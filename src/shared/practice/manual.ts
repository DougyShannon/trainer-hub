// "By hand" moves for card text the practice engine doesn't automate: a Stadium, an Ability, a rare
// Trainer. On a real table you'd just do what the card says, so these let you do exactly that:
// draw, search your deck, take cards back from the discard pile, heal, move Energy and so on.
// Every move is written in the game log so both players can see what happened.

import { otherSeat, type Condition, type Seat } from "../game-types";
import { ask, draw, fail, flip, isBasicPokemon, isEnergy, log, newSlot, plural, shuffle, slotAt, slotKeys, switchActive, topCard, BENCH_SIZE } from "./engine";
import type { PCard, PState, SlotKey } from "./types";

export type ManualOp =
  | "draw"
  | "search"
  | "searchBench"
  | "fromDiscard"
  | "discardHand"
  | "handToDeck"
  | "shuffleDeck"
  | "switchMine"
  | "switchTheirs"
  | "heal"
  | "damage"
  | "energyFromDiscard"
  | "energyFromDeck"
  | "moveEnergy"
  | "discardEnergy"
  | "condition"
  | "discardStadium"
  | "flip";

type Data = Record<string, unknown>;

/** What each by-hand move is called, in the order the panel lists them. */
export const MANUAL_OPS: { op: ManualOp; label: string; amount?: "count" | "damage"; group: string }[] = [
  { op: "draw", label: "Draw cards", amount: "count", group: "Cards" },
  { op: "search", label: "Search your deck for cards", group: "Cards" },
  { op: "fromDiscard", label: "Put cards from your discard pile into your hand", group: "Cards" },
  { op: "discardHand", label: "Discard cards from your hand", group: "Cards" },
  { op: "handToDeck", label: "Shuffle your hand into your deck", group: "Cards" },
  { op: "shuffleDeck", label: "Shuffle your deck", group: "Cards" },
  { op: "searchBench", label: "Put a Basic Pokémon from your deck onto your Bench", group: "Pokémon" },
  { op: "switchMine", label: "Switch your Active Pokémon", group: "Pokémon" },
  { op: "switchTheirs", label: "Switch your opponent's Active Pokémon", group: "Pokémon" },
  { op: "heal", label: "Heal one of your Pokémon", amount: "damage", group: "Pokémon" },
  { op: "damage", label: "Put damage on one of your opponent's Pokémon", amount: "damage", group: "Pokémon" },
  { op: "condition", label: "Give your opponent's Active Pokémon a Special Condition", group: "Pokémon" },
  { op: "energyFromDiscard", label: "Attach an Energy from your discard pile", group: "Energy" },
  { op: "energyFromDeck", label: "Attach an Energy from your deck", group: "Energy" },
  { op: "moveEnergy", label: "Move an Energy between your Pokémon", group: "Energy" },
  { op: "discardEnergy", label: "Discard an Energy from your opponent's Pokémon", group: "Energy" },
  { op: "discardStadium", label: "Discard the Stadium in play", group: "Other" },
  { op: "flip", label: "Flip a coin", group: "Other" },
];

const CONDITIONS: Condition[] = ["asleep", "burned", "confused", "paralyzed", "poisoned"];

const all = (cards: PCard[]) => cards.map((c) => c.uid);
const pull = (from: PCard[], uids: string[]) =>
  uids
    .map(
      (u) =>
        from.splice(
          from.findIndex((c) => c.uid === u),
          1,
        )[0],
    )
    .filter(Boolean);
const names = (cards: PCard[]) => (cards.length ? cards.map((c) => c.name).join(", ") : "nothing");
const say = (state: PState, seat: Seat, text: string) => log(state, seat, `By hand: ${text}`);

