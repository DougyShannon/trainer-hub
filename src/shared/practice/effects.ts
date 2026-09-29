// Lasting card effects in practice games: what Pokémon Tools, Stadiums and "during this turn"
// Trainer cards change while they're in play. The engine and attacks ask these functions for
// HP, damage, costs and the like, and call the triggers when something happens (a Pokémon is
// damaged, Knocked Out, put on the Bench, or a turn ends).

import { otherSeat, type Seat } from "../game-types";
import { ask, draw, energyProvides, isBasicEnergy, isBasicPokemon, isPokemon, log, plural, shuffle, topCard } from "./engine";
import type { PCard, PPlayer, PSlot, PState, TurnEffect } from "./types";
import { markTotal, marksOn, matchesFilter } from "./lasting";
import { unitIs, specialAfterDamage, specialCleanup, specialDamageTaken, specialEndOfTurn, specialFromHand, specialOnKnockOut } from "./special-energy";
import {
  abilityAttackBlock,
  abilityAttackCost,
  abilityDamageBonus,
  abilityDamageTaken,
  abilityHp,
  abilityKnockOut,
  abilityRetreat,
  abilityRetreatBlock,
  abilityWeakness,
  afterAttackDamage,
  beforeAttackDamage,
  benchCap,
  benchCountersBlocked,
  benchedAbilities,
  checkupExtra,
  conditionBlocked,
  deckDam,
  endOfTurnAbilities,
  energyAttachedAbilities,
  ignoresDefenderEffects,
  lockedByAbility,
  noHealing,
  stadiumShielded,
  survives,
  toHandOnKo,
  toolCap,
  trainerProof,
} from "./abilities";

// ----- Card tests -----

export const baseName = (name: string) => name.replace(/\s*\(.*\)$/, "");
export const hasRuleBox = (c: PCard) => isPokemon(c) && c.rules.length > 0;
export const isEx = (c: PCard) => c.subtypes.includes("ex") || c.subtypes.includes("EX");
export const isV = (c: PCard) => c.subtypes.some((s) => s === "V" || s === "VMAX" || s === "VSTAR" || s === "V-UNION");
export const isMegaEx = (c: PCard) => c.subtypes.includes("MEGA") && isEx(c);
export const isTera = (c: PCard) => c.subtypes.includes("Tera");
export const isStage = (c: PCard, n: 1 | 2) => c.subtypes.includes(`Stage ${n}`);
export const ofType = (c: PCard, type: string) => c.types.includes(type);
/** "Team Rocket's", "N's", "Hop's" and so on. */
export const trainersPokemon = (c: PCard, owner: string) => isPokemon(c) && c.name.startsWith(`${owner}'s `);

/** Special cards that sit in play as if they were Basic Pokémon, like the Antique Fossils. */
export const FOSSILS = [
  "Antique Plume Fossil",
  "Antique Dome Fossil",
  "Antique Helix Fossil",
  "Antique Old Amber",
  "Antique Cover Fossil",
  "Antique Root Fossil",
  "Unidentified Fossil",
  "Snorlax Doll",
];
export const isFossil = (c: PCard) => c.supertype === "Trainer" && FOSSILS.includes(baseName(c.name));

// ----- Where things are -----

export function ownerOf(state: PState, slot: PSlot): Seat {
  const p1 = state.players.p1;
  return p1.active === slot || p1.bench.includes(slot) ? "p1" : "p2";
}
export const isActive = (state: PState, slot: PSlot) => state.players.p1.active === slot || state.players.p2.active === slot;
export const inPlay = (p: PPlayer) => [...(p.active ? [p.active] : []), ...p.bench];

export const stadiumName = (state: PState) => (state.stadium ? baseName(state.stadium.card.name) : null);
export const stadiumIs = (state: PState, name: string) => stadiumName(state) === name;

/** Every Tool card attached to a Pokémon. Most can hold one; some Abilities allow more (see toolCap). */
export const toolsOn = (slot: PSlot): PCard[] => (slot.tool ? [slot.tool, ...(slot.extraTools ?? [])] : []);
/** Everything attached to a Pokémon: its Energy and Tools. */
export const attachedTo = (slot: PSlot): PCard[] => [...slot.energy, ...toolsOn(slot)];
/** Takes one Tool off a Pokémon, leaving any others attached. */
export function removeTool(slot: PSlot, uid: string) {
  const rest = toolsOn(slot).filter((c) => c.uid !== uid);
  slot.tool = rest[0] ?? null;
  slot.extraTools = rest.slice(1);
}
export function addTool(slot: PSlot, card: PCard) {
  if (slot.tool) (slot.extraTools ??= []).push(card);
  else slot.tool = card;
}
/** Takes every Tool off a Pokémon and returns them. */
export function takeTools(slot: PSlot): PCard[] {
  const all = toolsOn(slot);
  slot.tool = null;
  slot.extraTools = [];
  return all;
}
/** Whether a Pokémon has room for another Tool. */
export const toolRoom = (state: PState, slot: PSlot) => toolsOn(slot).length < toolCap(state, slot);

