// Special Energy cards in practice games: what Energy they provide (some depend on the Pokémon
// they're attached to) and what they do. The hooks in effects.ts and engine.ts call these.
// Temple of Sinnoh turns them all into plain Colorless Energy (see specialEnergyOff).

import { otherSeat, type Seat } from "../game-types";
import type { PCard, PSlot, PState } from "./types";
import { draw, isBasicEnergy, log, switchActive, topCard } from "./engine";
import { baseName, hasRuleBox, inPlay, isActive, isV, specialEnergyOff } from "./effects";
import { noteHealed, seatOf } from "./lasting";

/** An Energy unit that counts as every type (it pays for any one symbol). */
export const ANY = "Any";
/** Whether an Energy unit (from energyProvides) counts as this type. Units like "Psychic|Darkness" can be either. */
export const unitIs = (unit: string, type: string) => unit === type || unit === ANY || (unit.includes("|") && unit.split("|").includes(type));

const nameOf = (c: PCard) => baseName(c.name);
const isSpecial = (c: PCard) => c.supertype === "Energy" && !isBasicEnergy(c);
const working = (state: PState | undefined) => !specialEnergyOff(state);
const isEvolution = (c: PCard) => !c.subtypes.includes("Basic");
const isTeamRockets = (c: PCard) => c.name.startsWith("Team Rocket's");
/** Special Energy cards whose text the game carries out. Any other Special Energy just provides Colorless, and its owner does the rest by hand. */
export const AUTOMATED_SPECIAL_ENERGY = [
  "Boomerang Energy",
  "Double Colorless Energy",
  "Double Turbo Energy",
  "Enriching Energy",
  "Gift Energy",
  "Ignition Energy",
  "Jet Energy",
  "Legacy Energy",
  "Luminous Energy",
  "Medical Energy",
  "Mist Energy",
  "Neo Upper Energy",
  "Prism Energy",
  "Regenerative Energy",
  "Reversal Energy",
  "Spiky Energy",
  "Team Rocket's Energy",
  "Therapeutic Energy",
  "V Guard Energy",
];

/** A working Special Energy with this name on a Pokémon. */
export const hasSpecial = (state: PState | undefined, slot: PSlot, name: string) => working(state) && slot.energy.some((e) => nameOf(e) === name);

function slotHolding(state: PState, card: PCard): PSlot | null {
  for (const s of ["p1", "p2"] as Seat[]) for (const slot of inPlay(state.players[s])) if (slot.energy.includes(card)) return slot;
  return null;
}

/** What a Special Energy card provides, or null to use the plain rule (1 Colorless). */
export function specialProvides(c: PCard, state: PState | undefined): string[] | null {
  const name = nameOf(c);
  if (name === "Double Turbo Energy" || name === "Double Colorless Energy") return ["Colorless", "Colorless"];
  if (name === "Legacy Energy") return [ANY];
  if (name === "Team Rocket's Energy") return ["Psychic|Darkness", "Psychic|Darkness"];
  const slot = state ? slotHolding(state, c) : null;
  if (!slot || !state) return null;
  const top = topCard(slot);
  switch (name) {
    case "Ignition Energy":
      return isEvolution(top) ? ["Colorless", "Colorless", "Colorless"] : null;
    case "Prism Energy":
      return top.subtypes.includes("Basic") ? [ANY] : null;
    case "Luminous Energy":
      return slot.energy.some((e) => e !== c && isSpecial(e)) ? null : [ANY];
    case "Neo Upper Energy":
      return top.subtypes.includes("Stage 2") ? [ANY, ANY] : null;
    case "Reversal Energy": {
      const seat = seatOf(state, slot);
      const ahead = state.players[seat].prizes.length > state.players[otherSeat(seat)].prizes.length;
      return ahead && isEvolution(top) && !hasRuleBox(top) ? [ANY, ANY, ANY] : null;
    }
  }
  return null;
}

/** Why a Special Energy can't be attached to this Pokémon, or null. */
export function energyAttachBlock(state: PState, card: PCard, slot: PSlot): string | null {
  if (nameOf(card) === "Team Rocket's Energy" && !isTeamRockets(topCard(slot))) return "Team Rocket's Energy can only be attached to a Team Rocket's Pokémon.";
  return null;
}

/** "When you attach this card from your hand": Jet, Medical and Enriching Energy. */
export function specialFromHand(state: PState, seat: Seat, slot: PSlot, card: PCard) {
  if (!isSpecial(card) || !working(state)) return;
  const p = state.players[seat];
  switch (nameOf(card)) {
    case "Jet Energy": {
      const i = p.bench.indexOf(slot);
      if (i >= 0 && p.active) {
        switchActive(p, i);
        log(state, seat, `Jet Energy switched ${topCard(slot).name} into the Active Spot.`);
      }
      break;
    }
    case "Medical Energy":
      if (slot.damage) {
        slot.damage = Math.max(0, slot.damage - 30);
        noteHealed(state, seat, slot);
        log(state, seat, `Medical Energy healed 30 damage from ${topCard(slot).name}.`);
      }
      break;
    case "Enriching Energy":
      draw(p, 4);
      log(state, seat, `Enriching Energy: ${p.name} drew 4 cards.`);
      break;
  }
}