/** Why a by-hand move can't be done right now, or null if it can. */
export function manualBlocked(state: PState, seat: Seat, op: ManualOp): string | null {
  const p = state.players[seat];
  const opp = state.players[otherSeat(seat)];
  const any = (list: SlotKey[], test: (k: SlotKey) => boolean) => list.some(test);
  switch (op) {
    case "draw":
    case "search":
    case "shuffleDeck":
      return p.deck.length ? null : "Your deck is empty.";
    case "searchBench":
      if (p.bench.length >= BENCH_SIZE) return "Your Bench is full.";
      return p.deck.some(isBasicPokemon) ? null : "There are no Basic Pokémon left in your deck.";
    case "fromDiscard":
      return p.discard.length ? null : "Your discard pile is empty.";
    case "discardHand":
    case "handToDeck":
      return p.hand.length ? null : "Your hand is empty.";
    case "switchMine":
      return p.bench.length ? null : "You have no Benched Pokémon.";
    case "switchTheirs":
      return opp.bench.length ? null : "Your opponent has no Benched Pokémon.";
    case "heal":
      return any(slotKeys(p), (k) => slotAt(p, k)!.damage > 0) ? null : "None of your Pokémon have damage.";
    case "damage":
      return slotKeys(opp).length ? null : "Your opponent has no Pokémon in play.";
    case "condition":
      return opp.active ? null : "Your opponent has no Active Pokémon.";
    case "energyFromDiscard":
      return p.discard.some(isEnergy) ? null : "There's no Energy in your discard pile.";
    case "energyFromDeck":
      return p.deck.some(isEnergy) ? null : "There's no Energy left in your deck.";
    case "moveEnergy":
      return slotKeys(p).length > 1 && any(slotKeys(p), (k) => slotAt(p, k)!.energy.length > 0)
        ? null
        : "You need a Pokémon with Energy and another Pokémon to move it to.";
    case "discardEnergy":
      return any(slotKeys(opp), (k) => slotAt(opp, k)!.energy.length > 0) ? null : "Your opponent's Pokémon have no Energy attached.";
    case "discardStadium":
      return state.stadium ? null : "There's no Stadium in play.";
    case "flip":
      return null;
  }
}