/** The names of the Tools on a Pokémon that are working (Jamming Tower turns them all off). */
export function toolNames(state: PState, slot: PSlot): string[] {
  if (stadiumIs(state, "Jamming Tower")) return [];
  return toolsOn(slot).map((c) => baseName(c.name));
}
export const hasTool = (state: PState, slot: PSlot, name: string) => toolNames(state, slot).includes(name);
/** The first working Tool on a Pokémon. */
export const toolOf = (state: PState, slot: PSlot): string | null => toolNames(state, slot)[0] ?? null;

const effectsNow = (state: PState, kind: TurnEffect["kind"]) => (state.effects ?? []).filter((e) => e.kind === kind && e.turn === state.turn);

export function addEffect(state: PState, effect: TurnEffect) {
  (state.effects ??= []).push(effect);
}

/** Whether a Pokémon matches a TurnEffect's `vs` filter. */
function matchesVs(c: PCard, vs: string | undefined) {
  if (!vs) return true;
  if (vs === "ex") return isEx(c);
  if (vs === "V") return isV(c);
  if (vs === "exV") return isEx(c) || isV(c);
  if (vs === "VSTAR") return c.subtypes.some((s) => s === "VSTAR" || s === "VMAX");
  if (vs === "Tera") return isTera(c);
  if (vs === "N") return trainersPokemon(c, "N");
  return true;
}

/** Whether this Pokémon's Abilities work, before other Abilities that switch them off are counted. */
export function abilitiesBase(state: PState, slot: PSlot) {
  const c = topCard(slot);
  if (stadiumIs(state, "Team Rocket's Watchtower") && ofType(c, "Colorless")) return false;
  const owner = ownerOf(state, slot);
  if (isActive(state, slot) && effectsNow(state, "noAbilities").some((e) => e.seat !== owner)) return false;
  return true;
}
/** Whether this Pokémon's Abilities work right now (Stadiums, cards and other Abilities can switch them off). */
export const abilitiesWork = (state: PState, slot: PSlot) => abilitiesBase(state, slot) && !lockedByAbility(state, slot);
const hasAbility = (state: PState, slot: PSlot) => topCard(slot).abilities.length > 0 && abilitiesWork(state, slot);
/** The Stadium in play, as it affects this Pokémon (New Moon shields some). */
const stadiumOn = (state: PState, name: string, slot: PSlot) => stadiumIs(state, name) && !stadiumShielded(state, slot);

// The game being played, so plain helpers like heal() can check Freezing Disaster.
let playing: PState | null = null;
export const setPlaying = (state: PState | null) => {
  playing = state;
};
/** The game being played right now (for coin flips, which don't get the state passed in). */
export const flipping = () => playing;
/** Whether healing works right now. */
export const canHeal = () => !playing || !noHealing(playing);

// ----- HP -----

export function hpBonus(state: PState, slot: PSlot) {
  const c = topCard(slot);
  let bonus = 0;
  for (const tool of toolNames(state, slot))
    switch (tool) {
      case "Hero's Cape":
        bonus += 100;
        break;
      case "Big Charm":
        bonus += 30;
        break;
      case "Bravery Charm":
        if (isBasicPokemon(c)) bonus += 50;
        break;
      case "Cynthia's Power Weight":
        if (trainersPokemon(c, "Cynthia")) bonus += 70;
        break;
      case "Ancient Booster Energy Capsule":
        if (c.subtypes.includes("Ancient")) bonus += 60;
        break;
      case "Luxurious Cape":
        if (!hasRuleBox(c)) bonus += 100;
        break;
    }
  if (stadiumOn(state, "Lively Stadium", slot) && isBasicPokemon(c)) bonus += 30;
  if (stadiumOn(state, "Gravity Mountain", slot) && isStage(c, 2)) bonus -= 30;
  return bonus + abilityHp(state, slot);
}

// ----- Damage -----

/** Extra damage an attack does to the opponent's Active Pokémon, before Weakness and Resistance. */
export function damageBonus(state: PState, seat: Seat, attacker: PSlot, defender: PSlot) {
  const me = state.players[seat];
  const them = state.players[otherSeat(seat)];
  const a = topCard(attacker);
  const d = topCard(defender);
  let bonus = 0;
  for (const tool of toolNames(state, attacker))
    switch (tool) {
      case "Vitality Band":
        bonus += 10;
        break;
      case "Muscle Band":
        bonus += 20;
        break;
      case "Choice Belt":
        if (isV(d)) bonus += 30;
        break;
      case "Maximum Belt":
        if (isEx(d)) bonus += 50;
        break;
      case "Defiance Band":
        if (me.prizes.length > them.prizes.length) bonus += 30;
        break;
      case "Light Ball":
        if (baseName(a.name) === "Pikachu ex" && isEx(d)) bonus += 50;
        break;
      case "Brave Bangle":
        if (!hasRuleBox(a) && isEx(d)) bonus += 30;
        break;
      case "Future Booster Energy Capsule":
        if (a.subtypes.includes("Future")) bonus += 20;
        break;
      case "Binding Mochi":
        if (attacker.conditions.includes("poisoned")) bonus += 40;
        break;
      case "Hop's Choice Band":
        if (trainersPokemon(a, "Hop")) bonus += 30;
        break;
    }
  if (stadiumOn(state, "Practice Studio", attacker) && isStage(a, 1)) bonus += 10;
  if (stadiumOn(state, "Postwick", attacker) && trainersPokemon(a, "Hop")) bonus += 30;
  for (const e of effectsNow(state, "damageUp")) {
    if (e.seat === seat && (!e.type || ofType(a, e.type)) && matchesVs(d, e.vs)) bonus += e.amount ?? 0;
  }
  bonus += markTotal(state, attacker, "dmgUp") - markTotal(state, attacker, "dmgDown");
  return bonus + abilityDamageBonus(state, seat, attacker, defender);
}

