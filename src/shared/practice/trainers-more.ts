// More Trainer cards that practice games play automatically: the everyday draw, search, heal,
// recover and switch cards in the Standard format. Built from a few shared shapes so each card
// is a line or two. Cards that aren't here or in trainers.ts are resolved "by hand" (manual.ts).

import { otherSeat, type Seat } from "../game-types";
import {
  ask,
  draw,
  energyProvides,
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
  settle,
  shuffle,
  slotAt,
  slotKeys,
  switchActive,
  topCard,
} from "./engine";
import { attachedTo, benchLimit, canHeal, setCondition } from "./effects";
import { discardLocked, pickUpLocked, trainersStayDiscarded } from "./abilities";
import {
  benchSlots,
  discardCost,
  gust,
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

// ----- Card tests -----

export const hasRuleBox = (c: PCard) => isPokemon(c) && c.rules.length > 0;
export const isEvolution = (c: PCard) => isPokemon(c) && !isBasicPokemon(c);
export const isStageN = (n: 1 | 2) => (c: PCard) => isPokemon(c) && c.subtypes.includes(`Stage ${n}`);
export const ofTypeP = (type: string) => (c: PCard) => isPokemon(c) && c.types.includes(type);
export const basicEnergyOf = (type: string) => (c: PCard) => isBasicEnergy(c) && c.name.includes(type);
export const either =
  (...tests: Match[]) =>
  (c: PCard) =>
    tests.some((t) => t(c));

// ----- Shapes -----

export const slots = (p: PPlayer) => slotKeys(p).map((k) => slotAt(p, k)!);

export function heal(slot: PSlot, amount: number) {
  if (!canHeal()) return 0;
  const before = slot.damage;
  slot.damage = Math.max(0, slot.damage - amount);
  return before - slot.damage;
}

/** Plain "Draw N cards." */
export const drawCards = (n: number | ((state: PState, seat: Seat) => number)): TrainerEffect => ({
  play(state, seat) {
    const p = me(state, seat);
    const count = typeof n === "number" ? n : n(state, seat);
    const before = p.hand.length;
    draw(p, count);
    log(state, seat, `${p.name} drew ${plural(p.hand.length - before, "card")}.`);
  },
});

/** "Draw cards until you have N cards in your hand." */
export const drawUntil = (n: (state: PState, seat: Seat) => number): TrainerEffect => ({
  play(state, seat) {
    const p = me(state, seat);
    const before = p.hand.length;
    draw(p, Math.max(0, n(state, seat) - p.hand.length));
    log(state, seat, `${p.name} drew ${plural(p.hand.length - before, "card")}.`);
  },
});

/** "Shuffle your hand into your deck. Then, draw N cards." */
export const shuffleDraw = (n: (state: PState, seat: Seat) => number): TrainerEffect => ({
  play(state, seat) {
    const p = me(state, seat);
    const count = n(state, seat);
    p.deck.push(...p.hand.splice(0));
    shuffle(p.deck);
    draw(p, count);
    log(state, seat, `${p.name} shuffled their hand into their deck and drew ${plural(count, "card")}.`);
  },
});

/** "Each player shuffles their hand into their deck", then each draws their own number. */
export function bothShuffleDraw(state: PState, seat: Seat, mine: number, theirs: number) {
  for (const s of [seat, otherSeat(seat)]) {
    const p = state.players[s];
    p.deck.push(...p.hand.splice(0));
    shuffle(p.deck);
    draw(p, s === seat ? mine : theirs);
  }
  log(state, null, `Each player shuffled their hand into their deck. ${me(state, seat).name} drew ${mine} and ${them(state, seat).name} drew ${theirs}.`);
}

/** "Search your deck for up to N ... and put them into your hand." `trim` enforces combos like "a Basic and a Stage 1". */
export const searchToHand = (title: string, match: Match, max: number, trim?: (cards: PCard[]) => PCard[]): TrainerEffect => ({
  canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
  play: (state, seat, card) => searchDeck(state, seat, card, title, match, max, { card: card.name }),
  resume(state, seat, picks, data) {
    const card = { name: String(data.card) } as PCard;
    if (!trim) return toHand(state, seat, card, picks);
    const p = me(state, seat);
    const chosen = picks.map((u) => p.deck.find((c) => c.uid === u)!).filter(Boolean);
    const keep = trim(chosen).map((c) => c.uid);
    toHand(state, seat, card, keep);
  },
});

/** "Put up to N ... from your discard pile into your hand" (or shuffle them into your deck). */
export const recover = (
  title: string,
  match: Match,
  max: number,
  to: "hand" | "deck",
  after?: (state: PState, seat: Seat, count: number) => void,
): TrainerEffect => ({
  canPlay: (state, seat) => {
    if (to === "hand" && discardLocked(state, seat)) return "Slime Mold Colony stops cards leaving your discard pile for your hand.";
    const ok = (c: PCard) => match(c) && !(to === "deck" && c.supertype === "Trainer" && trainersStayDiscarded(state, seat));
    return me(state, seat).discard.some(ok) ? null : "There's nothing in your discard pile for this card.";
  },
  play(state, seat, card) {
    const p = me(state, seat);
    ask(state, {
      seat,
      title,
      zone: "discard",
      options: p.discard.filter(match).map((c) => c.uid),
      min: 1,
      max,
      effect: card.name,
    });
  },
  resume(state, seat, picks) {
    const p = me(state, seat);
    const back = pull(p.discard, picks);
    if (to === "hand") p.hand.push(...back);
    else {
      p.deck.push(...back);
      shuffle(p.deck);
    }
    log(state, seat, `${p.name} put ${names(back)} ${to === "hand" ? "into their hand" : "back into their deck"}.`);
    after?.(state, seat, back.length);
  },
});

/** "Look at the top N cards of your deck and put M of them into your hand", with what happens to the rest. */
export const topCards = (n: number, take: number, rest: "discard" | "bottom" | "shuffle", match: Match = () => true, exactly = false): TrainerEffect => ({
  canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
  play(state, seat, card) {
    const p = me(state, seat);
    const top = p.deck.slice(0, n);
    const options = top.filter(match).map((c) => c.uid);
    if (!options.length) {
      finishTop(
        state,
        seat,
        card.name,
        top.map((c) => c.uid),
        [],
        rest,
      );
      return;
    }
    const want = Math.min(take, options.length);
    ask(state, {
      seat,
      title: `Top ${plural(top.length, "card")} of your deck: choose ${exactly ? want : `up to ${want}`} to put into your hand`,
      zone: "deck",
      options,
      shown: top.map((c) => c.uid),
      min: exactly ? want : 0,
      max: want,
      effect: card.name,
      data: { top: top.map((c) => c.uid), card: card.name },
    });
  },
  resume(state, seat, picks, data) {
    finishTop(state, seat, String(data.card), data.top as string[], picks, rest);
  },
});
function finishTop(state: PState, seat: Seat, cardName: string, top: string[], picks: string[], rest: "discard" | "bottom" | "shuffle") {
  const p = me(state, seat);
  const taken = pull(p.deck, picks);
  p.hand.push(...taken);
  const others = pull(
    p.deck,
    top.filter((u) => !picks.includes(u)),
  );
  if (rest === "discard") p.discard.push(...others);
  else if (rest === "bottom") p.deck.push(...shuffle(others));
  else {
    p.deck.push(...others);
    shuffle(p.deck);
  }
  const restText = rest === "discard" ? "discarded the rest" : rest === "bottom" ? "put the rest on the bottom of their deck" : "shuffled the rest back";
  log(state, seat, `${p.name} took ${names(taken)} with ${cardName} and ${restText}.`);
}

/** "Heal N damage from 1 of your Pokémon." */
export const healOne = (amount: number, which: Match = () => true, extra?: (state: PState, seat: Seat, slot: PSlot) => void): TrainerEffect => ({
  canPlay: (state, seat) => (slots(me(state, seat)).some((s) => s.damage && which(topCard(s))) ? null : "None of your Pokémon that this can heal have damage."),
  play(state, seat, card) {
    const p = me(state, seat);
    ask(state, {
      seat,
      title: `Choose a Pokémon to heal ${amount >= 999 ? "all" : amount} damage from`,
      zone: "myPokemon",
      options: slotKeys(p).filter((k) => slotAt(p, k)!.damage && which(topCard(slotAt(p, k)!))),
      min: 1,
      max: 1,
      effect: card.name,
    });
  },
  resume(state, seat, picks) {
    const slot = slotAt(me(state, seat), picks[0] as SlotKey)!;
    const healed = heal(slot, amount);
    log(state, seat, `${topCard(slot).name} was healed ${healed} damage.`);
    extra?.(state, seat, slot);
  },
});

/** "Heal N damage from your Active Pokémon." */
export const healActive = (amount: number, ok: (slot: PSlot) => boolean = () => true): TrainerEffect => ({
  canPlay: (state, seat) => {
    const a = me(state, seat).active;
    return a && a.damage && ok(a) ? null : "Your Active Pokémon can't be healed by this card.";
  },
  play(state, seat) {
    const a = me(state, seat).active!;
    const healed = heal(a, amount);
    log(state, seat, `${topCard(a).name} was healed ${healed} damage.`);
  },
});

/** "Heal N damage from each of your Pokémon." */
export const healEach = (amount: number, which: Match = () => true, both = false): TrainerEffect => ({
  play(state, seat) {
    for (const s of both ? [seat, otherSeat(seat)] : [seat]) for (const slot of slots(state.players[s])) if (which(topCard(slot))) heal(slot, amount);
    log(state, seat, `${both ? "Every" : `Each of ${me(state, seat).name}'s`} Pokémon was healed ${amount} damage.`);
  },
});

/** Ask for one of your Benched Pokémon, then switch it in. */
export function askSwitch(state: PState, seat: Seat, effect: string, data: Data = {}) {
  ask(state, {
    seat,
    title: "Choose a Benched Pokémon to switch with your Active Pokémon",
    zone: "myBench",
    options: benchSlots(me(state, seat)),
    min: 1,
    max: 1,
    effect,
    data,
  });
}
export function doSwitch(state: PState, seat: Seat, picks: string[]) {
  const p = me(state, seat);
  const index = Number(picks[0].split(":")[1]);
  const outgoing = p.active;
  const name = topCard(p.bench[index]).name;
  switchActive(p, index);
  log(state, seat, `${p.name} switched ${name} into the Active Spot.`);
  return outgoing;
}
export const needBench = (state: PState, seat: Seat) => (me(state, seat).bench.length ? null : "You have no Benched Pokémon.");

/** Puts a Pokémon in play back into its owner's hand (with its attached cards, or discarding them). */
function pickUp(state: PState, seat: Seat, key: SlotKey, attached: "hand" | "discard") {
  const p = me(state, seat);
  const slot = slotAt(p, key)!;
  p.hand.push(...slot.pokemon);
  const rest = attachedTo(slot);
  if (attached === "hand") p.hand.push(...rest);
  else p.discard.push(...rest);
  if (key === "active") p.active = null;
  else p.bench.splice(Number(key.split(":")[1]), 1);
  log(state, seat, `${p.name} put ${topCard(slot).name} back into their hand.`);
  // An empty Active Spot is filled from the Bench when the game settles, the same as after a Knock Out.
}
export const pickUpCard = (which: Match, attached: "hand" | "discard"): TrainerEffect => ({
  canPlay: (state, seat) => {
    const p = me(state, seat);
    if (pickUpLocked(state, seat)) return "Mentally Calm stops your Pokémon going back into your hand.";
    const ok = slotKeys(p).filter((k) => which(topCard(slotAt(p, k)!)));
    if (!ok.length) return "You have no Pokémon this card can pick up.";
    return ok.length === 1 && ok[0] === "active" && !p.bench.length ? "You'd have no Pokémon left in play." : null;
  },
  play(state, seat, card) {
    const p = me(state, seat);
    ask(state, {
      seat,
      title: "Choose a Pokémon to put back into your hand",
      zone: "myPokemon",
      options: slotKeys(p).filter((k) => which(topCard(slotAt(p, k)!)) && (k !== "active" || p.bench.length > 0)),
      min: 1,
      max: 1,
      effect: card.name,
    });
  },
  resume: (state, seat, picks) => pickUp(state, seat, picks[0] as SlotKey, attached),
});

/** Attach a Basic Energy from your discard pile to one of your (Benched) Pokémon. */
export const attachFromDiscard = (energy: Match, target: Match, benchOnly: boolean): TrainerEffect => ({
  canPlay: (state, seat) => {
    const p = me(state, seat);
    if (!p.discard.some(energy)) return "There's no matching Energy in your discard pile.";
    const keys = (benchOnly ? benchSlots(p) : slotKeys(p)) as SlotKey[];
    return keys.some((k) => target(topCard(slotAt(p, k)!))) ? null : "You have no Pokémon this can attach to.";
  },
  play(state, seat, card) {
    const p = me(state, seat);
    ask(state, {
      seat,
      title: "Choose an Energy card from your discard pile",
      zone: "discard",
      options: p.discard.filter(energy).map((c) => c.uid),
      min: 1,
      max: 1,
      effect: card.name,
      data: { step: "energy", card: card.name },
    });
  },
  resume(state, seat, picks, data) {
    const p = me(state, seat);
    if (data.step === "energy") {
      const keys = ((benchOnly ? benchSlots(p) : slotKeys(p)) as SlotKey[]).filter((k) => target(topCard(slotAt(p, k)!)));
      ask(state, {
        seat,
        title: "Choose a Pokémon to attach it to",
        zone: "myPokemon",
        options: keys,
        min: 1,
        max: 1,
        effect: String(data.card),
        data: { step: "target", energy: picks[0] },
      });
      return;
    }
    const slot = slotAt(p, picks[0] as SlotKey)!;
    const [e] = pull(p.discard, [String(data.energy)]);
    if (e) slot.energy.push(e);
    log(state, seat, `${p.name} attached ${e?.name ?? "an Energy"} from their discard pile to ${topCard(slot).name}.`);
  },
});

export const prizesLeft = (state: PState, seat: Seat) => them(state, seat).prizes.length;
export const wentSecondFirstTurn = (state: PState, seat: Seat) => state.turn === 2 && state.first !== seat;

// Built on first use: this module and engine.ts import each other, so nothing from the engine
// may be touched while the modules are still loading.
let built: Record<string, TrainerEffect> | null = null;
export const moreTrainers = () => (built ??= build());

const build = (): Record<string, TrainerEffect> => ({
  // ----- Supporters: draw -----
  Barry: drawCards(3),
  Cheren: drawCards(3),
  Nemona: drawCards(3),
  "Friends in Hisui": drawCards(3),
  "Friends in Paldea": drawCards(3),
  "Friends in Sinnoh": drawCards(3),
  "Billy & O'Nare": drawCards((state, seat) => (me(state, seat).hand.length + 2 >= 10 ? 4 : 2)),
  "Emcee's Hype": drawCards((state, seat) => (prizesLeft(state, seat) <= 3 ? 4 : 2)),
  Falkner: drawCards((state, seat) => (state.stadium?.owner === seat ? 4 : 2)),
  Norman: drawCards((state, seat) => (them(state, seat).active && topCard(them(state, seat).active!).subtypes.includes("ex") ? 4 : 2)),
  Picnicker: {
    play(state, seat) {
      const heads = flip();
      log(state, seat, `Coin flip for Picnicker: ${heads ? "heads" : "tails"}.`, "coin");
      drawCards(heads ? 4 : 2).play(state, seat, {} as PCard);
    },
  },
  Worker: {
    play(state, seat) {
      drawCards(3).play(state, seat, {} as PCard);
      if (state.stadium) {
        state.players[state.stadium.owner].discard.push(state.stadium.card);
        log(state, seat, `${state.stadium.card.name} was discarded.`);
        state.stadium = null;
      }
    },
  },
  "Cynthia's Ambition": drawUntil(() => 5),
  "Team Rocket's Ariana": drawUntil(() => 5),
  Grusha: drawUntil((state, seat) => (slots(me(state, seat)).some((s) => s.energy.length) ? 5 : 7)),
  Zisu: drawUntil((state, seat) => them(state, seat).hand.length + 1),
  Youngster: shuffleDraw(() => 5),
  "Lillie's Determination": shuffleDraw((state, seat) => (me(state, seat).prizes.length === 6 ? 8 : 6)),
  Lacey: shuffleDraw((state, seat) => (prizesLeft(state, seat) <= 3 ? 8 : 4)),
  "Parasol Lady": shuffleDraw((state, seat) => (wentSecondFirstTurn(state, seat) ? 8 : 4)),
  Brassius: shuffleDraw((state, seat) => me(state, seat).hand.length + 1),
  Katy: {
    play(state, seat) {
      shuffleDraw(() => 8).play(state, seat, {} as PCard);
      log(state, seat, "Katy ends the turn.");
      state.pendingEnd = true;
      settle(state);
    },
  },
  Drasna: {
    play(state, seat) {
      const heads = flip();
      log(state, seat, `Coin flip for Drasna: ${heads ? "heads" : "tails"}.`, "coin");
      shuffleDraw(() => (heads ? 8 : 3)).play(state, seat, {} as PCard);
    },
  },
  Harlequin: {
    play(state, seat) {
      const heads = flip();
      log(state, seat, `Coin flip for Harlequin: ${heads ? "heads" : "tails"}.`, "coin");
      bothShuffleDraw(state, seat, heads ? 5 : 3, heads ? 3 : 5);
    },
  },
  Roxanne: {
    canPlay: (state, seat) => (prizesLeft(state, seat) <= 3 ? null : "You can use this only if your opponent has 3 or fewer Prize cards left."),
    play: (state, seat) => bothShuffleDraw(state, seat, 6, 2),
  },
  Carmine: {
    play(state, seat) {
      const p = me(state, seat);
      p.discard.push(...p.hand.splice(0));
      draw(p, 5);
      log(state, seat, `${p.name} discarded their hand and drew 5 cards.`);
    },
  },
  "Iris's Fighting Spirit": {
    canPlay: needsOtherCards(1),
    play: (state, seat, card) => discardCost(state, seat, card, 1),
    resume(state, seat, picks) {
      payDiscard(state, seat, picks);
      drawUntil(() => 6).play(state, seat, {} as PCard);
    },
  },
  Roark: {
    play(state, seat, card) {
      drawCards(2).play(state, seat, card);
      const p = me(state, seat);
      const options = p.discard.filter(isBasicEnergy).map((c) => c.uid);
      if (options.length)
        ask(state, {
          seat,
          title: "Choose a Basic Energy from your discard pile to put into your hand",
          zone: "discard",
          options,
          min: 1,
          max: 1,
          effect: card.name,
        });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const back = pull(p.discard, picks);
      p.hand.push(...back);
      log(state, seat, `${p.name} put ${names(back)} into their hand.`);
    },
  },

  // ----- Supporters and Items: search -----
  "Master Ball": searchToHand("Choose a Pokémon to put into your hand", isPokemon, 1),
  "Hyper Aroma": searchToHand("Choose up to 3 Stage 1 Pokémon", isStageN(1), 3),
  Jacq: searchToHand("Choose up to 2 Evolution Pokémon", isEvolution, 2),
  Arezu: searchToHand("Choose up to 3 Evolution Pokémon without a Rule Box", (c) => isEvolution(c) && !hasRuleBox(c), 3),
  Cyrano: searchToHand("Choose up to 3 Pokémon ex", (c) => isPokemon(c) && c.subtypes.includes("ex"), 3),
  Lance: searchToHand("Choose up to 3 Dragon Pokémon", ofTypeP("Dragon"), 3),
  Clavell: searchToHand("Choose up to 3 Basic Pokémon with 120 HP or less", (c) => isBasicPokemon(c) && (c.hp ?? 0) <= 120, 3),
  Lady: searchToHand("Choose up to 4 Basic Energy cards", isBasicEnergy, 4),
  Firebreather: searchToHand("Choose up to 7 Basic Fire Energy cards", basicEnergyOf("Fire"), 7),
  "Team Rocket's Petrel": searchToHand("Choose a Trainer card", (c) => c.supertype === "Trainer", 1),
  "Tera Orb": searchToHand("Choose a Tera Pokémon", (c) => isPokemon(c) && c.subtypes.includes("Tera"), 1),
  "Feather Ball": searchToHand("Choose a Pokémon with no Retreat Cost", (c) => isPokemon(c) && c.retreat === 0, 1),
  "Treasure Tracker": searchToHand("Choose up to 5 Pokémon Tool cards", isTool, 5),
  "Mega Signal": searchToHand("Choose a Mega Evolution Pokémon ex", (c) => isPokemon(c) && c.subtypes.includes("MEGA"), 1),
  "Fighting Gong": searchToHand(
    "Choose a Basic Fighting Energy or a Basic Fighting Pokémon",
    either(basicEnergyOf("Fighting"), (c) => isBasicPokemon(c) && c.types.includes("Fighting")),
    1,
  ),
  "Brock's Scouting": searchToHand("Choose up to 2 Basic Pokémon, or 1 Evolution Pokémon", isPokemon, 2, (cards) => {
    const evo = cards.find(isEvolution);
    return evo ? [evo] : cards.filter(isBasicPokemon).slice(0, 2);
  }),
  Dawn: searchToHand("Choose a Basic, a Stage 1 and a Stage 2 Pokémon", either(isBasicPokemon, isStageN(1), isStageN(2)), 3, (cards) => [
    ...cards.filter(isBasicPokemon).slice(0, 1),
    ...cards.filter(isStageN(1)).slice(0, 1),
    ...cards.filter(isStageN(2)).slice(0, 1),
  ]),
  Hilda: searchToHand("Choose an Evolution Pokémon and an Energy card", either(isEvolution, isEnergy), 2, (cards) => [
    ...cards.filter(isEvolution).slice(0, 1),
    ...cards.filter(isEnergy).slice(0, 1),
  ]),
  "Colress's Tenacity": searchToHand("Choose a Stadium card and an Energy card", either(isStadium, isEnergy), 2, (cards) => [
    ...cards.filter(isStadium).slice(0, 1),
    ...cards.filter(isEnergy).slice(0, 1),
  ]),
  Irida: searchToHand("Choose a Water Pokémon and an Item card", either(ofTypeP("Water"), isItem), 2, (cards) => [
    ...cards.filter(ofTypeP("Water")).slice(0, 1),
    ...cards.filter(isItem).slice(0, 1),
  ]),
  "Energy Search Pro": searchToHand("Choose Basic Energy cards of different types", isBasicEnergy, 10, (cards) => {
    const seen = new Set<string>();
    return cards.filter((c) => {
      const t = energyProvides(c)[0];
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
  }),
  Cassiopeia: {
    ...searchToHand("Choose up to 2 cards", () => true, 2),
    canPlay: (state, seat) => (me(state, seat).hand.length === 1 ? null : "You can use this only when it's the last card in your hand."),
  },
  "Precious Trolley": {
    canPlay: (state, seat) => (me(state, seat).bench.length >= benchLimit(state, seat) ? "Your Bench is full." : null),
    play: (state, seat, card) =>
      searchDeck(
        state,
        seat,
        card,
        "Choose any number of Basic Pokémon to put onto your Bench",
        isBasicPokemon,
        benchLimit(state, seat) - me(state, seat).bench.length,
      ),
    resume: (state, seat, picks) => toBench(state, seat, { name: "Precious Trolley" } as PCard, picks),
  },
  "Furisode Girl": {
    canPlay: (state, seat) => (me(state, seat).bench.length >= benchLimit(state, seat) ? "Your Bench is full." : null),
    play: (state, seat, card) => searchDeck(state, seat, card, "Choose a Basic Pokémon to put onto your Bench", isBasicPokemon, 1),
    resume: (state, seat, picks) => toBench(state, seat, { name: "Furisode Girl" } as PCard, picks),
  },

  // ----- Looking at the top of the deck -----
  "Explorer's Guidance": topCards(6, 2, "discard", undefined, true),
  Rika: topCards(4, 2, "bottom", undefined, true),
  "Bill's Transfer": topCards(8, 8, "shuffle", isPokemon),
  "Tool Box": topCards(7, 7, "shuffle", isTool),
  "Roto-Stick": topCards(4, 4, "shuffle", isSupporter),
  "Energy Loto": topCards(7, 1, "shuffle", isEnergy),
  "Hole-Digging Shovel": {
    play(state, seat) {
      const p = me(state, seat);
      const gone = p.deck.splice(0, 2);
      p.discard.push(...gone);
      log(state, seat, `${p.name} discarded ${names(gone)} from the top of their deck.`);
    },
  },

  // ----- The discard pile -----
  "Max Rod": recover("Choose up to 5 Pokémon and Basic Energy cards", either(isPokemon, isBasicEnergy), 5, "hand"),
  "Miracle Headset": recover("Choose up to 2 Supporter cards", isSupporter, 2, "hand"),
  "Lana's Aid": recover(
    "Choose up to 3 Pokémon without a Rule Box and Basic Energy cards",
    either((c) => isPokemon(c) && !hasRuleBox(c), isBasicEnergy),
    3,
    "hand",
  ),
  Tulip: recover("Choose up to 4 Psychic Pokémon and Basic Psychic Energy cards", either(ofTypeP("Psychic"), basicEnergyOf("Psychic")), 4, "hand"),
  "Energy Recycler": recover("Choose up to 5 Basic Energy cards to shuffle into your deck", isBasicEnergy, 5, "deck"),
  "Sacred Ash": recover("Choose up to 5 Pokémon to shuffle into your deck", isPokemon, 5, "deck"),
  "Pal Pad": recover("Choose up to 2 Supporter cards to shuffle into your deck", isSupporter, 2, "deck"),
  Miriam: recover("Choose up to 5 Pokémon to shuffle into your deck", isPokemon, 5, "deck", (state, seat, count) => {
    if (count) drawCards(3).play(state, seat, {} as PCard);
  }),
  "Marnie's Pride": attachFromDiscard(isBasicEnergy, () => true, true),
  "Dark Patch": attachFromDiscard(basicEnergyOf("Darkness"), ofTypeP("Darkness"), true),
  "Wondrous Patch": attachFromDiscard(basicEnergyOf("Psychic"), ofTypeP("Psychic"), true),

  // ----- Healing -----
  Cook: healActive(70),
  "Arven's Sandwich": {
    canPlay: (state, seat) => (me(state, seat).active?.damage ? null : "Your Active Pokémon has no damage."),
    play(state, seat) {
      const a = me(state, seat).active!;
      const healed = heal(a, topCard(a).name.startsWith("Arven's ") ? 100 : 30);
      log(state, seat, `${topCard(a).name} was healed ${healed} damage.`);
    },
  },
  "Jumbo Ice Cream": healActive(80, (s) => s.energy.length >= 3),
  "Dragon Elixir": healActive(60, (s) => topCard(s).types.includes("Dragon")),
  Fennel: healEach(40),
  "Fresh Water Set": healEach(20),
  "Picnic Basket": healEach(30, undefined, true),
  "Clemont's Quick Wit": healEach(60, (c) => c.types.includes("Lightning")),
  "Poké Vital A": healOne(150),
  "Pokémon Center Lady": healOne(60, undefined, (_state, _seat, slot) => (slot.conditions = [])),
  "Super Potion": healOne(60, undefined, (state, seat, slot) => {
    const e = slot.energy.pop();
    if (e) {
      me(state, seat).discard.push(e);
      log(state, seat, `${e.name} was discarded from ${topCard(slot).name}.`);
    }
  }),
  "Bianca's Devotion": {
    canPlay: (state, seat) =>
      slots(me(state, seat)).some((s) => s.damage && (topCard(s).hp ?? 0) - s.damage <= 30) ? null : "None of your Pokémon have 30 HP or less left.",
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose a Pokémon with 30 HP or less left to heal completely",
        zone: "myPokemon",
        options: slotKeys(p).filter((k) => {
          const s = slotAt(p, k)!;
          return s.damage && (topCard(s).hp ?? 0) - s.damage <= 30;
        }),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const slot = slotAt(me(state, seat), picks[0] as SlotKey)!;
      slot.damage = 0;
      log(state, seat, `${topCard(slot).name} was healed completely.`);
    },
  },

  // ----- Switching -----
  "AZ's Tranquility": {
    canPlay: needBench,
    play: (state, seat, card) => askSwitch(state, seat, card.name),
    resume(state, seat, picks) {
      const out = doSwitch(state, seat, picks);
      if (out && topCard(out).subtypes.includes("ex")) {
        heal(out, 80);
        log(state, seat, `${topCard(out).name} was healed 80 damage.`);
      }
    },
  },
  Surfer: {
    canPlay: needBench,
    play: (state, seat, card) => askSwitch(state, seat, card.name),
    resume(state, seat, picks) {
      doSwitch(state, seat, picks);
      drawUntil(() => 5).play(state, seat, {} as PCard);
    },
  },
  "Prime Catcher": {
    canPlay: oppHasBench,
    play: gust,
    resume(state, seat, picks) {
      resumeGust(state, seat, picks);
      if (me(state, seat).bench.length) askSwitch(state, seat, "Switch");
    },
  },
  "Lisia's Appeal": {
    canPlay: (state, seat) => (them(state, seat).bench.some((s) => isBasicPokemon(topCard(s))) ? null : "Your opponent has no Benched Basic Pokémon."),
    play(state, seat, card) {
      const opp = them(state, seat);
      ask(state, {
        seat,
        title: `Choose 1 of ${opp.name}'s Benched Basic Pokémon to switch in`,
        zone: "oppBench",
        options: benchSlots(opp).filter((k) => isBasicPokemon(topCard(slotAt(opp, k as SlotKey)!))),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      resumeGust(state, seat, picks);
      const a = them(state, seat).active;
      if (a) setCondition(state, a, "confused");
    },
  },

  // ----- Picking Pokémon back up -----
  Penny: pickUpCard(isBasicPokemon, "hand"),
  "Scoop Up Cyclone": pickUpCard(() => true, "hand"),
  "Professor Turo's Scenario": pickUpCard(() => true, "discard"),

  // ----- Energy -----
  "Energy Switch": {
    canPlay: (state, seat) => {
      const s = slots(me(state, seat));
      return s.length > 1 && s.some((x) => x.energy.some(isBasicEnergy)) ? null : "You need a Pokémon with Basic Energy and another Pokémon to move it to.";
    },
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose the Pokémon to move a Basic Energy from",
        zone: "myPokemon",
        options: slotKeys(p).filter((k) => slotAt(p, k)!.energy.some(isBasicEnergy)),
        min: 1,
        max: 1,
        effect: card.name,
        data: { step: "from" },
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (data.step === "from") {
        ask(state, {
          seat,
          title: "Choose the Pokémon to move it to",
          zone: "myPokemon",
          options: slotKeys(p).filter((k) => k !== picks[0]),
          min: 1,
          max: 1,
          effect: "Energy Switch",
          data: { step: "to", from: picks[0] },
        });
        return;
      }
      const from = slotAt(p, data.from as SlotKey)!;
      const to = slotAt(p, picks[0] as SlotKey)!;
      const i = from.energy.findIndex(isBasicEnergy);
      const [e] = from.energy.splice(i, 1);
      to.energy.push(e);
      log(state, seat, `${p.name} moved ${e.name} from ${topCard(from).name} to ${topCard(to).name}.`);
    },
  },
  "Crushing Hammer": {
    canPlay: (state, seat) => (slots(them(state, seat)).some((s) => s.energy.length) ? null : "Your opponent's Pokémon have no Energy attached."),
    play(state, seat, card) {
      const heads = flip();
      log(state, seat, `Coin flip for Crushing Hammer: ${heads ? "heads" : "tails"}.`, "coin");
      if (!heads) return;
      const opp = them(state, seat);
      ask(state, {
        seat,
        title: `Choose 1 of ${opp.name}'s Pokémon to discard an Energy from`,
        zone: "oppPokemon",
        options: slotKeys(opp).filter((k) => slotAt(opp, k)!.energy.length),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const opp = them(state, seat);
      const slot = slotAt(opp, picks[0] as SlotKey)!;
      const e = slot.energy.pop();
      if (e) {
        opp.discard.push(e);
        log(state, seat, `${e.name} was discarded from ${topCard(slot).name}.`);
      }
    },
  },

  // ----- Special Conditions -----
  "Dangerous Laser": {
    canPlay: (state, seat) => (them(state, seat).active ? null : "Your opponent has no Active Pokémon."),
    play(state, seat) {
      const a = them(state, seat).active!;
      for (const c of ["burned", "confused"] as const) setCondition(state, a, c);
      log(state, seat, `${topCard(a).name} is now Burned and Confused.`);
    },
  },
});

/** Supporters that the player who goes first may still play on their first turn. */
export const FIRST_TURN_SUPPORTERS = ["Carmine"];
