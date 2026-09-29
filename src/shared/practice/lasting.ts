// Attack effects that last into a later turn, like "During your opponent's next turn, the Defending
// Pokémon's attacks do 30 less damage". An attack puts a mark on a Pokémon (it goes away when that
// Pokémon moves to the Bench or evolves, like other attack effects) or a lock on a player. The rules
// in effects.ts and engine.ts read them. Plain data, so saved games keep them.

import { otherSeat, type Seat } from "../game-types";
import type { PCard, PPlayer, PSlot, PState } from "./types";

export type MarkKind =
  /** This Pokémon's attacks do `amount` less damage (before Weakness and Resistance). */
  | "dmgDown"
  /** This Pokémon's attacks do `amount` more damage (before Weakness and Resistance). */
  | "dmgUp"
  /** This Pokémon takes `amount` more damage from attacks (after Weakness and Resistance). */
  | "takesMore"
  /** This Pokémon takes `amount` less damage from attacks from Pokémon matching `data` (see matchesFilter). */
  | "takesLess"
  /** Prevent all damage done to this Pokémon by attacks from Pokémon matching `data`. `amount` set: only damage of that much or less. */
  | "prevent"
  /** When this Pokémon is damaged by an attack, put `amount` damage counters on the Attacking Pokémon (no amount: as many as the damage). */
  | "counter"
  /** This Pokémon has no Weakness. */
  | "noWeakness"
  /** This Pokémon's Weakness is now `data` (×2). */
  | "weakness"
  /** When this Pokémon tries to attack, its owner flips `amount` coins; if any is tails, the attack doesn't happen. */
  | "attackCoin"
  /** This Pokémon's attacks cost `amount` more Colorless Energy. */
  | "costMore"
  /** This Pokémon can't use the attack named `data` (no data: can't attack at all). */
  | "noAttack"
  /** This Pokémon can't retreat. */
  | "noRetreat"
  /** Energy can't be attached to this Pokémon from its owner's hand. */
  | "noEnergy"
  /** When Energy is attached to this Pokémon from its owner's hand: `data` "counters" (put `amount` damage counters on it), "sleep" or "endTurn". */
  | "onEnergy"
  /** Pokémon can't be played from the hand to evolve this Pokémon. */
  | "noEvolve"
  /** If this Pokémon is Knocked Out, the other player takes `amount` more Prize cards (negative for fewer; -99 for none). */
  | "prizes"
  /** If this Pokémon has full HP and would be Knocked Out by damage from an attack, its remaining HP becomes `amount` instead. */
  | "endure"
  /** Prevent all effects (not damage) of attacks used by the opponent's Pokémon done to this Pokémon. */
  | "effectsProof"
  /** While Asleep, flip 2 coins in Pokémon Checkup instead of 1; if either is tails, it stays Asleep. Lasts until it wakes up (any `turn`). */
  | "deepSleep"
  /** At the end of the turn `turn`, put `amount` damage counters on this Pokémon. */
  | "endCounters";

export type Mark = { kind: MarkKind; turn: number; amount?: number; data?: string; source?: string };

/** The turn numbers for "during your opponent's next turn" and "during your next turn". */
export const oppNextTurn = (state: PState) => state.turn + 1;
export const myNextTurn = (state: PState) => state.turn + 2;

export function mark(slot: PSlot, m: Mark) {
  const e = slot.effects as PSlot["effects"] & { marks?: Mark[] };
  (e.marks ??= []).push(m);
}
/** Marks of one kind on a Pokémon that apply right now. */
export const marksOn = (state: PState, slot: PSlot | null | undefined, kind: MarkKind): Mark[] =>
  ((slot?.effects as { marks?: Mark[] } | undefined)?.marks ?? []).filter((m) => m.kind === kind && m.turn === state.turn);
export const marked = (state: PState, slot: PSlot | null | undefined, kind: MarkKind) => marksOn(state, slot, kind).length > 0;
export const markTotal = (state: PState, slot: PSlot | null | undefined, kind: MarkKind) => marksOn(state, slot, kind).reduce((n, m) => n + (m.amount ?? 0), 0);

/**
 * Whether a Pokémon matches a filter word used by marks: "" or "all", "ability" (has an Ability),
 * "basic", "evolution", "ex", "V", "exV", "burned", "Tera", "Ancient", "Future", "basicNonColorless",
 * a type like "Fire", or "not:<name>" (any Pokémon but that one).
 */
