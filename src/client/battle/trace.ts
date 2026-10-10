// Records how the battle engine works out each hit, so players can see the maths behind it.
//
// The engine is Pokémon Showdown's own simulator (@pkmn/sim, MIT licence). Rather than rewrite its
// damage formula, we watch it work: while it calculates a hit we note the base power, the attack
// and defence stats, every modifier an ability, item, weather or screen adds, the critical-hit
// chance and the random roll. The one function we replace, modifyDamage, is a copy of the engine's
// Gen 9 version with notes added; it gives exactly the same numbers and uses the same random rolls.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sim = any;

/** One multiplier from an ability, item, weather, screen and so on. */
export type Mod = { name: string; mult: number };

export type StatLine = {
  pokemon: string;
  stat: "Atk" | "Def" | "SpA" | "SpD";
  /** The stat on its own, from base stat, IVs, EVs, level and nature. */
  raw: number;
  /** Boost stage, -6 to +6. */
  stage: number;
  /** True when a critical hit (or Unaware and the like) ignored the stage. */
  stageIgnored: boolean;
  afterStage: number;
  mods: Mod[];
  value: number;
};

export type DamageCalc = {
  kind: "damage";
  attacker: string;
  defender: string;
  move: string;
  moveType: string;
  category: string;
  /** Which hit of a multi-hit move this is (0 for single hits). */
  hit: number;
  level: number;
  basePower: { raw: number; mods: Mod[]; value: number };
  attack: StatLine | null;
  defense: StatLine | null;
  /** floor(floor(floor(2 × Level ÷ 5 + 2) × Power × Attack ÷ Defence) ÷ 50) */
  baseDamage: number;
  spread: number | null;
  parentalBond: number | null;
  weather: Mod[];
  crit: { stage: number; chance: string; roll: number | null; always: boolean; happened: boolean };
  /** Damage before the random roll. */
  preRandom: number;
  /** The random roll as a percentage, 85 to 100. */
  roll: number;
  stab: number;
  stabNote: string;
  typeMult: number;
  /** The defender's types when it was hit (after Terastallizing). */
  defenderTypes: string[];
  defenderMaxHp: number;
  burn: boolean;
  final: { mods: Mod[]; mult: number };
  damage: number;
  /** The 16 possible results of this hit, lowest roll first, with the same crit result. */
  rolls: number[];
};

export type AccuracyCalc = {
  kind: "accuracy";
  attacker: string;
  defender: string;
  move: string;
  base: number | true;
  /** After abilities, items and weather (for example Compound Eyes, Thunder in rain). */
  modified: number | true;
  stage: number;
  /** After accuracy and evasion stages. */
  final: number | true;
  /** The random number from 0 to 99; the move hits if it's below `final`. */
  roll: number | null;
  hit: boolean;
  ohko: boolean;
};

export type Calc = DamageCalc | AccuracyCalc;

type DamageTrace = {
  stage: string | null;
  attacker: Sim;
  defender: Sim;
  move: Sim;
  mods: Record<string, Mod[]>;
  /** Raw modifiers (numerator / denominator) for the final damage event, to rebuild the rolls. */
  finalRaw: [number, number][];
  results: Record<string, any>;
  stats: StatLine[];
  critRatio: number;
  awaitCrit: boolean;
  critRoll: number | null;
  calc: Partial<DamageCalc>;
};

type AccuracyTrace = {
  pokemon: Sim;
  move: Sim;
  entries: Map<Sim, Partial<AccuracyCalc>>;
};

// Events whose modifiers belong to one step of the formula.
const STAGE_OF: Record<string, string> = {
  BasePower: "basePower",
  ModifyAtk: "attack",
  ModifySpA: "attack",
  ModifyDef: "defense",
  ModifySpD: "defense",
  WeatherModifyDamage: "weather",
  ModifyDamage: "final",
  ModifyCritRatio: "crit",
  ModifySTAB: "stab",
};