/** How Weakness applies: "none" (Protective Goggles), or the multiplier. */
export function weaknessFactor(state: PState, attacker: PSlot, defender: PSlot): number {
  if (hasTool(state, defender, "Protective Goggles") && isBasicPokemon(topCard(defender))) return 0;
  const byAbility = abilityWeakness(state, attacker, defender);
  if (byAbility !== null) return byAbility;
  return hasTool(state, attacker, "Supereffective Glasses") ? 3 : 2;
}

const BERRIES: Record<string, string> = {
  "Occa Berry": "Fire",
  "Payapa Berry": "Psychic",
  "Babiri Berry": "Metal",
  "Colbur Berry": "Darkness",
  "Passho Berry": "Water",
  "Haban Berry": "Dragon",
};

/**
 * Damage after the defender's Tools, the Stadium and effects like Jasmine's Gaze, applied after
 * Weakness and Resistance. Doesn't change anything (so the computer can use it to plan).
 */
export function damageTaken(state: PState, seat: Seat, attacker: PSlot, defender: PSlot, damage: number) {
  if (damage <= 0) return 0;
  // Azure Seas: effects on the opponent's Active Pokémon don't change this attacker's damage.
  if (ignoresDefenderEffects(state, attacker, defender)) return damage;
  const a = topCard(attacker);
  const d = topCard(defender);
  const owner = otherSeat(seat);
  const mine = state.players[owner];
  const theirs = state.players[seat];
  // Prevented completely.
  if (defender.effects.exProof === state.turn && isEx(a)) return 0;
  if (marksOn(state, defender, "prevent").some((m) => matchesFilter(state, attacker, m.data) && (m.amount === undefined || damage <= m.amount))) return 0;
  if (stadiumOn(state, "Neutralization Zone", defender) && !hasRuleBox(d) && (isEx(a) || isV(a))) return 0;
  const tool = (name: string) => hasTool(state, defender, name);
  if (tool("Panic Mask") && hpLeft(state, attacker) <= 40) return 0;
  let less = 0;
  if (tool("Pot Helmet") && !hasRuleBox(d)) less += 30;
  if (tool("Rock Chestplate") && ofType(d, "Fighting")) less += 30;
  if (tool("Rigid Band") && isStage(d, 1)) less += 30;
  if (tool("Thick Scale") && ofType(d, "Dragon") && ["Grass", "Fire", "Water", "Lightning"].some((t) => ofType(a, t))) less += 50;
  if (tool("Sacred Charm") && hasAbility(state, attacker)) less += 30;
  if (tool("Defiance Vest") && mine.prizes.length > theirs.prizes.length) less += 40;
  for (const t of toolNames(state, defender)) if (BERRIES[t] && ofType(a, BERRIES[t])) less += 60;
  if (stadiumOn(state, "Granite Cave", defender) && trainersPokemon(d, "Steven")) less += 30;
  if (stadiumOn(state, "Full Metal Lab", defender) && ofType(d, "Metal")) less += 30;
  if (stadiumOn(state, "Lake Acuity", defender) && defender.energy.some((e) => energyProvides(e, state).some((t) => unitIs(t, "Water") || unitIs(t, "Fighting"))))
    less += 20;
  for (const e of effectsNow(state, "damageDown")) {
    if (e.seat === owner && (!e.type || ofType(d, e.type)) && matchesVs(a, e.vs)) less += e.amount ?? 0;
  }
  for (const m of marksOn(state, defender, "takesLess")) if (matchesFilter(state, attacker, m.data)) less += m.amount ?? 0;
  less += specialDamageTaken(state, attacker, defender);
  const taken = abilityDamageTaken(state, seat, attacker, defender, Math.max(0, damage - less));
  return taken > 0 ? taken + markTotal(state, defender, "takesMore") : taken;
}

/**
 * Puts an attack's damage on a Pokémon and runs what happens when a Pokémon is damaged:
 * Survival Brace, Berries, Rocky Helmet and the rest. `damage` is already final.
 */
