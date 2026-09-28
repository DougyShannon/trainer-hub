// The Trainer cards practice games play automatically. Each entry says when the card can be
// played, what it does, and (for cards that need a choice) what happens once the choice is made.
// Anything not listed here can still be played but does nothing, and the table says so.

import { otherSeat, type Seat } from "../game-types";
import {
  ask,
  draw,
  evolveSlot,
  flip,
  isBasicEnergy,
  isBasicPokemon,
  isItem,
  isPokemon,
  isSupporter,
  isTool,
  log,
  newSlot,
  plural,
  shuffle,
  slotAt,
  slotKeys,
  switchActive,
  topCard,
  BENCH_SIZE,
} from "./engine";
import type { PCard, PPlayer, PSlot, PState, SlotKey } from "./types";

type Data = Record<string, unknown>;
export type TrainerEffect = {
  /** Why the card can't be played right now, or null if it can. */
  canPlay?: (state: PState, seat: Seat, card: PCard) => string | null;
  play: (state: PState, seat: Seat, card: PCard) => void;
  resume?: (state: PState, seat: Seat, picks: string[], data: Data) => void;
};

// ----- Helpers -----

const me = (state: PState, seat: Seat) => state.players[seat];
const them = (state: PState, seat: Seat) => state.players[otherSeat(seat)];

const benchSlots = (p: PPlayer) => p.bench.map((_, i) => `bench:${i}`);

/** Removes cards from a zone by uid, keeping their order. */
function pull(zone: PCard[], uids: string[]) {
  const taken: PCard[] = [];
  for (const uid of uids) {
    const i = zone.findIndex((c) => c.uid === uid);
    if (i >= 0) taken.push(zone.splice(i, 1)[0]);
  }
  return taken;
}

const names = (cards: PCard[]) => (cards.length ? cards.map((c) => c.name).join(", ") : "nothing");

/**
 * Lets the player search their deck for cards matching `match`. The whole deck is shown so a
 * human can see what's there. Searching can always come up empty (min 0), as in the real game.
 */
function searchDeck(state: PState, seat: Seat, card: PCard, title: string, match: (c: PCard) => boolean, max: number, data: Data = {}) {
  const p = me(state, seat);
  const options = p.deck.filter(match).map((c) => c.uid);
  if (!options.length) {
    shuffle(p.deck);
    log(state, seat, `${p.name} searched their deck but found nothing for ${card.name}.`);
    return;
  }
  ask(state, { seat, title, zone: "deck", options, shown: p.deck.map((c) => c.uid), min: 0, max, effect: card.name, data });
}

/** Looks at the top N cards; the player may take matching ones and the rest are shuffled back. */
function lookAtTop(state: PState, seat: Seat, card: PCard, n: number, title: string, match: (c: PCard) => boolean) {
  const p = me(state, seat);
  const top = p.deck.slice(0, n);
  const options = top.filter(match).map((c) => c.uid);
  if (!options.length) {
    shuffle(p.deck);
    log(state, seat, `${p.name} looked at the top ${plural(top.length, "card")} and found nothing for ${card.name}.`);
    return;
  }
  ask(state, { seat, title, zone: "deck", options, shown: top.map((c) => c.uid), min: 0, max: 1, effect: card.name });
}

function toHand(state: PState, seat: Seat, card: PCard, picks: string[]) {
  const p = me(state, seat);
  const found = pull(p.deck, picks);
  p.hand.push(...found);
  shuffle(p.deck);
  log(state, seat, `${p.name} put ${names(found)} into their hand with ${card.name}.`);
}

function toBench(state: PState, seat: Seat, card: PCard, picks: string[]) {
  const p = me(state, seat);
  const found = pull(p.deck, picks).slice(0, BENCH_SIZE - p.bench.length);
  for (const c of found) p.bench.push(newSlot(c, state.turn));
  shuffle(p.deck);
  log(state, seat, `${p.name} put ${names(found)} onto their Bench with ${card.name}.`);
}

const benchFull = (state: PState, seat: Seat) => (me(state, seat).bench.length >= BENCH_SIZE ? "Your Bench is full." : null);