const STAT_NAME: Record<string, StatLine["stat"]> = { atk: "Atk", def: "Def", spa: "SpA", spd: "SpD" };
const CRIT_MULT = [0, 24, 8, 2, 1];

const label = (p: Sim) => (p ? `${p.side?.id === "p1" ? "" : "foe "}${p.name}` : "");
const effectName = (battle: Sim) => {
  const e = battle.effect;
  if (!e || !e.name) return "Effect";
  return e.name as string;
};

/**
 * Watches a live battle and calls `onCalc` for every accuracy check and every hit's damage.
 * Returns the index the calc should be shown at; the battle log gets a `|th-calc|n` marker line
 * where it happened so the page can put the breakdown next to the right message.
 */
export function installTracer(battle: Sim, onCalc: (calc: Calc) => number) {
  if (battle.gen !== 9) return;
  const actions = battle.actions;
  let trace: DamageTrace | null = null;
  let acc: AccuracyTrace | null = null;

  const origRunEvent = battle.runEvent;
  battle.runEvent = function (eventid: string, target?: Sim, source?: Sim, effect?: Sim, relayVar?: any, ...rest: any[]) {
    if (acc && (eventid === "ModifyAccuracy" || eventid === "Accuracy")) {
      const entry = acc.entries.get(target) ?? {};
      acc.entries.set(target, entry);
      const result = origRunEvent.call(this, eventid, target, source, effect, relayVar, ...rest);
      if (eventid === "ModifyAccuracy") {
        entry.base = relayVar;
        entry.modified = result;
      } else {
        entry.final = result;
      }
      return result;
    }
    if (!trace) return origRunEvent.call(this, eventid, target, source, effect, relayVar, ...rest);
    const stage = STAGE_OF[eventid] ?? null;
    const prev = trace.stage;
    trace.stage = stage;
    if (stage === "basePower") {
      trace.awaitCrit = false;
      trace.results.basePowerIn = relayVar;
    }
    try {
      const result = origRunEvent.call(this, eventid, target, source, effect, relayVar, ...rest);
      if (stage) trace.results[stage] = result;
      if (stage === "crit") trace.awaitCrit = true;
      return result;
    } finally {
      trace.stage = prev;
    }
  };

  const origChainModify = battle.chainModify;
  battle.chainModify = function (numerator: number | [number, number], denominator = 1) {
    if (trace?.stage) {
      const [n, d] = Array.isArray(numerator) ? numerator : [numerator, denominator];
      (trace.mods[trace.stage] ??= []).push({ name: effectName(this), mult: n / d });
      if (trace.stage === "final") trace.finalRaw.push([n, d]);
    }
    return origChainModify.call(this, numerator, denominator);
  };

  const origRandomChance = battle.randomChance;
  battle.randomChance = function (numerator: number, denominator: number) {
    const crit = trace?.awaitCrit;
    const target = acc ? this.activeTarget : null;
    if ((!crit && !target) || this.forceRandomChance !== null) return origRandomChance.call(this, numerator, denominator);
    // Same as the engine's own randomChance: one number from 0 to denominator - 1.
    const roll = this.prng.random(denominator);
    if (crit && trace) {
      trace.critRoll = roll;
      trace.awaitCrit = false;
    } else if (acc && target) {
      const entry = acc.entries.get(target) ?? {};
      entry.roll = roll;
      acc.entries.set(target, entry);
    }
    return roll < numerator;
  };

  // ---- Accuracy ----
  const origHitStepAccuracy = actions.hitStepAccuracy;
  actions.hitStepAccuracy = function (targets: Sim[], pokemon: Sim, move: Sim) {
    if (acc) return origHitStepAccuracy.call(this, targets, pokemon, move);
    acc = { pokemon, move, entries: new Map() };
    try {
      const results: boolean[] = origHitStepAccuracy.call(this, targets, pokemon, move);
      for (const [i, target] of targets.entries()) {
        const e = acc.entries.get(target);
        if (!e) continue;
        const base = move.ohko ? 30 : (e.base ?? move.accuracy);
        // Moves that can't miss here have nothing worth showing.
        const fin = e.final ?? 100;
        if (base === true || ((e.final ?? e.modified) === true && !move.ohko) || (base >= 100 && (fin === true || (typeof fin === "number" && fin >= 100)) && !move.ohko)) continue;
        const stage = Math.max(-6, Math.min(6, (move.ignoreAccuracy ? 0 : pokemon.boosts.accuracy) - (move.ignoreEvasion ? 0 : target.boosts.evasion)));
        const calc: AccuracyCalc = {
          kind: "accuracy",
          attacker: label(pokemon),
          defender: label(target),
          move: move.name,
          base,
          modified: e.modified ?? base,
          stage: e.modified === true ? 0 : stage,
          final: e.final ?? e.modified ?? base,
          roll: e.roll ?? null,
          hit: !!results[i],
          ohko: !!move.ohko,
        };
        battle.add("th-calc", String(onCalc(calc)));
      }
      return results;
    } finally {
      acc = null;
    }
  };

  // ---- Damage ----
  const origGetDamage = actions.getDamage;
  actions.getDamage = function (source: Sim, target: Sim, move: Sim, suppressMessages = false) {
    if (trace || typeof move !== "object" || !move) return origGetDamage.call(this, source, target, move, suppressMessages);
    trace = {
      stage: null,
      attacker: move.overrideOffensivePokemon === "target" ? target : source,
      defender: move.overrideDefensivePokemon === "source" ? source : target,
      move,
      mods: {},
      finalRaw: [],
      results: {},
      stats: [],
      critRatio: 0,
      awaitCrit: false,
      critRoll: null,
      calc: {},
    };
    const t = trace;
    // Note the attack and defence stats as the engine works them out.
    const watch = (p: Sim) => {
      const orig = p.calculateStat;
      p.calculateStat = function (statName: string, boost: number, modifier?: number, statUser?: Sim) {
        const value = orig.call(this, statName, boost, modifier, statUser);
        if (t.stats.length < 2 && STAT_NAME[statName]) {
          const raw = this.storedStats[statName] as number;
          t.stats.push({ pokemon: label(this), stat: STAT_NAME[statName], raw, stage: boost, stageIgnored: boost !== 0 && value === raw, afterStage: value, mods: [], value });
        }
        return value;
      };
      return () => {
        p.calculateStat = orig;
      };
    };
    const undo = [watch(t.attacker), t.defender !== t.attacker ? watch(t.defender) : () => {}];
    try {
      const result = origGetDamage.call(this, source, target, move, suppressMessages);
      if (typeof result === "number" && t.calc.preRandom !== undefined) {
        const [atk, def] = t.stats;
        if (atk) {
          atk.mods = t.mods.attack ?? [];
          atk.value = t.results.attack ?? atk.afterStage;
        }
        if (def) {
          def.mods = t.mods.defense ?? [];
          def.value = t.results.defense ?? def.afterStage;
        }
        const critRatio = Math.max(0, Math.min(4, Number(t.results.crit ?? 0)));
        const calc: DamageCalc = {
          kind: "damage",
          attacker: label(source),
          defender: label(target),
          move: move.name,
          moveType: move.type,
          category: move.category,
          hit: move.multihit || move.multihitType ? (move.hit ?? 1) : 0,
          level: source.level,
          basePower: { raw: t.calc.basePower?.raw ?? move.basePower, mods: t.mods.basePower ?? [], value: t.calc.basePower?.value ?? move.basePower },
          attack: atk ?? null,
          defense: def ?? null,
          baseDamage: t.calc.baseDamage ?? 0,
          spread: t.calc.spread ?? null,
          parentalBond: t.calc.parentalBond ?? null,
          weather: t.mods.weather ?? [],
          crit: {
            stage: Math.max(0, critRatio - 1),
            chance: move.willCrit ? "always" : critRatio ? `1 in ${CRIT_MULT[critRatio]}` : "none",
            roll: t.critRoll,
            always: !!move.willCrit,
            happened: !!target.getMoveHitData(move).crit,
          },
          preRandom: t.calc.preRandom!,
          roll: t.calc.roll!,
          stab: t.calc.stab ?? 1,
          stabNote: t.calc.stabNote ?? "",
          typeMult: t.calc.typeMult ?? 1,
          defenderTypes: target.getTypes(),
          defenderMaxHp: target.maxhp,
          burn: !!t.calc.burn,
          final: { mods: t.mods.final ?? [], mult: t.calc.final?.mult ?? 1 },
          damage: result,
          rolls: t.calc.rolls ?? [],
        };
        const n = onCalc(calc);
        if (!suppressMessages) battle.add("th-calc", String(n));
      }
      return result;
    } finally {
      undo.forEach((u) => u());
      trace = null;
    }
  };

  // Base damage, before modifiers: the engine calls modifyDamage straight after working it out,
  // so the power, attack and defence it used are already recorded.
  actions.modifyDamage = function (baseDamage: number, pokemon: Sim, target: Sim, move: Sim, suppressMessages = false) {
    const t = trace;
    const b = this.battle;
    const tr = b.trunc;
    if (t) {
      t.calc.baseDamage = baseDamage;
      // The final power is the BasePower event's result, after the Tera 60-power floor.
      const bp = t.results.basePower;
      t.calc.basePower = { raw: t.results.basePowerIn ?? move.basePower, mods: [], value: bp };
      const [atk, def] = t.stats;
      if (atk && def && t.results.basePower !== undefined) {
        // Recover the power actually used (Tera's minimum 60, Hacked Max Moves) from the formula.
        const a = t.results.attack ?? atk.afterStage;
        const d = t.results.defense ?? def.afterStage;
        for (const p of [bp, 60]) {
          if (tr(tr(tr(tr((2 * pokemon.level) / 5 + 2) * p * a) / d) / 50) === baseDamage) {
            t.calc.basePower.value = p;
            break;
          }
        }
      }
    }

    if (!move.type) move.type = "???";
    const type = move.type;
    baseDamage += 2;
    if (move.spreadHit) {
      // Multi-target modifier (doubles only)
      const spreadModifier = b.gameType === "freeforall" ? 0.5 : 0.75;
      baseDamage = b.modify(baseDamage, spreadModifier);
      if (t) t.calc.spread = spreadModifier;
    } else if (move.multihitType === "parentalbond" && move.hit > 1) {
      baseDamage = b.modify(baseDamage, 0.25);
      if (t) t.calc.parentalBond = 0.25;
    }
    // Weather modifier
    baseDamage = b.priorityEvent("WeatherModifyDamage", pokemon, target, move, baseDamage);
    // Crit: not a modifier
    const isCrit = target.getMoveHitData(move).crit;
    if (isCrit) baseDamage = tr(baseDamage * (move.critModifier || 1.5));
    // Random factor: also not a modifier. Same as the engine's randomizer(), but we keep the roll.
    const preRandom = baseDamage;
    const rollIndex = b.random(16);
    baseDamage = tr(tr(baseDamage * (100 - rollIndex)) / 100);

    // STAB. The "???" type never gets STAB.
    let stab: number | [number, number] = 1;
    let stabNote = "";
    if (type !== "???") {
      const isSTAB = move.forceSTAB || pokemon.hasType(type) || pokemon.getTypes(false, true).includes(type);
      if (isSTAB) stab = 1.5;
      if (pokemon.terastallized === "Stellar") {
        if (!pokemon.stellarBoostedTypes.includes(type) || move.stellarBoosted) {
          stab = isSTAB ? 2 : [4915, 4096];
          stabNote = "Stellar Tera";
          move.stellarBoosted = true;
          if (pokemon.species.name !== "Terapagos-Stellar") pokemon.stellarBoostedTypes.push(type);
        }
      } else {
        if (pokemon.terastallized === type && pokemon.getTypes(false, true).includes(type)) {
          stab = 2;
          stabNote = "Tera type matches an original type";
        } else if (pokemon.terastallized === type) {
          stabNote = "Tera type";
        }
        const before = stab;
        stab = b.runEvent("ModifySTAB", pokemon, target, move, stab);
        if (stab !== before && !stabNote) stabNote = pokemon.getAbility().name;
      }
      baseDamage = b.modify(baseDamage, stab);
    }
    const afterRandom = (d: number) => {
      if (type !== "???") d = b.modify(d, stab);
      return d;
    };

    // Types
    let typeMod = target.runEffectiveness(move);
    typeMod = b.clampIntRange(typeMod, -6, 6);
    target.getMoveHitData(move).typeMod = typeMod;
    if (typeMod > 0) {
      if (!suppressMessages) b.add("-supereffective", target);
      for (let i = 0; i < typeMod; i++) baseDamage *= 2;
    }
    if (typeMod < 0) {
      if (!suppressMessages) b.add("-resisted", target);
      for (let i = 0; i > typeMod; i--) baseDamage = tr(baseDamage / 2);
    }
    if (isCrit && !suppressMessages) b.add("-crit", target);

    const burned = pokemon.status === "brn" && move.category === "Physical" && !pokemon.hasAbility("guts") && move.id !== "facade";
    if (burned) baseDamage = b.modify(baseDamage, 0.5);

    // Final modifier. Modifiers that apply after the minimum damage check, such as Life Orb.
    const beforeFinal = baseDamage;
    baseDamage = b.runEvent("ModifyDamage", pokemon, target, move, baseDamage);
    const afterFinal = baseDamage;
    const bypassProtect = target.getMoveHitData(move).bypassProtect;
    if (bypassProtect) {
      baseDamage = b.modify(baseDamage, 0.25);
      if (bypassProtect !== true && bypassProtect.effectType === "Ability") b.add("-ability", pokemon, bypassProtect.name);
      b.add("-zbroken", target);
    }

    if (t) {
      // Rebuild the chained final modifier exactly as the engine does, to work out every roll.
      let chained = 1;
      for (const [n, d] of t.finalRaw) {
        const previousMod = tr(chained * 4096);
        const nextMod = tr((n * 4096) / d);
        chained = ((previousMod * nextMod + 2048) >> 12) / 4096;
      }
      const direct = chained !== 1 ? b.modify(beforeFinal, chained) : beforeFinal;
      const finish = (d: number) => {
        d = afterRandom(d);
        if (typeMod > 0) for (let i = 0; i < typeMod; i++) d *= 2;
        if (typeMod < 0) for (let i = 0; i > typeMod; i--) d = tr(d / 2);
        if (burned) d = b.modify(d, 0.5);
        // A handler that returned a number directly (rare) is scaled instead.
        d = direct === afterFinal ? (chained !== 1 ? b.modify(d, chained) : d) : beforeFinal ? Math.floor((d * afterFinal) / beforeFinal) : d;
        if (bypassProtect) d = b.modify(d, 0.25);
        return d ? tr(d, 16) : 1;
      };
      t.calc.preRandom = preRandom;
      t.calc.roll = 100 - rollIndex;
      t.calc.stab = Array.isArray(stab) ? stab[0] / stab[1] : stab;
      t.calc.stabNote = stabNote;
      t.calc.typeMult = 2 ** typeMod;
      t.calc.burn = burned;
      t.calc.final = { mods: [], mult: beforeFinal ? afterFinal / beforeFinal : 1 };
      t.calc.rolls = Array.from({ length: 16 }, (_, k) => finish(tr(tr(preRandom * (85 + k)) / 100)));
    }

    // Minimum 1 damage after the final modifier, then 16-bit truncation.
    if (!baseDamage) return 1;
    return tr(baseDamage, 16);
  };
}
