// Pokémon Abilities in practice games. The ones a player uses on purpose, and the ones that go off
// when a Pokémon is evolved, benched or moved, are in ability-uses.ts. This file has what's always
// on (HP, damage, retreat and attack costs, locks), what happens when a Pokémon is damaged or
// Knocked Out, Pokémon Checkup and the end of the turn, and the buttons for Abilities.

import { otherSeat, type Seat } from "../game-types";
import {
  ask,
  draw,
  fail,
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
  maxHp,
  plural,
  shuffle,
  slotAt,
  slotKeys,
  switchActive,
  topCard,
  benchPokemon,
} from "./engine";
import { askChoice } from "./actions";
import {
  abilitiesBase,
  baseName,
  hasRuleBox,
  hasTool,
  hpLeft,
  inPlay,
  isActive,
  isEx,
  isMegaEx,
  isStage,
  isTera,
  isV,
  ofType,
  ownerOf,
  putCounters,
  setCondition,
  toolOf,
  trainersPokemon,
} from "./effects";
import { abilityTriggers, abilityUses, lustrousAssist, selfOf, type Use } from "./ability-uses";
import { me, names, pull, them } from "./trainers";
import type { Attack, PCard, PPlayer, PSlot, PState, SlotKey } from "./types";
import { marked, marksOn, turnLog } from "./lasting";
import { specialEffectsProof } from "./special-energy";

type Data = Record<string, unknown>;

// ----- Finding Abilities -----

const abilityNames = (c: PCard) => c.abilities.map((a) => a.name);
const cardHas = (c: PCard, name: string) => c.abilities.some((a) => a.name === name);
const benchIndex = (key: string) => Number(key.split(":")[1]);
const PRIZES = 6;

/** An Ability on a Pokémon in play that's working right now. */
export type Holder = { seat: Seat; slot: PSlot; name: string; text: string };

/** Other Abilities that switch Abilities off (Klefki, Iron Thorns ex, Flutter Mane and so on). */
export function lockedByAbility(state: PState, slot: PSlot): boolean {
  const c = topCard(slot);
  if (!c.abilities.length) return false;
  const owner = ownerOf(state, slot);
  const active = isActive(state, slot);
  for (const seat of ["p1", "p2"] as Seat[]) {
    for (const lock of inPlay(state.players[seat])) {
      const names_ = abilityNames(topCard(lock));
      if (!names_.length || !abilitiesBase(state, lock)) continue;
      const lockActive = state.players[seat].active === lock;
      if (names_.includes("Mischievous Lock") && lockActive && isBasicPokemon(c) && !cardHas(c, "Mischievous Lock")) return true;
      if (names_.includes("Initialization") && lockActive && hasRuleBox(c) && !c.subtypes.includes("Future")) return true;
      if (names_.includes("Midnight Fluttering") && lockActive && seat !== owner && active && !cardHas(c, "Midnight Fluttering")) return true;
      if (names_.includes("Cursed Land") && lockActive && seat !== owner && slot.damage > 0 && !isEx(c)) return true;
      if (names_.includes("Sticky Bind") && !lockActive && !active && isStage(c, 2)) return true;
      if (names_.includes("Fettered in Misfortune") && isBasicPokemon(c) && isV(c)) return true;
    }
  }
  return false;
}

/** Whether this Pokémon has this Ability and it's working. */
export function has(state: PState, slot: PSlot | null | undefined, name: string) {
  if (!slot || !cardHas(topCard(slot), name)) return false;
  return abilitiesBase(state, slot) && !lockedByAbility(state, slot);
}
/** How many Tools a Pokémon may hold: 4 with Tune-Up or Boss Pockets, 2 for Rotom with Multi Adapter. */
export function toolCap(state: PState, slot: PSlot) {
  if (has(state, slot, "Tune-Up") || has(state, slot, "Boss Pockets")) return 4;
  if (topCard(slot).name.includes("Rotom") && holders(state, "Multi Adapter", ownerOf(state, slot)).length) return 2;
  return 1;
}
const textOf = (slot: PSlot, name: string) => topCard(slot).abilities.find((a) => a.name === name)?.text ?? "";

/** Every working copy of an Ability in play (for one player, or both). */
export function holders(state: PState, name: string, seat?: Seat): Holder[] {
  const list: Holder[] = [];
  for (const s of seat ? [seat] : (["p1", "p2"] as Seat[])) {
    for (const slot of inPlay(state.players[s])) if (has(state, slot, name)) list.push({ seat: s, slot, name, text: textOf(slot, name) });
  }
  return list;
}
const active = (state: PState, seat: Seat) => state.players[seat].active;
/** A working Ability on a player's Active Pokémon. */
const onActive = (state: PState, seat: Seat, name: string) => has(state, active(state, seat), name);
/** A working Ability on one of a player's Benched Pokémon. */
const onBench = (state: PState, seat: Seat, name: string) => state.players[seat].bench.some((s) => has(state, s, name));
const anywhere = (state: PState, seat: Seat, name: string) => holders(state, name, seat).length > 0;
const count = (state: PState, seat: Seat, name: string) => holders(state, name, seat).length;
const nameIs = (slot: PSlot, ...list: string[]) => list.includes(baseName(topCard(slot).name));
const hasInPlay = (p: PPlayer, name: string) => inPlay(p).some((s) => baseName(topCard(s).name) === name);
const number = (text: string, re: RegExp, fallback: number) => Number(text.match(re)?.[1] ?? fallback);
const energyUnits = (slot: PSlot, type: string) => slot.energy.filter((e) => e.name.includes(type) || (isBasicEnergy(e) && e.name.includes(type))).length;
const hasEnergyOf = (slot: PSlot, type: string) => slot.energy.some((e) => e.name.includes(type));

// ----- Protection -----

/** Whether effects of the other player's Abilities can't touch this Pokémon. `seat` is the one using the Ability. */
export function abilityProof(state: PState, seat: Seat, slot: PSlot) {
  if (ownerOf(state, slot) === seat) return false;
  if (has(state, slot, "Amber Protection") || has(state, slot, "Hide 'n' Sneak")) return true;
  if (!nameIs(slot, "Enamorus V") && hasEnergyOf(slot, "Psychic") && anywhere(state, ownerOf(state, slot), "Guardian of Love")) return true;
  return false;
}

/** Whether effects (not damage) of the attacker's attack are prevented on this Pokémon. */
export function effectsProof(state: PState, seat: Seat, attacker: PSlot, slot: PSlot) {
  const owner = otherSeat(seat);
  const a = topCard(attacker);
  if (specialEffectsProof(state, slot)) return true;
  if (["Unfazed Fat", "Emperor's Stance", "Cocoon Cover", "Flare Veil", "Protective Cover", "Unaware", "Hide 'n' Sneak"].some((n) => has(state, slot, n)))
    return true;
  if (slot.energy.length && anywhere(state, owner, "Protective Mycelium")) return true;
  if (isBasicPokemon(topCard(slot)) && trainersPokemon(topCard(slot), "Team Rocket") && anywhere(state, owner, "Repelling Veil")) return true;
  if (!isActive(state, slot) && (has(state, slot, "So Submerged") || has(state, slot, "Storehouse Hideaway") || anywhere(state, owner, "Spherical Shield")))
    return true;
  if (has(state, slot, "Mighty Shell") && attacker.energy.some((e) => !isBasicEnergy(e))) return true;
  if (has(state, slot, "Sparkling Scales") && isTera(a)) return true;
  return false;
}

/** Watchful Eye: damage counters can't be moved. */
export const countersMove = (state: PState) => holders(state, "Watchful Eye").length === 0;
/** Freezing Disaster: nothing can be healed. */
export const noHealing = (state: PState) => holders(state, "Freezing Disaster").length > 0;

// ----- HP -----

export function abilityHp(state: PState, slot: PSlot) {
  const c = topCard(slot);
  const seat = ownerOf(state, slot);
  const them_ = state.players[otherSeat(seat)];
  let bonus = 0;
  if (anywhere(state, seat, "Vibrant Dance")) bonus += 40;
  if (ofType(c, "Grass") && baseName(c.name) !== "Kricketune" && anywhere(state, seat, "Swelling Tune")) bonus += 40;
  if (has(state, slot, "Nutritional Iron") && energyUnits(slot, "Metal") >= 3) bonus += 100;
  if (has(state, slot, "Expanding Body") && slot.energy.some((e) => !isBasicEnergy(e))) bonus += 100;
  if (has(state, slot, "Adrena-Power") && hasEnergyOf(slot, "Darkness")) bonus += 100;
  if (has(state, slot, "Crisis Muscles") && them_.prizes.length <= 3) bonus += 150;
  if (has(state, slot, "Craftsmanship")) bonus += 40 * energyUnits(slot, "Fighting");
  if (has(state, slot, "Resilient Soul")) bonus += 50 * (PRIZES - them_.prizes.length);
  return bonus;
}

// ----- Damage -----