export function hitWithAttack(state: PState, seat: Seat, attacker: PSlot, defender: PSlot, damage: number) {
  const oppSeat = otherSeat(seat);
  const opp = state.players[oppSeat];
  const me = state.players[seat];
  const a = topCard(attacker);
  const d = topCard(defender);
  const fullHp = defender.damage === 0;
  const wasActive = opp.active === defender;
  damage = beforeAttackDamage(state, seat, attacker, defender, damage);
  const names = toolNames(state, defender);
  const tool = (name: string) => names.includes(name);
  const discardTool = (name: string) => {
    const card = toolsOn(defender).find((c) => baseName(c.name) === name);
    if (!card) return;
    log(state, oppSeat, `${card.name} was discarded from ${d.name}.`);
    opp.discard.push(card);
    removeTool(defender, card.uid);
  };
  // A Berry is used up even when it soaks up all the damage.
  for (const berry of names.filter((t) => BERRIES[t] && ofType(a, BERRIES[t]))) {
    log(state, oppSeat, `${berry} softened the blow.`);
    discardTool(berry);
  }
  if (damage <= 0) return;
  defender.damage += damage;
  const endure = marksOn(state, defender, "endure")[0];
  if (endure && fullHp && defender.damage >= maxHp(state, defender)) {
    defender.damage = maxHp(state, defender) - (endure.amount ?? 10);
    log(state, oppSeat, `${endure.source ?? "An attack's effect"} kept ${d.name} in play.`);
  }
  for (const m of marksOn(state, defender, "counter")) {
    const n = m.amount ?? damage / 10;
    attacker.damage += n * 10;
    log(state, oppSeat, `${m.source ?? d.name} put ${plural(n, "damage counter")} on ${a.name}.`);
  }
  specialAfterDamage(state, seat, attacker, defender);
  survives(state, seat, defender, fullHp);
  afterAttackDamage(state, seat, attacker, defender, wasActive, fullHp);
  if (tool("Survival Brace") && fullHp && defender.damage >= maxHp(state, defender)) {
    defender.damage = maxHp(state, defender) - 10;
    log(state, oppSeat, `Survival Brace kept ${d.name} in play with 10 HP.`);
    discardTool("Survival Brace");
    return;
  }
  if (tool("Box of Disaster") && fullHp && isV(d) && defender.damage >= maxHp(state, defender)) {
    attacker.damage += 80;
    log(state, oppSeat, `Box of Disaster put 8 damage counters on ${a.name}.`);
  }
  if (!wasActive) return;
  for (const t of names)
    switch (t) {
      case "Rocky Helmet":
        attacker.damage += 20;
        log(state, oppSeat, `Rocky Helmet put 2 damage counters on ${a.name}.`);
        break;
      case "Punk Helmet":
        if (ofType(d, "Darkness")) {
          attacker.damage += 40;
          log(state, oppSeat, `Punk Helmet put 4 damage counters on ${a.name}.`);
        }
        break;
      case "Team Rocket's Hypnotizer":
        if (trainersPokemon(d, "Team Rocket")) {
          setCondition(state, attacker, "asleep");
          log(state, oppSeat, `Team Rocket's Hypnotizer made ${a.name} fall Asleep.`);
        }
        break;
      case "Adversity Policy":
        if (d.weaknesses.some((w) => a.types.includes(w.type))) {
          draw(opp, 3);
          log(state, oppSeat, `Adversity Policy: ${opp.name} drew 3 cards.`);
        }
        break;
      case "Tremendous Bomb":
        if (!isMegaEx(d) && isMegaEx(a) && damage >= 240) {
          attacker.damage += 120;
          log(state, oppSeat, `Tremendous Bomb put 12 damage counters on ${a.name}.`);
          discardTool(t);
        }
        break;
      case "Deluxe Bomb":
        attacker.damage += 120;
        log(state, oppSeat, `Deluxe Bomb put 12 damage counters on ${a.name}.`);
        discardTool(t);
        break;
      case "Lucky Helmet":
        draw(opp, 2);
        log(state, oppSeat, `Lucky Helmet: ${opp.name} drew 2 cards.`);
        break;
      case "Handheld Fan":
        if (attacker.energy.length && me.bench.length) {
          ask(state, {
            seat: oppSeat,
            title: `Handheld Fan: choose 1 of ${me.name}'s Benched Pokémon to move an Energy from ${a.name} to`,
            zone: "oppBench",
            options: me.bench.map((_, i) => `bench:${i}`),
            min: 1,
            max: 1,
            effect: "fx:Handheld Fan",
          });
        }
        break;
    }
}

/** Damage counters put on a Pokémon by an effect (not attack damage), e.g. Venture Bomb. */
export function putCounters(state: PState, seat: Seat, slot: PSlot, counters: number) {
  const owner = ownerOf(state, slot);
  // Battle Cage protects Benched Pokémon from the other player's effects.
  if (stadiumOn(state, "Battle Cage", slot) && owner !== seat && !isActive(state, slot)) {
    log(state, seat, `Battle Cage stopped the damage counters on ${topCard(slot).name}.`);
    return;
  }
  if (benchCountersBlocked(state, seat, slot)) {
    log(state, seat, `Stellar Veil stopped the damage counters on ${topCard(slot).name}.`);
    return;
  }
  slot.damage += counters * 10;
}

// ----- HP left, costs and conditions -----

export const maxHp = (state: PState, slot: PSlot) => Math.max(10, (topCard(slot).hp ?? 0) + hpBonus(state, slot));
export const hpLeft = (state: PState, slot: PSlot) => maxHp(state, slot) - slot.damage;