export function matchesFilter(state: PState, slot: PSlot, filter: string | undefined): boolean {
  const c = slot.pokemon[slot.pokemon.length - 1];
  const f = filter ?? "";
  if (!f || f === "all") return true;
  if (f.includes("&")) return f.split("&").every((part) => matchesFilter(state, slot, part));
  if (f.startsWith("not:")) return !c.name.includes(f.slice(4));
  switch (f) {
    case "ability":
      return c.abilities.length > 0;
    case "basic":
      return c.subtypes.includes("Basic");
    case "evolution":
      return !c.subtypes.includes("Basic");
    case "ex":
      return c.subtypes.includes("ex") || c.subtypes.includes("EX");
    case "V":
      return c.subtypes.some((s) => s === "V" || s === "VSTAR" || s === "VMAX");
    case "exV":
      return matchesFilter(state, slot, "ex") || matchesFilter(state, slot, "V");
    case "burned":
      return slot.conditions.includes("burned");
    case "basicNonColorless":
      return c.subtypes.includes("Basic") && !c.types.includes("Colorless");
    default:
      return c.subtypes.includes(f) || c.types.includes(f);
  }
}

// ----- Player locks -----

/**
 * Something a player can't do during a turn: "Item", "Supporter", "Tool", "Stadium", "Special Energy"
 * (playing those cards from the hand), "evolve" (evolving from the hand), "attack" (none of their
 * Pokémon can attack), "lowEnergy" (Pokémon with `amount` or less Energy can't attack), "tails"
 * (every coin they flip is tails), or "card" (playing any card named in `names`).
 */
export type LockKind = "Item" | "Supporter" | "Tool" | "Stadium" | "Special Energy" | "evolve" | "attack" | "lowEnergy" | "tails" | "card";
export type Lock = { kind: LockKind; seat: Seat; turn: number; amount?: number; names?: string[]; source: string };

type WithLocks = PState & { locks?: Lock[] };
export function lock(state: PState, l: Lock) {
  const s = state as WithLocks;
  (s.locks ??= []).push(l);
  // Old locks are no use to anyone.
  s.locks = s.locks.filter((x) => x.turn >= state.turn);
}
export const locksOn = (state: PState, seat: Seat, kind: LockKind): Lock[] =>
  ((state as WithLocks).locks ?? []).filter((l) => l.seat === seat && l.kind === kind && l.turn === state.turn);
export const locked = (state: PState, seat: Seat, kind: LockKind) => locksOn(state, seat, kind).length > 0;

/** Why an attack's lock stops a player playing this card from their hand, or null. */
export function cardLocked(state: PState, seat: Seat, card: PCard): string | null {
  const is = (sub: string) => card.subtypes.includes(sub);
  const special = card.supertype === "Energy" && is("Special");
  const checks: [LockKind, boolean][] = [
    ["Item", card.supertype === "Trainer" && is("Item")],
    ["Supporter", card.supertype === "Trainer" && is("Supporter")],
    ["Tool", card.supertype === "Trainer" && (is("Pokémon Tool") || is("Tool"))],
    ["Stadium", card.supertype === "Trainer" && is("Stadium")],
    ["Special Energy", special],
  ];
  for (const [kind, hit] of checks) {
    const l = hit ? locksOn(state, seat, kind)[0] : undefined;
    if (l) return `${l.source} stops you playing ${kind === "Special Energy" ? "Special Energy" : `${kind} cards`} this turn.`;
  }
  const byName = locksOn(state, seat, "card").find((l) => l.names?.includes(card.name));
  if (byName) return `${byName.source} stops you playing ${card.name} this turn.`;
  return null;
}

// ----- What happened this turn -----

/** Things attacks ask about ("If you played Emma from your hand during this turn"). Reset each turn. */
export type TurnLog = {
  turn: number;
  /** Names of cards played from the hand (Trainers, Energy, Pokémon). */
  played: string[];
  /** uids (top card) of Pokémon a Tool was attached to from the hand. */
  tools: string[];
  /** uids (top card) of Pokémon that were healed. */
  healed: string[];
  /** uids (bottom card) of Pokémon that moved from the Bench to the Active Spot. */
  movedUp: string[];
};
type WithLog = PPlayer & { turnLog?: TurnLog };
export function turnLog(state: PState, seat: Seat): TurnLog {
  const p = state.players[seat] as WithLog;
  if (!p.turnLog || p.turnLog.turn !== state.turn) p.turnLog = { turn: state.turn, played: [], tools: [], healed: [], movedUp: [] };
  return p.turnLog;
}
export const playedThisTurn = (state: PState, seat: Seat, test: (name: string) => boolean) => turnLog(state, seat).played.some(test);
export const noteHealed = (state: PState, seat: Seat, slot: PSlot) => turnLog(state, seat).healed.push(slot.pokemon[0].uid);
export const wasHealed = (state: PState, seat: Seat, slot: PSlot) => turnLog(state, seat).healed.includes(slot.pokemon[0].uid);
export const movedUpThisTurn = (state: PState, seat: Seat, slot: PSlot) => turnLog(state, seat).movedUp.includes(slot.pokemon[0].uid);

/** The seat whose Pokémon this is. */
export function seatOf(state: PState, slot: PSlot): Seat {
  const p1 = state.players.p1;
  return p1.active === slot || p1.bench.includes(slot) ? "p1" : "p2";
}
export const opponentOf = (state: PState, slot: PSlot) => otherSeat(seatOf(state, slot));