export function applyManual(state: PState, seat: Seat, op: ManualOp, amount = 0) {
  const reason = manualBlocked(state, seat, op);
  if (reason) fail(reason);
  const p = state.players[seat];
  const opp = state.players[otherSeat(seat)];
  const choose = (
    title: string,
    zone: Parameters<typeof ask>[1]["zone"],
    options: string[],
    max: number,
    data: Data = {},
    extra: { min?: number; shown?: string[] } = {},
  ) => ask(state, { seat, title, zone, options, shown: extra.shown, min: extra.min ?? 1, max, effect: `manual:${op}`, data: { amount, ...data } });

  switch (op) {
    case "draw": {
      const n = Math.max(1, Math.min(amount || 1, 20));
      const before = p.hand.length;
      draw(p, n);
      return say(state, seat, `${p.name} drew ${plural(p.hand.length - before, "card")}.`);
    }
    case "search":
      return choose("Search your deck: choose the cards the card lets you take", "deck", all(p.deck), p.deck.length, {}, { min: 0, shown: all(p.deck) });
    case "searchBench":
      return choose(
        "Choose Basic Pokémon to put onto your Bench",
        "deck",
        all(p.deck.filter(isBasicPokemon)),
        BENCH_SIZE - p.bench.length,
        {},
        { min: 0, shown: all(p.deck) },
      );
    case "fromDiscard":
      return choose("Choose cards to put from your discard pile into your hand", "discard", all(p.discard), p.discard.length);
    case "discardHand":
      return choose("Choose cards to discard from your hand", "hand", all(p.hand), p.hand.length);
    case "handToDeck": {
      const n = p.hand.length;
      p.deck.push(...p.hand.splice(0));
      shuffle(p.deck);
      return say(state, seat, `${p.name} shuffled their hand (${plural(n, "card")}) into their deck.`);
    }
    case "shuffleDeck":
      shuffle(p.deck);
      return say(state, seat, `${p.name} shuffled their deck.`);
    case "switchMine":
      return choose(
        "Choose a Benched Pokémon to switch into your Active Spot",
        "myBench",
        p.bench.map((_, i) => `bench:${i}`),
        1,
      );
    case "switchTheirs":
      return choose(
        `Choose 1 of ${opp.name}'s Benched Pokémon to switch into the Active Spot`,
        "oppBench",
        opp.bench.map((_, i) => `bench:${i}`),
        1,
      );
    case "heal":
      return choose(
        `Choose a Pokémon to heal ${amount || 10} damage from`,
        "myPokemon",
        slotKeys(p).filter((k) => slotAt(p, k)!.damage > 0),
        1,
      );
    case "damage":
      return choose(`Choose 1 of ${opp.name}'s Pokémon to put ${amount || 10} damage on`, "oppPokemon", slotKeys(opp), 1);
    case "condition":
      // The condition is picked in the panel and passed as the amount's index.
      return applyCondition(state, seat, CONDITIONS[amount] ?? "confused");
    case "energyFromDiscard":
      return choose("Choose an Energy card from your discard pile", "discard", all(p.discard.filter(isEnergy)), 1, { step: "energy" });
    case "energyFromDeck":
      return choose("Choose an Energy card from your deck", "deck", all(p.deck.filter(isEnergy)), 1, { step: "energy" }, { shown: all(p.deck) });
    case "moveEnergy":
      return choose(
        "Choose the Pokémon to move an Energy from",
        "myPokemon",
        slotKeys(p).filter((k) => slotAt(p, k)!.energy.length),
        1,
        { step: "from" },
      );
    case "discardEnergy":
      return choose(
        `Choose 1 of ${opp.name}'s Pokémon to discard an Energy from`,
        "oppPokemon",
        slotKeys(opp).filter((k) => slotAt(opp, k)!.energy.length),
        1,
      );
    case "discardStadium": {
      const s = state.stadium!;
      state.players[s.owner].discard.push(s.card);
      state.stadium = null;
      return say(state, seat, `${p.name} discarded the Stadium ${s.card.name}.`);
    }
    case "flip": {
      const heads = flip();
      return log(state, seat, `By hand: ${p.name} flipped a coin: ${heads ? "heads" : "tails"}.`, "coin");
    }
  }
}

function applyCondition(state: PState, seat: Seat, condition: Condition) {
  const a = state.players[otherSeat(seat)].active!;
  // Asleep, Confused and Paralyzed replace each other; Burned and Poisoned stack with anything.
  const rotating: Condition[] = ["asleep", "confused", "paralyzed"];
  if (rotating.includes(condition)) a.conditions = a.conditions.filter((c) => !rotating.includes(c));
  if (!a.conditions.includes(condition)) a.conditions.push(condition);
  say(state, seat, `${topCard(a).name} is now ${condition[0].toUpperCase()}${condition.slice(1)}.`);
}

export const MANUAL_CONDITIONS = CONDITIONS;

