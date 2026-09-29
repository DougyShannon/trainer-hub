// The rest of the Standard Items and Supporters, so every Trainer card in a practice game does
// what it says. Built on the shapes in trainers-more.ts where they fit.

import { otherSeat, type Seat } from "../game-types";
import {
  ask,
  benchPokemon,
  draw,
  energyProvides,
  evolveSlot,
  flip,
  isBasicEnergy,
  isBasicPokemon,
  isEnergy,
  isItem,
  isPokemon,
  isStadium,
  isSupporter,
  isTool,
  log,
  plural,
  shuffle,
  slotAt,
  slotKeys,
  switchActive,
  topCard,
} from "./engine";
import { askChoice, askDiscard } from "./actions";
import { benchEnergyGuarded } from "./abilities";
import {
  addEffect,
  attachedTo,
  baseName,
  benchLimit,
  deckGuarded,
  hasRuleBox,
  inPlay,
  isEx,
  isMegaEx,
  isTera,
  isV,
  ofType,
  putCounters,
  removeTool,
  setCondition,
  supporterProof,
  toolsOn,
  trainersPokemon,
} from "./effects";
import {
  attachFromDiscard,
  askSwitch,
  basicEnergyOf,
  bothShuffleDraw,
  doSwitch,
  drawCards,
  drawUntil,
  either,
  heal,
  healOne,
  isEvolution,
  needBench,
  recover,
  searchToHand,
  shuffleDraw,
  topCards,
  wentSecondFirstTurn,
} from "./trainers-more";
import {
  benchSlots,
  me,
  names,
  needsOtherCards,
  oppHasBench,
  payDiscard,
  pull,
  resumeGust,
  searchDeck,
  them,
  toBench,
  toHand,
  type TrainerEffect,
} from "./trainers";
import type { PCard, PPlayer, PSlot, PState, SlotKey } from "./types";

type Data = Record<string, unknown>;
type Match = (c: PCard) => boolean;

// ----- Tests and small helpers -----

export const isSpecialEnergy = (c: PCard) => isEnergy(c) && !isBasicEnergy(c);
const isBasicOf = (owner: string) => (c: PCard) => isBasicPokemon(c) && trainersPokemon(c, owner);
const pokemonOfType = (type: string) => (c: PCard) => isPokemon(c) && ofType(c, type);
export const energyOf = (type: string) => (c: PCard) => isEnergy(c) && energyProvides(c).includes(type) && (isBasicEnergy(c) || c.name.includes(type));
const koLastTurn = (state: PState, seat: Seat) => me(state, seat).koTurn === state.turn - 1;
const firstTurn = (state: PState) => state.turn <= 2;
export const keyIndex = (key: string) => Number(key.split(":")[1]);
export const slotsOf = (p: PPlayer) => slotKeys(p).map((k) => ({ key: k, slot: slotAt(p, k)! }));
const lastPlayed = (state: PState, seat: Seat, name: string) =>
  me(state, seat)
    .discard.filter((c) => baseName(c.name) === name)
    .pop();

export function revealHand(state: PState, seat: Seat) {
  const opp = them(state, seat);
  log(state, otherSeat(seat), `${opp.name} revealed their hand: ${names(opp.hand)}.`);
}

export function endTurnNow(state: PState, seat: Seat, card: string) {
  log(state, seat, `${card} ends ${me(state, seat).name}'s turn.`);
  state.pendingEnd = true;
}

/** Discards a card attached to a Pokémon (a Tool or an Energy) into its owner's discard pile. */
export function discardAttached(state: PState, owner: Seat, slot: PSlot, card: PCard) {
  const p = state.players[owner];
  if (owner !== state.current && isBasicEnergy(card) && benchEnergyGuarded(state, owner, slot)) {
    log(state, owner, `Stand Sentry kept ${card.name} on ${topCard(slot).name}.`);
    return;
  }
  if (toolsOn(slot).includes(card)) removeTool(slot, card.uid);
  else slot.energy = slot.energy.filter((e) => e.uid !== card.uid);
  p.discard.push(card);
  log(state, owner, `${card.name} was discarded from ${topCard(slot).name}.`);
}

/** Labelled choices for cards attached to Pokémon. The id is "seat|slotKey|uid". */
export function attachedChoices(state: PState, seats: Seat[], test: (c: PCard, slot: PSlot) => boolean) {
  const list: { id: string; label: string }[] = [];
  for (const s of seats) {
    const p = state.players[s];
    for (const { key, slot } of slotsOf(p)) {
      for (const c of [...toolsOn(slot), ...slot.energy]) {
        if (test(c, slot))
          list.push({
            id: `${s}|${key}|${c.uid}`,
            label: `${c.name} on ${p.name}'s ${topCard(slot).name}`,
          });
      }
    }
  }
  return list;
}
export function fromAttachedId(state: PState, id: string) {
  const [s, key, uid] = id.split("|");
  const seat = s as Seat;
  const slot = slotAt(state.players[seat], key as SlotKey);
  const card = slot && [...toolsOn(slot), ...slot.energy].find((c) => c.uid === uid);
  return slot && card ? { seat, slot, card } : null;
}

/** Evolves a Pokémon down: the top `n` Evolution cards go to their owner's hand. */
export function devolve(state: PState, owner: Seat, slot: PSlot, n: number) {
  const p = state.players[owner];
  const off = slot.pokemon.splice(Math.max(1, slot.pokemon.length - n));
  p.hand.push(...off);
  slot.playedTurn = state.turn;
  slot.conditions = [];
  slot.effects = {};
  log(state, owner, `${names(off)} went back to ${p.name}'s hand; ${topCard(slot).name} is left in play.`);
}

// ----- Chains: attaching several Energy, and putting cards on top of the deck in order -----

/**
 * Attaches Energy cards one at a time to Pokémon the player picks. The cards stay where they are
 * (deck, discard pile or hand) until attached. `after` runs once all are placed.
 */
export type After = "shuffle" | "endTurn" | "draw3" | "none";
export function askAttach(
  state: PState,
  seat: Seat,
  effect: string,
  from: "deck" | "discard" | "hand",
  energy: string[],
  targets: SlotKey[],
  after: After = "none",
  extra: Data = {},
): void {
  const p = me(state, seat);
  const zone = from === "deck" ? p.deck : from === "discard" ? p.discard : p.hand;
  const next = zone.find((c) => c.uid === energy[0]);
  if (!next || !targets.length) return finishAttach(state, seat, effect, after);
  if (targets.length === 1) return attachTo(state, seat, effect, from, energy, targets, targets[0], after, extra);
  ask(state, {
    seat,
    title: `Choose a Pokémon to attach ${next.name} to`,
    zone: "myPokemon",
    options: targets,
    min: 1,
    max: 1,
    effect,
    data: { ...extra, step: "attach", effect, from, energy, targets, after },
  });
}
function attachTo(
  state: PState,
  seat: Seat,
  effect: string,
  from: "deck" | "discard" | "hand",
  energy: string[],
  targets: SlotKey[],
  key: SlotKey,
  after: After,
  extra: Data,
): void {
  const p = me(state, seat);
  const zone = from === "deck" ? p.deck : from === "discard" ? p.discard : p.hand;
  const [e] = pull(zone, [energy[0]]);
  const slot = slotAt(p, key);
  if (e && slot) {
    slot.energy.push(e);
    log(state, seat, `${p.name} attached ${e.name} to ${topCard(slot).name}.`);
  }
  const rest = energy.slice(1);
  const left = extra.each ? targets.filter((t) => t !== key) : targets;
  if (rest.length && left.length) return askAttach(state, seat, effect, from, rest, left, after, extra);
  finishAttach(state, seat, effect, after);
}
function finishAttach(state: PState, seat: Seat, effect: string, after: After) {
  if (after === "shuffle") shuffle(me(state, seat).deck);
  if (after === "draw3") drawCards(3).play(state, seat, {} as PCard);
  if (after === "endTurn") {
    shuffle(me(state, seat).deck);
    endTurnNow(state, seat, effect);
  }
}

/** Has the player choose which of `cards` (already on top of their deck) goes on top, one at a time. */
export function askOrder(state: PState, seat: Seat, effect: string, left: string[], placed: string[] = []) {
  if (left.length <= 1) return finishOrder(state, seat, [...placed, ...left]);
  ask(state, {
    seat,
    title: placed.length ? "Choose the next card down" : "Choose the card to put on top of your deck",
    zone: "deck",
    options: left,
    min: 1,
    max: 1,
    effect,
    data: { step: "order", effect, left, placed },
  });
}
function finishOrder(state: PState, seat: Seat, order: string[]) {
  const p = me(state, seat);
  const cards = pull(p.deck, order);
  p.deck.unshift(...cards);
  log(state, seat, `${p.name} put ${plural(cards.length, "card")} back on top of their deck in the order they chose.`);
}

/** Wraps a card so the attach and order chains above carry on through its resume. */
export const chain = (effect: TrainerEffect): TrainerEffect => ({
  ...effect,
  resume(state, seat, picks, data) {
    if (data.step === "attach") {
      const {
        effect: name,
        from,
        energy,
        targets,
        after,
        ...extra
      } = data as {
        effect: string;
        from: "deck" | "discard" | "hand";
        energy: string[];
        targets: SlotKey[];
        after: After;
      } & Data;
      delete extra.step;
      return attachTo(state, seat, name, from, energy, targets, picks[0] as SlotKey, after, extra);
    }
    if (data.step === "order") {
      const left = (data.left as string[]).filter((u) => u !== picks[0]);
      return askOrder(state, seat, String(data.effect), left, [...(data.placed as string[]), picks[0]]);
    }
    effect.resume?.(state, seat, picks, data);
  },
});

// ----- Opponent's-hand cards -----

export function askOppHand(state: PState, seat: Seat, effect: string, title: string, match: Match, max: number, min = 0, data: Data = {}) {
  const opp = them(state, seat);
  revealHand(state, seat);
  const options = opp.hand.filter(match).map((c) => c.uid);
  if (!options.length) {
    log(state, seat, `${me(state, seat).name} found nothing they could choose.`);
    return false;
  }
  ask(state, {
    seat,
    title,
    zone: "oppHand",
    options,
    shown: opp.hand.map((c) => c.uid),
    min: Math.min(min, options.length),
    max,
    effect,
    data,
  });
  return true;
}

/** The opponent discards down to `n` cards (they choose which). */
export function oppDiscardTo(state: PState, seat: Seat, target: Seat, n: number) {
  const p = state.players[target];
  const extra = p.hand.length - n;
  if (extra <= 0) return;
  ask(state, {
    seat: target,
    title: `Discard ${plural(extra, "card")} from your hand (down to ${n})`,
    zone: "hand",
    options: p.hand.map((c) => c.uid),
    min: extra,
    max: extra,
    effect: "discardHand",
    data: { step: "cost" },
  });
}

/** The opponent chooses their new Active Pokémon after being switched out. */
export function oppSwitchesOut(state: PState, seat: Seat) {
  const opp = them(state, seat);
  if (!opp.bench.length) return;
  ask(state, {
    seat: otherSeat(seat),
    title: `${me(state, seat).name} is switching out your Active Pokémon. Choose a Benched Pokémon to send in`,
    zone: "myBench",
    options: benchSlots(opp),
    min: 1,
    max: 1,
    effect: "switchOut",
  });
}

export function gustFrom(state: PState, seat: Seat, effect: string, supporter: boolean) {
  const opp = them(state, seat);
  const options = benchSlots(opp).filter((k) => !supporter || !supporterProof(state, opp.bench[keyIndex(k)]));
  if (!options.length) return;
  ask(state, {
    seat,
    title: `Choose 1 of ${opp.name}'s Benched Pokémon to switch into the Active Spot`,
    zone: "oppBench",
    options,
    min: 1,
    max: 1,
    effect,
    data: { step: "gust" },
  });
}

/** Coin flip, logged. */
export function coin(state: PState, seat: Seat, card: string) {
  const heads = flip();
  log(state, seat, `Coin flip for ${card}: ${heads ? "heads" : "tails"}.`, "coin");
  return heads;
}

/** Searches the deck, or does nothing when there's nothing to find. */
export const search = (state: PState, seat: Seat, card: string, title: string, match: Match, max: number, data: Data = {}) =>
  searchDeck(state, seat, { name: card } as PCard, title, match, max, {
    card,
    ...data,
  });

/** Picks one of your Pokémon matching `test`, as a SlotKey list. */
export const myKeys = (state: PState, seat: Seat, test: (s: PSlot) => boolean = () => true) =>
  slotsOf(me(state, seat))
    .filter((x) => test(x.slot))
    .map((x) => x.key);
export const myBenchKeys = (state: PState, seat: Seat, test: (s: PSlot) => boolean = () => true) => myKeys(state, seat, test).filter((k) => k !== "active");