export function retreatCost(state: PState, slot: PSlot) {
  const c = topCard(slot);
  const tool = (name: string) => hasTool(state, slot, name);
  if (tool("Big Air Balloon") && isStage(c, 2)) return 0;
  if (tool("Future Booster Energy Capsule") && c.subtypes.includes("Future")) return 0;
  if (tool("Rescue Board") && hpLeft(state, slot) <= 30) return 0;
  if (stadiumOn(state, "N's Castle", slot) && trainersPokemon(c, "N")) return 0;
  let cost = c.retreat + (slot.effects.retreatTax === state.turn ? 1 : 0);
  if (tool("Air Balloon")) cost -= 2;
  if (tool("Rescue Board")) cost -= 1;
  if (stadiumOn(state, "Beach Court", slot) && isBasicPokemon(c)) cost -= 1;
  if (stadiumOn(state, "Calamitous Wasteland", slot) && isBasicPokemon(c) && !ofType(c, "Fighting")) cost += 1;
  if (stadiumOn(state, "Paradise Resort", slot) && baseName(c.name) === "Psyduck") cost -= 1;
  if (isActive(state, slot) && [state.players.p1.active, state.players.p2.active].some((s) => s && hasTool(state, s, "Gravity Gemstone"))) cost += 1;
  return abilityRetreat(state, slot, Math.max(0, cost));
}

/** Why a Pokémon can't retreat because of a card, or null. */
export function retreatBlock(state: PState, seat: Seat, slot: PSlot): string | null {
  if (isFossil(topCard(slot))) return `${topCard(slot).name} can't retreat.`;
  if (slot.conditions.includes("poisoned") && effectsNow(state, "poisonNoRetreat").some((e) => e.seat !== seat)) {
    return "Roxie's Performance stops Poisoned Pokémon retreating this turn.";
  }
  if (state.players[seat].active === slot) return abilityRetreatBlock(state, seat);
  return null;
}

/** An attack's Energy cost after Tools, the Stadium and attack effects. */
export function attackCost(state: PState, slot: PSlot, attack: { name?: string; cost: string[] }) {
  const c = topCard(slot);
  const owner = ownerOf(state, slot);
  const cost = attack.cost.filter((x) => x !== "Free");
  const lessColorless = () => {
    const i = cost.lastIndexOf("Colorless");
    if (i >= 0) cost.splice(i, 1);
  };
  const tool = (name: string) => hasTool(state, slot, name);
  if (tool("Counter Gain") && state.players[owner].prizes.length > state.players[otherSeat(owner)].prizes.length) lessColorless();
  if (tool("Hop's Choice Band") && trainersPokemon(c, "Hop")) lessColorless();
  if (tool("Sparkling Crystal") && isTera(c) && cost.length) {
    const i = cost.lastIndexOf("Colorless");
    cost.splice(i >= 0 ? i : cost.length - 1, 1);
  }
  if (stadiumOn(state, "Nighttime Mine", slot) && isTera(c)) cost.push("Colorless");
  if (stadiumOn(state, "Pokémon League Headquarters", slot) && isBasicPokemon(c)) cost.push("Colorless");
  if (slot.effects.attackTax === state.turn) cost.push("Colorless");
  for (let i = 0; i < markTotal(state, slot, "costMore"); i++) cost.push("Colorless");
  abilityAttackCost(state, slot, attack, cost);
  return cost;
}

/** Why a card stops this Pokémon attacking, or null. */
export function attackBlock(state: PState, seat: Seat): string | null {
  if (effectsNow(state, "noAttack").some((e) => e.seat === seat)) return "Geeta stops your Pokémon attacking this turn.";
  return abilityAttackBlock(state, seat);
}

/** Whether Special Conditions can't touch this Pokémon right now. */
export function conditionProof(state: PState, slot: PSlot) {
  const c = topCard(slot);
  if (isFossil(c)) return true;
  if (hasTool(state, slot, "Ancient Booster Energy Capsule") && c.subtypes.includes("Ancient")) return true;
  if (stadiumOn(state, "Festival Grounds", slot) && slot.energy.length) return true;
  return false;
}

/** Asleep, Confused and Paralyzed replace each other; Poisoned and Burned stack. */
export function setCondition(state: PState, slot: PSlot, condition: PSlot["conditions"][number]) {
  if (conditionProof(state, slot) || conditionBlocked(state, slot, condition)) return;
  if (["asleep", "confused", "paralyzed"].includes(condition)) {
    slot.conditions = slot.conditions.filter((c) => !["asleep", "confused", "paralyzed"].includes(c));
  }
  if (!slot.conditions.includes(condition)) slot.conditions.push(condition);
}

/** Clears Special Conditions from Pokémon that can't have them (checked whenever the game settles). */
export function cleanse(state: PState) {
  specialCleanup(state);
  for (const p of [state.players.p1, state.players.p2]) {
    for (const slot of inPlay(p)) {
      // A Pokémon that lost the Ability letting it hold several Tools keeps only one.
      while (slot.extraTools?.length && toolsOn(slot).length > toolCap(state, slot)) {
        const extra = slot.extraTools.pop()!;
        p.discard.push(extra);
        log(state, null, `${extra.name} was discarded from ${topCard(slot).name}.`);
      }
      if (!slot.conditions.length) continue;
      if (conditionProof(state, slot)) slot.conditions = [];
      else slot.conditions = slot.conditions.filter((c) => !conditionBlocked(state, slot, c));
    }
  }
}

/** Whether the Active Pokémon can attack even while Asleep or Paralyzed. */
export const ignoresSleep = (state: PState, slot: PSlot) => hasTool(state, slot, "Windup Arm");

/** Extra Poison damage from Perilous Jungle. */
export const poisonExtra = (state: PState, slot: PSlot) =>
  (stadiumOn(state, "Perilous Jungle", slot) && !ofType(topCard(slot), "Darkness") ? 20 : 0) + checkupExtra(state, slot, "poisoned");