/** "Discard N other cards from your hand" costs, asked before the effect. */
function discardCost(state: PState, seat: Seat, card: PCard, n: number) {
  const p = me(state, seat);
  ask(state, {
    seat,
    title: `Discard ${plural(n, "card")} from your hand for ${card.name}`,
    zone: "hand",
    options: p.hand.map((c) => c.uid),
    min: n,
    max: n,
    effect: card.name,
    data: { step: "cost" },
  });
}
function payDiscard(state: PState, seat: Seat, picks: string[]) {
  const p = me(state, seat);
  const gone = pull(p.hand, picks);
  p.discard.push(...gone);
  log(state, seat, `${p.name} discarded ${names(gone)}.`);
}
const needsOtherCards = (n: number) => (state: PState, seat: Seat) =>
  me(state, seat).hand.length - 1 < n ? `You need ${plural(n, "other card")} in your hand to discard.` : null;

/** Moves the chosen opponent's Benched Pokémon into their Active Spot. */
function gust(state: PState, seat: Seat, card: PCard) {
  const opp = them(state, seat);
  ask(state, {
    seat,
    title: `Choose 1 of ${opp.name}'s Benched Pokémon to switch into the Active Spot`,
    zone: "oppBench",
    options: benchSlots(opp),
    min: 1,
    max: 1,
    effect: card.name,
  });
}
function resumeGust(state: PState, seat: Seat, picks: string[]) {
  const opp = them(state, seat);
  const index = Number(picks[0].split(":")[1]);
  const name = topCard(opp.bench[index]).name;
  switchActive(opp, index);
  log(state, seat, `${name} was switched into ${opp.name}'s Active Spot.`);
}
const oppHasBench = (state: PState, seat: Seat) => (them(state, seat).bench.length ? null : "Your opponent has no Benched Pokémon.");

/** Cards and Pokémon that could still evolve from a Basic in play with Rare Candy. */
function candyPairs(state: PState, seat: Seat) {
  const p = me(state, seat);
  const pairs: { hand: string; slot: SlotKey }[] = [];
  if (state.turn <= 2) return pairs;
  for (const c of p.hand) {
    if (!c.candyFrom || !c.subtypes.includes("Stage 2")) continue;
    for (const key of slotKeys(p)) {
      const s = slotAt(p, key)!;
      if (s.pokemon.length === 1 && isBasicPokemon(s.pokemon[0]) && s.pokemon[0].name === c.candyFrom && s.playedTurn !== state.turn) {
        pairs.push({ hand: c.uid, slot: key });
      }
    }
  }
  return pairs;
}

// ----- The cards -----