const drewAnd =
  (n: number, then: (state: PState, seat: Seat, card: PCard) => void): TrainerEffect["play"] =>
  (state, seat, card) => {
    const p = me(state, seat);
    const before = p.hand.length;
    draw(p, n);
    log(state, seat, `${p.name} drew ${plural(p.hand.length - before, "card")}.`);
    if (p.hand.length > before) then(state, seat, card);
  };

/** Blanche, Candela, Spark: draw 2, then on heads attach an Energy of a type from the discard pile to a Benched Pokémon. */
const drawFlipAttach = (type: string): TrainerEffect =>
  chain({
    play: drewAnd(2, (state, seat, card) => {
      if (!coin(state, seat, card.name)) return;
      const p = me(state, seat);
      const e = p.discard.find(energyOf(type));
      const targets = myBenchKeys(state, seat);
      if (e && targets.length)
        askAttach(state, seat, card.name, "discard", [e.uid], targets, "none", {
          card: card.name,
        });
    }),
  });

// ----- The cards -----

let built: Record<string, TrainerEffect> | null = null;
export const extraTrainers = () => (built ??= build());

const build = (): Record<string, TrainerEffect> => ({
  // ===== Items =====
  "Superior Energy Retrieval": {
    canPlay: (state, seat) =>
      needsOtherCards(2)(state, seat) ?? (me(state, seat).discard.some(isBasicEnergy) ? null : "There's no Basic Energy in your discard pile."),
    play: (state, seat, card) => askDiscard(state, seat, "Superior Energy Retrieval: discard 2 cards from your hand", () => true, 2, card.name),
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (data.step === "cost") {
        payDiscard(state, seat, picks);
        const options = p.discard.filter((c) => isBasicEnergy(c) && !picks.includes(c.uid)).map((c) => c.uid);
        if (!options.length) return;
        ask(state, {
          seat,
          title: "Choose up to 4 Basic Energy cards to put into your hand",
          zone: "discard",
          options,
          min: Math.min(4, options.length),
          max: 4,
          effect: "Superior Energy Retrieval",
        });
        return;
      }
      const back = pull(p.discard, picks);
      p.hand.push(...back);
      log(state, seat, `${p.name} put ${names(back)} into their hand.`);
    },
  },
  "Iron Defender": {
    play(state, seat) {
      addEffect(state, {
        kind: "damageDown",
        seat,
        turn: state.turn + 1,
        amount: 30,
        type: "Metal",
        source: "Iron Defender",
      });
      log(state, seat, "During the next turn, your Metal Pokémon take 30 less damage from attacks.");
    },
  },
  "Premium Power Pro": {
    play(state, seat) {
      addEffect(state, {
        kind: "damageUp",
        seat,
        turn: state.turn,
        amount: 30,
        type: "Fighting",
        source: "Premium Power Pro",
      });
      log(state, seat, "This turn, your Fighting Pokémon's attacks do 30 more damage.");
    },
  },
  Repel: {
    canPlay: oppHasBench,
    play: (state, seat) => oppSwitchesOut(state, seat),
  },
  "Strange Timepiece": {
    canPlay: (state, seat) =>
      myKeys(state, seat, (s) => s.pokemon.length > 1 && ofType(topCard(s), "Psychic")).length ? null : "You have no evolved Psychic Pokémon.",
    play(state, seat, card) {
      ask(state, {
        seat,
        title: "Choose an evolved Psychic Pokémon to devolve",
        zone: "myPokemon",
        options: myKeys(state, seat, (s) => s.pokemon.length > 1 && ofType(topCard(s), "Psychic")),
        min: 1,
        max: 1,
        effect: card.name,
        data: { step: "slot" },
      });
    },
    resume(state, seat, picks, data) {
      const slot = slotAt(me(state, seat), (data.slot ?? picks[0]) as SlotKey)!;
      if (data.step === "slot" && slot.pokemon.length > 2) {
        askChoice(
          state,
          seat,
          "How far back?",
          [
            { id: "1", label: `Take off ${topCard(slot).name} only` },
            {
              id: String(slot.pokemon.length - 1),
              label: `Back to ${slot.pokemon[0].name}`,
            },
          ],
          "Strange Timepiece",
          { data: { step: "how", slot: picks[0] } },
        );
        return;
      }
      devolve(state, seat, slot, data.step === "how" ? Number(picks[0]) : 1);
    },
  },
  Blowtorch: {
    canPlay: (state, seat) => {
      if (!me(state, seat).hand.some(basicEnergyOf("Fire"))) return "You need a Basic Fire Energy card in your hand to discard.";
      return state.stadium || attachedChoices(state, [otherSeat(seat)], (c, s) => toolsOn(s).includes(c) || isSpecialEnergy(c)).length
        ? null
        : "There's no Tool, Special Energy or Stadium to discard.";
    },
    play: (state, seat, card) => askDiscard(state, seat, "Blowtorch: discard a Basic Fire Energy card", basicEnergyOf("Fire"), 1, card.name),
    resume(state, seat, picks, data) {
      if (data.step === "cost") {
        payDiscard(state, seat, picks);
        const choices = attachedChoices(state, [otherSeat(seat)], (c, s) => toolsOn(s).includes(c) || isSpecialEnergy(c));
        if (state.stadium)
          choices.push({
            id: "stadium",
            label: `The Stadium ${state.stadium.card.name}`,
          });
        askChoice(state, seat, "Choose what to discard", choices, "Blowtorch");
        return;
      }
      discardChoice(state, seat, picks[0]);
    },
  },
  "Glass Trumpet": chain({
    canPlay: (state, seat) => {
      if (!inPlay(me(state, seat)).some((s) => isTera(topCard(s)))) return "You need a Tera Pokémon in play.";
      if (!me(state, seat).discard.some(isBasicEnergy)) return "There's no Basic Energy in your discard pile.";
      return myBenchKeys(state, seat, (s) => ofType(topCard(s), "Colorless")).length ? null : "You have no Benched Colorless Pokémon.";
    },
    play(state, seat, card) {
      const energy = me(state, seat)
        .discard.filter(isBasicEnergy)
        .slice(0, 2)
        .map((c) => c.uid);
      askAttach(
        state,
        seat,
        card.name,
        "discard",
        energy,
        myBenchKeys(state, seat, (s) => ofType(topCard(s), "Colorless")),
        "none",
        { card: card.name, each: true },
      );
    },
  }),
  "N's PP Up": attachFromDiscard(isBasicEnergy, (c) => trainersPokemon(c, "N"), true),
  "Team Rocket's Great Ball": {
    play(state, seat, card) {
      const heads = coin(state, seat, card.name);
      search(
        state,
        seat,
        card.name,
        heads ? "Choose an Evolution Team Rocket's Pokémon" : "Choose a Basic Team Rocket's Pokémon",
        (c) => trainersPokemon(c, "Team Rocket") && (heads ? isEvolution(c) : isBasicPokemon(c)),
        1,
      );
    },
    resume: (state, seat, picks) => toHand(state, seat, { name: "Team Rocket's Great Ball" } as PCard, picks),
  },
  "Team Rocket's Transceiver": searchToHand('Choose a Supporter with "Team Rocket" in its name', (c) => isSupporter(c) && c.name.includes("Team Rocket"), 1),
  "Tool Scrapper": {
    canPlay: (state) => (attachedChoices(state, ["p1", "p2"], (c, s) => toolsOn(s).includes(c)).length ? null : "No Pokémon has a Tool attached."),
    play(state, seat, card) {
      const choices = attachedChoices(state, [otherSeat(seat), seat], (c, s) => toolsOn(s).includes(c));
      askChoice(state, seat, "Choose up to 2 Pokémon Tools to discard", choices, card.name, { min: 1, max: 2 });
    },
    resume: (state, seat, picks) => picks.forEach((id) => discardChoice(state, seat, id)),
  },
  "Dark Bell": {
    play(state, seat) {
      for (const s of [seat, otherSeat(seat)]) {
        const a = state.players[s].active;
        if (a && !ofType(topCard(a), "Darkness")) {
          setCondition(state, a, "confused");
          log(state, seat, `${topCard(a).name} is now Confused.`);
        }
      }
    },
  },
  "Egg Incubator": {
    play(state, seat, card) {
      if (coin(state, seat, card.name)) {
        if (me(state, seat).bench.length < benchLimit(state, seat))
          search(state, seat, card.name, "Choose a Basic Pokémon to put onto your Bench", isBasicPokemon, 1);
        return;
      }
      const p = me(state, seat);
      const [self] = pull(p.discard, [card.uid]);
      if (self) p.deck.push(self);
      log(state, seat, "Egg Incubator went to the bottom of the deck.");
    },
    resume: (state, seat, picks) => toBench(state, seat, { name: "Egg Incubator" } as PCard, picks),
  },
  "Lure Module": {
    play(state, seat) {
      for (const s of [seat, otherSeat(seat)]) {
        const p = state.players[s];
        const top = p.deck.slice(0, 3);
        const found = pull(
          p.deck,
          top.filter(isPokemon).map((c) => c.uid),
        );
        p.hand.push(...found);
        shuffle(p.deck);
        log(state, s, `${p.name} revealed ${names(top)} and put ${names(found)} into their hand.`);
      }
    },
  },
  "Electric Generator": chain({
    canPlay: (state, seat) => (myBenchKeys(state, seat, (s) => ofType(topCard(s), "Lightning")).length ? null : "You have no Benched Lightning Pokémon."),
    play(state, seat, card) {
      const p = me(state, seat);
      const top = p.deck.slice(0, 5);
      log(state, seat, `${p.name} looked at ${names(top)}.`);
      const energy = top
        .filter(basicEnergyOf("Lightning"))
        .slice(0, 2)
        .map((c) => c.uid);
      askAttach(
        state,
        seat,
        card.name,
        "deck",
        energy,
        myBenchKeys(state, seat, (s) => ofType(topCard(s), "Lightning")),
        "shuffle",
        { card: card.name },
      );
    },
  }),
  "Team Rocket's Bother-Bot": {
    canPlay: (state, seat) => (them(state, seat).hand.length ? null : "Your opponent's hand is empty."),
    play(state, seat, card) {
      const opp = them(state, seat);
      const prize = Math.floor(Math.random() * opp.prizes.length);
      const hand = Math.floor(Math.random() * opp.hand.length);
      log(state, seat, `${opp.name}'s Prize card is ${opp.prizes[prize].name}; the random card from their hand is ${opp.hand[hand].name}.`);
      askChoice(
        state,
        seat,
        `Swap ${opp.name}'s Prize card (${opp.prizes[prize].name}) with the card from their hand (${opp.hand[hand].name})?`,
        [
          { id: "swap", label: "Swap them" },
          { id: "keep", label: "Leave them" },
        ],
        card.name,
        { data: { prize, hand } },
      );
    },
    resume(state, seat, picks, data) {
      if (picks[0] !== "swap") return;
      const opp = them(state, seat);
      const pi = Number(data.prize);
      const hi = Number(data.hand);
      [opp.prizes[pi], opp.hand[hi]] = [opp.hand[hi], opp.prizes[pi]];
      log(state, seat, `${me(state, seat).name} swapped the cards.`);
    },
  },
  "Team Rocket's Venture Bomb": {
    play(state, seat, card) {
      if (coin(state, seat, card.name)) {
        const opp = them(state, seat);
        ask(state, {
          seat,
          title: `Choose 1 of ${opp.name}'s Pokémon to put 2 damage counters on`,
          zone: "oppPokemon",
          options: slotKeys(opp),
          min: 1,
          max: 1,
          effect: card.name,
        });
      } else {
        const a = me(state, seat).active;
        if (a) {
          putCounters(state, seat, a, 2);
          log(state, seat, `2 damage counters on ${topCard(a).name}.`);
        }
      }
    },
    resume(state, seat, picks) {
      const slot = slotAt(them(state, seat), picks[0] as SlotKey);
      if (!slot) return;
      putCounters(state, seat, slot, 2);
      log(state, seat, `2 damage counters on ${topCard(slot).name}.`);
    },
  },
  "TM Machine": searchToHand('Choose up to 3 Tools with "Technical Machine" in their name', (c) => isTool(c) && c.name.includes("Technical Machine"), 3),
  "Delivery Drone": {
    play(state, seat, card) {
      const a = flip();
      const b = flip();
      log(state, seat, `Flipped 2 coins for Delivery Drone: ${a && b ? "both heads" : "not both heads"}.`, "coin");
      if (a && b) search(state, seat, card.name, "Choose any card to put into your hand", () => true, 1);
    },
    resume: (state, seat, picks) => toHand(state, seat, { name: "Delivery Drone" } as PCard, picks),
  },
  "Fighting Au Lait": {
    ...healOne(60),
    canPlay: (state, seat) =>
      me(state, seat).prizes.length > them(state, seat).prizes.length
        ? (healOne(60).canPlay?.(state, seat, {} as PCard) ?? null)
        : "You can use this only if you have more Prize cards left than your opponent.",
  },
  "Letter of Encouragement": {
    ...searchToHand("Choose up to 3 Basic Energy cards", isBasicEnergy, 3),
    canPlay: (state, seat) =>
      koLastTurn(state, seat) ? null : "You can use this only if one of your Pokémon was Knocked Out during your opponent's last turn.",
  },
  "Energy Sticker": {
    canPlay: (state, seat) => attachFromDiscard(isBasicEnergy, () => true, true).canPlay!(state, seat, {} as PCard),
    play(state, seat, card) {
      if (coin(state, seat, card.name)) attachFromDiscard(isBasicEnergy, () => true, true).play(state, seat, card);
    },
    resume: (state, seat, picks, data) => attachFromDiscard(isBasicEnergy, () => true, true).resume!(state, seat, picks, { ...data, card: "Energy Sticker" }),
  },
  Grabber: {
    canPlay: (state, seat) => (them(state, seat).hand.length ? null : "Your opponent's hand is empty."),
    play: (state, seat, card) => void askOppHand(state, seat, card.name, "Choose a Pokémon to put on the bottom of their deck", isPokemon, 1, 1),
    resume(state, seat, picks) {
      const opp = them(state, seat);
      const moved = pull(opp.hand, picks);
      opp.deck.push(...moved);
      log(state, seat, `${names(moved)} went to the bottom of ${opp.name}'s deck.`);
    },
  },
  "Snorlax Doll": {
    canPlay: () => "You can put Snorlax Doll into play only when setting up.",
    play: () => undefined,
  },
  "Techno Radar": {
    canPlay: needsOtherCards(1),
    play: (state, seat, card) => askDiscard(state, seat, "Techno Radar: discard another card from your hand", () => true, 1, card.name),
    resume(state, seat, picks, data) {
      if (data.step === "cost") {
        payDiscard(state, seat, picks);
        return search(state, seat, "Techno Radar", "Choose up to 2 Future Pokémon", (c) => isPokemon(c) && c.subtypes.includes("Future"), 2);
      }
      toHand(state, seat, { name: "Techno Radar" } as PCard, picks);
    },
  },
  "Nemona's Backpack": recover("Choose up to 2 Nemona cards", (c) => baseName(c.name).startsWith("Nemona"), 2, "hand"),
  "Awakening Drum": drawCards((state, seat) => inPlay(me(state, seat)).filter((s) => topCard(s).subtypes.includes("Ancient")).length),
  "Boxed Order": {
    play: (state, seat, card) => {
      search(state, seat, card.name, "Choose up to 2 Item cards", (c) => isItem(c), 2);
      if (!state.prompt) endTurnNow(state, seat, card.name);
    },
    resume(state, seat, picks) {
      toHand(state, seat, { name: "Boxed Order" } as PCard, picks);
      endTurnNow(state, seat, "Boxed Order");
    },
  },
  "Hand Trimmer": {
    play(state, seat) {
      oppDiscardTo(state, seat, otherSeat(seat), 5);
      oppDiscardTo(state, seat, seat, 5);
    },
  },
  "Reboot Pod": {
    canPlay: (state, seat) => (inPlay(me(state, seat)).some((s) => topCard(s).subtypes.includes("Future")) ? null : "You have no Future Pokémon in play."),
    play(state, seat) {
      const p = me(state, seat);
      for (const slot of inPlay(p).filter((s) => topCard(s).subtypes.includes("Future"))) {
        const e = p.discard.find(isBasicEnergy);
        if (!e) break;
        p.discard.splice(p.discard.indexOf(e), 1);
        slot.energy.push(e);
        log(state, seat, `${p.name} attached ${e.name} to ${topCard(slot).name}.`);
      }
    },
  },
  "Accompanying Flute": {
    canPlay: (state, seat) => (them(state, seat).bench.length < benchLimit(state, otherSeat(seat)) ? null : "Your opponent's Bench is full."),
    play(state, seat, card) {
      const opp = them(state, seat);
      const top = opp.deck.slice(0, 5);
      log(state, seat, `${opp.name} revealed ${names(top)}.`);
      const options = top.filter(isBasicPokemon).map((c) => c.uid);
      if (!options.length) return void shuffle(opp.deck);
      ask(state, {
        seat,
        title: `Choose Basic Pokémon to put onto ${opp.name}'s Bench`,
        zone: "oppDeck",
        options,
        shown: top.map((c) => c.uid),
        min: 0,
        max: Math.min(options.length, benchLimit(state, otherSeat(seat)) - opp.bench.length),
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const oppSeat = otherSeat(seat);
      const opp = state.players[oppSeat];
      for (const c of pull(opp.deck, picks)) benchPokemon(state, oppSeat, c);
      shuffle(opp.deck);
      if (picks.length) log(state, seat, `${plural(picks.length, "Pokémon")} went onto ${opp.name}'s Bench.`);
    },
  },
  "Bug Catching Set": topCards(7, 2, "shuffle", either(pokemonOfType("Grass"), basicEnergyOf("Grass"))),
  "Enhanced Hammer": {
    canPlay: (state, seat) => (attachedChoices(state, [otherSeat(seat)], isSpecialEnergy).length ? null : "Your opponent's Pokémon have no Special Energy."),
    play: (state, seat, card) =>
      askChoice(state, seat, "Choose a Special Energy to discard", attachedChoices(state, [otherSeat(seat)], isSpecialEnergy), card.name),
    resume: (state, seat, picks) => discardChoice(state, seat, picks[0]),
  },
  "Love Ball": {
    play(state, seat, card) {
      const names = new Set(inPlay(them(state, seat)).map((s) => topCard(s).name));
      search(state, seat, card.name, "Choose a Pokémon with the same name as one of your opponent's Pokémon", (c) => isPokemon(c) && names.has(c.name), 1);
    },
    resume: (state, seat, picks) => toHand(state, seat, { name: "Love Ball" } as PCard, picks),
  },
  "Ogre's Mask": {
    canPlay: (state, seat) => {
      const ogre = (c: PCard) => isEx(c) && c.name.includes("Ogerpon");
      if (!me(state, seat).discard.some(ogre)) return "You need an Ogerpon ex in your discard pile.";
      return myKeys(state, seat, (s) => ogre(topCard(s))).length ? null : "You need an Ogerpon ex in play.";
    },
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose an Ogerpon ex from your discard pile",
        zone: "discard",
        options: p.discard.filter((c) => isEx(c) && c.name.includes("Ogerpon")).map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
        data: { step: "from" },
      });
    },
    resume(state, seat, picks, data) {
      if (data.step === "from") {
        ask(state, {
          seat,
          title: "Choose the Ogerpon ex in play to swap it with",
          zone: "myPokemon",
          options: myKeys(state, seat, (s) => isEx(topCard(s)) && topCard(s).name.includes("Ogerpon")),
          min: 1,
          max: 1,
          effect: "Ogre's Mask",
          data: { step: "to", card: picks[0] },
        });
        return;
      }
      swapFromDiscard(state, seat, String(data.card), picks[0] as SlotKey);
    },
  },
  "Secret Box": {
    canPlay: needsOtherCards(3),
    play: (state, seat, card) => askDiscard(state, seat, "Secret Box: discard 3 other cards from your hand", () => true, 3, card.name),
    resume(state, seat, picks, data) {
      if (data.step === "cost") {
        payDiscard(state, seat, picks);
        return search(state, seat, "Secret Box", "Choose an Item, a Pokémon Tool, a Supporter and a Stadium", (c) => c.supertype === "Trainer", 4, {
          step: "find",
        });
      }
      const p = me(state, seat);
      const chosen = picks.map((u) => p.deck.find((c) => c.uid === u)!).filter(Boolean);
      const keep = [chosen.find((c) => isItem(c) && !isTool(c)), chosen.find(isTool), chosen.find(isSupporter), chosen.find(isStadium)].filter(
        Boolean,
      ) as PCard[];
      toHand(
        state,
        seat,
        { name: "Secret Box" } as PCard,
        keep.map((c) => c.uid),
      );
    },
  },
  "Unfair Stamp": {
    canPlay: (state, seat) =>
      koLastTurn(state, seat) ? null : "You can use this only if one of your Pokémon was Knocked Out during your opponent's last turn.",
    play: (state, seat) => bothShuffleDraw(state, seat, 5, 2),
  },
  "Brilliant Blender": {
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play: (state, seat, card) => search(state, seat, card.name, "Choose up to 5 cards to discard", () => true, 5),
    resume(state, seat, picks) {
      const p = me(state, seat);
      const gone = pull(p.deck, picks);
      p.discard.push(...gone);
      shuffle(p.deck);
      log(state, seat, `${p.name} discarded ${names(gone)} from their deck.`);
    },
  },
  "Call Bell": {
    ...searchToHand("Choose a Supporter card", isSupporter, 1),
    canPlay: (state, seat) => (wentSecondFirstTurn(state, seat) ? null : "You can use this only if you went second, during your first turn."),
  },
  "Chill Teaser Toy": {
    canPlay: (state, seat) =>
      !wentSecondFirstTurn(state, seat)
        ? "You can use this only if you went second, during your first turn."
        : attachedChoices(state, [otherSeat(seat)], isEnergy).length
          ? null
          : "Your opponent's Pokémon have no Energy.",
    play: (state, seat, card) =>
      askChoice(state, seat, "Choose an Energy to put back into your opponent's hand", attachedChoices(state, [otherSeat(seat)], isEnergy), card.name),
    resume(state, seat, picks) {
      const found = fromAttachedId(state, picks[0]);
      if (!found) return;
      found.slot.energy = found.slot.energy.filter((e) => e.uid !== found.card.uid);
      state.players[found.seat].hand.push(found.card);
      log(state, seat, `${found.card.name} went back to ${state.players[found.seat].name}'s hand.`);
    },
  },
  "Deduction Kit": chain({
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const top = me(state, seat).deck.slice(0, 3);
      askChoice(
        state,
        seat,
        `The top cards of your deck are ${names(top)}`,
        [
          { id: "order", label: "Put them back in the order I choose" },
          { id: "bottom", label: "Shuffle them and put them on the bottom" },
        ],
        card.name,
        { data: { top: top.map((c) => c.uid) } },
      );
    },
    resume(state, seat, picks, data) {
      const top = data.top as string[];
      if (picks[0] === "order") return askOrder(state, seat, "Deduction Kit", top);
      const p = me(state, seat);
      p.deck.push(...shuffle(pull(p.deck, top)));
      log(state, seat, `${p.name} put the top ${plural(top.length, "card")} on the bottom of their deck.`);
    },
  }),
  "Dusk Ball": {
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const p = me(state, seat);
      const bottom = p.deck.slice(-7);
      const options = bottom.filter(isPokemon).map((c) => c.uid);
      if (!options.length) {
        shuffle(p.deck);
        return log(state, seat, `${p.name} found no Pokémon in the bottom 7 cards.`);
      }
      ask(state, {
        seat,
        title: "Bottom 7 cards of your deck: you may take a Pokémon",
        zone: "deck",
        options,
        shown: bottom.map((c) => c.uid),
        min: 0,
        max: 1,
        effect: card.name,
      });
    },
    resume: (state, seat, picks) => toHand(state, seat, { name: "Dusk Ball" } as PCard, picks),
  },
  "Meddling Memo": {
    play(state, seat) {
      const opp = them(state, seat);
      const n = opp.hand.length;
      opp.deck.push(...shuffle(opp.hand.splice(0)));
      draw(opp, n);
      log(state, seat, `${opp.name} put their hand on the bottom of their deck and drew ${plural(n, "card")}.`);
    },
  },
  "Megaton Blower": {
    play(state, seat) {
      const oppSeat = otherSeat(seat);
      for (const slot of inPlay(them(state, seat))) {
        for (const t of toolsOn(slot)) discardAttached(state, oppSeat, slot, t);
        for (const e of slot.energy.filter(isSpecialEnergy)) discardAttached(state, oppSeat, slot, e);
      }
      discardStadium(state, seat);
    },
  },
  "Scramble Switch": {
    canPlay: needBench,
    play: (state, seat, card) => askSwitch(state, seat, card.name, { step: "switch" }),
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (data.step === "switch") {
        const out = doSwitch(state, seat, picks);
        if (!out || !out.energy.length) return;
        const outKey = `bench:${p.bench.indexOf(out)}`;
        askChoice(
          state,
          seat,
          `Move any Energy from ${topCard(out).name} to ${topCard(p.active!).name}?`,
          out.energy.map((e) => ({ id: e.uid, label: e.name })),
          "Scramble Switch",
          {
            min: 0,
            max: out.energy.length,
            data: { step: "move", from: outKey },
          },
        );
        return;
      }
      const from = slotAt(p, data.from as SlotKey);
      if (!from || !p.active) return;
      const moving = from.energy.filter((e) => picks.includes(e.uid));
      from.energy = from.energy.filter((e) => !picks.includes(e.uid));
      p.active.energy.push(...moving);
      if (moving.length) log(state, seat, `${p.name} moved ${names(moving)} to ${topCard(p.active).name}.`);
    },
  },
  "Hop's Bag": {
    canPlay: (state, seat) => (me(state, seat).bench.length < benchLimit(state, seat) ? null : "Your Bench is full."),
    play: (state, seat, card) =>
      search(
        state,
        seat,
        card.name,
        "Choose up to 2 Basic Hop's Pokémon for your Bench",
        isBasicOf("Hop"),
        Math.min(2, benchLimit(state, seat) - me(state, seat).bench.length),
      ),
    resume: (state, seat, picks) => toBench(state, seat, { name: "Hop's Bag" } as PCard, picks),
  },
  "Redeemable Ticket": {
    play(state, seat) {
      const p = me(state, seat);
      const n = p.prizes.length;
      p.deck.push(...shuffle(p.prizes.splice(0)));
      p.prizes = p.deck.splice(0, n);
      log(state, seat, `${p.name} put their ${plural(n, "Prize card")} on the bottom of their deck and took new ones from the top.`);
    },
  },
  "Canceling Cologne": {
    play(state, seat) {
      addEffect(state, {
        kind: "noAbilities",
        seat,
        turn: state.turn,
        source: "Canceling Cologne",
      });
      log(state, seat, "Until the end of this turn, your opponent's Active Pokémon has no Abilities.");
    },
  },
  "Gutsy Pickaxe": {
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const p = me(state, seat);
      const top = p.deck[0];
      log(state, seat, `${p.name} revealed ${top.name}.`);
      if (isEnergy(top) && top.name.includes("Fighting") && p.bench.length) {
        ask(state, {
          seat,
          title: `Choose a Benched Pokémon to attach ${top.name} to`,
          zone: "myBench",
          options: benchSlots(p),
          min: 1,
          max: 1,
          effect: card.name,
        });
      } else {
        p.hand.push(p.deck.shift()!);
        log(state, seat, `${p.name} put ${top.name} into their hand.`);
      }
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const slot = slotAt(p, picks[0] as SlotKey);
      const e = p.deck.shift();
      if (slot && e) {
        slot.energy.push(e);
        log(state, seat, `${p.name} attached ${e.name} to ${topCard(slot).name}.`);
      }
    },
  },
  "Hisuian Heavy Ball": {
    play(state, seat, card) {
      const p = me(state, seat);
      const options = p.prizes.filter(isBasicPokemon).map((c) => c.uid);
      ask(state, {
        seat,
        title: "Your Prize cards: you may take a Basic Pokémon (Hisuian Heavy Ball takes its place)",
        zone: "prizes",
        options,
        shown: p.prizes.map((c) => c.uid),
        min: 0,
        max: Math.min(1, options.length),
        effect: card.name,
        data: { ball: card.uid },
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (!picks.length) return void shuffle(p.prizes);
      const taken = pull(p.prizes, picks);
      const ball = pull(p.discard, [String(data.ball)]);
      p.hand.push(...taken);
      p.prizes.push(...ball);
      shuffle(p.prizes);
      log(state, seat, `${p.name} took ${names(taken)} from their Prize cards.`);
    },
  },
  "Sweet Honey": {
    canPlay: (state, seat) => (myKeys(state, seat, (s) => s.damage > 0).length ? null : "None of your Pokémon have damage."),
    play: (state, seat, card) =>
      ask(state, {
        seat,
        title: "Choose a Pokémon to heal",
        zone: "myPokemon",
        options: myKeys(state, seat, (s) => s.damage > 0),
        min: 1,
        max: 1,
        effect: card.name,
      }),
    resume(state, seat, picks) {
      const slot = slotAt(me(state, seat), picks[0] as SlotKey)!;
      let heads = 0;
      while (flip()) heads++;
      log(state, seat, `Flipped until tails: ${plural(heads, "heads")}.`, "coin");
      const healed = heal(slot, 40 * heads);
      log(state, seat, `${topCard(slot).name} was healed ${healed} damage.`);
    },
  },
  "Trekking Shoes": {
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const top = me(state, seat).deck[0];
      askChoice(
        state,
        seat,
        `The top card of your deck is ${top.name}`,
        [
          { id: "take", label: `Put ${top.name} into your hand` },
          { id: "discard", label: "Discard it and draw a card" },
        ],
        card.name,
      );
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const top = p.deck.shift();
      if (!top) return;
      if (picks[0] === "take") {
        p.hand.push(top);
        log(state, seat, `${p.name} put ${top.name} into their hand.`);
      } else {
        p.discard.push(top);
        draw(p, 1);
        log(state, seat, `${p.name} discarded ${top.name} and drew a card.`);
      }
    },
  },
  "Wait and See Turbo": chain({
    canPlay: (state, seat) => (wentSecondFirstTurn(state, seat) ? null : "You can use this only if you went second, during your first turn."),
    play(state, seat, card) {
      search(state, seat, card.name, "Choose a Basic Energy card to attach", isBasicEnergy, 1, { step: "find" });
      if (!state.prompt) endTurnNow(state, seat, card.name);
    },
    resume(state, seat, picks) {
      if (!picks.length) {
        shuffle(me(state, seat).deck);
        return endTurnNow(state, seat, "Wait and See Turbo");
      }
      askAttach(state, seat, "Wait and See Turbo", "deck", picks, myKeys(state, seat), "endTurn", { card: "Wait and See Turbo" });
    },
  }),
  "Arc Phone": {
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const p = me(state, seat);
      askChoice(
        state,
        seat,
        `The top card of your deck is ${p.deck[0].name}. Switch it with a face-down Prize card?`,
        [
          { id: "keep", label: "Leave it" },
          ...p.prizes.map((_, i) => ({
            id: String(i),
            label: `Switch with Prize card ${i + 1}`,
          })),
        ],
        card.name,
      );
    },
    resume(state, seat, picks) {
      if (picks[0] === "keep") return;
      const p = me(state, seat);
      const i = Number(picks[0]);
      [p.deck[0], p.prizes[i]] = [p.prizes[i], p.deck[0]];
      log(state, seat, `${p.name} switched the top card of their deck with a Prize card.`);
    },
  },
  "Damage Pump": {
    canPlay: (state, seat) =>
      myKeys(state, seat, (s) => s.damage > 0).length && inPlay(me(state, seat)).length > 1
        ? null
        : "You need a damaged Pokémon and another Pokémon to move damage to.",
    play: (state, seat, card) =>
      ask(state, {
        seat,
        title: "Choose the Pokémon to move damage counters from",
        zone: "myPokemon",
        options: myKeys(state, seat, (s) => s.damage > 0),
        min: 1,
        max: 1,
        effect: card.name,
        data: { step: "from" },
      }),
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (data.step === "from") {
        ask(state, {
          seat,
          title: "Choose the Pokémon to move up to 2 damage counters to",
          zone: "myPokemon",
          options: myKeys(state, seat).filter((k) => k !== picks[0]),
          min: 1,
          max: 1,
          effect: "Damage Pump",
          data: { step: "to", from: picks[0] },
        });
        return;
      }
      const from = slotAt(p, data.from as SlotKey)!;
      const to = slotAt(p, picks[0] as SlotKey)!;
      const moved = Math.min(20, from.damage);
      from.damage -= moved;
      to.damage += moved;
      log(state, seat, `${p.name} moved ${plural(moved / 10, "damage counter")} from ${topCard(from).name} to ${topCard(to).name}.`);
    },
  },
  "Lost Vacuum": {
    canPlay: (state, seat) =>
      needsOtherCards(1)(state, seat) ??
      (state.stadium || attachedChoices(state, ["p1", "p2"], (c, s) => toolsOn(s).includes(c)).length ? null : "There's no Tool or Stadium in play."),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Lost Vacuum: choose a card from your hand to put in the Lost Zone",
        zone: "hand",
        options: p.hand.map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
        data: { step: "cost" },
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (data.step === "cost") {
        const gone = pull(p.hand, picks);
        (p.lost ??= []).push(...gone);
        log(state, seat, `${p.name} put ${names(gone)} in the Lost Zone.`);
        const choices = attachedChoices(state, [otherSeat(seat), seat], (c, s) => toolsOn(s).includes(c));
        if (state.stadium)
          choices.push({
            id: "stadium",
            label: `The Stadium ${state.stadium.card.name}`,
          });
        askChoice(state, seat, "Choose a Tool or Stadium to put in the Lost Zone", choices, "Lost Vacuum");
        return;
      }
      if (picks[0] === "stadium" && state.stadium) {
        (state.players[state.stadium.owner].lost ??= []).push(state.stadium.card);
        log(state, seat, `${state.stadium.card.name} went to the Lost Zone.`);
        state.stadium = null;
        return;
      }
      const found = fromAttachedId(state, picks[0]);
      if (!found) return;
      removeTool(found.slot, found.card.uid);
      (state.players[found.seat].lost ??= []).push(found.card);
      log(state, seat, `${found.card.name} went to the Lost Zone.`);
    },
  },
  "Mirage Gate": chain({
    canPlay: (state, seat) => ((me(state, seat).lost ?? []).length >= 7 ? null : "You need 7 or more cards in the Lost Zone."),
    play: (state, seat, card) => search(state, seat, card.name, "Choose up to 2 Basic Energy cards of different types", isBasicEnergy, 2, { step: "find" }),
    resume(state, seat, picks) {
      const p = me(state, seat);
      const chosen = picks.map((u) => p.deck.find((c) => c.uid === u)!).filter(Boolean);
      const different = chosen.length === 2 && energyProvides(chosen[0])[0] === energyProvides(chosen[1])[0] ? chosen.slice(0, 1) : chosen;
      askAttach(
        state,
        seat,
        "Mirage Gate",
        "deck",
        different.map((c) => c.uid),
        myKeys(state, seat),
        "shuffle",
        { card: "Mirage Gate" },
      );
    },
  }),
  "Capturing Aroma": {
    play(state, seat, card) {
      const heads = coin(state, seat, card.name);
      search(state, seat, card.name, heads ? "Choose an Evolution Pokémon" : "Choose a Basic Pokémon", heads ? isEvolution : isBasicPokemon, 1);
    },
    resume: (state, seat, picks) => toHand(state, seat, { name: "Capturing Aroma" } as PCard, picks),
  },
  "Energy Coin": chain({
    play(state, seat, card) {
      const a = flip();
      const b = flip();
      log(state, seat, `Flipped 2 coins for Energy Coin: ${a && b ? "both heads" : "not both heads"}.`, "coin");
      if (a && b) search(state, seat, card.name, "Choose a Basic Energy card to attach", isBasicEnergy, 1, { step: "find" });
    },
    resume(state, seat, picks) {
      if (!picks.length) return void shuffle(me(state, seat).deck);
      askAttach(state, seat, "Energy Coin", "deck", picks, myKeys(state, seat), "shuffle", { card: "Energy Coin" });
    },
  }),

  // ===== Supporters =====
  "Acerola's Mischief": {
    canPlay: (state, seat) => (them(state, seat).prizes.length <= 2 ? null : "You can use this only if your opponent has 2 or fewer Prize cards left."),
    play: (state, seat, card) =>
      ask(state, {
        seat,
        title: "Choose a Pokémon to protect from Pokémon ex",
        zone: "myPokemon",
        options: myKeys(state, seat),
        min: 1,
        max: 1,
        effect: card.name,
      }),
    resume(state, seat, picks) {
      const slot = slotAt(me(state, seat), picks[0] as SlotKey)!;
      slot.effects.exProof = state.turn + 1;
      log(state, seat, `During the next turn, attacks from Pokémon ex can't hurt ${topCard(slot).name}.`);
    },
  },
  "Lt. Surge's Bargain": {
    play(state, seat, card) {
      const opp = them(state, seat);
      askChoice(
        state,
        otherSeat(seat),
        `${me(state, seat).name} asks: may each player take a Prize card? If you say no, they draw 4 cards`,
        [
          { id: "yes", label: "Yes, each takes a Prize card" },
          { id: "no", label: "No" },
        ],
        card.name,
        {
          data: {
            botPick: [opp.prizes.length <= me(state, seat).prizes.length ? "yes" : "no"],
          },
        },
      );
    },
    resume(state, answerer, picks) {
      // The opponent answered, so `answerer` is the other seat.
      const seat = otherSeat(answerer);
      const yes = picks[0] === "yes";
      if (!yes) {
        draw(me(state, seat), 4);
        return log(state, seat, `${them(state, seat).name} said no, so ${me(state, seat).name} drew 4 cards.`);
      }
      for (const s of [seat, answerer]) {
        const p = state.players[s];
        const prize = p.prizes.shift();
        if (prize) p.hand.push(prize);
      }
      log(state, seat, "Each player took a Prize card.");
      for (const s of [seat, answerer]) {
        if (!state.players[s].prizes.length) {
          state.status = "finished";
          state.winner = s;
          state.endReason = `${state.players[s].name} took their last Prize card.`;
          log(state, s, `${state.endReason} ${state.players[s].name} wins!`, "system");
          return;
        }
      }
    },
  },
  "Wally's Compassion": {
    canPlay: (state, seat) =>
      myKeys(state, seat, (s) => isMegaEx(topCard(s)) && s.damage > 0).length ? null : "None of your Mega Evolution Pokémon ex have damage.",
    play: (state, seat, card) =>
      ask(state, {
        seat,
        title: "Choose a Mega Evolution Pokémon ex to heal",
        zone: "myPokemon",
        options: myKeys(state, seat, (s) => isMegaEx(topCard(s)) && s.damage > 0),
        min: 1,
        max: 1,
        effect: card.name,
      }),
    resume(state, seat, picks) {
      const p = me(state, seat);
      const slot = slotAt(p, picks[0] as SlotKey)!;
      slot.damage = 0;
      p.hand.push(...slot.energy.splice(0));
      log(state, seat, `${topCard(slot).name} was healed completely and its Energy went back to ${p.name}'s hand.`);
    },
  },
  "Grimsley's Move": {
    canPlay: (state, seat) =>
      firstTurn(state)
        ? "You can't use this card during your first turn."
        : me(state, seat).bench.length >= benchLimit(state, seat)
          ? "Your Bench is full."
          : null,
    play(state, seat, card) {
      const p = me(state, seat);
      const top = p.deck.slice(0, 7);
      const options = top.filter((c) => isBasicPokemon(c) && ofType(c, "Darkness")).map((c) => c.uid);
      if (!options.length)
        return grimsleyRest(
          state,
          seat,
          top.map((c) => c.uid),
        );
      ask(state, {
        seat,
        title: "Top 7 cards: choose a Darkness Pokémon to put onto your Bench",
        zone: "deck",
        options,
        shown: top.map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
        data: { top: top.map((c) => c.uid) },
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      for (const c of pull(p.deck, picks)) benchPokemon(state, seat, c);
      log(state, seat, `${p.name} put a Pokémon onto their Bench.`);
      grimsleyRest(
        state,
        seat,
        (data.top as string[]).filter((u) => !picks.includes(u)),
      );
    },
  },
  "Anthea & Concordia": {
    canPlay: (state, seat) => {
      const need = ["N's Darmanitan", "N's Zoroark ex", "N's Vanilluxe", "N's Klinklang", "N's Reshiram", "N's Zekrom"];
      const have = inPlay(me(state, seat)).map((s) => baseName(topCard(s).name));
      return need.every((n) => have.includes(n)) ? null : "You need all six N's Pokémon it names in play.";
    },
    play(state, seat) {
      addEffect(state, {
        kind: "morePrizes",
        seat,
        turn: state.turn,
        amount: 3,
        vs: "N",
        source: "Anthea & Concordia",
      });
      log(state, seat, "This turn, Knocking Out the Active Pokémon with an N's Pokémon's attack takes 3 more Prize cards.");
    },
  },
  Canari: {
    canPlay: needsOtherCards(1),
    play: (state, seat, card) => askDiscard(state, seat, "Canari: discard another card from your hand", () => true, 1, card.name),
    resume(state, seat, picks, data) {
      if (data.step === "cost") {
        payDiscard(state, seat, picks);
        return search(state, seat, "Canari", "Choose up to 4 Lightning Pokémon", pokemonOfType("Lightning"), 4);
      }
      toHand(state, seat, { name: "Canari" } as PCard, picks);
    },
  },
  "Team Rocket's Archer": {
    canPlay: (state, seat) =>
      koLastTurn(state, seat) && (me(state, seat).koNames ?? []).some((n) => n.startsWith("Team Rocket's"))
        ? null
        : "You can use this only if a Team Rocket's Pokémon was Knocked Out during your opponent's last turn.",
    play: (state, seat) => bothShuffleDraw(state, seat, 5, 3),
  },
  "Team Rocket's Giovanni": {
    canPlay: (state, seat) => {
      const p = me(state, seat);
      if (!p.active || !trainersPokemon(topCard(p.active), "Team Rocket")) return "Your Active Pokémon must be a Team Rocket's Pokémon.";
      return p.bench.some((s) => trainersPokemon(topCard(s), "Team Rocket")) ? null : "You have no Benched Team Rocket's Pokémon.";
    },
    play(state, seat, card) {
      const p = me(state, seat);
      const options = p.bench.map((s, i) => (trainersPokemon(topCard(s), "Team Rocket") ? `bench:${i}` : "")).filter(Boolean);
      ask(state, {
        seat,
        title: "Choose a Benched Team Rocket's Pokémon to switch in",
        zone: "myBench",
        options,
        min: 1,
        max: 1,
        effect: card.name,
        data: { step: "switch" },
      });
    },
    resume(state, seat, picks, data) {
      if (data.step === "switch") {
        doSwitch(state, seat, picks);
        return gustFrom(state, seat, "Team Rocket's Giovanni", true);
      }
      resumeGust(state, seat, picks);
    },
  },
  "Team Rocket's Proton": searchToHand("Choose up to 3 Basic Team Rocket's Pokémon", isBasicOf("Team Rocket"), 3),
  "Black Belt's Training": {
    play(state, seat) {
      addEffect(state, {
        kind: "damageUp",
        seat,
        turn: state.turn,
        amount: 40,
        vs: "ex",
        source: "Black Belt's Training",
      });
      log(state, seat, "This turn, your attacks do 40 more damage to your opponent's Active Pokémon ex.");
    },
  },
  Emma: {
    play(state, seat) {
      revealHand(state, seat);
      drawCards((s, st) => them(s, st).hand.filter(isPokemon).length).play(state, seat, {} as PCard);
    },
  },
  Philippe: {
    canPlay: (state, seat) =>
      me(state, seat).discard.some(basicEnergyOf("Metal")) && myKeys(state, seat, (s) => ofType(topCard(s), "Metal")).length
        ? null
        : "You need Basic Metal Energy in your discard pile and a Metal Pokémon in play.",
    play: (state, seat, card) =>
      ask(state, {
        seat,
        title: "Choose a Metal Pokémon to attach up to 2 Basic Metal Energy to",
        zone: "myPokemon",
        options: myKeys(state, seat, (s) => ofType(topCard(s), "Metal")),
        min: 1,
        max: 1,
        effect: card.name,
      }),
    resume(state, seat, picks) {
      const p = me(state, seat);
      const slot = slotAt(p, picks[0] as SlotKey)!;
      const energy = pull(
        p.discard,
        p.discard
          .filter(basicEnergyOf("Metal"))
          .slice(0, 2)
          .map((c) => c.uid),
      );
      slot.energy.push(...energy);
      log(state, seat, `${p.name} attached ${names(energy)} to ${topCard(slot).name}.`);
    },
  },
  "Roxie's Performance": {
    play(state, seat) {
      addEffect(state, {
        kind: "poisonNoRetreat",
        seat,
        turn: state.turn + 1,
        source: "Roxie's Performance",
      });
      log(state, seat, "During your opponent's next turn, their Poisoned Pokémon can't retreat.");
    },
  },
  Gwynn: {
    play(state, seat, card) {
      const p = me(state, seat);
      const options = p.hand.filter((c) => isPokemon(c) && !hasRuleBox(c)).map((c) => c.uid);
      if (!options.length) return log(state, seat, `${p.name} had no Pokémon without a Rule Box to discard.`);
      ask(state, {
        seat,
        title: "Discard up to 2 Pokémon without a Rule Box (draw 3 for each)",
        zone: "hand",
        options,
        min: 0,
        max: 2,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      payDiscard(state, seat, picks);
      drawCards(picks.length * 3).play(state, seat, {} as PCard);
    },
  },
  Jett: drawCards((state, seat) => inPlay(them(state, seat)).filter((s) => isMegaEx(topCard(s))).length),
  "Misty's Vitality": chain({
    play(state, seat, card) {
      search(state, seat, card.name, "Choose up to 4 Basic Water Energy cards to attach to 1 of your Pokémon", basicEnergyOf("Water"), 4, { step: "find" });
      if (!state.prompt) endTurnNow(state, seat, card.name);
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (data.step === "find") {
        if (!picks.length) {
          shuffle(p.deck);
          return endTurnNow(state, seat, "Misty's Vitality");
        }
        ask(state, {
          seat,
          title: "Choose the Pokémon to attach them to",
          zone: "myPokemon",
          options: myKeys(state, seat),
          min: 1,
          max: 1,
          effect: "Misty's Vitality",
          data: { step: "target", energy: picks },
        });
        return;
      }
      const slot = slotAt(p, picks[0] as SlotKey)!;
      const energy = pull(p.deck, data.energy as string[]);
      slot.energy.push(...energy);
      shuffle(p.deck);
      log(state, seat, `${p.name} attached ${names(energy)} to ${topCard(slot).name}.`);
      endTurnNow(state, seat, "Misty's Vitality");
    },
  }),
  Blanche: drawFlipAttach("Water"),
  Candela: drawFlipAttach("Fire"),
  Spark: drawFlipAttach("Lightning"),
  "Team Star Grunt": {
    canPlay: (state, seat) => (them(state, seat).active?.energy.length ? null : "Your opponent's Active Pokémon has no Energy."),
    play(state, seat, card) {
      const a = them(state, seat).active!;
      askChoice(
        state,
        seat,
        "Choose an Energy to put on top of your opponent's deck",
        a.energy.map((e) => ({ id: e.uid, label: e.name })),
        card.name,
      );
    },
    resume(state, seat, picks) {
      const opp = them(state, seat);
      const a = opp.active!;
      const [e] = pull(a.energy, picks);
      if (e) opp.deck.unshift(e);
      log(state, seat, `${e?.name ?? "An Energy"} went on top of ${opp.name}'s deck.`);
    },
  },
  "Ethan's Adventure": searchToHand(
    "Choose up to 3 Ethan's Pokémon and Basic Fire Energy cards",
    either((c) => trainersPokemon(c, "Ethan"), basicEnergyOf("Fire")),
    3,
  ),
  Dendra: {
    canPlay: needsOtherCards(1),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose a card to put on the bottom of your deck",
        zone: "hand",
        options: p.hand.map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
        data: { step: "cost" },
      });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      p.deck.push(...pull(p.hand, picks));
      drawUntil(() => 5).play(state, seat, {} as PCard);
    },
  },
  Giacomo: {
    play(state, seat) {
      const oppSeat = otherSeat(seat);
      for (const slot of inPlay(them(state, seat))) {
        const e = slot.energy.find(isSpecialEnergy);
        if (e) discardAttached(state, oppSeat, slot, e);
      }
    },
  },
  Saguaro: {
    canPlay: (state, seat) => (myKeys(state, seat, (s) => s.damage > 0).length ? null : "None of your Pokémon have damage."),
    play: (state, seat, card) =>
      ask(state, {
        seat,
        title: "Choose up to 2 Pokémon to heal 50 damage from",
        zone: "myPokemon",
        options: myKeys(state, seat, (s) => s.damage > 0),
        min: 1,
        max: 2,
        effect: card.name,
      }),
    resume(state, seat, picks) {
      for (const k of picks) {
        const slot = slotAt(me(state, seat), k as SlotKey)!;
        log(state, seat, `${topCard(slot).name} was healed ${heal(slot, 50)} damage.`);
      }
    },
  },
  Geeta: chain({
    play(state, seat, card) {
      addEffect(state, {
        kind: "noAttack",
        seat,
        turn: state.turn,
        source: "Geeta",
      });
      search(state, seat, card.name, "Choose up to 2 Basic Energy cards to attach to 1 of your Pokémon", isBasicEnergy, 2, { step: "find" });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (data.step === "find") {
        if (!picks.length) return void shuffle(p.deck);
        ask(state, {
          seat,
          title: "Choose the Pokémon to attach them to",
          zone: "myPokemon",
          options: myKeys(state, seat),
          min: 1,
          max: 1,
          effect: "Geeta",
          data: { step: "target", energy: picks },
        });
        return;
      }
      const slot = slotAt(p, picks[0] as SlotKey)!;
      const energy = pull(p.deck, data.energy as string[]);
      slot.energy.push(...energy);
      shuffle(p.deck);
      log(state, seat, `${p.name} attached ${names(energy)} to ${topCard(slot).name}. Their Pokémon can't attack this turn.`);
    },
  }),
  Ortega: {
    canPlay: (state, seat) => (them(state, seat).hand.length ? null : "Your opponent's hand is empty."),
    play: (state, seat, card) =>
      void askOppHand(state, seat, card.name, "Choose a card to put on the bottom of their deck", () => true, 1, 1, { step: "pick" }),
    resume(state, seat, picks, data) {
      if (data.step === "draw") {
        // The opponent answered.
        if (picks[0] === "yes") {
          draw(state.players[seat], 1);
          log(state, seat, `${state.players[seat].name} drew a card.`);
        }
        return;
      }
      const opp = them(state, seat);
      const moved = pull(opp.hand, picks);
      opp.deck.push(...moved);
      log(state, seat, `${names(moved)} went to the bottom of ${opp.name}'s deck.`);
      askChoice(
        state,
        otherSeat(seat),
        "Ortega: you may draw a card",
        [
          { id: "yes", label: "Draw a card" },
          { id: "no", label: "Don't draw" },
        ],
        "Ortega",
        { data: { step: "draw" } },
      );
    },
  },
  Poppy: {
    canPlay: (state, seat) =>
      inPlay(me(state, seat)).length > 1 && inPlay(me(state, seat)).some((s) => s.energy.length) ? null : "You need a Pokémon with Energy and another Pokémon.",
    play: (state, seat, card) =>
      ask(state, {
        seat,
        title: "Choose the Pokémon to move up to 2 Energy from",
        zone: "myPokemon",
        options: myKeys(state, seat, (s) => s.energy.length > 0),
        min: 1,
        max: 1,
        effect: card.name,
        data: { step: "from" },
      }),
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (data.step === "from") {
        const from = slotAt(p, picks[0] as SlotKey)!;
        askChoice(
          state,
          seat,
          "Choose up to 2 Energy to move",
          from.energy.map((e) => ({ id: e.uid, label: e.name })),
          "Poppy",
          { min: 1, max: 2, data: { step: "energy", from: picks[0] } },
        );
        return;
      }
      if (data.step === "energy") {
        ask(state, {
          seat,
          title: "Choose the Pokémon to move them to",
          zone: "myPokemon",
          options: myKeys(state, seat).filter((k) => k !== data.from),
          min: 1,
          max: 1,
          effect: "Poppy",
          data: { step: "to", from: data.from, energy: picks },
        });
        return;
      }
      moveEnergy(state, seat, slotAt(p, data.from as SlotKey)!, slotAt(p, picks[0] as SlotKey)!, data.energy as string[]);
    },
  },
  Ryme: {
    play(state, seat) {
      drawCards(3).play(state, seat, {} as PCard);
      oppSwitchesOut(state, seat);
    },
  },
  "Daisy's Help": {
    play(state, seat, card) {
      drawCards(2).play(state, seat, card);
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Your face-down Prize cards",
        zone: "prizes",
        options: [],
        shown: p.prizes.map((c) => c.uid),
        min: 0,
        max: 0,
        effect: card.name,
      });
    },
    resume: () => undefined,
  },
  "Erika's Invitation": {
    canPlay: (state, seat) => (them(state, seat).bench.length < benchLimit(state, otherSeat(seat)) ? null : "Your opponent's Bench is full."),
    play: (state, seat, card) => void askOppHand(state, seat, card.name, "Choose a Basic Pokémon to put onto their Bench and switch in", isBasicPokemon, 1, 1),
    resume(state, seat, picks) {
      const oppSeat = otherSeat(seat);
      const opp = state.players[oppSeat];
      const [c] = pull(opp.hand, picks);
      if (!c) return;
      const slot = benchPokemon(state, oppSeat, c);
      switchActive(opp, opp.bench.indexOf(slot));
      log(state, seat, `${c.name} was put onto ${opp.name}'s Bench and switched into the Active Spot.`);
    },
  },
  "Giovanni's Charisma": {
    canPlay: (state, seat) => (them(state, seat).active?.energy.length ? null : "Your opponent's Active Pokémon has no Energy."),
    play(state, seat, card) {
      const a = them(state, seat).active!;
      askChoice(
        state,
        seat,
        "Choose an Energy to put into your opponent's hand",
        a.energy.map((e) => ({ id: e.uid, label: e.name })),
        card.name,
        { data: { step: "take" } },
      );
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (data.step === "take") {
        const opp = them(state, seat);
        const [e] = pull(opp.active!.energy, picks);
        if (e) opp.hand.push(e);
        log(state, seat, `${e?.name} went back to ${opp.name}'s hand.`);
        const options = p.hand.filter(isEnergy).map((c) => c.uid);
        if (options.length && p.active)
          ask(state, {
            seat,
            title: "Choose an Energy card from your hand to attach to your Active Pokémon",
            zone: "hand",
            options,
            min: 1,
            max: 1,
            effect: "Giovanni's Charisma",
            data: { step: "give" },
          });
        return;
      }
      const [e] = pull(p.hand, picks);
      if (e && p.active) {
        p.active.energy.push(e);
        log(state, seat, `${p.name} attached ${e.name} to ${topCard(p.active).name}.`);
      }
    },
  },
  Larry: {
    play(state, seat, card) {
      const heads = coin(state, seat, card.name);
      search(state, seat, card.name, heads ? "Choose up to 2 Pokémon" : "Choose a Basic Pokémon", heads ? isPokemon : isBasicPokemon, heads ? 2 : 1);
    },
    resume: (state, seat, picks) => toHand(state, seat, { name: "Larry" } as PCard, picks),
  },
  Mela: {
    canPlay: (state, seat) =>
      !koLastTurn(state, seat)
        ? "You can use this only if one of your Pokémon was Knocked Out during your opponent's last turn."
        : me(state, seat).discard.some(basicEnergyOf("Fire"))
          ? null
          : "There's no Basic Fire Energy in your discard pile.",
    play: (state, seat, card) =>
      ask(state, {
        seat,
        title: "Choose a Pokémon to attach a Basic Fire Energy to",
        zone: "myPokemon",
        options: myKeys(state, seat),
        min: 1,
        max: 1,
        effect: card.name,
      }),
    resume(state, seat, picks) {
      const p = me(state, seat);
      const slot = slotAt(p, picks[0] as SlotKey)!;
      const [e] = pull(p.discard, [p.discard.find(basicEnergyOf("Fire"))!.uid]);
      slot.energy.push(e);
      log(state, seat, `${p.name} attached ${e.name} to ${topCard(slot).name}.`);
      drawUntil(() => 6).play(state, seat, {} as PCard);
    },
  },
  "Professor Sada's Vitality": chain({
    canPlay: (state, seat) =>
      me(state, seat).discard.some(isBasicEnergy) && myKeys(state, seat, (s) => topCard(s).subtypes.includes("Ancient")).length
        ? null
        : "You need an Ancient Pokémon in play and Basic Energy in your discard pile.",
    play(state, seat, card) {
      const energy = me(state, seat)
        .discard.filter(isBasicEnergy)
        .slice(0, 2)
        .map((c) => c.uid);
      askAttach(
        state,
        seat,
        card.name,
        "discard",
        energy,
        myKeys(state, seat, (s) => topCard(s).subtypes.includes("Ancient")),
        "draw3",
        { each: true },
      );
    },
  }),
  Shauntal: {
    play(state, seat, card) {
      if (coin(state, seat, card.name)) gustFrom(state, seat, card.name, true);
      else if (me(state, seat).bench.length) askSwitch(state, seat, card.name, { step: "switch" });
    },
    resume(state, seat, picks, data) {
      if (data.step === "switch") doSwitch(state, seat, picks);
      else resumeGust(state, seat, picks);
    },
  },
  Atticus: {
    ...shuffleDraw(() => 7),
    canPlay: (state, seat) => (them(state, seat).active?.conditions.includes("poisoned") ? null : "Your opponent's Active Pokémon must be Poisoned."),
  },
  Clive: {
    play(state, seat) {
      revealHand(state, seat);
      drawCards((s, st) => them(s, st).hand.filter(isSupporter).length * 2).play(state, seat, {} as PCard);
    },
  },
  "Paldean Student": {
    play(state, seat, card) {
      const extra = me(state, seat).discard.filter((c) => baseName(c.name) === "Paldean Student").length - 1;
      search(
        state,
        seat,
        card.name,
        `Choose up to ${1 + Math.max(0, extra)} Pokémon without a Rule Box`,
        (c) => isPokemon(c) && !hasRuleBox(c),
        1 + Math.max(0, extra),
      );
    },
    resume: (state, seat, picks) => toHand(state, seat, { name: "Paldean Student" } as PCard, picks),
  },
  "Ciphermaniac's Codebreaking": chain({
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play: (state, seat, card) => search(state, seat, card.name, "Choose 2 cards to put on top of your deck", () => true, 2, { step: "find" }),
    resume(state, seat, picks) {
      const p = me(state, seat);
      const chosen = pull(p.deck, picks);
      shuffle(p.deck);
      p.deck.unshift(...chosen);
      askOrder(
        state,
        seat,
        "Ciphermaniac's Codebreaking",
        chosen.map((c) => c.uid),
      );
    },
  }),
  Eri: {
    canPlay: (state, seat) => (them(state, seat).hand.length ? null : "Your opponent's hand is empty."),
    play: (state, seat, card) => void askOppHand(state, seat, card.name, "Choose up to 2 Item cards to discard", (c) => isItem(c), 2),
    resume(state, seat, picks) {
      const opp = them(state, seat);
      const gone = pull(opp.hand, picks);
      opp.discard.push(...gone);
      log(state, seat, `${names(gone)} were discarded from ${opp.name}'s hand.`);
    },
  },
  "Morty's Conviction": {
    canPlay: needsOtherCards(1),
    play: (state, seat, card) => askDiscard(state, seat, "Morty's Conviction: discard another card from your hand", () => true, 1, card.name),
    resume(state, seat, picks) {
      payDiscard(state, seat, picks);
      drawCards((s, st) => them(s, st).bench.length).play(state, seat, {} as PCard);
    },
  },
  Salvatore: {
    canPlay: (state, seat) => (salvatoreCards(state, seat).length ? null : "Your deck has nothing without an Ability that evolves from your Pokémon."),
    play: (state, seat, card) => {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose a Pokémon to evolve into",
        zone: "deck",
        options: salvatoreCards(state, seat),
        shown: p.deck.map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
        data: { step: "card" },
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (data.step === "card") {
        const card = p.deck.find((c) => c.uid === picks[0])!;
        const targets = myKeys(state, seat, (s) => topCard(s).name === card.evolvesFrom);
        if (targets.length === 1) return salvatoreEvolve(state, seat, picks[0], targets[0]);
        ask(state, {
          seat,
          title: `Choose the Pokémon to evolve into ${card.name}`,
          zone: "myPokemon",
          options: targets,
          min: 1,
          max: 1,
          effect: "Salvatore",
          data: { step: "slot", card: picks[0] },
        });
        return;
      }
      salvatoreEvolve(state, seat, String(data.card), picks[0] as SlotKey);
    },
  },
  Caretaker: {
    play(state, seat, card) {
      const p = me(state, seat);
      const before = p.hand.length;
      drawCards(2).play(state, seat, card);
      if (p.hand.length > before && state.stadium && baseName(state.stadium.card.name) === "Community Center") {
        const [self] = pull(p.discard, [card.uid]);
        if (self) {
          p.deck.push(self);
          shuffle(p.deck);
          log(state, seat, "Caretaker was shuffled back into the deck.");
        }
      }
    },
  },
  Hassel: {
    ...topCards(8, 3, "shuffle"),
    canPlay: (state, seat) =>
      koLastTurn(state, seat) ? null : "You can use this only if one of your Pokémon was Knocked Out during your opponent's last turn.",
  },
  Kieran: {
    play(state, seat, card) {
      const choices = [
        {
          id: "boost",
          label: "Attacks do 30 more damage to an Active ex or V this turn",
        },
      ];
      if (me(state, seat).bench.length)
        choices.unshift({
          id: "switch",
          label: "Switch your Active Pokémon with a Benched Pokémon",
        });
      askChoice(state, seat, "Kieran: choose 1", choices, card.name, {
        data: { step: "which", botPick: ["boost"] },
      });
    },
    resume(state, seat, picks, data) {
      if (data.step === "switch") return void doSwitch(state, seat, picks);
      if (picks[0] === "switch") return askSwitch(state, seat, "Kieran", { step: "switch" });
      addEffect(state, {
        kind: "damageUp",
        seat,
        turn: state.turn,
        amount: 30,
        vs: "exV",
        source: "Kieran",
      });
      log(state, seat, "This turn, attacks do 30 more damage to your opponent's Active Pokémon ex or V.");
    },
  },
  Lucian: {
    play(state, seat) {
      let any = false;
      for (const s of [seat, otherSeat(seat)]) {
        const p = state.players[s];
        if (p.hand.length) any = true;
        p.deck.push(...shuffle(p.hand.splice(0)));
      }
      log(state, seat, "Each player put their hand on the bottom of their deck.");
      if (!any) return;
      for (const s of [seat, otherSeat(seat)]) {
        const p = state.players[s];
        const heads = flip();
        draw(p, heads ? 6 : 3);
        log(state, s, `${p.name} flipped ${heads ? "heads and drew 6 cards" : "tails and drew 3 cards"}.`, "coin");
      }
    },
  },
  Perrin: {
    canPlay: (state, seat) => (me(state, seat).hand.some(isPokemon) ? null : "You have no Pokémon in your hand."),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Reveal up to 2 Pokémon to shuffle into your deck",
        zone: "hand",
        options: p.hand.filter(isPokemon).map((c) => c.uid),
        min: 1,
        max: 2,
        effect: card.name,
        data: { step: "give" },
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (data.step === "give") {
        const back = pull(p.hand, picks);
        p.deck.push(...back);
        log(state, seat, `${p.name} put ${names(back)} into their deck.`);
        return search(state, seat, "Perrin", `Choose up to ${back.length} Pokémon`, isPokemon, back.length, { step: "take" });
      }
      toHand(state, seat, { name: "Perrin" } as PCard, picks);
    },
  },
  Raifort: chain({
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const top = me(state, seat).deck.slice(0, 5);
      ask(state, {
        seat,
        title: "Top 5 cards: choose any to discard",
        zone: "deck",
        options: top.map((c) => c.uid),
        min: 0,
        max: top.length,
        effect: card.name,
        data: { step: "discard", top: top.map((c) => c.uid) },
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      const gone = pull(p.deck, picks);
      p.discard.push(...gone);
      if (gone.length) log(state, seat, `${p.name} discarded ${names(gone)}.`);
      askOrder(
        state,
        seat,
        "Raifort",
        (data.top as string[]).filter((u) => !picks.includes(u)),
      );
    },
  }),
  "Janine's Secret Art": {
    canPlay: (state, seat) => (myKeys(state, seat, (s) => ofType(topCard(s), "Darkness")).length ? null : "You have no Darkness Pokémon."),
    play: (state, seat, card) =>
      ask(state, {
        seat,
        title: "Choose up to 2 Darkness Pokémon",
        zone: "myPokemon",
        options: myKeys(state, seat, (s) => ofType(topCard(s), "Darkness")),
        min: 1,
        max: 2,
        effect: card.name,
      }),
    resume(state, seat, picks) {
      const p = me(state, seat);
      for (const key of picks) {
        const slot = slotAt(p, key as SlotKey)!;
        const e = p.deck.find(basicEnergyOf("Darkness"));
        if (!e) break;
        p.deck.splice(p.deck.indexOf(e), 1);
        slot.energy.push(e);
        log(state, seat, `${p.name} attached ${e.name} to ${topCard(slot).name}.`);
        if (key === "active") {
          setCondition(state, slot, "poisoned");
          log(state, seat, `${topCard(slot).name} is now Poisoned.`);
        }
      }
      shuffle(p.deck);
    },
  },
  "Xerosic's Machinations": {
    play: (state, seat) => oppDiscardTo(state, seat, otherSeat(seat), 3),
  },
  Briar: {
    canPlay: (state, seat) => (them(state, seat).prizes.length === 2 ? null : "You can use this only if your opponent has exactly 2 Prize cards left."),
    play(state, seat) {
      addEffect(state, {
        kind: "morePrizes",
        seat,
        turn: state.turn,
        amount: 1,
        vs: "Tera",
        source: "Briar",
      });
      log(state, seat, "This turn, Knocking Out the Active Pokémon with a Tera Pokémon's attack takes 1 more Prize card.");
    },
  },
  Crispin: chain({
    play: (state, seat, card) => search(state, seat, card.name, "Choose up to 2 Basic Energy cards of different types", isBasicEnergy, 2, { step: "find" }),
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (data.step === "find") {
        const chosen = picks.map((u) => p.deck.find((c) => c.uid === u)!).filter(Boolean);
        const list = chosen.length === 2 && energyProvides(chosen[0])[0] === energyProvides(chosen[1])[0] ? chosen.slice(0, 1) : chosen;
        if (list.length < 2)
          return toHand(
            state,
            seat,
            { name: "Crispin" } as PCard,
            list.map((c) => c.uid),
          );
        askChoice(
          state,
          seat,
          "Choose which Energy goes into your hand (the other is attached)",
          list.map((c) => ({ id: c.uid, label: c.name })),
          "Crispin",
          { data: { step: "split", both: list.map((c) => c.uid) } },
        );
        return;
      }
      const both = data.both as string[];
      const hand = pull(p.deck, picks);
      p.hand.push(...hand);
      log(state, seat, `${p.name} put ${names(hand)} into their hand.`);
      askAttach(
        state,
        seat,
        "Crispin",
        "deck",
        both.filter((u) => u !== picks[0]),
        myKeys(state, seat),
        "shuffle",
        { card: "Crispin" },
      );
    },
  }),
  Kofu: {
    canPlay: needsOtherCards(2),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose 2 cards to put on the bottom of your deck",
        zone: "hand",
        options: p.hand.map((c) => c.uid),
        min: 2,
        max: 2,
        effect: card.name,
        data: { step: "cost" },
      });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      p.deck.push(...pull(p.hand, picks));
      drawCards(4).play(state, seat, {} as PCard);
    },
  },
  Drayton: {
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const p = me(state, seat);
      const top = p.deck.slice(0, 7);
      const options = top.filter((c) => isPokemon(c) || c.supertype === "Trainer").map((c) => c.uid);
      if (!options.length) return void shuffle(p.deck);
      ask(state, {
        seat,
        title: "Top 7 cards: you may take a Pokémon and a Trainer card",
        zone: "deck",
        options,
        shown: top.map((c) => c.uid),
        min: 0,
        max: 2,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const chosen = picks.map((u) => p.deck.find((c) => c.uid === u)!).filter(Boolean);
      const keep = [chosen.find(isPokemon), chosen.find((c) => c.supertype === "Trainer")].filter(Boolean) as PCard[];
      toHand(
        state,
        seat,
        { name: "Drayton" } as PCard,
        keep.map((c) => c.uid),
      );
    },
  },
  "Jasmine's Gaze": {
    play(state, seat) {
      addEffect(state, {
        kind: "damageDown",
        seat,
        turn: state.turn + 1,
        amount: 30,
        source: "Jasmine's Gaze",
      });
      log(state, seat, "During the next turn, your Pokémon take 30 less damage from attacks.");
    },
  },
  Tyme: {
    canPlay: (state, seat) => (me(state, seat).hand.some(isPokemon) ? null : "You have no Pokémon in your hand."),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose a Pokémon in your hand for your opponent to guess its HP",
        zone: "hand",
        options: p.hand.filter(isPokemon).map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
        data: { step: "pick" },
      });
    },
    resume(state, seat, picks, data) {
      if (data.step === "pick") {
        const c = me(state, seat).hand.find((x) => x.uid === picks[0])!;
        log(state, seat, `${me(state, seat).name} named ${c.name}.`);
        const guesses = Array.from({ length: 34 }, (_, i) => String(30 + i * 10));
        const botGuess = String(Math.round((60 + Math.random() * 100) / 10) * 10);
        askChoice(
          state,
          otherSeat(seat),
          `Guess the HP of ${me(state, seat).name}'s ${c.name}`,
          guesses.map((g) => ({ id: g, label: `${g} HP` })),
          "Tyme",
          { data: { step: "guess", card: picks[0], botPick: [botGuess] } },
        );
        return;
      }
      // The opponent guessed: `seat` here is the guesser.
      const owner = otherSeat(seat);
      const c = state.players[owner].hand.find((x) => x.uid === data.card);
      const right = c && String(c.hp) === picks[0];
      const drawer = right ? seat : owner;
      draw(state.players[drawer], 4);
      log(state, seat, `${state.players[seat].name} guessed ${picks[0]} HP. ${c?.name} has ${c?.hp} HP, so ${state.players[drawer].name} drew 4 cards.`);
    },
  },
  Amarys: {
    play(state, seat) {
      drawCards(4).play(state, seat, {} as PCard);
      addEffect(state, {
        kind: "discardHandAt5",
        seat,
        turn: state.turn,
        source: "Amarys",
      });
    },
  },
  "Larry's Skill": {
    play(state, seat, card) {
      const p = me(state, seat);
      p.discard.push(...p.hand.splice(0));
      log(state, seat, `${p.name} discarded their hand.`);
      search(state, seat, card.name, "Choose a Pokémon, a Supporter and a Basic Energy card", either(isPokemon, isSupporter, isBasicEnergy), 3);
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const chosen = picks.map((u) => p.deck.find((c) => c.uid === u)!).filter(Boolean);
      const keep = [chosen.find(isPokemon), chosen.find(isSupporter), chosen.find(isBasicEnergy)].filter(Boolean) as PCard[];
      toHand(
        state,
        seat,
        { name: "Larry's Skill" } as PCard,
        keep.map((c) => c.uid),
      );
    },
  },
  Ruffian: {
    canPlay: (state, seat) =>
      myOppKeys(state, seat, (s) => !!s.tool || s.energy.some(isSpecialEnergy)).length
        ? null
        : "None of your opponent's Pokémon have a Tool or Special Energy.",
    play(state, seat, card) {
      ask(state, {
        seat,
        title: "Choose 1 of your opponent's Pokémon",
        zone: "oppPokemon",
        options: myOppKeys(state, seat, (s) => !!s.tool || s.energy.some(isSpecialEnergy)),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const oppSeat = otherSeat(seat);
      const slot = slotAt(state.players[oppSeat], picks[0] as SlotKey)!;
      if (slot.tool) discardAttached(state, oppSeat, slot, slot.tool);
      const e = slot.energy.find(isSpecialEnergy);
      if (e) discardAttached(state, oppSeat, slot, e);
    },
  },
  Adaman: {
    canPlay: (state, seat) =>
      me(state, seat).hand.filter((c) => isEnergy(c) && c.name.includes("Metal")).length >= 2 ? null : "You need 2 Metal Energy cards in your hand to discard.",
    play: (state, seat, card) => askDiscard(state, seat, "Adaman: discard 2 Metal Energy cards", (c) => isEnergy(c) && c.name.includes("Metal"), 2, card.name),
    resume(state, seat, picks, data) {
      if (data.step === "cost") {
        payDiscard(state, seat, picks);
        return search(state, seat, "Adaman", "Choose up to 2 cards", () => true, 2);
      }
      toHand(state, seat, { name: "Adaman" } as PCard, picks);
    },
  },
  Choy: {
    play(state, seat) {
      revealHand(state, seat);
      log(state, seat, `${me(state, seat).name} revealed their hand.`);
      drawCards(3).play(state, seat, {} as PCard);
    },
  },
  Cyllene: chain({
    play(state, seat, card) {
      const heads = [flip(), flip()].filter(Boolean).length;
      log(state, seat, `Flipped 2 coins for Cyllene: ${plural(heads, "heads")}.`, "coin");
      const p = me(state, seat);
      if (!heads || !p.discard.length) return;
      ask(state, {
        seat,
        title: `Choose up to ${heads} cards from your discard pile to put on top of your deck`,
        zone: "discard",
        options: p.discard.map((c) => c.uid),
        min: 0,
        max: heads,
        effect: card.name,
        data: { step: "pick" },
      });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const cards = pull(p.discard, picks);
      p.deck.unshift(...cards);
      askOrder(
        state,
        seat,
        "Cyllene",
        cards.map((c) => c.uid),
      );
    },
  }),
  "Gardenia's Vigor": {
    play: drewAnd(2, (state, seat, card) => {
      const p = me(state, seat);
      const grass = p.hand.filter(energyOf("Grass"));
      if (!grass.length || !p.bench.length) return;
      ask(state, {
        seat,
        title: "Choose a Benched Pokémon to attach up to 2 Grass Energy from your hand to",
        zone: "myBench",
        options: benchSlots(p),
        min: 1,
        max: 1,
        effect: card.name,
      });
    }),
    resume(state, seat, picks) {
      const p = me(state, seat);
      const slot = slotAt(p, picks[0] as SlotKey)!;
      const energy = pull(
        p.hand,
        p.hand
          .filter(energyOf("Grass"))
          .slice(0, 2)
          .map((c) => c.uid),
      );
      slot.energy.push(...energy);
      log(state, seat, `${p.name} attached ${names(energy)} to ${topCard(slot).name}.`);
    },
  },
  Grant: {
    play(state, seat) {
      addEffect(state, {
        kind: "damageUp",
        seat,
        turn: state.turn,
        amount: 30,
        type: "Fighting",
        source: "Grant",
      });
      log(state, seat, "This turn, your Fighting Pokémon's attacks do 30 more damage.");
    },
  },
  Kamado: {
    canPlay: needsOtherCards(1),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose a card to keep (the rest are discarded)",
        zone: "hand",
        options: p.hand.map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const gone = p.hand.filter((c) => !picks.includes(c.uid));
      p.hand = p.hand.filter((c) => picks.includes(c.uid));
      p.discard.push(...gone);
      log(state, seat, `${p.name} discarded ${plural(gone.length, "card")}.`);
      drawCards(4).play(state, seat, {} as PCard);
    },
  },
  "Colress's Experiment": {
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const p = me(state, seat);
      const top = p.deck.slice(0, 5);
      const n = Math.min(3, top.length);
      ask(state, {
        seat,
        title: `Top ${top.length} cards: choose ${n} to put into your hand (the rest go to the Lost Zone)`,
        zone: "deck",
        options: top.map((c) => c.uid),
        min: n,
        max: n,
        effect: card.name,
        data: { top: top.map((c) => c.uid) },
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      const taken = pull(p.deck, picks);
      p.hand.push(...taken);
      const lost = pull(
        p.deck,
        (data.top as string[]).filter((u) => !picks.includes(u)),
      );
      (p.lost ??= []).push(...lost);
      log(state, seat, `${p.name} took ${names(taken)} and put ${plural(lost.length, "card")} in the Lost Zone.`);
    },
  },
  Fantina: {
    canPlay: (state, seat) => ((me(state, seat).lost ?? []).length >= 10 ? null : "You need 10 or more cards in the Lost Zone."),
    play(state, seat) {
      addEffect(state, {
        kind: "damageDown",
        seat,
        turn: state.turn + 1,
        amount: 120,
        vs: "V",
        source: "Fantina",
      });
      log(state, seat, "During the next turn, your Pokémon take 120 less damage from Pokémon V.");
    },
  },
  Iscan: drawCards((state, seat) => (me(state, seat).active && topCard(me(state, seat).active!).name.includes("Hisuian") ? 4 : 2)),
  "Miss Fortune Sisters": {
    play(state, seat, card) {
      const opp = them(state, seat);
      const top = opp.deck.slice(0, 5);
      log(state, seat, `${me(state, seat).name} looked at ${names(top)} on top of ${opp.name}'s deck.`);
      const options = deckGuarded(state, otherSeat(seat)) ? [] : top.filter((c) => isItem(c)).map((c) => c.uid);
      if (!options.length) return void shuffle(opp.deck);
      ask(state, {
        seat,
        title: `Choose any Item cards to discard from ${opp.name}'s deck`,
        zone: "oppDeck",
        options,
        shown: top.map((c) => c.uid),
        min: 0,
        max: options.length,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const opp = them(state, seat);
      const gone = pull(opp.deck, picks);
      opp.discard.push(...gone);
      shuffle(opp.deck);
      log(state, seat, `${names(gone)} were discarded from ${opp.name}'s deck.`);
    },
  },
  Riley: {
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const p = me(state, seat);
      const top = p.deck.slice(0, 5);
      log(state, seat, `${p.name} revealed ${names(top)}.`);
      const n = Math.min(2, top.length);
      ask(state, {
        seat: otherSeat(seat),
        title: `Choose ${n} of ${p.name}'s cards to discard (they keep the rest)`,
        zone: "oppDeck",
        options: top.map((c) => c.uid),
        min: n,
        max: n,
        effect: card.name,
        data: { top: top.map((c) => c.uid) },
      });
    },
    resume(state, chooser, picks, data) {
      const seat = otherSeat(chooser);
      const p = me(state, seat);
      const gone = pull(p.deck, picks);
      p.discard.push(...gone);
      const kept = pull(
        p.deck,
        (data.top as string[]).filter((u) => !picks.includes(u)),
      );
      p.hand.push(...kept);
      log(state, seat, `${names(gone)} were discarded; ${p.name} put ${names(kept)} into their hand.`);
    },
  },
  Thorton: {
    canPlay: (state, seat) =>
      me(state, seat).discard.some(isBasicPokemon) && myKeys(state, seat, (s) => s.pokemon.length === 1 && isBasicPokemon(topCard(s))).length
        ? null
        : "You need a Basic Pokémon in your discard pile and one in play.",
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose a Basic Pokémon from your discard pile",
        zone: "discard",
        options: p.discard.filter(isBasicPokemon).map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
        data: { step: "from" },
      });
    },
    resume(state, seat, picks, data) {
      if (data.step === "from") {
        ask(state, {
          seat,
          title: "Choose the Basic Pokémon in play to swap it with",
          zone: "myPokemon",
          options: myKeys(state, seat, (s) => s.pokemon.length === 1 && isBasicPokemon(topCard(s))),
          min: 1,
          max: 1,
          effect: "Thorton",
          data: { step: "to", card: picks[0] },
        });
        return;
      }
      swapFromDiscard(state, seat, String(data.card), picks[0] as SlotKey);
    },
  },
  Volo: {
    canPlay: (state, seat) => (me(state, seat).bench.some((s) => isV(topCard(s))) ? null : "You have no Benched Pokémon V."),
    play: (state, seat, card) =>
      ask(state, {
        seat,
        title: "Choose a Benched Pokémon V to discard",
        zone: "myBench",
        options: myBenchKeys(state, seat, (s) => isV(topCard(s))),
        min: 1,
        max: 1,
        effect: card.name,
      }),
    resume(state, seat, picks) {
      const p = me(state, seat);
      const [slot] = p.bench.splice(keyIndex(picks[0]), 1);
      if (!slot) return;
      p.discard.push(...slot.pokemon, ...attachedTo(slot));
      log(state, seat, `${p.name} discarded ${topCard(slot).name} and all cards attached to it.`);
    },
  },
  Brandon: {
    ...drawCards((state, seat) => me(state, seat).bench.length + them(state, seat).bench.length),
    canPlay: (state, seat) => (me(state, seat).hand.length === 1 ? null : "You can use this only when it's the last card in your hand."),
  },
  Candice: topCards(7, 7, "shuffle", either(pokemonOfType("Water"), energyOf("Water"))),
  "Professor Laventon": recover('Choose up to 3 Pokémon with "Hisuian" in their names', (c) => isPokemon(c) && c.name.includes("Hisuian"), 3, "hand"),
  Wallace: {
    play(state, seat, card) {
      drawCards(3).play(state, seat, card);
      askChoice(
        state,
        otherSeat(seat),
        `Wallace: you may draw a card (then ${me(state, seat).name} draws 1 more)`,
        [
          { id: "yes", label: "Draw a card" },
          { id: "no", label: "Don't draw" },
        ],
        card.name,
      );
    },
    resume(state, chooser, picks) {
      if (picks[0] !== "yes") return;
      const seat = otherSeat(chooser);
      draw(state.players[chooser], 1);
      draw(state.players[seat], 1);
      log(state, seat, `${state.players[chooser].name} drew a card, so ${state.players[seat].name} drew 1 more.`);
    },
  },
  "Digging Duo": {
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const p = me(state, seat);
      const n = coin(state, seat, card.name) ? 8 : 3;
      const bottom = p.deck.slice(-n);
      ask(state, {
        seat,
        title: `Bottom ${bottom.length} cards of your deck: choose 1 to put into your hand`,
        zone: "deck",
        options: bottom.map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume: (state, seat, picks) => toHand(state, seat, { name: "Digging Duo" } as PCard, picks),
  },
  "Cheren's Care": {
    canPlay: (state, seat) => {
      const keys = myKeys(state, seat, (s) => s.damage > 0 && ofType(topCard(s), "Colorless"));
      if (!keys.length) return "You have no damaged Colorless Pokémon.";
      return keys.length === 1 && keys[0] === "active" && !me(state, seat).bench.length ? "You'd have no Pokémon left in play." : null;
    },
    play: (state, seat, card) =>
      ask(state, {
        seat,
        title: "Choose a damaged Colorless Pokémon to put into your hand",
        zone: "myPokemon",
        options: myKeys(state, seat, (s) => s.damage > 0 && ofType(topCard(s), "Colorless")).filter((k) => k !== "active" || me(state, seat).bench.length > 0),
        min: 1,
        max: 1,
        effect: card.name,
      }),
    resume(state, seat, picks) {
      const p = me(state, seat);
      const key = picks[0] as SlotKey;
      const slot = slotAt(p, key)!;
      p.hand.push(...slot.pokemon, ...attachedTo(slot));
      if (key === "active") p.active = null;
      else p.bench.splice(keyIndex(key), 1);
      log(state, seat, `${p.name} put ${topCard(slot).name} and all attached cards into their hand.`);
    },
  },
  Kindler: {
    canPlay: (state, seat) => (me(state, seat).hand.some(energyOf("Fire")) ? null : "You need a Fire Energy card in your hand to discard."),
    play: (state, seat, card) => askDiscard(state, seat, "Kindler: discard a Fire Energy card", energyOf("Fire"), 1, card.name),
    resume(state, seat, picks, data) {
      if (data.step === "cost") {
        payDiscard(state, seat, picks);
        return topCards(7, 2, "shuffle").play(state, seat, {
          name: "Kindler",
        } as PCard);
      }
      topCards(7, 2, "shuffle").resume!(state, seat, picks, data);
    },
  },
  "Team Yell's Cheer": recover(
    "Choose up to 3 Pokémon and Supporter cards to shuffle into your deck",
    (c) => (isPokemon(c) || isSupporter(c)) && baseName(c.name) !== "Team Yell's Cheer",
    3,
    "deck",
  ),
  "N's Plan": {
    canPlay: (state, seat) =>
      me(state, seat).active && me(state, seat).bench.some((s) => s.energy.length) ? null : "Your Benched Pokémon have no Energy to move.",
    play(state, seat, card) {
      const choices = attachedChoices(state, [seat], (c, s) => isEnergy(c) && s !== me(state, seat).active && !toolsOn(s).includes(c));
      askChoice(state, seat, "Choose up to 2 Energy on your Bench to move to your Active Pokémon", choices, card.name, { min: 1, max: 2 });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      for (const id of picks) {
        const found = fromAttachedId(state, id);
        if (found && p.active) moveEnergy(state, seat, found.slot, p.active, [found.card.uid]);
      }
    },
  },
});

