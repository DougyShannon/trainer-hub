// Things a player can do during their turn that aren't playing a card from their hand: using the
// Stadium in play ("Once during each player's turn..."), discarding an Antique Fossil from play,
// taking Grant back from the discard pile and using a Seal Stone's VSTAR Power. The table shows
// each one as a button, and the computer uses them too.

import type { Seat } from "../game-types";
import {
  ask,
  draw,
  fail,
  evolveSlot,
  flip,
  isBasicEnergy,
  isBasicPokemon,
  isEnergy,
  isItem,
  isPokemon,
  isTool,
  log,
  shuffle,
  slotAt,
  slotKeys,
  topCard,
} from "./engine";
import {
  addEffect,
  attachedTo,
  baseName,
  benchLimit,
  hasRuleBox,
  inPlay,
  isFossil,
  isV,
  ofType,
  stadiumName,
  toolNames,
  toolsOn,
  trainersPokemon,
} from "./effects";
import { heal, recover, searchToHand, drawUntil, doSwitch } from "./trainers-more";
import { me, names, pull, searchDeck, toBench, type TrainerEffect } from "./trainers";
import { abilityActions, runAbilityAction } from "./abilities";
import type { PCard, PState, SlotKey } from "./types";

type Data = Record<string, unknown>;

// ----- Shared prompt helpers -----

/** Asks a player to pick from plain labelled choices, like "Yes" and "No". */
export function askChoice(
  state: PState,
  seat: Seat,
  title: string,
  choices: { id: string; label: string }[],
  effect: string,
  opts: { min?: number; max?: number; data?: Data } = {},
) {
  ask(state, {
    seat,
    title,
    zone: "choice",
    options: choices.map((c) => c.id),
    labels: Object.fromEntries(choices.map((c) => [c.id, c.label])),
    min: opts.min ?? 1,
    max: opts.max ?? 1,
    effect,
    data: opts.data,
  });
}

/** Discard cards from the hand as a cost. `match` limits which cards count. */
export function askDiscard(state: PState, seat: Seat, title: string, match: (c: PCard) => boolean, n: number, effect: string, data: Data = {}) {
  const p = me(state, seat);
  ask(state, {
    seat,
    title,
    zone: "hand",
    options: p.hand.filter(match).map((c) => c.uid),
    min: n,
    max: n,
    effect,
    data: { ...data, step: "cost" },
  });
}

const heals = (state: PState, seat: Seat, amount: number) => {
  for (const slot of inPlay(me(state, seat))) heal(slot, amount);
  log(state, seat, `Each of ${me(state, seat).name}'s Pokémon was healed ${amount} damage.`);
};

// ----- Stadiums -----

const psychicInPlay = (state: PState, seat: Seat) => inPlay(me(state, seat)).filter((s) => ofType(topCard(s), "Psychic")).length;
const playedSupporter = (state: PState, seat: Seat, test: (name: string) => boolean = () => true) =>
  (me(state, seat).used ?? []).some((u) => u.startsWith("supporter:") && test(u.slice(10)));
const benchRoom = (state: PState, seat: Seat) => (me(state, seat).bench.length >= benchLimit(state, seat) ? "Your Bench is full." : null);
const hasDeck = (state: PState, seat: Seat) => (me(state, seat).deck.length ? null : "Your deck is empty.");

// Built on first use: this module and engine.ts import each other, so card tests like isTool
// aren't ready while the modules are still loading.
let stadiums: Record<string, TrainerEffect> | null = null;
const STADIUM_USES = () => (stadiums ??= buildStadiums());