/** Extra Burn damage from Abilities like Magma Surge. */
export const burnExtra = (state: PState, slot: PSlot) => checkupExtra(state, slot, "burned");

/** Confusion stays through evolving on Dizzying Valley. */
export const keepsConfusion = (state: PState) => stadiumIs(state, "Dizzying Valley");

/** Grass Pokémon can evolve the turn they're played on Forest of Vitality. */
export const evolvesSameTurn = (state: PState, slot: PSlot, card: PCard) =>
  stadiumIs(state, "Forest of Vitality") && ofType(card, "Grass") && ofType(topCard(slot), "Grass");

/** Temple of Sinnoh turns Special Energy into plain Colorless Energy. */
export const specialEnergyOff = (state: PState | undefined) => !!state && stadiumIs(state, "Temple of Sinnoh");

/** Cards in this player's deck can't be discarded by the opponent's effects (Patrol Cap). */
export const deckGuarded = (state: PState, seat: Seat) => {
  const a = state.players[seat].active;
  return (!!a && hasTool(state, a, "Patrol Cap")) || deckDam(state, seat);
};

/** Leafy Camo Poncho: the opponent's Supporters can't affect this Pokémon VSTAR or VMAX. */
export const supporterProof = (state: PState, slot: PSlot) =>
  (hasTool(state, slot, "Leafy Camo Poncho") && topCard(slot).subtypes.some((s) => s === "VSTAR" || s === "VMAX")) || trainerProof(state, slot, "Supporter");

// ----- The Bench -----

export function benchLimit(state: PState, seat: Seat) {
  let limit = 5;
  if (stadiumIs(state, "Collapsed Stadium")) limit = 4;
  else if (stadiumIs(state, "Area Zero Underdepths") && inPlay(state.players[seat]).some((s) => isTera(topCard(s)))) limit = 8;
  const cap = benchCap(state, seat);
  return cap === null ? limit : Math.min(limit, cap);
}

/** Players with more Benched Pokémon than they're allowed discard down to the limit. */
export function trimBenches(state: PState) {
  if (state.prompt) return;
  const first = state.stadium?.owner ?? state.current;
  for (const seat of [first, otherSeat(first)]) {
    const p = state.players[seat];
    const extra = p.bench.length - benchLimit(state, seat);
    if (extra > 0) {
      ask(state, {
        seat,
        title: `You can have only ${benchLimit(state, seat)} Benched Pokémon. Choose ${plural(extra, "Pokémon")} to discard`,
        zone: "myBench",
        options: p.bench.map((_, i) => `bench:${i}`),
        min: extra,
        max: extra,
        effect: "fx:trim bench",
      });
      return;
    }
  }
}

/** Stadiums that hurt Basic Pokémon as they're put onto the Bench. */
export function onBenched(state: PState, seat: Seat, slot: PSlot, fromHand: boolean) {
  const c = topCard(slot);
  if (!isBasicPokemon(c)) return;
  const hurt =
    (stadiumOn(state, "Risky Ruins", slot) && state.current === seat && !ofType(c, "Darkness")) || (stadiumOn(state, "Gapejaw Bog", slot) && fromHand);
  if (hurt) {
    slot.damage += 20;
    log(state, seat, `${stadiumName(state)} put 2 damage counters on ${c.name}.`);
  }
  if (fromHand) benchedAbilities(state, seat, slot);
}

/** Calamitous Snowy Mountain hurts Basic non-Water Pokémon when Energy is attached from the hand. */
export function onEnergyFromHand(state: PState, seat: Seat, slot: PSlot, card?: PCard) {
  const c = topCard(slot);
  for (const m of marksOn(state, slot, "onEnergy")) {
    if (m.data === "counters") {
      slot.damage += (m.amount ?? 0) * 10;
      log(state, seat, `${m.source ?? "An attack's effect"} put ${plural(m.amount ?? 0, "damage counter")} on ${c.name}.`);
    } else if (m.data === "sleep") {
      setCondition(state, slot, "asleep");
      log(state, seat, `${m.source ?? "An attack's effect"}: ${c.name} is now Asleep.`);
    } else if (m.data === "endTurn") {
      log(state, seat, `${m.source ?? "An attack's effect"} ends ${state.players[seat].name}'s turn.`);
      state.pendingEnd = true;
    }
  }
  if (card) specialFromHand(state, seat, slot, card);
  if (stadiumOn(state, "Calamitous Snowy Mountain", slot) && isBasicPokemon(c) && !ofType(c, "Water")) {
    slot.damage += 20;
    log(state, seat, `Calamitous Snowy Mountain put 2 damage counters on ${c.name}.`);
  }
  energyAttachedAbilities(state, seat, slot);
}

// ----- Knock Outs -----

/**
 * Runs just before a Knocked Out Pokémon leaves play. Returns how many Prize cards the other
 * player takes for it (after Luxurious Cape, Lillie's Pearl, Briar and so on).
 */