/** Whenever a Pokémon V with Regenerative Energy evolves from the hand, heal 100 damage. */
export function specialOnEvolve(state: PState, seat: Seat, slot: PSlot, from: PCard) {
  if (!isV(from) || !hasSpecial(state, slot, "Regenerative Energy") || !slot.damage) return;
  const n = slot.energy.filter((e) => nameOf(e) === "Regenerative Energy").length;
  slot.damage = Math.max(0, slot.damage - 100 * n);
  noteHealed(state, seat, slot);
  log(state, seat, `Regenerative Energy healed ${topCard(slot).name}.`);
}

/** Special Energy that change damage taken (V Guard Energy). */
export function specialDamageTaken(state: PState, attacker: PSlot, defender: PSlot) {
  return hasSpecial(state, defender, "V Guard Energy") && isV(topCard(attacker)) ? 30 : 0;
}

/** Mist Energy: no effects of the opponent's attacks. */
export const specialEffectsProof = (state: PState, slot: PSlot) => hasSpecial(state, slot, "Mist Energy");

/** Therapeutic Energy: can't be Asleep, Confused or Paralyzed. */
export const specialConditionBlocked = (state: PState, slot: PSlot, condition: string) =>
  hasSpecial(state, slot, "Therapeutic Energy") && ["asleep", "confused", "paralyzed"].includes(condition);

/** After damage from an attack lands: Spiky Energy on the Active Pokémon hits back. */
export function specialAfterDamage(state: PState, attackerSeat: Seat, attacker: PSlot, defender: PSlot) {
  if (!isActive(state, defender)) return;
  const n = working(state) ? defender.energy.filter((e) => nameOf(e) === "Spiky Energy").length : 0;
  if (!n) return;
  attacker.damage += 20 * n;
  log(state, otherSeat(attackerSeat), `Spiky Energy put ${2 * n} damage counters on ${topCard(attacker).name}.`);
}

/** When a Pokémon is Knocked Out: Gift Energy draws, Legacy Energy takes a Prize off (once a game). Returns the Prize count. */
export function specialOnKnockOut(state: PState, owner: Seat, slot: PSlot, prizes: number, byAttack: boolean) {
  if (!byAttack || !working(state)) return prizes;
  const p = state.players[owner] as PState["players"]["p1"] & { legacyUsed?: boolean };
  if (slot.energy.some((e) => nameOf(e) === "Gift Energy") && p.hand.length < 7) {
    draw(p, 7 - p.hand.length);
    log(state, owner, `Gift Energy: ${p.name} drew until they had 7 cards.`);
  }
  if (slot.energy.some((e) => nameOf(e) === "Legacy Energy") && !p.legacyUsed && prizes > 0) {
    p.legacyUsed = true;
    log(state, owner, `Legacy Energy: ${state.players[otherSeat(owner)].name} takes 1 fewer Prize card.`);
    return prizes - 1;
  }
  return prizes;
}

/** Tidy-ups whenever the game settles: Team Rocket's Energy falls off other Pokémon, Therapeutic Energy cures. */
export function specialCleanup(state: PState) {
  for (const seat of ["p1", "p2"] as Seat[]) {
    const p = state.players[seat];
    for (const slot of inPlay(p)) {
      for (const e of slot.energy.filter((x) => nameOf(x) === "Team Rocket's Energy")) {
        if (isTeamRockets(topCard(slot))) continue;
        slot.energy.splice(slot.energy.indexOf(e), 1);
        p.discard.push(e);
        log(state, seat, `Team Rocket's Energy was discarded from ${topCard(slot).name}.`);
      }
      if (slot.conditions.length) slot.conditions = slot.conditions.filter((c) => !specialConditionBlocked(state, slot, c));
    }
  }
}

/** Ignition Energy is discarded at the end of its owner's turn. */
export function specialEndOfTurn(state: PState, seat: Seat) {
  const p = state.players[seat];
  for (const slot of inPlay(p)) {
    for (const e of slot.energy.filter((x) => nameOf(x) === "Ignition Energy")) {
      slot.energy.splice(slot.energy.indexOf(e), 1);
      p.discard.push(e);
      log(state, seat, `Ignition Energy was discarded from ${topCard(slot).name}.`);
    }
  }
}

/** Boomerang Energy: remember which ones are on the attacker, so any an attack discards come back after it. */
export function boomerangsBefore(slot: PSlot): string[] {
  return slot.energy.filter((e) => nameOf(e) === "Boomerang Energy").map((e) => e.uid);
}
export function boomerangsAfter(state: PState, seat: Seat, slot: PSlot | null, uids: string[]) {
  const p = state.players[seat];
  if (!slot || !uids.length || !inPlay(p).includes(slot) || !working(state)) return;
  for (const uid of uids) {
    const i = p.discard.findIndex((c) => c.uid === uid);
    if (i < 0) continue;
    const [card] = p.discard.splice(i, 1);
    slot.energy.push(card);
    log(state, seat, `Boomerang Energy came back to ${topCard(slot).name}.`);
  }
}