// ----- Helpers for the cards above -----

function discardChoice(state: PState, seat: Seat, id: string) {
  if (id === "stadium") return discardStadium(state, seat);
  const found = fromAttachedId(state, id);
  if (found) discardAttached(state, found.seat, found.slot, found.card);
}

function discardStadium(state: PState, seat: Seat) {
  if (!state.stadium) return;
  state.players[state.stadium.owner].discard.push(state.stadium.card);
  log(state, seat, `${state.stadium.card.name} was discarded.`);
  state.stadium = null;
}

function moveEnergy(state: PState, seat: Seat, from: PSlot, to: PSlot, uids: string[]) {
  const moving = from.energy.filter((e) => uids.includes(e.uid));
  from.energy = from.energy.filter((e) => !uids.includes(e.uid));
  to.energy.push(...moving);
  log(state, seat, `${me(state, seat).name} moved ${names(moving)} from ${topCard(from).name} to ${topCard(to).name}.`);
}

/** Puts a Pokémon from the discard pile in place of one in play, keeping everything attached. */
function swapFromDiscard(state: PState, seat: Seat, uid: string, key: SlotKey) {
  const p = me(state, seat);
  const slot = slotAt(p, key);
  const [card] = pull(p.discard, [uid]);
  if (!slot || !card) return;
  const old = slot.pokemon.splice(slot.pokemon.length - 1, 1, card);
  p.discard.push(...old);
  log(state, seat, `${p.name} swapped ${names(old)} for ${card.name}.`);
}

function grimsleyRest(state: PState, seat: Seat, rest: string[]) {
  const p = me(state, seat);
  p.deck.push(...shuffle(pull(p.deck, rest)));
}

function salvatoreCards(state: PState, seat: Seat) {
  const p = me(state, seat);
  const names = new Set(inPlay(p).map((s) => topCard(s).name));
  return p.deck.filter((c) => isPokemon(c) && c.evolvesFrom && names.has(c.evolvesFrom) && !c.abilities.length).map((c) => c.uid);
}
function salvatoreEvolve(state: PState, seat: Seat, uid: string, key: SlotKey) {
  const p = me(state, seat);
  const slot = slotAt(p, key)!;
  const [card] = pull(p.deck, [uid]);
  const from = topCard(slot).name;
  evolveSlot(state, slot, card);
  shuffle(p.deck);
  log(state, seat, `${p.name} evolved ${from} into ${card.name} with Salvatore.`);
}

export const myOppKeys = (state: PState, seat: Seat, test: (s: PSlot) => boolean) =>
  slotsOf(them(state, seat))
    .filter((x) => test(x.slot))
    .map((x) => x.key);

/** Supporters the player who goes first may play on their first turn. */
export const FIRST_TURN_EXTRA = ["Team Rocket's Proton"];