export function beforeKnockOut(state: PState, seat: Seat, slot: PSlot, basePrizes: number) {
  const p = state.players[seat];
  const takerSeat = otherSeat(seat);
  const taker = state.players[takerSeat];
  const c = topCard(slot);
  const byAttack = state.attacking === takerSeat;
  const wasActive = p.active === slot;
  const attacker = taker.active;
  let prizes = baseName(c.name) === "Snorlax Doll" ? 0 : basePrizes;
  const tool = (name: string) => hasTool(state, slot, name);

  p.koNames = [...(p.koTurn === state.turn ? (p.koNames ?? []) : []), c.name];
  p.koTurn = state.turn;

  if (byAttack) {
    if (tool("Luxurious Cape") && !hasRuleBox(c)) prizes += 1;
    if (tool("Lillie's Pearl") && trainersPokemon(c, "Lillie")) prizes = Math.max(0, prizes - 1);
    if (wasActive && attacker) {
      for (const e of effectsNow(state, "morePrizes")) {
        if (e.seat !== takerSeat || !matchesVs(topCard(attacker), e.vs)) continue;
        if (e.source === "Star Order" && !c.subtypes.some((s) => s === "VSTAR" || s === "VMAX")) continue;
        prizes += e.amount ?? 0;
        log(state, takerSeat, `${e.source}: ${taker.name} takes ${plural(e.amount ?? 0, "more Prize card")}.`);
      }
    }
    if (tool("Vengeful Punch") && attacker) {
      attacker.damage += 40;
      log(state, seat, `Vengeful Punch put 4 damage counters on ${topCard(attacker).name}.`);
    }
    if (tool("Cursed Duster") && taker.hand.length) {
      const [gone] = taker.hand.splice(Math.floor(Math.random() * taker.hand.length), 1);
      taker.discard.push(gone);
      log(state, seat, `Cursed Duster discarded ${gone.name} from ${taker.name}'s hand.`);
    }
    if (tool("Amulet of Hope") && p.deck.length) {
      ask(state, {
        seat,
        title: "Amulet of Hope: choose up to 3 cards from your deck to put into your hand",
        zone: "deck",
        options: p.deck.map((x) => x.uid),
        min: 0,
        max: 3,
        effect: "fx:Amulet of Hope",
      });
    }
    if (wasActive) {
      const share = p.bench.findIndex((s) => hasTool(state, s, "Exp. Share"));
      const basic = slot.energy.find(isBasicEnergy);
      if (share >= 0 && basic) {
        slot.energy.splice(slot.energy.indexOf(basic), 1);
        p.bench[share].energy.push(basic);
        log(state, seat, `Exp. Share moved ${basic.name} to ${topCard(p.bench[share]).name}.`);
      }
      if (tool("Heavy Baton") && c.retreat === 4 && p.bench.length) {
        const moving = slot.energy.filter(isBasicEnergy).slice(0, 3);
        if (moving.length) {
          for (const e of moving) slot.energy.splice(slot.energy.indexOf(e), 1);
          ask(state, {
            seat,
            title: `Heavy Baton: choose a Benched Pokémon to move ${plural(moving.length, "Basic Energy")} to`,
            zone: "myBench",
            options: p.bench.map((_, i) => `bench:${i}`),
            min: 1,
            max: 1,
            effect: "fx:Heavy Baton",
            data: { energy: moving.map((e) => e.uid) },
          });
          // Keep the Energy safe from the discard until it's moved.
          p.hand.push(...moving);
        }
      }
    }
  }
  for (const m of marksOn(state, slot, "prizes")) prizes = m.amount === -99 ? 0 : Math.max(0, prizes + (m.amount ?? 0));
  prizes = specialOnKnockOut(state, seat, slot, prizes, byAttack);
  return abilityKnockOut(state, seat, slot, prizes, byAttack);
}

/** Where a Knocked Out Pokémon's cards go (Lost City sends the Pokémon to the Lost Zone). */
export function knockOutTo(state: PState, p: PPlayer, slot: PSlot) {
  const attached = attachedTo(slot);
  if (toHandOnKo(state, slot)) {
    p.hand.push(...slot.pokemon);
    p.discard.push(...attached);
    log(state, null, `Persistent Cells put ${topCard(slot).name} back into its owner's hand.`);
  } else if (stadiumIs(state, "Lost City")) {
    (p.lost ??= []).push(...slot.pokemon);
    p.discard.push(...attached);
  } else {
    p.discard.push(...slot.pokemon, ...attached);
  }
}

// ----- The end of a turn -----

export function endOfTurn(state: PState) {
  const seat = state.current;
  const p = state.players[seat];
  endOfTurnAbilities(state);
  specialEndOfTurn(state, seat);
  const active = p.active;
  if (active) {
    const tool = (name: string) => hasTool(state, active, name);
    if (tool("Leftovers") && active.damage && canHeal()) {
      active.damage = Math.max(0, active.damage - 20);
      log(state, seat, `Leftovers healed 20 damage from ${topCard(active).name}.`);
    }
    if (tool("Powerglass")) {
      const e = p.discard.find(isBasicEnergy);
      if (e) {
        p.discard.splice(p.discard.indexOf(e), 1);
        active.energy.push(e);
        log(state, seat, `Powerglass attached ${e.name} from the discard pile to ${topCard(active).name}.`);
      }
    }
  }
  // Technical Machines are discarded at the end of their owner's turn.
  for (const slot of inPlay(p)) {
    for (const tm of toolsOn(slot).filter((c) => baseName(c.name).startsWith("Technical Machine"))) {
      log(state, seat, `${tm.name} was discarded from ${topCard(slot).name}.`);
      p.discard.push(tm);
      removeTool(slot, tm.uid);
    }
  }
  for (const s of [seat, otherSeat(seat)]) {
    for (const slot of inPlay(state.players[s])) {
      const jelly = toolsOn(slot).find((c) => baseName(c.name) === "Emergency Jelly");
      if (jelly && hasTool(state, slot, "Emergency Jelly") && slot.damage && hpLeft(state, slot) <= 30 && canHeal()) {
        slot.damage = Math.max(0, slot.damage - 120);
        log(state, s, `Emergency Jelly healed ${topCard(slot).name} and was discarded.`);
        state.players[s].discard.push(jelly);
        removeTool(slot, jelly.uid);
      }
    }
  }
  if (effectsNow(state, "discardHandAt5").some((e) => e.seat === seat) && p.hand.length >= 5) {
    p.discard.push(...p.hand.splice(0));
    log(state, seat, `Amarys: ${p.name} had 5 or more cards, so they discarded their hand.`);
  }
  // Drop effects that have run their course.
  state.effects = (state.effects ?? []).filter((e) => e.turn > state.turn);
}