/** Finishes a by-hand move once its choice is made. */
export const MANUAL_RESUME: Record<string, (state: PState, seat: Seat, picks: string[], data: Data) => void> = {
  "manual:search"(state, seat, picks) {
    const p = state.players[seat];
    const found = pull(p.deck, picks);
    p.hand.push(...found);
    shuffle(p.deck);
    say(state, seat, `${p.name} searched their deck and took ${names(found)}, then shuffled it.`);
  },
  "manual:searchBench"(state, seat, picks) {
    const p = state.players[seat];
    const found = pull(p.deck, picks);
    for (const c of found) p.bench.push(newSlot(c, state.turn));
    shuffle(p.deck);
    say(state, seat, `${p.name} put ${names(found)} onto their Bench from their deck.`);
  },
  "manual:fromDiscard"(state, seat, picks) {
    const p = state.players[seat];
    const back = pull(p.discard, picks);
    p.hand.push(...back);
    say(state, seat, `${p.name} put ${names(back)} from their discard pile into their hand.`);
  },
  "manual:discardHand"(state, seat, picks) {
    const p = state.players[seat];
    const gone = pull(p.hand, picks);
    p.discard.push(...gone);
    say(state, seat, `${p.name} discarded ${names(gone)} from their hand.`);
  },
  "manual:switchMine"(state, seat, picks) {
    const p = state.players[seat];
    const i = Number(picks[0].split(":")[1]);
    const name = topCard(p.bench[i]).name;
    switchActive(p, i);
    say(state, seat, `${p.name} switched ${name} into their Active Spot.`);
  },
  "manual:switchTheirs"(state, seat, picks) {
    const opp = state.players[otherSeat(seat)];
    const i = Number(picks[0].split(":")[1]);
    const name = topCard(opp.bench[i]).name;
    switchActive(opp, i);
    say(state, seat, `${name} was switched into ${opp.name}'s Active Spot.`);
  },
  "manual:heal"(state, seat, picks, data) {
    const slot = slotAt(state.players[seat], picks[0] as SlotKey)!;
    const before = slot.damage;
    slot.damage = Math.max(0, slot.damage - (Number(data.amount) || 10));
    say(state, seat, `${topCard(slot).name} was healed ${before - slot.damage} damage.`);
  },
  "manual:damage"(state, seat, picks, data) {
    const slot = slotAt(state.players[otherSeat(seat)], picks[0] as SlotKey)!;
    const amount = Number(data.amount) || 10;
    slot.damage += amount;
    say(state, seat, `${amount} damage was put on ${topCard(slot).name}.`);
  },
  "manual:energyFromDiscard": attachEnergyFrom("discard"),
  "manual:energyFromDeck": attachEnergyFrom("deck"),
  "manual:moveEnergy"(state, seat, picks, data) {
    const p = state.players[seat];
    if (data.step === "from") {
      // The Energy attached most recently is the one that moves.
      ask(state, {
        seat,
        title: "Choose the Pokémon to move it to",
        zone: "myPokemon",
        options: slotKeys(p).filter((k) => k !== picks[0]),
        min: 1,
        max: 1,
        effect: "manual:moveEnergy",
        data: { step: "to", from: picks[0] },
      });
      return;
    }
    const from = slotAt(p, data.from as SlotKey)!;
    const to = slotAt(p, picks[0] as SlotKey)!;
    const e = from.energy.pop()!;
    to.energy.push(e);
    say(state, seat, `${p.name} moved ${e.name} from ${topCard(from).name} to ${topCard(to).name}.`);
  },
  "manual:discardEnergy"(state, seat, picks) {
    const opp = state.players[otherSeat(seat)];
    const slot = slotAt(opp, picks[0] as SlotKey)!;
    const e = slot.energy.pop()!;
    opp.discard.push(e);
    say(state, seat, `${e.name} was discarded from ${topCard(slot).name}.`);
  },
};

function attachEnergyFrom(where: "deck" | "discard") {
  return (state: PState, seat: Seat, picks: string[], data: Data) => {
    const p = state.players[seat];
    if (data.step === "energy") {
      ask(state, {
        seat,
        title: "Choose a Pokémon to attach it to",
        zone: "myPokemon",
        options: slotKeys(p),
        min: 1,
        max: 1,
        effect: `manual:energyFrom${where === "deck" ? "Deck" : "Discard"}`,
        data: { step: "target", energy: picks[0] },
      });
      return;
    }
    const pile = where === "deck" ? p.deck : p.discard;
    const [e] = pull(pile, [String(data.energy)]);
    const slot = slotAt(p, picks[0] as SlotKey)!;
    if (e) slot.energy.push(e);
    if (where === "deck") shuffle(p.deck);
    say(state, seat, `${p.name} attached ${e?.name ?? "an Energy"} from their ${where === "deck" ? "deck" : "discard pile"} to ${topCard(slot).name}.`);
  };
}