/** More (or less) damage to the opponent's Active Pokémon, before Weakness and Resistance. */
export function abilityDamageBonus(state: PState, seat: Seat, attacker: PSlot, defender: PSlot) {
  const a = topCard(attacker);
  const d = topCard(defender);
  const opp = otherSeat(seat);
  const mine = state.players[seat];
  const theirs = state.players[opp];
  let bonus = 0;
  if (isActive(state, defender)) {
    if (baseName(a.name) === "Marowak") bonus += 30 * holders(state, "Cheering Bone", seat).filter((h) => h.slot !== mine.active).length;
    if (d.subtypes.includes("VMAX") && mine.bench.some((s) => has(state, s, "Big Match"))) bonus += 30;
    if (has(state, attacker, "Supreme Overlord")) bonus += 30 * (PRIZES - theirs.prizes.length);
    if (has(state, attacker, "Compound Eyes") && d.abilities.length) bonus += 50;
    if (trainersPokemon(a, "Cynthia")) bonus += 30 * count(state, seat, "Cheer On to Glory");
    if (!isBasicPokemon(a) && ofType(a, "Fire")) bonus += 10 * count(state, seat, "Victory Cheer");
    if (ofType(a, "Fighting")) bonus += 30 * count(state, seat, "Powerful a-Salt");
    if (a.subtypes.includes("Future") && baseName(a.name) !== "Iron Crown ex") bonus += 20 * count(state, seat, "Cobalt Command");
    if (ofType(a, "Grass") || ofType(a, "Fire")) bonus += 20 * count(state, seat, "Sunny Day");
    if (trainersPokemon(a, "Hop") && anywhere(state, seat, "Extra Helpings")) bonus += 30;
    bonus += 20 * count(state, seat, "Regal Cheer");
    if (defender.pokemon.length > 1 || !isBasicPokemon(d)) bonus += 30 * count(state, seat, "Primal Knowledge");
    if (has(state, attacker, "Lose Cool") && attacker.damage >= 20) bonus += 120;
    if (has(state, attacker, "Excited Power") && inPlay(mine).some((s) => isMegaEx(topCard(s)) && ofType(topCard(s), "Darkness"))) bonus += 120;
    if (has(state, attacker, "Adrena-Power") && hasEnergyOf(attacker, "Darkness")) bonus += 100;
    if (has(state, attacker, "Synchro Pulse") && mine.hand.length === theirs.hand.length) bonus += 80;
    if (isBasicPokemon(a)) {
      if (ofType(a, "Fire") && baseName(a.name) !== "Moltres") bonus += 10 * count(state, seat, "Flare Symbol");
      if (ofType(a, "Lightning")) bonus += 30 * count(state, seat, "Transistor");
      if (ofType(a, "Lightning") && baseName(a.name) !== "Zapdos") bonus += 10 * count(state, seat, "Lightning Symbol");
      if (ofType(a, "Water") && baseName(a.name) !== "Articuno") bonus += 10 * count(state, seat, "Ice Symbol");
      if (ofType(d, "Darkness")) bonus += 30 * count(state, seat, "Justified Law");
      bonus += 30 * count(state, seat, "Leadership");
    }
  }
  // The defending side's Abilities that weaken attacks.
  if (mine.active === attacker) {
    if (onActive(state, opp, "Pressure")) bonus -= 20;
    if (onActive(state, opp, "Intimidating Fang")) bonus -= 30;
    if (attacker.tool) bonus -= 20 * count(state, opp, "Gloomy Garbage");
  }
  return bonus;
}

/** Whether the defender's Abilities stop an attack's damage completely. */
function prevented(state: PState, seat: Seat, attacker: PSlot, defender: PSlot, damage: number) {
  const owner = otherSeat(seat);
  const a = topCard(attacker);
  const d = topCard(defender);
  const benched = !isActive(state, defender);
  if (benched) {
    if (onActive(state, owner, "Adverse Weather")) return true;
    if (anywhere(state, owner, "Wave Veil") || anywhere(state, owner, "Spherical Shield")) return true;
    if (!hasRuleBox(d) && anywhere(state, owner, "Flower Curtain")) return true;
    if (["Yoga Guard", "Carefree Countenance", "Plume Protection", "So Submerged", "Storehouse Hideaway"].some((n) => has(state, defender, n))) return true;
  }
  if (attacker.energy.length <= 2 && state.players[owner].bench.some((s) => has(state, s, "Ancient Bulwark"))) return true;
  if (has(state, defender, "Mimic Barrier") && attacker.energy.length === defender.energy.length) return true;
  if (isBasicPokemon(d) && hasEnergyOf(defender, "Metal") && isV(a) && anywhere(state, owner, "Metal Lodging")) return true;
  if (has(state, defender, "Armor Tail") && isBasicPokemon(a) && isEx(a)) return true;
  if (has(state, defender, "Heatproof") && ofType(a, "Fire")) return true;
  if (has(state, defender, "Well-Baked Body") && ofType(a, "Fire")) return true;
  if (has(state, defender, "Insulator") && ofType(a, "Lightning")) return true;
  if (has(state, defender, "Miracle Body") && isV(a)) return true;
  if (has(state, defender, "Safeguard") && (isEx(a) || (/Pokémon V/.test(textOf(defender, "Safeguard")) && isV(a)))) return true;
  if (has(state, defender, "Mysterious Shield") && (isEx(a) || isV(a))) return true;
  if (has(state, defender, "Mysterious Rock Inn") && isEx(a)) return true;
  if (has(state, defender, "Impervious Shell") && damage >= 200) return true;
  if (has(state, defender, "Mighty Shell") && attacker.energy.some((e) => !isBasicEnergy(e))) return true;
  if (has(state, defender, "Sparkling Scales") && isTera(a)) return true;
  if (has(state, defender, "Cornerstone Stance") && a.abilities.length) return true;
  return false;
}