/** Every Pokémon Tool the rules above handle. */
export const AUTOMATED_TOOLS = [
  "Vitality Band",
  "Muscle Band",
  "Choice Belt",
  "Maximum Belt",
  "Defiance Band",
  "Hero's Cape",
  "Big Charm",
  "Bravery Charm",
  "Rocky Helmet",
  "Exp. Share",
  "Air Balloon",
  "Punk Helmet",
  "Sacred Charm",
  "Counter Gain",
  "Light Ball",
  "Team Rocket's Hypnotizer",
  "Thick Scale",
  "Adversity Policy",
  "Backtrack Badge",
  "Tremendous Bomb",
  "Brave Bangle",
  "Rock Chestplate",
  "Cynthia's Power Weight",
  "Patrol Cap",
  "Vengeful Punch",
  "Big Air Balloon",
  "Leftovers",
  "Protective Goggles",
  "Rigid Band",
  "Ancient Booster Energy Capsule",
  "Cursed Duster",
  "Defiance Vest",
  "Future Booster Energy Capsule",
  "Luxurious Cape",
  "Heavy Baton",
  "Rescue Board",
  "Handheld Fan",
  "Lucky Helmet",
  "Survival Brace",
  "Binding Mochi",
  "Powerglass",
  "Deluxe Bomb",
  "Gravity Gemstone",
  "Sparkling Crystal",
  "Amulet of Hope",
  "Hop's Choice Band",
  "Lillie's Pearl",
  "Supereffective Glasses",
  "Box of Disaster",
  "Panic Mask",
  "Windup Arm",
  "Earthen Seal Stone",
  "Emergency Jelly",
  "Forest Seal Stone",
  "Leafy Camo Poncho",
  "Sky Seal Stone",
  "Pot Helmet",
  ...Object.keys(BERRIES),
];
export const isAutomatedTool = (name: string) => AUTOMATED_TOOLS.includes(name) || name.startsWith("Technical Machine");

// ----- Choices these effects ask for -----

type Resume = (state: PState, seat: Seat, picks: string[], data: Record<string, unknown>) => void;
const benchIndex = (key: string) => Number(key.split(":")[1]);

export const EFFECT_RESUME: Record<string, Resume> = {
  "fx:Handheld Fan"(state, seat, picks) {
    const them = state.players[otherSeat(seat)];
    const target = them.bench[benchIndex(picks[0])];
    const attacker = them.active;
    if (!target || !attacker || !attacker.energy.length) return;
    const e = attacker.energy.pop()!;
    target.energy.push(e);
    log(state, seat, `Handheld Fan moved ${e.name} from ${topCard(attacker).name} to ${topCard(target).name}.`);
  },
  "fx:Amulet of Hope"(state, seat, picks) {
    const p = state.players[seat];
    const found = p.deck.filter((c) => picks.includes(c.uid));
    p.deck = p.deck.filter((c) => !picks.includes(c.uid));
    p.hand.push(...found);
    shuffle(p.deck);
    log(state, seat, `Amulet of Hope: ${p.name} put ${plural(found.length, "card")} into their hand.`);
  },
  "fx:Heavy Baton"(state, seat, picks, data) {
    const p = state.players[seat];
    const target = p.bench[benchIndex(picks[0])];
    const uids = (data.energy as string[]) ?? [];
    const moving = p.hand.filter((c) => uids.includes(c.uid));
    p.hand = p.hand.filter((c) => !uids.includes(c.uid));
    if (target) target.energy.push(...moving);
    else p.discard.push(...moving);
    if (target) log(state, seat, `Heavy Baton moved ${plural(moving.length, "Energy")} to ${topCard(target).name}.`);
  },
  "fx:trim bench"(state, seat, picks) {
    const p = state.players[seat];
    const gone = picks.map((k) => p.bench[benchIndex(k)]).filter(Boolean);
    for (const slot of gone) {
      p.bench.splice(p.bench.indexOf(slot), 1);
      p.discard.push(...slot.pokemon, ...slot.energy, ...(slot.tool ? [slot.tool] : []));
    }
    log(state, seat, `${p.name} discarded ${gone.map((s) => topCard(s).name).join(", ")} from their Bench.`);
  },
};
