// "What if" maths on a scratch copy of the battle: how much would this move do, would it hit, who
// is faster. The move buttons use it to show damage ranges, and the computer player uses it to
// choose. Working on a copy means nothing here can change the real battle.

import { State } from "@pkmn/sim";
import { installTracer, type DamageCalc } from "./trace";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sim = any;

export type Estimate = {
  /** Lowest and highest damage of one hit, without a critical hit. */
  min: number;
  max: number;
  /** Damage as a share of the target's current HP (can be over 1). */
  minPct: number;
  maxPct: number;
  /** Hits for multi-hit moves, e.g. [2, 5]. */
  hits: [number, number];
  immune: boolean;
  /** Chance to hit, 0 to 100, or true for moves that never miss. */
  accuracy: number | true;
  calc: DamageCalc | null;
  moveType: string;
  category: string;
  priority: number;
};

/** A Pokémon in the battle, found by side and its place in that side's team list. */
export type Ref = { side: number; index: number };

export class Lab {
  readonly battle: Sim;
  private last: DamageCalc | null = null;

  constructor(live: Sim) {
    this.battle = State.deserializeBattle(State.serializeBattle(live));
    this.battle.restart(() => {});
    installTracer(this.battle, (calc) => {
      if (calc.kind === "damage") this.last = calc;
      return 0;
    });
    // Nothing on the copy should ever be shown or sent anywhere.
    this.battle.add = () => {};
    this.battle.hint = () => {};
  }

  mon(ref: Ref): Sim {
    return this.battle.sides[ref.side].pokemon[ref.index];
  }

  /** Damage `moveId` would do from one Pokémon to another right now. */
  damage(attacker: Ref, defender: Ref, moveId: string, opts: { tera?: boolean; spread?: boolean } = {}): Estimate | null {
    const b = this.battle;
    const source = this.mon(attacker);
    const target = this.mon(defender);
    if (!source || !target || target.fainted) return null;
    const savedTera = source.terastallized;
    if (opts.tera && source.teraType && !source.terastallized) source.terastallized = source.teraType;
    try {
      let move = b.dex.getActiveMove(moveId);
      if (!move.exists && !move.id) return null;
      b.activeMove = null;
      b.singleEvent("ModifyType", move, null, source, target, move, move);
      b.singleEvent("ModifyMove", move, null, source, target, move, move);
      move = b.runEvent("ModifyType", source, target, move, move) || move;
      move = b.runEvent("ModifyMove", source, target, move, move) || move;
      const priority = b.runEvent("ModifyPriority", source, target, move, move.priority) ?? move.priority;
      const accuracy = this.accuracy(source, target, move);
      if (move.category === "Status") {
        return { min: 0, max: 0, minPct: 0, maxPct: 0, hits: [1, 1], immune: !target.runImmunity(move), accuracy, calc: null, moveType: move.type, category: move.category, priority };
      }
      move.willCrit = false;
      if (opts.spread) move.spreadHit = true;
      const hits: [number, number] = Array.isArray(move.multihit)
        ? source.hasAbility("skilllink")
          ? [move.multihit[1], move.multihit[1]]
          : (move.multihit as [number, number])
        : typeof move.multihit === "number"
          ? [move.multihit, move.multihit]
          : [1, 1];
      move.hit = 1;
      this.last = null;
      b.activeMove = move;
      b.activePokemon = source;
      b.activeTarget = target;
      const result = b.actions.getDamage(source, target, move, true);
      b.activeMove = null;
      const hp = Math.max(1, target.hp);
      if (result === false || result === undefined || result === null) {
        return { min: 0, max: 0, minPct: 0, maxPct: 0, hits, immune: result === false, accuracy, calc: null, moveType: move.type, category: move.category, priority };
      }
      const calc = this.last as DamageCalc | null;
      const rolls = calc?.rolls?.length ? calc.rolls : [result, result];
      const min = Math.min(...rolls);
      const max = Math.max(...rolls);
      return { min, max, minPct: min / hp, maxPct: max / hp, hits, immune: false, accuracy, calc, moveType: move.type, category: move.category, priority };
    } catch {
      return null;
    } finally {
      source.terastallized = savedTera;
    }
  }

  /** Chance to hit, the same way the engine works it out: abilities and items, then stages. */
  private accuracy(source: Sim, target: Sim, move: Sim): number | true {
    const b = this.battle;
    if (move.ohko) return 30;
    if (move.alwaysHit || (move.target === "self" && move.category === "Status")) return true;
    if (move.id === "toxic" && source.hasType("Poison")) return true;
    let accuracy = b.runEvent("ModifyAccuracy", target, source, move, move.accuracy);
    if (accuracy === true) return true;
    let boost = move.ignoreAccuracy ? 0 : b.clampIntRange(source.boosts.accuracy, -6, 6);
    if (!move.ignoreEvasion) boost = b.clampIntRange(boost - target.boosts.evasion, -6, 6);
    if (boost > 0) accuracy = b.trunc((accuracy * (3 + boost)) / 3);
    else if (boost < 0) accuracy = b.trunc((accuracy * 3) / (3 - boost));
    const final = b.runEvent("Accuracy", target, source, move, accuracy);
    return final === true ? true : Math.min(100, Number(final) || 0);
  }

  /** Speed as the turn order uses it, including boosts, paralysis, Choice Scarf, Tailwind and abilities. */
  speed(ref: Ref): number {
    const p = this.mon(ref);
    try {
      return p.getStat("spe", false, false);
    } catch {
      return p.storedStats?.spe ?? 0;
    }
  }

  get trickRoom(): boolean {
    return !!this.battle.field.pseudoWeather?.trickroom;
  }
}