export const TRAINERS: Record<string, TrainerEffect> = {
  // Supporters
  "Professor's Research": {
    play(state, seat) {
      const p = me(state, seat);
      p.discard.push(...p.hand.splice(0));
      draw(p, 7);
      log(state, seat, `${p.name} discarded their hand and drew 7 cards.`);
    },
  },
  Iono: {
    play(state) {
      for (const s of ["p1", "p2"] as Seat[]) {
        const p = state.players[s];
        p.deck.push(...shuffle(p.hand.splice(0)));
        draw(p, p.prizes.length);
      }
      log(state, null, "Each player put their hand on the bottom of their deck and drew a card for each of their remaining Prize cards.");
    },
  },
  Judge: {
    play(state) {
      for (const s of ["p1", "p2"] as Seat[]) {
        const p = state.players[s];
        p.deck.push(...p.hand.splice(0));
        shuffle(p.deck);
        draw(p, 4);
      }
      log(state, null, "Each player shuffled their hand into their deck and drew 4 cards.");
    },
  },
  Marnie: {
    play(state, seat) {
      for (const s of ["p1", "p2"] as Seat[]) {
        const p = state.players[s];
        p.deck.push(...shuffle(p.hand.splice(0)));
        draw(p, s === seat ? 5 : 4);
      }
      log(state, null, `Each player put their hand on the bottom of their deck. ${me(state, seat).name} drew 5 cards and ${them(state, seat).name} drew 4.`);
    },
  },
  "Boss's Orders": { canPlay: oppHasBench, play: gust, resume: resumeGust },
  Arven: {
    play(state, seat, card) {
      searchDeck(state, seat, card, "Choose an Item card to put into your hand", (c) => isItem(c) && !isTool(c), 1, { step: "item" });
      if (!state.prompt) TRAINERS.Arven.resume!(state, seat, [], { step: "item" });
    },
    resume(state, seat, picks, data) {
      const card = { name: "Arven" } as PCard;
      if (data.step === "item") {
        const p = me(state, seat);
        const found = pull(p.deck, picks);
        p.hand.push(...found);
        if (found.length) log(state, seat, `${p.name} put ${names(found)} into their hand with Arven.`);
        searchDeck(state, seat, card, "Choose a Pokémon Tool card to put into your hand", isTool, 1, { step: "tool" });
        return;
      }
      toHand(state, seat, card, picks);
    },
  },

  // Items that find Pokémon
  "Nest Ball": {
    canPlay: benchFull,
    play: (state, seat, card) => searchDeck(state, seat, card, "Choose a Basic Pokémon to put onto your Bench", isBasicPokemon, 1),
    resume: (state, seat, picks) => toBench(state, seat, { name: "Nest Ball" } as PCard, picks),
  },
  "Buddy-Buddy Poffin": {
    canPlay: benchFull,
    play: (state, seat, card) =>
      searchDeck(
        state,
        seat,
        card,
        "Choose up to 2 Basic Pokémon with 70 HP or less for your Bench",
        (c) => isBasicPokemon(c) && (c.hp ?? 0) <= 70,
        Math.min(2, BENCH_SIZE - me(state, seat).bench.length),
      ),
    resume: (state, seat, picks) => toBench(state, seat, { name: "Buddy-Buddy Poffin" } as PCard, picks),
  },
  "Battle VIP Pass": {
    canPlay: (state, seat) => (state.turn > 2 ? "You can use this card only during your first turn." : benchFull(state, seat)),
    play: (state, seat, card) =>
      searchDeck(state, seat, card, "Choose up to 2 Basic Pokémon for your Bench", isBasicPokemon, Math.min(2, BENCH_SIZE - me(state, seat).bench.length)),
    resume: (state, seat, picks) => toBench(state, seat, { name: "Battle VIP Pass" } as PCard, picks),
  },
  "Ultra Ball": {
    canPlay: needsOtherCards(2),
    play: (state, seat, card) => discardCost(state, seat, card, 2),
    resume(state, seat, picks, data) {
      const card = { name: "Ultra Ball" } as PCard;
      if (data.step === "cost") {
        payDiscard(state, seat, picks);
        return searchDeck(state, seat, card, "Choose a Pokémon to put into your hand", isPokemon, 1);
      }
      toHand(state, seat, card, picks);
    },
  },
  "Quick Ball": {
    canPlay: needsOtherCards(1),
    play: (state, seat, card) => discardCost(state, seat, card, 1),
    resume(state, seat, picks, data) {
      const card = { name: "Quick Ball" } as PCard;
      if (data.step === "cost") {
        payDiscard(state, seat, picks);
        return searchDeck(state, seat, card, "Choose a Basic Pokémon to put into your hand", isBasicPokemon, 1);
      }
      toHand(state, seat, card, picks);
    },
  },
  "Level Ball": {
    play: (state, seat, card) => searchDeck(state, seat, card, "Choose a Pokémon with 90 HP or less", (c) => isPokemon(c) && (c.hp ?? 0) <= 90, 1),
    resume: (state, seat, picks) => toHand(state, seat, { name: "Level Ball" } as PCard, picks),
  },
  "Poké Ball": {
    play(state, seat, card) {
      const heads = flip();
      log(state, seat, `Coin flip for Poké Ball: ${heads ? "heads" : "tails"}.`, "coin");
      if (heads) searchDeck(state, seat, card, "Choose a Pokémon to put into your hand", isPokemon, 1);
    },
    resume: (state, seat, picks) => toHand(state, seat, { name: "Poké Ball" } as PCard, picks),
  },
  "Great Ball": {
    play: (state, seat, card) => lookAtTop(state, seat, card, 7, "You may take a Pokémon from the top 7 cards", isPokemon),
    resume: (state, seat, picks) => toHand(state, seat, { name: "Great Ball" } as PCard, picks),
  },

  // Items that find other cards
  "Pokégear 3.0": {
    play: (state, seat, card) => lookAtTop(state, seat, card, 7, "You may take a Supporter from the top 7 cards", isSupporter),
    resume: (state, seat, picks) => toHand(state, seat, { name: "Pokégear 3.0" } as PCard, picks),
  },
  "Energy Search": {
    play: (state, seat, card) => searchDeck(state, seat, card, "Choose a Basic Energy card", isBasicEnergy, 1),
    resume: (state, seat, picks) => toHand(state, seat, { name: "Energy Search" } as PCard, picks),
  },
  "Earthen Vessel": {
    canPlay: needsOtherCards(1),
    play: (state, seat, card) => discardCost(state, seat, card, 1),
    resume(state, seat, picks, data) {
      const card = { name: "Earthen Vessel" } as PCard;
      if (data.step === "cost") {
        payDiscard(state, seat, picks);
        return searchDeck(state, seat, card, "Choose up to 2 Basic Energy cards", isBasicEnergy, 2);
      }
      toHand(state, seat, card, picks);
    },
  },

  // Items that use the discard pile
  "Energy Retrieval": {
    canPlay: (state, seat) => (me(state, seat).discard.some(isBasicEnergy) ? null : "There's no Basic Energy in your discard pile."),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose up to 2 Basic Energy cards to put into your hand",
        zone: "discard",
        options: p.discard.filter(isBasicEnergy).map((c) => c.uid),
        min: 1,
        max: 2,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const back = pull(p.discard, picks);
      p.hand.push(...back);
      log(state, seat, `${p.name} put ${names(back)} from their discard pile into their hand.`);
    },
  },
  "Night Stretcher": {
    canPlay: (state, seat) => (me(state, seat).discard.some((c) => isPokemon(c) || isBasicEnergy(c)) ? null : "There's nothing in your discard pile to take."),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose a Pokémon or Basic Energy card to put into your hand",
        zone: "discard",
        options: p.discard.filter((c) => isPokemon(c) || isBasicEnergy(c)).map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume: (state, seat, picks) => TRAINERS["Energy Retrieval"].resume!(state, seat, picks, {}),
  },
  "Super Rod": {
    canPlay: (state, seat) => (me(state, seat).discard.some((c) => isPokemon(c) || isBasicEnergy(c)) ? null : "There's nothing in your discard pile to shuffle back."),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose up to 3 Pokémon and Basic Energy cards to shuffle into your deck",
        zone: "discard",
        options: p.discard.filter((c) => isPokemon(c) || isBasicEnergy(c)).map((c) => c.uid),
        min: 1,
        max: 3,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const back = pull(p.discard, picks);
      p.deck.push(...back);
      shuffle(p.deck);
      log(state, seat, `${p.name} shuffled ${names(back)} back into their deck.`);
    },
  },

  // Switching
  Switch: {
    canPlay: (state, seat) => (me(state, seat).bench.length ? null : "You have no Benched Pokémon."),
    play(state, seat, card) {
      ask(state, {
        seat,
        title: "Choose a Benched Pokémon to switch with your Active Pokémon",
        zone: "myBench",
        options: benchSlots(me(state, seat)),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const index = Number(picks[0].split(":")[1]);
      const name = topCard(p.bench[index]).name;
      switchActive(p, index);
      log(state, seat, `${p.name} switched ${name} into the Active Spot.`);
    },
  },
  "Switch Cart": {
    canPlay: (state, seat) => {
      const p = me(state, seat);
      if (!p.bench.length) return "You have no Benched Pokémon.";
      return p.active && isBasicPokemon(topCard(p.active)) ? null : "Your Active Pokémon must be a Basic Pokémon.";
    },
    play: (state, seat, card) => TRAINERS.Switch.play(state, seat, card),
    resume(state, seat, picks) {
      const p = me(state, seat);
      const moved = p.active!;
      TRAINERS.Switch.resume!(state, seat, picks, {});
      moved.damage = Math.max(0, moved.damage - 30);
    },
  },
  "Counter Catcher": {
    canPlay: (state, seat) =>
      me(state, seat).prizes.length <= them(state, seat).prizes.length
        ? "You can use this only if you have more Prize cards left than your opponent."
        : oppHasBench(state, seat),
    play: gust,
    resume: resumeGust,
  },
  "Pokémon Catcher": {
    canPlay: oppHasBench,
    play(state, seat, card) {
      const heads = flip();
      log(state, seat, `Coin flip for Pokémon Catcher: ${heads ? "heads" : "tails"}.`, "coin");
      if (heads) gust(state, seat, card);
    },
    resume: resumeGust,
  },

  // Healing
  Potion: {
    canPlay: (state, seat) => (slotKeys(me(state, seat)).some((k) => slotAt(me(state, seat), k)!.damage) ? null : "None of your Pokémon have damage."),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose a Pokémon to heal 30 damage from",
        zone: "myPokemon",
        options: slotKeys(p).filter((k) => slotAt(p, k)!.damage),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const slot = slotAt(me(state, seat), picks[0] as SlotKey)!;
      slot.damage = Math.max(0, slot.damage - 30);
      log(state, seat, `${topCard(slot).name} was healed.`);
    },
  },

  // Evolution
  "Rare Candy": {
    canPlay: (state, seat) =>
      state.turn <= 2
        ? "You can't use Rare Candy during your first turn."
        : candyPairs(state, seat).length
          ? null
          : "You need a Stage 2 Pokémon in your hand and the Basic Pokémon it evolves from in play (not played this turn).",
    play(state, seat, card) {
      const pairs = candyPairs(state, seat);
      ask(state, {
        seat,
        title: "Choose a Stage 2 Pokémon from your hand",
        zone: "hand",
        options: [...new Set(pairs.map((x) => x.hand))],
        min: 1,
        max: 1,
        effect: card.name,
        data: { step: "stage2" },
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (data.step === "stage2") {
        const options = candyPairs(state, seat).filter((x) => x.hand === picks[0]).map((x) => x.slot);
        if (options.length === 1) return TRAINERS["Rare Candy"].resume!(state, seat, options, { step: "basic", stage2: picks[0] });
        ask(state, {
          seat,
          title: "Choose the Basic Pokémon to evolve",
          zone: "myPokemon",
          options,
          min: 1,
          max: 1,
          effect: "Rare Candy",
          data: { step: "basic", stage2: picks[0] },
        });
        return;
      }
      const slot = slotAt(p, picks[0] as SlotKey)!;
      const [stage2] = pull(p.hand, [String(data.stage2)]);
      const from = topCard(slot).name;
      evolveSlot(state, slot, stage2);
      log(state, seat, `${p.name} used Rare Candy to evolve ${from} into ${stage2.name}.`);
    },
  },
};

/** The effect for a Trainer card. Reprints like "Boss's Orders (Ghetsis)" share one entry. */
export const trainerFor = (name: string): TrainerEffect | undefined => TRAINERS[name.replace(/\s*\(.*\)$/, "")];

// ----- Pokémon Tools -----

const isEx = (c: PCard) => c.subtypes.includes("ex");
const isV = (c: PCard) => c.subtypes.some((s) => s === "V" || s === "VMAX" || s === "VSTAR");

/** Extra damage from the attacker's Tool, before Weakness and Resistance. */
export function toolDamageBonus(state: PState, seat: Seat, attacker: PSlot, defender: PSlot) {
  const tool = attacker.tool?.name;
  const target = topCard(defender);
  if (tool === "Vitality Band") return 10;
  if (tool === "Muscle Band") return 20;
  if (tool === "Choice Belt" && isV(target)) return 30;
  if (tool === "Maximum Belt" && isEx(target)) return 50;
  if (tool === "Defiance Band" && me(state, seat).prizes.length > them(state, seat).prizes.length) return 30;
  return 0;
}

/** Extra HP from a Pokémon's Tool. */
export function toolHpBonus(slot: PSlot) {
  const tool = slot.tool?.name;
  if (tool === "Hero's Cape") return 100;
  if (tool === "Big Charm") return 30;
  if (tool === "Bravery Charm" && isBasicPokemon(topCard(slot))) return 50;
  return 0;
}

export const AUTOMATED_TOOLS = ["Vitality Band", "Muscle Band", "Choice Belt", "Maximum Belt", "Defiance Band", "Hero's Cape", "Big Charm", "Bravery Charm"];