/** Card-effect shapes reused for Stadiums: canPlay says whether it can be used now. */
const buildStadiums = (): Record<string, TrainerEffect> => ({
  "Mystery Garden": {
    canPlay: (state, seat) =>
      !me(state, seat).hand.some(isEnergy)
        ? "You need an Energy card in your hand to discard."
        : psychicInPlay(state, seat) <= me(state, seat).hand.length - 1
          ? "You'd draw nothing: you already have as many cards as Psychic Pokémon in play."
          : null,
    play: (state, seat, card) => askDiscard(state, seat, "Mystery Garden: discard an Energy card from your hand", isEnergy, 1, card.name),
    resume(state, seat, picks) {
      discardPicked(state, seat, picks);
      drawUntil((s, st) => psychicInPlay(s, st)).play(state, seat, {} as PCard);
    },
  },
  "Surfing Beach": {
    canPlay: (state, seat) => {
      const p = me(state, seat);
      if (!p.active || !ofType(topCard(p.active), "Water")) return "Your Active Pokémon isn't a Water Pokémon.";
      return p.bench.some((s) => ofType(topCard(s), "Water")) ? null : "You have no Benched Water Pokémon.";
    },
    play(state, seat, card) {
      const p = me(state, seat);
      const options = p.bench.map((s, i) => (ofType(topCard(s), "Water") ? `bench:${i}` : "")).filter(Boolean);
      ask(state, {
        seat,
        title: "Surfing Beach: choose a Benched Water Pokémon to switch in",
        zone: "myBench",
        options,
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume: (state, seat, picks) => void doSwitch(state, seat, picks),
  },
  "Team Rocket's Factory": {
    canPlay: (state, seat) => (playedSupporter(state, seat, (n) => n.startsWith("Team Rocket")) ? null : 'Play a "Team Rocket" Supporter first this turn.'),
    play(state, seat) {
      draw(me(state, seat), 2);
      log(state, seat, `${me(state, seat).name} drew 2 cards.`);
    },
  },
  "Prism Tower": {
    canPlay: (state, seat) => (me(state, seat).hand.length >= 2 ? null : "You need 2 cards in your hand to discard."),
    play: (state, seat, card) => askDiscard(state, seat, "Prism Tower: discard 2 cards from your hand", () => true, 2, card.name),
    resume(state, seat, picks) {
      discardPicked(state, seat, picks);
      draw(me(state, seat), 1);
      log(state, seat, `${me(state, seat).name} drew a card.`);
    },
  },
  "Fossil Quarry": {
    canPlay: (state, seat) => benchRoom(state, seat) ?? hasDeck(state, seat),
    play: (state, seat, card) =>
      searchDeck(
        state,
        seat,
        card,
        "Choose up to 2 Antique Item cards to put onto your Bench",
        (c) => isItem(c) && c.name.includes("Antique"),
        Math.min(2, benchLimit(state, seat) - me(state, seat).bench.length),
      ),
    resume: (state, seat, picks) => toBench(state, seat, { name: "Fossil Quarry" } as PCard, picks),
  },
  PokéStop: {
    canPlay: hasDeck,
    play(state, seat) {
      const p = me(state, seat);
      const top = p.deck.splice(0, 3);
      const items = top.filter((c) => isItem(c) && !isTool(c));
      p.hand.push(...items);
      p.discard.push(...top.filter((c) => !items.includes(c)));
      log(state, seat, `PokéStop: ${p.name} discarded ${names(top)} and kept ${names(items)}.`);
    },
  },
  Mesagoza: {
    canPlay: hasDeck,
    play(state, seat, card) {
      const heads = flip();
      log(state, seat, `Coin flip for Mesagoza: ${heads ? "heads" : "tails"}.`, "coin");
      if (heads) searchDeck(state, seat, card, "Mesagoza: choose a Pokémon to put into your hand", isPokemon, 1);
    },
    resume: (state, seat, picks) => toHandFromDeck(state, seat, "Mesagoza", picks),
  },
  "Spikemuth Gym": searchToHand("Spikemuth Gym: choose a Marnie's Pokémon", (c) => trainersPokemon(c, "Marnie"), 1),
  Levincia: recover("Levincia: choose up to 2 Basic Lightning Energy cards", (c) => isBasicEnergy(c) && c.name.includes("Lightning"), 2, "hand"),
  Artazon: {
    canPlay: (state, seat) => benchRoom(state, seat) ?? hasDeck(state, seat),
    play: (state, seat, card) =>
      searchDeck(state, seat, card, "Artazon: choose a Basic Pokémon without a Rule Box for your Bench", (c) => isBasicPokemon(c) && !hasRuleBox(c), 1),
    resume: (state, seat, picks) => toBench(state, seat, { name: "Artazon" } as PCard, picks),
  },
  "Town Store": searchToHand("Town Store: choose a Pokémon Tool card", isTool, 1),
  "Cycling Road": {
    canPlay: (state, seat) => (me(state, seat).hand.some(isBasicEnergy) ? null : "You need a Basic Energy card in your hand to discard."),
    play: (state, seat, card) => askDiscard(state, seat, "Cycling Road: discard a Basic Energy card", isBasicEnergy, 1, card.name),
    resume(state, seat, picks) {
      discardPicked(state, seat, picks);
      draw(me(state, seat), 1);
      log(state, seat, `${me(state, seat).name} drew a card.`);
    },
  },
  "Moonlit Hill": {
    canPlay: (state, seat) =>
      me(state, seat).hand.some((c) => isBasicEnergy(c) && c.name.includes("Psychic")) ? null : "You need a Basic Psychic Energy card in your hand.",
    play: (state, seat, card) =>
      askDiscard(state, seat, "Moonlit Hill: discard a Basic Psychic Energy card", (c) => isBasicEnergy(c) && c.name.includes("Psychic"), 1, card.name),
    resume(state, seat, picks) {
      discardPicked(state, seat, picks);
      heals(state, seat, 30);
    },
  },
  "Academy at Night": {
    canPlay: (state, seat) => (me(state, seat).hand.length ? null : "Your hand is empty."),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Academy at Night: choose a card to put on top of your deck",
        zone: "hand",
        options: p.hand.map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const moved = pull(p.hand, picks);
      p.deck.unshift(...moved);
      log(state, seat, `${p.name} put a card on top of their deck.`);
    },
  },
  "Grand Tree": {
    canPlay: (state, seat) => (grandTreeTargets(state, seat).length ? null : "None of your Basic Pokémon can evolve from your deck right now."),
    play(state, seat, card) {
      ask(state, {
        seat,
        title: "Grand Tree: choose a Basic Pokémon to evolve",
        zone: "myPokemon",
        options: grandTreeTargets(state, seat),
        min: 1,
        max: 1,
        effect: card.name,
        data: { step: "basic" },
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (data.step === "basic") {
        const slot = slotAt(p, picks[0] as SlotKey)!;
        const name = topCard(slot).name;
        return searchDeck(
          state,
          seat,
          { name: "Grand Tree" } as PCard,
          `Choose a Stage 1 Pokémon that evolves from ${name}`,
          (c) => c.evolvesFrom === name,
          1,
          { step: "stage1", slot: picks[0] },
        );
      }
      const slot = slotAt(p, data.slot as SlotKey);
      const [card] = pull(p.deck, picks);
      if (!slot || !card) return void shuffle(p.deck);
      const from = topCard(slot).name;
      evolveSlot(state, slot, card);
      log(state, seat, `Grand Tree: ${p.name} evolved ${from} into ${card.name}.`);
      if (data.step === "stage1" && p.deck.some((c) => c.evolvesFrom === card.name)) {
        return searchDeck(
          state,
          seat,
          { name: "Grand Tree" } as PCard,
          `You may also evolve ${card.name} into a Stage 2 Pokémon`,
          (c) => c.evolvesFrom === card.name,
          1,
          { step: "stage2", slot: data.slot },
        );
      }
      shuffle(p.deck);
    },
  },
  "Primordial Altar": {
    canPlay: hasDeck,
    play(state, seat, card) {
      const top = me(state, seat).deck[0];
      askChoice(
        state,
        seat,
        `Primordial Altar: the top card of your deck is ${top.name}`,
        [
          { id: "keep", label: "Leave it on top" },
          { id: "discard", label: `Discard ${top.name}` },
        ],
        card.name,
      );
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      if (picks[0] !== "discard") return;
      const gone = p.deck.shift();
      if (gone) p.discard.push(gone);
      log(state, seat, `${p.name} discarded the top card of their deck.`);
    },
  },
  "Magma Basin": {
    canPlay: (state, seat) => {
      const p = me(state, seat);
      if (!p.discard.some((c) => isEnergy(c) && c.name.includes("Fire"))) return "There's no Fire Energy in your discard pile.";
      return p.bench.some((s) => ofType(topCard(s), "Fire")) ? null : "You have no Benched Fire Pokémon.";
    },
    play(state, seat, card) {
      const p = me(state, seat);
      const options = p.bench.map((s, i) => (ofType(topCard(s), "Fire") ? `bench:${i}` : "")).filter(Boolean);
      ask(state, {
        seat,
        title: "Magma Basin: choose a Benched Fire Pokémon to attach a Fire Energy to",
        zone: "myBench",
        options,
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const slot = slotAt(p, picks[0] as SlotKey)!;
      const e = p.discard.find((c) => isEnergy(c) && c.name.includes("Fire"));
      if (!e) return;
      p.discard.splice(p.discard.indexOf(e), 1);
      slot.energy.push(e);
      slot.damage += 20;
      log(state, seat, `Magma Basin attached ${e.name} to ${topCard(slot).name} and put 2 damage counters on it.`);
    },
  },
  "Champions Festival": {
    canPlay: (state, seat) => (inPlay(me(state, seat)).length >= 6 ? null : "You need 6 Pokémon in play."),
    play: (state, seat) => heals(state, seat, 10),
  },
  "Community Center": {
    canPlay: (state, seat) => (playedSupporter(state, seat) ? null : "Play a Supporter first this turn."),
    play: (state, seat) => heals(state, seat, 10),
  },
  "Jubilife Village": {
    play(state, seat) {
      const p = me(state, seat);
      p.deck.push(...p.hand.splice(0));
      shuffle(p.deck);
      draw(p, 5);
      log(state, seat, `Jubilife Village: ${p.name} shuffled their hand into their deck, drew 5 cards and ended their turn.`);
      state.pendingEnd = true;
    },
  },
});

function discardPicked(state: PState, seat: Seat, picks: string[]) {
  const p = me(state, seat);
  const gone = pull(p.hand, picks);
  p.discard.push(...gone);
  log(state, seat, `${p.name} discarded ${names(gone)}.`);
}

function toHandFromDeck(state: PState, seat: Seat, source: string, picks: string[]) {
  const p = me(state, seat);
  const found = pull(p.deck, picks);
  p.hand.push(...found);
  shuffle(p.deck);
  log(state, seat, `${p.name} put ${names(found)} into their hand with ${source}.`);
}

function grandTreeTargets(state: PState, seat: Seat): SlotKey[] {
  const p = me(state, seat);
  if (state.turn <= 2) return [];
  return slotKeys(p).filter((k) => {
    const s = slotAt(p, k)!;
    return s.pokemon.length === 1 && isBasicPokemon(s.pokemon[0]) && s.playedTurn !== state.turn && p.deck.some((c) => c.evolvesFrom === s.pokemon[0].name);
  });
}

const STADIUM_NAMES = [
  "Mystery Garden",
  "Surfing Beach",
  "Team Rocket's Factory",
  "Prism Tower",
  "Fossil Quarry",
  "PokéStop",
  "Mesagoza",
  "Spikemuth Gym",
  "Levincia",
  "Artazon",
  "Town Store",
  "Cycling Road",
  "Moonlit Hill",
  "Academy at Night",
  "Grand Tree",
  "Primordial Altar",
  "Magma Basin",
  "Champions Festival",
  "Community Center",
  "Jubilife Village",
];

export const AUTOMATED_STADIUMS = [
  ...STADIUM_NAMES,
  // Stadiums that change the rules while they're in play (see effects.ts).
  "Forest of Vitality",
  "Risky Ruins",
  "Battle Cage",
  "Dizzying Valley",
  "Nighttime Mine",
  "Team Rocket's Watchtower",
  "Jamming Tower",
  "Beach Court",
  "Granite Cave",
  "Calamitous Snowy Mountain",
  "Calamitous Wasteland",
  "Practice Studio",
  "Pokémon League Headquarters",
  "Full Metal Lab",
  "Perilous Jungle",
  "Festival Grounds",
  "Neutralization Zone",
  "Area Zero Underdepths",
  "Gravity Mountain",
  "Lively Stadium",
  "N's Castle",
  "Postwick",
  "Paradise Resort",
  "Gapejaw Bog",
  "Temple of Sinnoh",
  "Lake Acuity",
  "Lost City",
  "Collapsed Stadium",
];

// ----- Other card actions -----

let seals: Record<string, TrainerEffect> | null = null;
const SEAL_STONES = () => (seals ??= buildSeals());
const buildSeals = (): Record<string, TrainerEffect> => ({
  "Forest Seal Stone": searchToHand("Star Alchemy: choose any card to put into your hand", () => true, 1),
  "Sky Seal Stone": {
    play(state, seat) {
      addEffect(state, {
        kind: "morePrizes",
        seat,
        turn: state.turn,
        amount: 1,
        vs: "V",
        source: "Star Order",
      });
      log(state, seat, "Star Order: if a Basic Pokémon V Knocks Out a VSTAR or VMAX this turn, take 1 more Prize card.");
    },
  },
});

const GRANT: TrainerEffect = {
  play: (state, seat, card) =>
    askDiscard(
      state,
      seat,
      "Grant: discard 2 cards (not Grant) from your hand to take Grant back",
      (c) => baseName(c.name) !== "Grant",
      2,
      "Grant (discard pile)",
      { grant: card.uid },
    ),
  resume(state, seat, picks, data) {
    const p = me(state, seat);
    discardPicked(state, seat, picks);
    const back = pull(p.discard, [String(data.grant)]);
    p.hand.push(...back);
    log(state, seat, `${p.name} put Grant back into their hand.`);
  },
};

export type CardAction = {
  id: string;
  label: string;
  card: PCard;
  blocked: string | null;
};

/** The card actions open to a player right now (blocked ones say why). */
export function cardActions(state: PState, seat: Seat): CardAction[] {
  const p = me(state, seat);
  const list: CardAction[] = [];
  const used = p.used ?? [];
  const name = stadiumName(state);
  if (state.stadium && name && STADIUM_USES()[name]) {
    list.push({
      id: "stadium",
      label: `Use ${state.stadium.card.name}`,
      card: state.stadium.card,
      blocked: used.includes("stadium") ? "Once per turn, and you've used it." : (STADIUM_USES()[name].canPlay?.(state, seat, state.stadium.card) ?? null),
    });
  }
  for (const slot of inPlay(p)) {
    const top = topCard(slot);
    if (isFossil(top))
      list.push({
        id: `fossil:${top.uid}`,
        label: `Discard ${top.name} from play`,
        card: top,
        blocked: null,
      });
    for (const card of toolNames(state, slot).length ? toolsOn(slot) : []) {
      const tool = baseName(card.name);
      if (!SEAL_STONES()[tool]) continue;
      const blocked = !isV(top)
        ? "Only a Pokémon V can use it."
        : p.vstarUsed
          ? "You've already used a VSTAR Power this game."
          : (SEAL_STONES()[tool].canPlay?.(state, seat, card) ?? null);
      list.push({
        id: `seal:${card.uid}`,
        label: `Use ${card.abilities[0]?.name ?? tool} (${tool})`,
        card,
        blocked,
      });
    }
  }
  const grant = p.discard.find((c) => baseName(c.name) === "Grant");
  if (grant) {
    const others = p.hand.filter((c) => baseName(c.name) !== "Grant").length;
    list.push({
      id: `grant:${grant.uid}`,
      label: "Take Grant back from your discard pile",
      card: grant,
      blocked: others >= 2 ? null : "You need 2 other cards in your hand to discard.",
    });
  }
  list.push(...abilityActions(state, seat));
  return list;
}

export function runCardAction(state: PState, seat: Seat, id: string) {
  if (id.startsWith("ab:")) return runAbilityAction(state, seat, id);
  const action = cardActions(state, seat).find((a) => a.id === id) ?? fail("You can't do that right now.");
  if (action.blocked) fail(action.blocked);
  const p = me(state, seat);
  if (id === "stadium") {
    (p.used ??= []).push("stadium");
    log(state, seat, `${p.name} used ${action.card.name}.`);
    STADIUM_USES()[stadiumName(state)!].play(state, seat, action.card);
    return;
  }
  if (id.startsWith("fossil:")) {
    const key = slotKeys(p).find((k) => topCard(slotAt(p, k)!).uid === action.card.uid)!;
    const slot = slotAt(p, key)!;
    p.discard.push(...slot.pokemon, ...attachedTo(slot));
    if (key === "active") p.active = null;
    else p.bench.splice(Number(key.split(":")[1]), 1);
    log(state, seat, `${p.name} discarded ${action.card.name} from play.`);
    return;
  }
  if (id.startsWith("seal:")) {
    p.vstarUsed = true;
    log(state, seat, `${p.name} used the VSTAR Power on ${action.card.name}.`);
    SEAL_STONES()[baseName(action.card.name)].play(state, seat, action.card);
    return;
  }
  if (id.startsWith("grant:")) GRANT.play(state, seat, action.card);
}

/** Finds the effect that asked a choice, for card actions. */
export function actionEffect(effect: string): TrainerEffect | undefined {
  if (effect === "Grant (discard pile)") return GRANT;
  const base = baseName(effect);
  return STADIUM_USES()[base] ?? SEAL_STONES()[base];
}