/** An attack's damage after the defender's Abilities (after Weakness and Resistance). */
export function abilityDamageTaken(state: PState, seat: Seat, attacker: PSlot, defender: PSlot, damage: number) {
  if (damage <= 0) return 0;
  if (prevented(state, seat, attacker, defender, damage)) return 0;
  const owner = otherSeat(seat);
  const a = topCard(attacker);
  const d = topCard(defender);
  let less = 0;
  less += 10 * (count(state, owner, "Arm Thrust Practice") + count(state, owner, "Protective Bell"));
  if (isV(a)) less += 20 * count(state, owner, "Loving Veil") + 30 * count(state, owner, "Primal Fortress");
  if (ofType(a, "Dragon") && anywhere(state, owner, "Spirit Charm")) less += 30;
  if (a.subtypes.includes("VSTAR")) less += 30 * count(state, owner, "Protective DNA");
  if (hasEnergyOf(defender, "Metal")) less += 20 * count(state, owner, "Gear Coating");
  if (trainersPokemon(d, "Steven") && state.players[owner].bench.some((s) => has(state, s, "Stone Palace"))) less += 30;
  if (
    isBasicPokemon(d) &&
    ofType(d, "Colorless") &&
    holders(state, "Curly Wall", owner).some((h) => inPlay(state.players[owner]).some((s) => s !== h.slot && baseName(topCard(s).name) === "Bouffalant"))
  )
    less += 60;
  if (isBasicPokemon(d)) less += 20 * count(state, owner, "Gear Wall");
  if (has(state, defender, "Crimson Armor") && defender.damage === 0) less += 80;
  if ((has(state, defender, "Rock Armor") || has(state, defender, "Metal Shield")) && defender.energy.length) less += 30;
  if (has(state, defender, "Miraculous Armor") && isV(a)) less += 100;
  if (has(state, defender, "Thick Fat") && (ofType(a, "Fire") || ofType(a, "Water"))) less += 30;
  for (const ab of d.abilities) {
    const m = ab.text.match(/^This Pokémon takes (\d+) less damage from attacks \(after/);
    if (m && has(state, defender, ab.name)) less += Number(m[1]);
  }
  return Math.max(0, damage - less);
}

/** Azure Seas: this attacker's damage ignores effects on the opponent's Active Pokémon. */
export const ignoresDefenderEffects = (state: PState, attacker: PSlot, defender: PSlot) => has(state, attacker, "Azure Seas") && isActive(state, defender);

/** Weakness changes: ×4 (Ancient Way), none (Blooming Garden, Mental Shroud), or unchanged (null). */
export function abilityWeakness(state: PState, attacker: PSlot, defender: PSlot): number | null {
  const owner = ownerOf(state, defender);
  if (anywhere(state, owner, "Blooming Garden")) return 0;
  if (anywhere(state, owner, "Mental Shroud") && hasInPlay(state.players[owner], "Uxie") && hasInPlay(state.players[owner], "Azelf")) return 0;
  if (isActive(state, defender) && anywhere(state, ownerOf(state, attacker), "Ancient Way")) return 4;
  return null;
}
/** Fairy Zone makes the other player's Dragon Pokémon weak to Psychic. */
export function weaknessesOf(state: PState, defender: PSlot) {
  const d = topCard(defender);
  if (marked(state, defender, "noWeakness")) return [];
  const changed = marksOn(state, defender, "weakness")[0];
  if (changed) return [{ type: changed.data ?? "Colorless", value: "×2" }];
  if (ofType(d, "Dragon") && anywhere(state, otherSeat(ownerOf(state, defender)), "Fairy Zone")) return [{ type: "Psychic", value: "×2" }];
  return d.weaknesses;
}
/** A Pokémon's types, with Abilities that add types (Scovillain, Iron Treads). */
export function typesOf(state: PState, slot: PSlot) {
  const c = topCard(slot);
  if (has(state, slot, "Double Type")) return ["Grass", "Fire"];
  if (has(state, slot, "Dual Core") && hasTool(state, slot, "Future Booster Energy Capsule")) return ["Fighting", "Metal"];
  return c.types;
}

// ----- Energy -----

/** Wild Growth and Burn Brightly make some Basic Energy provide 2. */
export function doubledEnergy(state: PState, card: PCard): string | null {
  if (!isBasicEnergy(card)) return null;
  const type = card.name.includes("Grass") ? "Grass" : card.name.includes("Fire") ? "Fire" : null;
  if (!type) return null;
  for (const seat of ["p1", "p2"] as Seat[]) {
    if (!inPlay(state.players[seat]).some((s) => s.energy.includes(card))) continue;
    if (type === "Grass" && anywhere(state, seat, "Wild Growth")) return "Grass";
    if (type === "Fire" && anywhere(state, seat, "Burn Brightly")) return "Fire";
  }
  return null;
}

// ----- Retreating -----

export function abilityRetreat(state: PState, slot: PSlot, cost: number) {
  const c = topCard(slot);
  const seat = ownerOf(state, slot);
  const opp = otherSeat(seat);
  const act = state.players[seat].active === slot;
  const free =
    (hasEnergyOf(slot, "Metal") && anywhere(state, seat, "Metal Bridge")) ||
    (hasEnergyOf(slot, "Psychic") && anywhere(state, seat, "Lunar Zone")) ||
    (has(state, slot, "Pika Dash") && slot.energy.length > 0) ||
    ((has(state, slot, "Flare Float") || has(state, slot, "Explosive Heat Dash")) && hasEnergyOf(slot, "Fire")) ||
    (has(state, slot, "Voltaic Float") && hasEnergyOf(slot, "Lightning")) ||
    (has(state, slot, "Mist Float") && hasEnergyOf(slot, "Psychic")) ||
    (has(state, slot, "Ice Float") && hasEnergyOf(slot, "Water")) ||
    (has(state, slot, "Vamoose") && slot.damage > 0) ||
    (["Agile", "Melt Away", "In a Hungry Hurry"].some((n) => has(state, slot, n)) && !slot.energy.length) ||
    (has(state, slot, "Punk Out") && inPlay(state.players[opp]).some((s) => isV(topCard(s)))) ||
    (isBasicPokemon(c) && anywhere(state, seat, "Skyliner")) ||
    anywhere(state, seat, "Jet Cruise");
  if (free) return 0;
  let out = cost;
  if (act) out -= 2 * state.players[seat].bench.filter((s) => has(state, s, "Secret Forest Path") || has(state, s, "Carry and Climb")).length;
  if (slot.conditions.includes("poisoned")) out += count(state, opp, "Sludge Street");
  if (act && !isBasicPokemon(c)) out += count(state, opp, "Big Net");
  if (act) out += count(state, opp, "Binding Flame") + count(state, opp, "Trap Territory");
  return Math.max(0, out);
}

export function abilityRetreatBlock(state: PState, seat: Seat): string | null {
  const opp = otherSeat(seat);
  if (onActive(state, opp, "Block") || onActive(state, opp, "Primordial Tentacles"))
    return `${topCard(active(state, opp)!).name} stops your Active Pokémon retreating.`;
  return null;
}

// ----- Attacking -----

/** Changes to an attack's Energy cost. `cost` is changed in place. */
export function abilityAttackCost(state: PState, slot: PSlot, attack: { name?: string; cost: string[] }, cost: string[]) {
  const c = topCard(slot);
  const seat = ownerOf(state, slot);
  const opp = otherSeat(seat);
  const mine = state.players[seat];
  const theirs = state.players[opp];
  const less = (n: number) => {
    for (let i = 0; i < n; i++) {
      const at = cost.lastIndexOf("Colorless");
      if (at >= 0) cost.splice(at, 1);
    }
  };
  const act = mine.active === slot;
  if (act && (onActive(state, opp, "Quaking Zone") || onActive(state, opp, "Dazzling Gaze"))) cost.push("Colorless");
  if (act && isBasicPokemon(c) && onActive(state, opp, "Primal Root")) cost.push("Colorless");
  if (c.subtypes.includes("VSTAR") && anywhere(state, opp, "Hidden Threads")) cost.push("Colorless");
  if (has(state, slot, "Food Prep")) less(mine.discard.filter((x) => baseName(x.name) === "Kofu").length);
  if (has(state, slot, "Hustle Play")) less(theirs.bench.length);
  if (has(state, slot, "Seasoned Skill") && attack.name === "Blood Moon") less(PRIZES - theirs.prizes.length);
  if (has(state, slot, "Excited Heart")) less(PRIZES - theirs.prizes.length);
  if (has(state, slot, "Wild Style"))
    less(inPlay(theirs).filter((s) => topCard(s).subtypes.some((t) => ["Single Strike", "Rapid Strike", "Fusion Strike"].includes(t))).length);
  if (has(state, slot, "Chakra Awakening") && mine.hand.length === 4) less(3);
  if (has(state, slot, "Hustle Bark") && inPlay(theirs).some((s) => topCard(s).subtypes.includes("VMAX"))) less(3);
  if (has(state, slot, "Monkey Trio") && ["Simisage", "Simisear", "Simipour"].every((n) => hasInPlay(mine, n))) less(cost.length);
  const free =
    (has(state, slot, "Lost Provisions") && (mine.lost ?? []).length >= 4) ||
    (has(state, slot, "Enthusiastic King") && hasInPlay(mine, "Nidoqueen")) ||
    (has(state, slot, "Tuning Echo") && attack.name === "Frightening Howl" && mine.hand.length === theirs.hand.length);
  if (free) cost.splice(0, cost.length);
}

/** Why this player's Active Pokémon can't attack because of an Ability, or null. */
export function abilityAttackBlock(state: PState, seat: Seat): string | null {
  const a = active(state, seat);
  if (!a) return null;
  const opp = state.players[otherSeat(seat)];
  const mine = state.players[seat];
  if (has(state, a, "Kinda Lazy") && [2, 4, 6].includes(mine.prizes.length)) return "Kinda Lazy: it can't attack with 2, 4 or 6 Prize cards left.";
  if (has(state, a, "Born to Slack") && !inPlay(opp).some((s) => isEx(topCard(s)) || isV(topCard(s))))
    return "Born to Slack: your opponent has no Pokémon ex or Pokémon V in play.";
  if (has(state, a, "Power Saver") && inPlay(mine).filter((s) => trainersPokemon(topCard(s), "Team Rocket")).length < 4)
    return "Power Saver: you need 4 Team Rocket's Pokémon in play.";
  if (hpLeft(state, a) <= 40 && anywhere(state, otherSeat(seat), "Frigid Room")) return "Frigid Room: Pokémon with 40 HP or less left can't attack.";
  return null;
}

/** Debut Performance: can attack on the first turn of the game. */
export const attacksFirstTurn = (state: PState, seat: Seat) => state.first === seat && has(state, active(state, seat), "Debut Performance");

/** Extra attacks from Abilities (Memory Dive, Sudden Transformation), and costs that change. */
export function abilityAttacks(state: PState, slot: PSlot, own: Attack[]): Attack[] {
  const seat = ownerOf(state, slot);
  const p = state.players[seat];
  let list = own;
  if (slot.pokemon.length > 1 && anywhere(state, seat, "Memory Dive")) {
    const earlier = slot.pokemon.slice(0, -1).flatMap((c) => c.attacks);
    list = [...list, ...earlier.filter((a) => !list.some((x) => x.name === a.name))];
  }
  if (has(state, slot, "Sudden Transformation")) {
    const copied = p.discard.filter((c) => isBasicPokemon(c) && !hasRuleBox(c)).flatMap((c) => c.attacks);
    list = [...list, ...copied.filter((a) => !list.some((x) => x.name === a.name))];
  }
  if (has(state, slot, "Glistening Bubbles") && inPlay(p).some((s) => isTera(topCard(s))))
    list = list.map((a) => (a.name === "Double-Edge" ? { ...a, cost: ["Psychic"] } : a));
  if (has(state, slot, "Plasma Bane") && state.players[otherSeat(seat)].discard.some((c) => c.name.includes("Colress")))
    list = list.map((a) => (a.name === "Trifrost" ? { ...a, cost: ["Colorless"] } : a));
  return list;
}

/** Festival Lead: with Festival Grounds in play, this Pokémon may attack twice if the first attack Knocks Out. */
export const attacksTwice = (state: PState, slot: PSlot) =>
  has(state, slot, "Festival Lead") && !!state.stadium && baseName(state.stadium.card.name) === "Festival Grounds";

// ----- Special Conditions -----

/** Whether an Ability stops this Pokémon getting this Special Condition. */
export function conditionBlocked(state: PState, slot: PSlot, condition: string) {
  const seat = ownerOf(state, slot);
  if (has(state, slot, "Salty Body")) return true;
  if (hasEnergyOf(slot, "Grass") && anywhere(state, seat, "Verdant Wind")) return true;
  if (condition === "confused" && hasEnergyOf(slot, "Grass") && anywhere(state, seat, "Curative Bower")) return true;
  if (condition === "asleep" && has(state, slot, "Insomnia")) return true;
  if (condition === "burned" && has(state, slot, "Well-Baked Body")) return true;
  if (condition === "paralyzed" && has(state, slot, "Electricity Pouches")) return true;
  return false;
}

/** Extra damage during Pokémon Checkup from Poison and Burns. */
export function checkupExtra(state: PState, slot: PSlot, condition: "poisoned" | "burned") {
  const opp = otherSeat(ownerOf(state, slot));
  if (condition === "poisoned") return 20 * count(state, opp, "Poison Peak") + (onActive(state, opp, "Toxic Subjugation") ? 50 : 0);
  let extra = 30 * count(state, opp, "Magma Surge");
  if (anywhere(state, opp, "Scorching Aura")) extra += 20;
  return extra;
}
/** Stir and Snooze: flip 2 coins to wake up. */
export const heavySleeper = (state: PState, slot: PSlot) => has(state, slot, "Stir and Snooze");
/** Poison Sacs: the other player's Poisoned Pokémon stay Poisoned when they evolve. */
export const keepsPoison = (state: PState, slot: PSlot) =>
  slot.conditions.includes("poisoned") && anywhere(state, otherSeat(ownerOf(state, slot)), "Poison Sacs");

// ----- Playing cards and evolving -----

/** Why an Ability stops this player playing this card from their hand, or null. */
export function playLock(state: PState, seat: Seat, card: PCard): string | null {
  const opp = otherSeat(seat);
  const oppActive = active(state, opp);
  const who = oppActive ? topCard(oppActive).name : "";
  if (isItem(card) && (onActive(state, opp, "Daunting Gaze") || onActive(state, opp, "Oceanic Curse"))) return `${who} stops you playing Item cards.`;
  if (isTool(card) && onActive(state, opp, "Oceanic Curse")) return `${who} stops you playing Pokémon Tool cards.`;
  if (isStadium(card) && (onActive(state, opp, "Helical Swell") || onActive(state, opp, "Massive Body"))) return `${who} stops you playing Stadium cards.`;
  if (card.subtypes.includes("ACE SPEC") && holders(state, "ACE Nullifier", opp).some((h) => h.slot.tool))
    return "Genesect's ACE Nullifier stops you playing ACE SPEC cards.";
  if (isPokemon(card) && card.abilities.length && !trainersPokemon(card, "Team Rocket") && onActive(state, opp, "Potent Glare"))
    return `${who} stops you playing Pokémon with Abilities.`;
  return null;
}

/** Whether an Ability lets this Pokémon evolve on the first turn or the turn it was played. */
export function evolvesEarly(state: PState, seat: Seat, slot: PSlot) {
  const p = state.players[seat];
  if (has(state, slot, "Adaptive Evolution")) return true;
  if (p.active === slot && has(state, slot, "Boosted Evolution")) return true;
  const stim = textOf(slot, "Stimulated Evolution").match(/If you have (\w+) in play/);
  if (stim && has(state, slot, "Stimulated Evolution") && hasInPlay(p, stim[1])) return true;
  return false;
}
/** Evolutionary Advantage: going second, it can evolve during the first turn (not the turn it's played). */
export const evolvesFirstTurn = (state: PState, seat: Seat, slot: PSlot) =>
  state.turn === 2 && state.first !== seat && has(state, slot, "Evolutionary Advantage");
/** Rainbow DNA: Eevee ex evolves into any Pokémon ex that evolves from Eevee. */
export const rainbowDna = (state: PState, slot: PSlot, card: PCard) => isEx(card) && card.evolvesFrom === "Eevee" && has(state, slot, "Rainbow DNA");
/** Hero's Spirit: Palafin ex only comes into play through Zero to Hero. */
export const onlyByAbility = (card: PCard) => cardHas(card, "Hero's Spirit");
/** Explosiveness: this can start the game face down in the Active Spot. */
export const startsActive = (card: PCard) => cardHas(card, "Explosiveness");

// ----- The Bench -----

/** Dust Field: the other player can have only 3 Benched Pokémon. */
export const benchCap = (state: PState, seat: Seat) => (onActive(state, otherSeat(seat), "Dust Field") ? 3 : null);

// ----- Trainer protection -----

/** Whether the other player's Supporter (or Item) can't affect this Pokémon. */
export function trainerProof(state: PState, slot: PSlot, kind: "Supporter" | "Item") {
  const seat = ownerOf(state, slot);
  const benched = !isActive(state, slot);
  if (has(state, slot, "Snow Camouflage") || has(state, slot, "Unnerve")) return true;
  if (kind !== "Supporter") return false;
  if (onActive(state, seat, "Wide Wall")) return true;
  if (benched && isBasicPokemon(topCard(slot)) && onActive(state, seat, "Princess's Curtain")) return true;
  if (benched && isV(topCard(slot)) && state.players[otherSeat(seat)].prizes.length <= 2 && anywhere(state, seat, "Baffling")) return true;
  return false;
}
/** Reassuring Dam: the other player's effects can't discard cards from this player's deck. */
export const deckDam = (state: PState, seat: Seat) => state.players[seat].bench.some((s) => has(state, s, "Reassuring Dam"));
/** Slime Mold Colony: this player's effects can't put cards from their discard pile into their hand. */
export const discardLocked = (state: PState, seat: Seat) => anywhere(state, otherSeat(seat), "Slime Mold Colony");
/** Sand Screen: Trainer cards can't go from this player's discard pile into their deck. */
export const trainersStayDiscarded = (state: PState, seat: Seat) => anywhere(state, otherSeat(seat), "Sand Screen");
/** Mentally Calm: this player's Pokémon in play can't go back into their hand. */
export const pickUpLocked = (state: PState, seat: Seat) => anywhere(state, otherSeat(seat), "Mentally Calm");
/** Stand Sentry: Basic Energy on this player's Benched Pokémon can't be discarded by the other player's Trainers. */
export const benchEnergyGuarded = (state: PState, seat: Seat, slot: PSlot) => !isActive(state, slot) && anywhere(state, seat, "Stand Sentry");
/** Stellar Veil: no damage counters on Benched Pokémon from effects of the other player's Basic Pokémon's attacks. */
export function benchCountersBlocked(state: PState, seat: Seat, slot: PSlot) {
  const owner = ownerOf(state, slot);
  const attacker = state.players[seat].active;
  return (
    owner !== seat &&
    state.attacking === seat &&
    !isActive(state, slot) &&
    !!attacker &&
    isBasicPokemon(topCard(attacker)) &&
    anywhere(state, owner, "Stellar Veil")
  );
}
/** New Moon: with Solrock in play, Stadiums don't affect this player's Pokémon. */
export function stadiumShielded(state: PState, slot: PSlot) {
  const seat = ownerOf(state, slot);
  return anywhere(state, seat, "New Moon") && hasInPlay(state.players[seat], "Solrock");
}

/**
 * Cards the other player's effects just discarded from this player's deck or hand. Ferrothorn's
 * Startling Drop and Amoonguss's Surprise Spores hit back when that happens during their turn.
 */
export function discardedByOpponent(state: PState, owner: Seat, cards: PCard[], from: "deck" | "hand") {
  if (state.current === owner || !cards.length) return;
  const opp = state.players[otherSeat(owner)];
  if (from === "deck" && cards.some((c) => cardHas(c, "Startling Drop"))) {
    const gone = opp.deck.splice(0, 8);
    opp.discard.push(...gone);
    log(state, owner, `Startling Drop discarded the top ${plural(gone.length, "card")} of ${opp.name}'s deck.`);
  }
  if (from === "hand" && cards.some((c) => cardHas(c, "Surprise Spores")) && opp.hand.length) {
    const gone = opp.hand.splice(0);
    opp.discard.push(...gone);
    log(state, owner, `Surprise Spores discarded ${opp.name}'s hand.`);
  }
}

/** Damp: Abilities that Knock Out their own Pokémon don't work. */
const damp = (state: PState) => holders(state, "Damp").length > 0;

// ----- Being damaged by an attack -----

/** Coin flips and the like that stop an attack's damage before it lands. Returns the damage left. */
export function beforeAttackDamage(state: PState, seat: Seat, attacker: PSlot, defender: PSlot, damage: number) {
  if (damage <= 0) return damage;
  const owner = otherSeat(seat);
  const dodge =
    ["Smooth Coat", "Primate Dexterity", "Drifting Dodge", "Expert Hider"].find((n) => has(state, defender, n)) ??
    (has(state, defender, "Adrena-Pheromone") && hasEnergyOf(defender, "Darkness") ? "Adrena-Pheromone" : null) ??
    (has(state, defender, "Tangled Feet") && defender.conditions.includes("confused") ? "Tangled Feet" : null);
  if (dodge) {
    const heads = flip();
    log(state, owner, `${dodge}: coin flip ${heads ? "heads, the damage is prevented" : "tails"}.`, "coin");
    if (heads) return 0;
  }
  return damage;
}

/** Keeps a Pokémon in play with 10 HP (Sturdy, Resolute Heart, Guts and so on). Call after damage is added. */
export function survives(state: PState, seat: Seat, defender: PSlot, wasFull: boolean) {
  if (defender.damage < maxHp(state, defender)) return;
  const owner = otherSeat(seat);
  const sturdy = wasFull && (has(state, defender, "Sturdy") || has(state, defender, "Resolute Heart"));
  const tough = ["Tenacious Body", "Durable Body", "Guts"].find((n) => has(state, defender, n));
  let saved = sturdy;
  if (!saved && tough) {
    saved = flip();
    log(state, owner, `${tough}: coin flip ${saved ? "heads" : "tails"}.`, "coin");
  }
  if (saved) {
    defender.damage = maxHp(state, defender) - 10;
    log(state, owner, `${topCard(defender).name} held on with 10 HP.`);
  }
}

/** What happens after an attack damages a Pokémon (Counterattack, Rough Skin-style Abilities). */
export function afterAttackDamage(state: PState, seat: Seat, attacker: PSlot, defender: PSlot, wasActive: boolean, wasFull: boolean) {
  const owner = otherSeat(seat);
  const opp = state.players[owner];
  const a = topCard(attacker);
  const counters_ = (n: number, why: string) => {
    if (n <= 0) return;
    attacker.damage += n * 10;
    log(state, owner, `${why} put ${plural(n, "damage counter")} on ${a.name}.`);
  };
  if (has(state, defender, "Pummeling Payback")) counters_(2 * energyUnits(defender, "Metal"), "Pummeling Payback");
  if (wasFull && defender.damage >= maxHp(state, defender) && has(state, defender, "Spiteful Magic")) counters_(8, "Spiteful Magic");
  if (!wasActive) return;
  if (has(state, defender, "Counterattacking Pincer") && attacker.energy.length) {
    const [e] = attacker.energy.splice(attacker.energy.length - 1, 1);
    state.players[seat].discard.push(e);
    log(state, owner, `Counterattacking Pincer discarded ${e.name} from ${a.name}.`);
  }
  if (has(state, defender, "Needly Armor")) counters_(3 * energyUnits(defender, "Grass"), "Needly Armor");
  for (const [n, k] of [
    ["Counterattack Quills", 3],
    ["Counterattacking Crest", 5],
    ["Counterattack", 3],
    ["Automated Combat", 3],
  ] as const)
    if (has(state, defender, n)) counters_(number(textOf(defender, n), /(\d+) damage counters/, k), n);
  if (has(state, defender, "Solidarity"))
    counters_(3 * inPlay(opp).filter((s) => ["Tandemaus", "Maushold", "Maushold ex"].includes(baseName(topCard(s).name))).length, "Solidarity");
  if (has(state, defender, "Custom Trap") && defender.tool) counters_(5, "Custom Trap");
  if (baseName(topCard(defender).name) === "Chesnaught V") counters_(3 * count(state, owner, "Needle Line"), "Needle Line");
  if (ofType(topCard(defender), "Darkness")) counters_(count(state, owner, "Spiteful Swirl"), "Spiteful Swirl");
  const burn = ["Incandescent Body", "Scorching Armor"].find((n) => has(state, defender, n));
  if (burn) {
    setCondition(state, attacker, "burned");
    log(state, owner, `${burn}: ${a.name} is now Burned.`);
  }
  if (has(state, defender, "Poison Point")) {
    setCondition(state, attacker, "poisoned");
    log(state, owner, `Poison Point: ${a.name} is now Poisoned.`);
  }
  if (has(state, defender, "Smog Signals") && opp.deck.some((c) => isPokemon(c) && c.name.includes("Koffing"))) {
    const room = Math.min(2, benchRoom(state, owner));
    if (room > 0)
      ask(state, {
        seat: owner,
        title: "Smog Signals: choose up to 2 Pokémon with Koffing in their name for your Bench",
        zone: "deck",
        options: opp.deck.filter((c) => isPokemon(c) && isBasicPokemon(c) && c.name.includes("Koffing")).map((c) => c.uid),
        shown: opp.deck.map((c) => c.uid),
        min: 0,
        max: room,
        effect: "ab:bench from deck",
      });
  }
}
const benchRoom = (state: PState, seat: Seat) => {
  const cap = benchCap(state, seat);
  const limit = cap === null ? 5 : Math.min(5, cap);
  return limit - state.players[seat].bench.length;
};

// ----- Knock Outs -----

/**
 * Prize changes and effects when a Pokémon is Knocked Out. Runs before it leaves play; returns
 * the new Prize count. `byAttack` is true when the other player's attack did it.
 */
export function abilityKnockOut(state: PState, seat: Seat, slot: PSlot, prizes: number, byAttack: boolean) {
  const taker = otherSeat(seat);
  const p = state.players[seat];
  const t = state.players[taker];
  const c = topCard(slot);
  const wasActive = p.active === slot;
  const attacker = t.active;
  const a = attacker ? topCard(attacker) : null;
  let out = prizes;
  const coin = (why: string) => {
    const heads = flip();
    log(state, seat, `${why}: coin flip ${heads ? "heads" : "tails"}.`, "coin");
    return heads;
  };
  if (byAttack && a) {
    if (has(state, slot, "All Just a Dream") && slot.conditions.includes("asleep")) out = 0;
    if ((has(state, slot, "Elder Tree Barrier") || has(state, slot, "Selfish Lips")) && isV(a)) out = 0;
    if (has(state, slot, "Fragile Husk") && isEx(a)) out = 0;
    if (has(state, slot, "Oh No You Don't") && hasInPlay(p, "Pecharunt ex")) out = Math.max(0, out - 1);
    if (ofType(c, "Darkness") && isEx(a) && anywhere(state, seat, "Shadowy Concealment")) out = Math.max(0, out - 1);
    if (wasActive && isBasicPokemon(c) && has(state, attacker, "Greedy Eater")) out += 1;
  }
  if (wasActive && has(state, slot, "Evanescent") && coin("Evanescent")) out = Math.max(0, out - 1);
  if (has(state, slot, "Shattering Crystal") && coin("Shattering Crystal")) out = 0;
  if (wasActive && out > 0 && anywhere(state, taker, "Wonder Kiss") && coin("Wonder Kiss")) out += 1;
  if (out !== prizes) log(state, seat, `${t.name} takes ${plural(out, "Prize card")} for ${c.name}.`);

  if (!byAttack || !attacker || !a) return out;
  if (has(state, slot, "Startling Pumpkin")) {
    for (let i = 0; i < 2 && t.hand.length; i++) {
      const [gone] = t.hand.splice(Math.floor(Math.random() * t.hand.length), 1);
      t.discard.push(gone);
      log(state, seat, `Startling Pumpkin discarded ${gone.name} from ${t.name}'s hand.`);
    }
  }
  const search1 = ["Final Chain", "Gold Coffin", "Cursed Message"].find((n) => has(state, slot, n));
  if (search1 && p.deck.length) askSearch(state, seat, `${search1}: choose a card to put into your hand`, 1);
  if (wasActive && has(state, slot, "Entrusted Wishes") && p.deck.length)
    askSearch(state, seat, "Entrusted Wishes: choose up to 3 cards to put into your hand", 3);
  if (wasActive && has(state, slot, "Let's Have a Blast") && coin("Let's Have a Blast")) {
    attacker.damage = Math.max(attacker.damage, maxHp(state, attacker));
    log(state, seat, `Let's Have a Blast Knocked Out ${a.name}.`);
  }
  if (wasActive && has(state, slot, "Exploding Needles")) {
    attacker.damage += 60;
    log(state, seat, `Exploding Needles put 6 damage counters on ${a.name}.`);
  }
  if (wasActive && (has(state, slot, "Sandy Flapping") || has(state, slot, "Bully of the Sands"))) {
    if (has(state, slot, "Sandy Flapping")) {
      t.discard.push(...t.deck.splice(0, 2));
      log(state, seat, `Sandy Flapping discarded the top 2 cards of ${t.name}'s deck.`);
    } else if (t.hand.length) {
      const [gone] = t.hand.splice(Math.floor(Math.random() * t.hand.length), 1);
      t.discard.push(gone);
      log(state, seat, `Bully of the Sands discarded ${gone.name} from ${t.name}'s hand.`);
    }
  }
  // Energy that moves before the Pokémon is discarded. It waits in the hand until a target is chosen.
  const others = p.bench.filter((s) => s !== slot);
  const park = (cards: PCard[], title: string, to: SlotKey[]) => {
    if (!cards.length || !to.length) return;
    for (const e of cards) slot.energy.splice(slot.energy.indexOf(e), 1);
    p.hand.push(...cards);
    ask(state, { seat, title, zone: "myPokemon", options: to, min: 1, max: 1, effect: "ab:ko move", data: { energy: cards.map((e) => e.uid) } });
  };
  const benchKeys = () => p.bench.map((s, i) => (s !== slot ? `bench:${i}` : "")).filter(Boolean) as SlotKey[];
  if (wasActive && has(state, slot, "Photon Cord"))
    park(
      slot.energy.filter((e) => isBasicEnergy(e) && e.name.includes("Lightning")).slice(0, 2),
      "Photon Cord: choose a Benched Pokémon to move the Lightning Energy to",
      benchKeys(),
    );
  else if (wasActive && has(state, slot, "Fillet Memento"))
    park(slot.energy.filter((e) => e.name.includes("Water")).slice(0, 2), "Fillet Memento: choose a Benched Pokémon to move the Water Energy to", benchKeys());
  else if (isBasicPokemon(c) && isV(c) && others.length && anywhere(state, seat, "Wish Connector")) {
    const e = slot.energy.find(isBasicEnergy);
    if (e)
      park(
        [e],
        "Wish Connector: choose a Pokémon to move a Basic Energy to",
        slotKeys(p).filter((k) => slotAt(p, k) !== slot),
      );
  } else {
    const raichu = holders(state, "Electrical Grounding", seat).find((h) => h.slot !== slot);
    const e = slot.energy.find((x) => x.name.includes("Lightning"));
    if (raichu && e) {
      slot.energy.splice(slot.energy.indexOf(e), 1);
      raichu.slot.energy.push(e);
      log(state, seat, `Electrical Grounding moved ${e.name} to ${topCard(raichu.slot).name}.`);
    }
  }
  if (ofType(c, "Water") && anywhere(state, seat, "Diver's Catch")) {
    const water = slot.energy.filter((e) => isBasicEnergy(e) && e.name.includes("Water"));
    if (water.length) {
      for (const e of water) slot.energy.splice(slot.energy.indexOf(e), 1);
      p.hand.push(...water);
      log(state, seat, `Diver's Catch put ${plural(water.length, "Basic Water Energy")} into ${p.name}'s hand.`);
    }
  }
  return out;
}
/** Persistent Cells: the Pokémon goes back to the hand instead of the discard pile. */
export const toHandOnKo = (state: PState, slot: PSlot) =>
  state.attacking !== null && state.attacking !== ownerOf(state, slot) && has(state, slot, "Persistent Cells");
/** Lost Block: Prize cards the other player takes go to the Lost Zone. */
export const prizesToLost = (state: PState, taker: Seat) => anywhere(state, otherSeat(taker), "Lost Block");

function askSearch(state: PState, seat: Seat, title: string, max: number) {
  const p = state.players[seat];
  ask(state, { seat, title, zone: "deck", options: p.deck.map((c) => c.uid), shown: p.deck.map((c) => c.uid), min: 0, max, effect: "ab:search" });
}

// ----- Pokémon Checkup, the end of the turn and other moments -----

export function checkupAbilities(state: PState) {
  for (const seat of [state.current, otherSeat(state.current)]) {
    const p = state.players[seat];
    const opp = state.players[otherSeat(seat)];
    const salt = count(state, seat, "Blessed Salt");
    if (salt && !noHealing(state)) {
      for (const s of inPlay(p)) s.damage = Math.max(0, s.damage - 20 * salt);
      log(state, seat, `Blessed Salt healed damage from each of ${p.name}'s Pokémon.`);
    }
    if (onActive(state, seat, "Forest Miasma") && opp.active) {
      opp.active.damage += 10;
      log(state, seat, `Forest Miasma put 1 damage counter on ${topCard(opp.active).name}.`);
    }
    if (onActive(state, seat, "Sand Stream")) {
      const basics = inPlay(opp).filter((s) => isBasicPokemon(topCard(s)));
      for (const s of basics) s.damage += 20;
      if (basics.length) log(state, seat, `Sand Stream put 2 damage counters on each of ${opp.name}'s Basic Pokémon.`);
    }
    const shroud = count(state, seat, "Freezing Shroud");
    if (shroud) {
      for (const who of ["p1", "p2"] as Seat[])
        for (const s of inPlay(state.players[who])) if (topCard(s).abilities.length && baseName(topCard(s).name) !== "Froslass") s.damage += 10 * shroud;
      log(state, seat, "Freezing Shroud put damage counters on each Pokémon with an Ability.");
    }
  }
}

/** "Once at the end of your turn" Abilities. */
export function endOfTurnAbilities(state: PState) {
  const seat = state.current;
  const p = state.players[seat];
  if (onActive(state, seat, "Quaking Demolition")) {
    const gone = p.deck.splice(0, 5);
    p.discard.push(...gone);
    log(state, seat, `Quaking Demolition: ${p.name} discarded the top ${plural(gone.length, "card")} of their deck.`);
  }
  for (const [name, n] of [
    ["Sunny Bloom", 4],
    ["Precious Gift", 8],
  ] as const) {
    if (!anywhere(state, seat, name)) continue;
    const want = n - p.hand.length;
    // Drawing never costs the game here: leave at least one card for next turn's draw.
    const safe = Math.min(want, p.deck.length - 1);
    if (safe > 0) {
      draw(p, safe);
      log(state, seat, `${name}: ${p.name} drew ${plural(safe, "card")}.`);
    }
  }
}

/** When Energy is attached from the hand (the once-a-turn attachment). */
export function energyAttachedAbilities(state: PState, seat: Seat, slot: PSlot) {
  const opp = otherSeat(seat);
  const c = topCard(slot);
  if (onActive(state, seat, "Auto Heal") && slot.damage && !noHealing(state)) {
    slot.damage = Math.max(0, slot.damage - 90);
    log(state, seat, `Auto Heal healed 90 damage from ${c.name}.`);
  }
  const curse = count(state, opp, "Gnawing Curse") * 2 + (anywhere(state, opp, "Buddy Pulse") && hasInPlay(state.players[opp], "Plusle") ? 2 : 0);
  const block = isV(c) ? count(state, "p1", "Shocking Block") + count(state, "p2", "Shocking Block") : 0;
  if (curse + block * 2 > 0) {
    slot.damage += (curse + block * 2) * 10;
    log(state, seat, `${plural(curse + block * 2, "damage counter")} went on ${c.name} for attaching Energy.`);
  }
  const p = state.players[seat];
  if (p.bench.includes(slot) && has(state, slot, "Far-Flying Meteor") && !used(p, slot, "Far-Flying Meteor")) {
    offer(state, seat, slot, "Far-Flying Meteor", "switch it with your Active Pokémon", "meteor");
  }
}

/** When a player plays a Pokémon from their hand to evolve (Darkest Impulse hurts the other player's). */
export function evolvedAbilities(state: PState, seat: Seat, slot: PSlot) {
  if (anywhere(state, otherSeat(seat), "Darkest Impulse")) {
    slot.damage += 40;
    log(state, seat, `Darkest Impulse put 4 damage counters on ${topCard(slot).name}.`);
  }
  runTrigger(state, seat, slot, "evolve");
}

/** When a player plays a Basic Pokémon from their hand onto their Bench. */
export const benchedAbilities = (state: PState, seat: Seat, slot: PSlot) => runTrigger(state, seat, slot, "bench");

/**
 * Notices Pokémon moving between the Active Spot and the Bench (by retreating, switching, being
 * promoted and so on) and runs the Abilities that care. Called whenever the game settles.
 */
export function trackMoves(state: PState) {
  for (const seat of ["p1", "p2"] as Seat[]) {
    const p = state.players[seat];
    const now = p.active?.pokemon[0]?.uid ?? null;
    const before = p.activeId;
    p.activeId = now;
    if (before === undefined || before === now || !p.active) continue;
    const myTurn = state.current === seat && state.status === "playing";
    const opp = otherSeat(seat);
    const outgoing = p.bench.find((s) => s.pokemon[0]?.uid === before);
    if (outgoing && myTurn) {
      // The old Active Pokémon moved to the Bench during its owner's turn.
      if (anywhere(state, opp, "Holes")) {
        outgoing.damage += 20;
        log(state, opp, `Holes put 2 damage counters on ${topCard(outgoing).name}.`);
      }
      if (anywhere(state, opp, "Lava Zone")) {
        setCondition(state, p.active, "burned");
        log(state, opp, `Lava Zone: ${topCard(p.active).name} is now Burned.`);
      }
      if (onActive(state, opp, "Swirling Prose")) {
        setCondition(state, p.active, "confused");
        log(state, opp, `Swirling Prose: ${topCard(p.active).name} is now Confused.`);
      }
      runTrigger(state, seat, outgoing, "toBench");
    }
    if (myTurn && p.bench.every((s) => s.pokemon[0]?.uid !== now)) {
      turnLog(state, seat).movedUp.push(p.active.pokemon[0].uid);
      runTrigger(state, seat, p.active, "toActive");
      if (baseName(topCard(p.active).name) === "Mega Latias ex") {
        const latios = holders(state, "Lustrous Assist", seat).find((h) => !used(p, h.slot, "Lustrous Assist"));
        if (latios) offer(state, seat, latios.slot, "Lustrous Assist", "move any Energy from your Benched Pokémon to your Active Pokémon", "lustrous");
      }
    }
  }
}

// ----- Offering an Ability ("you may") -----

const used = (p: PPlayer, slot: PSlot, name: string) => (p.used ?? []).includes(`ab:${topCard(slot).uid}:${name}`);
const markUsed = (p: PPlayer, uid: string, name: string) => (p.used ??= []).push(`ab:${uid}:${name}`);
const pseudo = (card: PCard, name: string, text: string): PCard => ({ ...card, name, rules: [text] });

function runTrigger(state: PState, seat: Seat, slot: PSlot, on: "evolve" | "bench" | "toActive" | "toBench") {
  const p = state.players[seat];
  const c = topCard(slot);
  for (const ab of c.abilities) {
    const t = abilityTriggers()[ab.name];
    if (!t || t.on !== on || !has(state, slot, ab.name)) continue;
    if (on === "bench" && ab.name !== "Sudden Cyclone" && state.current !== seat) continue;
    if (t.once && used(p, slot, ab.name)) continue;
    const card = pseudo(c, ab.name, ab.text);
    if (t.use.canPlay?.(state, seat, card)) continue;
    if (t.must) {
      log(state, seat, `${c.name}'s ${ab.name}.`);
      t.use.play(state, seat, card);
      continue;
    }
    offer(state, seat, slot, ab.name, ab.text, on);
  }
}

function offer(state: PState, seat: Seat, slot: PSlot, name: string, text: string, kind: string, extra: Data = {}) {
  const use = abilityTriggers()[name]?.use ?? abilityUses()[name];
  const self = slot;
  const worth = kind === "meteor" ? false : (use?.worth?.(state, seat, self) ?? true);
  askChoice(
    state,
    seat,
    `Use ${topCard(slot).name}'s ${name}? ${text.replace(/\s*\([^)]*\)/g, "")}`,
    [
      { id: "yes", label: `Use ${name}` },
      { id: "no", label: "Don't use it" },
    ],
    "ab:offer",
    { data: { name, src: topCard(slot).uid, kind, botPick: [worth ? "yes" : "no"], ...extra } },
  );
}

// ----- Buttons for Abilities -----

export type AbilityAction = { id: string; label: string; card: PCard; blocked: string | null };

function useFor(name: string): Use | undefined {
  return abilityUses()[name];
}

/** Why this Ability can't be used right now, or null. */
function blockedReason(state: PState, seat: Seat, card: PCard, slot: PSlot | null, name: string, use: Use): string | null {
  const p = state.players[seat];
  if (slot && !has(state, slot, name)) return `${topCard(slot).name}'s Abilities aren't working right now.`;
  if (use.where === "active" && p.active !== slot) return "Only from the Active Spot.";
  if (use.where === "bench" && (!slot || p.active === slot)) return "Only from the Bench.";
  const limit = use.limit;
  const key = `ab:${card.uid}:${name}`;
  if ((limit === "first" || limit === "firstName") && state.turn > 2) return "Only during your first turn.";
  if (limit === "vstar" && p.vstarUsed) return "You've already used a VSTAR Power this game.";
  if ((limit === "name" || limit === "firstName") && (p.used ?? []).includes(`abn:${name}`)) return `You can use only 1 ${name} each turn.`;
  if (limit !== "free" && (p.used ?? []).includes(key)) return "Once per turn, and you've used it.";
  if (use.selfKo && damp(state)) return "Damp stops Abilities that Knock Out their own Pokémon.";
  return use.canPlay?.(state, seat, pseudo(card, name, card.abilities.find((a) => a.name === name)?.text ?? "")) ?? null;
}

/** The Ability buttons open to a player right now (blocked ones say why). */
export function abilityActions(state: PState, seat: Seat): AbilityAction[] {
  const p = state.players[seat];
  const list: AbilityAction[] = [];
  for (const slot of inPlay(p)) {
    const c = topCard(slot);
    for (const ab of c.abilities) {
      const use = useFor(ab.name);
      if (!use || use.from) continue;
      list.push({ id: `ab:${c.uid}:${ab.name}`, label: `Use ${ab.name} (${c.name})`, card: c, blocked: blockedReason(state, seat, c, slot, ab.name, use) });
    }
  }
  for (const [zone, where] of [
    [p.hand, "hand"],
    [p.discard, "discard"],
  ] as const) {
    for (const c of zone) {
      for (const ab of c.abilities) {
        const use = useFor(ab.name);
        if (!use || use.from !== where) continue;
        let blocked = blockedReason(state, seat, c, null, ab.name, use);
        if (!blocked) blocked = fromZoneBlock(state, seat, ab.name);
        list.push({
          id: `ab:${c.uid}:${ab.name}`,
          label: `Use ${ab.name} (${c.name} in your ${where === "hand" ? "hand" : "discard pile"})`,
          card: c,
          blocked,
        });
      }
    }
  }
  return list;
}

/** Extra conditions for Abilities used from the hand or discard pile. */
function fromZoneBlock(state: PState, seat: Seat, name: string): string | null {
  const p = state.players[seat];
  const opp = state.players[otherSeat(seat)];
  if (name === "Emergency Surfacing" && p.hand.length) return "You need to have no cards in your hand.";
  if (name === "Swelling Flash" && p.prizes.length <= opp.prizes.length) return "You need more Prize cards left than your opponent.";
  if (name === "Emergency Rotation" && !inPlay(opp).some((s) => isStage(topCard(s), 2))) return "Your opponent needs a Stage 2 Pokémon in play.";
  return null;
}

export function runAbilityAction(state: PState, seat: Seat, id: string) {
  const action = abilityActions(state, seat).find((a) => a.id === id) ?? fail("You can't use that right now.");
  if (action.blocked) fail(action.blocked);
  const [, uid, ...rest] = id.split(":");
  const name = rest.join(":");
  const use = useFor(name)!;
  const p = state.players[seat];
  const text = action.card.abilities.find((a) => a.name === name)?.text ?? "";
  markUsed(p, uid, name);
  if (use.limit === "name" || use.limit === "firstName") p.used.push(`abn:${name}`);
  if (use.limit === "vstar") p.vstarUsed = true;
  log(state, seat, `${p.name} used ${action.card.name}'s ${name}.`);
  use.play(state, seat, pseudo(action.card, name, text));
}

/** How many times this turn a player has used an Ability (for the computer's "as often as you like" limit). */
export const timesUsed = (state: PState, seat: Seat, id: string) => (state.players[seat].used ?? []).filter((u) => u === id).length;
/** Whether the computer thinks an Ability is worth using now. */
export function abilityWorth(state: PState, seat: Seat, id: string) {
  const [, uid, ...rest] = id.split(":");
  const use = useFor(rest.join(":"));
  if (!use) return false;
  if (use.limit === "free" && timesUsed(state, seat, id) >= 3) return false;
  return use.worth?.(state, seat, selfOf(state, seat, uid)) ?? true;
}

// ----- Choices -----

type Resume = (state: PState, seat: Seat, picks: string[], data: Data) => void;

export const ABILITY_RESUME: Record<string, Resume> = {
  "ab:seen"() {},
  "ab:offer"(state, seat, picks, data) {
    if (picks[0] !== "yes") return;
    const p = state.players[seat];
    const name = String(data.name);
    const kind = String(data.kind);
    if (kind === "entry" || kind === "lucky") return special(state, seat, kind, data);
    const slot = selfOf(state, seat, data.src);
    if (!slot) return;
    const c = topCard(slot);
    const text = c.abilities.find((a) => a.name === name)?.text ?? "";
    markUsed(p, c.uid, name);
    log(state, seat, `${p.name} used ${c.name}'s ${name}.`);
    if (kind === "meteor") {
      const i = p.bench.indexOf(slot);
      if (i >= 0) switchActive(p, i);
      return log(state, seat, `${c.name} switched into the Active Spot.`);
    }
    if (kind === "lustrous") return lustrousAssist().play(state, seat, pseudo(c, name, text));
    const use = abilityTriggers()[name]?.use ?? abilityUses()[name];
    use?.play(state, seat, pseudo(c, name, text));
  },
  "ab:ko move"(state, seat, picks, data) {
    const p = state.players[seat];
    const uids = (data.energy as string[]) ?? [];
    const moving = pull(p.hand, uids);
    const target = slotAt(p, picks[0] as SlotKey);
    if (target) {
      target.energy.push(...moving);
      log(state, seat, `${names(moving)} moved to ${topCard(target).name}.`);
    } else p.discard.push(...moving);
  },
  "ab:search"(state, seat, picks) {
    const p = state.players[seat];
    const got = pull(p.deck, picks);
    p.hand.push(...got);
    shuffle(p.deck);
    log(state, seat, `${p.name} put ${plural(got.length, "card")} into their hand.`);
  },
  "ab:bench from deck"(state, seat, picks) {
    const p = state.players[seat];
    for (const c of pull(p.deck, picks)) benchPokemon(state, seat, c);
    shuffle(p.deck);
    if (picks.length) log(state, seat, `${p.name} put ${plural(picks.length, "Pokémon")} onto their Bench.`);
  },
};

/** Finds the Ability that asked a choice. */
export function abilityEffect(effect: string): { resume?: Resume } | undefined {
  return abilityUses()[effect] ?? abilityTriggers()[effect]?.use;
}

// ----- Drawing and Prize cards -----

/** Emergency Entry: a Metagross drawn at the start of the turn may go straight onto the Bench. */
export function drewAtTurnStart(state: PState, seat: Seat, card: PCard) {
  if (!cardHas(card, "Emergency Entry") || benchRoom(state, seat) <= 0) return;
  askChoice(
    state,
    seat,
    `You drew ${card.name}. Use Emergency Entry to put it onto your Bench and draw 3 cards?`,
    [
      { id: "yes", label: "Use Emergency Entry" },
      { id: "no", label: "Keep it in my hand" },
    ],
    "ab:offer",
    { data: { name: "Emergency Entry", kind: "entry", card: card.uid, botPick: ["yes"] } },
  );
}

/** Lucky Bonus: a Chansey taken as a Prize card during your turn may go onto the Bench. */
export function tookPrizes(state: PState, seat: Seat, cards: PCard[]) {
  if (state.current !== seat) return;
  for (const c of cards) {
    if (!cardHas(c, "Lucky Bonus") || benchRoom(state, seat) <= 0) continue;
    askChoice(
      state,
      seat,
      `You took ${c.name} as a Prize card. Use Lucky Bonus to put it onto your Bench (and flip for another Prize card)?`,
      [
        { id: "yes", label: "Use Lucky Bonus" },
        { id: "no", label: "Keep it in my hand" },
      ],
      "ab:offer",
      { data: { name: "Lucky Bonus", kind: "lucky", card: c.uid, botPick: ["yes"] } },
    );
  }
}

function special(state: PState, seat: Seat, kind: string, data: Data) {
  const p = state.players[seat];
  const [c] = pull(p.hand, [String(data.card)]);
  if (!c) return;
  if (benchRoom(state, seat) <= 0) return void p.hand.push(c);
  benchPokemon(state, seat, c);
  if (kind === "entry") {
    draw(p, 3);
    return log(state, seat, `Emergency Entry: ${c.name} went onto the Bench and ${p.name} drew 3 cards.`);
  }
  log(state, seat, `Lucky Bonus: ${c.name} went onto the Bench.`);
  const heads = flip();
  log(state, seat, `Lucky Bonus coin flip: ${heads ? "heads" : "tails"}.`, "coin");
  if (heads && p.prizes.length) {
    const taken = p.prizes.splice(0, 1);
    p.hand.push(...taken);
    log(state, seat, `${p.name} took 1 more Prize card.`);
  }
}

/** Every Ability the rules above and ability-uses.ts handle, for the "is this automated" check. */
export const PASSIVE_ABILITIES = [
  "Vibrant Dance",
  "Multi Adapter",
  "Tune-Up",
  "Boss Pockets",
  "Swelling Tune",
  "Nutritional Iron",
  "Expanding Body",
  "Adrena-Power",
  "Crisis Muscles",
  "Craftsmanship",
  "Resilient Soul",
  "Cheering Bone",
  "Big Match",
  "Supreme Overlord",
  "Compound Eyes",
  "Cheer On to Glory",
  "Victory Cheer",
  "Powerful a-Salt",
  "Cobalt Command",
  "Sunny Day",
  "Extra Helpings",
  "Regal Cheer",
  "Primal Knowledge",
  "Lose Cool",
  "Excited Power",
  "Synchro Pulse",
  "Flare Symbol",
  "Transistor",
  "Lightning Symbol",
  "Ice Symbol",
  "Justified Law",
  "Leadership",
  "Pressure",
  "Intimidating Fang",
  "Gloomy Garbage",
  "Adverse Weather",
  "Wave Veil",
  "Spherical Shield",
  "Flower Curtain",
  "Yoga Guard",
  "Carefree Countenance",
  "Plume Protection",
  "So Submerged",
  "Storehouse Hideaway",
  "Ancient Bulwark",
  "Mimic Barrier",
  "Metal Lodging",
  "Armor Tail",
  "Heatproof",
  "Well-Baked Body",
  "Insulator",
  "Miracle Body",
  "Safeguard",
  "Mysterious Shield",
  "Mysterious Rock Inn",
  "Impervious Shell",
  "Mighty Shell",
  "Sparkling Scales",
  "Cornerstone Stance",
  "Arm Thrust Practice",
  "Protective Bell",
  "Loving Veil",
  "Primal Fortress",
  "Spirit Charm",
  "Protective DNA",
  "Gear Coating",
  "Stone Palace",
  "Curly Wall",
  "Gear Wall",
  "Crimson Armor",
  "Rock Armor",
  "Metal Shield",
  "Miraculous Armor",
  "Thick Fat",
  "Azure Seas",
  "Blooming Garden",
  "Mental Shroud",
  "Ancient Way",
  "Fairy Zone",
  "Double Type",
  "Dual Core",
  "Wild Growth",
  "Burn Brightly",
  "Metal Bridge",
  "Lunar Zone",
  "Pika Dash",
  "Flare Float",
  "Explosive Heat Dash",
  "Voltaic Float",
  "Mist Float",
  "Ice Float",
  "Vamoose",
  "Agile",
  "Melt Away",
  "In a Hungry Hurry",
  "Punk Out",
  "Skyliner",
  "Jet Cruise",
  "Secret Forest Path",
  "Carry and Climb",
  "Sludge Street",
  "Big Net",
  "Binding Flame",
  "Trap Territory",
  "Block",
  "Primordial Tentacles",
  "Quaking Zone",
  "Dazzling Gaze",
  "Primal Root",
  "Hidden Threads",
  "Food Prep",
  "Hustle Play",
  "Seasoned Skill",
  "Excited Heart",
  "Wild Style",
  "Chakra Awakening",
  "Hustle Bark",
  "Monkey Trio",
  "Lost Provisions",
  "Enthusiastic King",
  "Tuning Echo",
  "Kinda Lazy",
  "Born to Slack",
  "Power Saver",
  "Frigid Room",
  "Debut Performance",
  "Memory Dive",
  "Sudden Transformation",
  "Glistening Bubbles",
  "Plasma Bane",
  "Festival Lead",
  "Salty Body",
  "Verdant Wind",
  "Curative Bower",
  "Insomnia",
  "Electricity Pouches",
  "Poison Peak",
  "Toxic Subjugation",
  "Magma Surge",
  "Scorching Aura",
  "Stir and Snooze",
  "Poison Sacs",
  "Daunting Gaze",
  "Oceanic Curse",
  "Helical Swell",
  "Massive Body",
  "ACE Nullifier",
  "Potent Glare",
  "Adaptive Evolution",
  "Boosted Evolution",
  "Stimulated Evolution",
  "Evolutionary Advantage",
  "Rainbow DNA",
  "Hero's Spirit",
  "Explosiveness",
  "Dust Field",
  "Snow Camouflage",
  "Unnerve",
  "Wide Wall",
  "Princess's Curtain",
  "Baffling",
  "Reassuring Dam",
  "Slime Mold Colony",
  "Sand Screen",
  "Mentally Calm",
  "Stand Sentry",
  "Stellar Veil",
  "Damp",
  "Smooth Coat",
  "Primate Dexterity",
  "Drifting Dodge",
  "Expert Hider",
  "Adrena-Pheromone",
  "Tangled Feet",
  "Sturdy",
  "Resolute Heart",
  "Tenacious Body",
  "Durable Body",
  "Guts",
  "Pummeling Payback",
  "Spiteful Magic",
  "Counterattacking Pincer",
  "Needly Armor",
  "Counterattack Quills",
  "Counterattacking Crest",
  "Counterattack",
  "Automated Combat",
  "Solidarity",
  "Custom Trap",
  "Needle Line",
  "Spiteful Swirl",
  "Incandescent Body",
  "Scorching Armor",
  "Poison Point",
  "Smog Signals",
  "All Just a Dream",
  "Elder Tree Barrier",
  "Selfish Lips",
  "Fragile Husk",
  "Oh No You Don't",
  "Shadowy Concealment",
  "Greedy Eater",
  "Evanescent",
  "Shattering Crystal",
  "Wonder Kiss",
  "Startling Pumpkin",
  "Final Chain",
  "Gold Coffin",
  "Cursed Message",
  "Entrusted Wishes",
  "Let's Have a Blast",
  "Exploding Needles",
  "Photon Cord",
  "Fillet Memento",
  "Wish Connector",
  "Electrical Grounding",
  "Diver's Catch",
  "Persistent Cells",
  "Lost Block",
  "Blessed Salt",
  "Forest Miasma",
  "Sand Stream",
  "Freezing Shroud",
  "Quaking Demolition",
  "Sunny Bloom",
  "Precious Gift",
  "Auto Heal",
  "Gnawing Curse",
  "Buddy Pulse",
  "Shocking Block",
  "Far-Flying Meteor",
  "Darkest Impulse",
  "Holes",
  "Lava Zone",
  "Swirling Prose",
  "Lustrous Assist",
  "Emergency Entry",
  "Lucky Bonus",
  "Mischievous Lock",
  "Initialization",
  "Midnight Fluttering",
  "Cursed Land",
  "Sticky Bind",
  "Fettered in Misfortune",
  "Watchful Eye",
  "Freezing Disaster",
  "Amber Protection",
  "Hide 'n' Sneak",
  "Guardian of Love",
  "Unfazed Fat",
  "Protective Mycelium",
  "Emperor's Stance",
  "Cocoon Cover",
  "Flare Veil",
  "Protective Cover",
  "Unaware",
  "Repelling Veil",
  "Slimy Sliding",
  "Startling Drop",
  "Surprise Spores",
  "New Moon",
];
/** "This Pokémon takes N less damage from attacks" is read from the Ability's text (see abilityDamageTaken). */
const readsItsOwnText = (text: string) => /^This Pokémon takes \d+ less damage from attacks \(after/.test(text);

/** Whether the game carries out this Ability for you. */
export const isAutomatedAbility = (name: string, text = "") =>
  !!abilityUses()[name] || !!abilityTriggers()[name] || PASSIVE_ABILITIES.includes(name) || readsItsOwnText(text);
