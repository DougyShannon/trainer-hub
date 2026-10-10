// The computer player. It looks at every move it could use against every target, works out the
// damage with the real damage formula (on a scratch copy of the battle, see lab.ts) and scores it:
// knock-outs, accuracy, priority, and rough values for status moves like Stealth Rock, setup moves
// and recovery. Skill 1 makes plenty of mistakes; skill 2 plays its best move most of the time;
// skill 3 also switches out of bad match-ups, Terastallizes at good moments and focuses fire.

import { Lab, type Ref } from "./lab";
import type { AiSkill } from "../../shared/battle/opponents";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sim = any;

type Option = { choice: string; score: number; target?: number; dealt?: number; tera?: boolean };

const TARGETED = new Set(["normal", "any", "adjacentFoe", "adjacentAlly", "adjacentAllyOrSelf"]);
const SPREAD = new Set(["allAdjacentFoes", "allAdjacent"]);
const HAZARDS: Record<string, number> = { stealthrock: 1, spikes: 3, toxicspikes: 2, stickyweb: 1 };
const HAZARD_REMOVAL = new Set(["defog", "rapidspin", "mortalspin", "tidyup", "courtchange"]);

const refOf = (side: Sim, p: Sim): Ref => ({ side: side.n, index: side.pokemon.indexOf(p) });
const hpFrac = (p: Sim) => (p.maxhp ? p.hp / p.maxhp : 0);
const alive = (side: Sim) => side.pokemon.filter((p: Sim) => !p.fainted).length;

export function chooseFor(battle: Sim, sideIndex: number, req: Sim, skill: AiSkill): string {
  const side = battle.sides[sideIndex];
  if (req.teamPreview) return teamPreview(battle, side, req, skill);
  if (req.forceSwitch) return forceSwitch(battle, side, req, skill);
  if (req.active) return moveTurn(battle, side, req, skill);
  return "default";
}

/** Best expected share of `to`'s current HP that `from` can take in one turn (0 to about 1.5). */
function bestHit(lab: Lab, from: Ref, to: Ref): number {
  const p = lab.mon(from);
  let best = 0;
  for (const slot of p.moveSlots ?? []) {
    if (slot.pp <= 0) continue;
    const est = lab.damage(from, to, slot.id);
    if (!est || est.immune || est.category === "Status") continue;
    const acc = est.accuracy === true ? 1 : est.accuracy / 100;
    const hits = (est.hits[0] + est.hits[1]) / 2;
    best = Math.max(best, Math.min(1.5, ((est.minPct + est.maxPct) / 2) * hits) * acc);
  }
  return best;
}

/** How good `mine` looks against `theirs`: positive is good for `mine`. */
function matchup(lab: Lab, mine: Ref, theirs: Ref): number {
  const dealt = bestHit(lab, mine, theirs);
  const taken = bestHit(lab, theirs, mine);
  const faster = lab.speed(mine) > lab.speed(theirs) !== lab.trickRoom;
  let score = Math.min(1, dealt) - Math.min(1, taken);
  if (dealt >= 1 && faster) score += 0.5;
  if (taken >= 1 && !faster) score -= 0.5;
  return score;
}

function teamPreview(battle: Sim, side: Sim, req: Sim, skill: AiSkill): string {
  const size = req.maxChosenTeamSize || side.pokemon.length;
  const foe = side.foe;
  let order = side.pokemon.map((_: Sim, i: number) => i) as number[];
  if (skill >= 2) {
    const lab = new Lab(battle);
    const score = (i: number) =>
      foe.pokemon.reduce((sum: number, f: Sim) => sum + matchup(lab, refOf(side, side.pokemon[i]), refOf(foe, f)), 0) / foe.pokemon.length;
    const scores = new Map<number, number>(order.map((i) => [i, score(i) + (skill === 2 ? Math.random() * 0.3 : 0)]));
    order = [...order].sort((a, b) => scores.get(b)! - scores.get(a)!);
  } else {
    order = shuffle(order);
  }
  return `team ${order.slice(0, Math.max(size, 1)).map((i) => i + 1).join("")}`;
}

function forceSwitch(battle: Sim, side: Sim, req: Sim, skill: AiSkill): string {
  const lab = new Lab(battle);
  const taken = new Set<number>();
  const parts: string[] = [];
  req.forceSwitch.forEach((must: boolean, slot: number) => {
    if (!must) {
      parts.push("pass");
      return;
    }
    const reviving = req.side.pokemon[slot]?.reviving;
    const candidates = side.pokemon
      .map((p: Sim, i: number) => ({ p, i }))
      .filter(({ p, i }: { p: Sim; i: number }) => i >= side.active.length && !taken.has(i) && (reviving ? p.fainted : !p.fainted));
    if (!candidates.length) {
      parts.push("pass");
      return;
    }
    let pick = candidates[Math.floor(Math.random() * candidates.length)];
    if (skill >= 2 && !reviving) {
      const foes = side.foe.active.filter((f: Sim) => f && !f.fainted);
      let best = -Infinity;
      for (const c of candidates) {
        const s = foes.length ? foes.reduce((sum: number, f: Sim) => sum + matchup(lab, refOf(side, c.p), refOf(side.foe, f)), 0) / foes.length : 0;
        const v = s + hpFrac(c.p) * 0.3 + (skill === 2 ? Math.random() * 0.4 : 0);
        if (v > best) {
          best = v;
          pick = c;
        }
      }
    }
    taken.add(pick.i);
    parts.push(`switch ${pick.i + 1}`);
  });
  return parts.join(", ");
}

function moveTurn(battle: Sim, side: Sim, req: Sim, skill: AiSkill): string {
  const lab = new Lab(battle);
  const doubles = side.active.length > 1;
  const foe = side.foe;
  const assigned = new Map<number, number>(); // expected damage already aimed at each foe slot this turn
  const switchedTo = new Set<number>();
  let teraUsed = false;
  const parts: string[] = [];

  req.active.forEach((active: Sim, slot: number) => {
    const me = side.active[slot];
    const info = req.side.pokemon[slot];
    if (!me || me.fainted || info?.commanding) {
      parts.push("pass");
      return;
    }
    const meRef = refOf(side, me);
    const options: Option[] = [];
    const foes = foe.active.map((f: Sim, k: number) => ({ f, k })).filter(({ f }: { f: Sim }) => f && !f.fainted);
    const threat = Math.max(0, ...foes.map(({ f }: { f: Sim }) => bestHit(lab, refOf(foe, f), meRef)));

    active.moves.forEach((m: Sim, j: number) => {
      if (m.disabled || (m.pp <= 0 && m.maxpp)) return;
      const move = battle.dex.moves.get(m.id);
      if (m.id === "recharge" || m.id === "struggle" || !move.exists) {
        options.push({ choice: `move ${j + 1}`, score: 0.5 });
        return;
      }
      if (move.category === "Status") {
        const targets = TARGETED.has(m.target) && doubles && !m.target.includes("Ally") ? foes : [{ f: foes[0]?.f, k: foes[0]?.k ?? 0 }];
        for (const { f, k } of targets) {
          const score = statusScore(battle, lab, side, me, f, move, threat, doubles);
          const target = !doubles || !TARGETED.has(m.target) ? "" : m.target.includes("Ally") ? ` -${(slot ^ 1) + 1}` : ` ${k + 1}`;
          options.push({ choice: `move ${j + 1}${target}`, score });
        }
        return;
      }
      const tryTera = [false];
      if (active.canTerastallize && !teraUsed && skill >= 2) tryTera.push(true);
      for (const tera of tryTera) {
        if (SPREAD.has(m.target) || !doubles || !TARGETED.has(m.target)) {
          // Hits every foe (or the only one): add up the value on each, minus any hit on our partner.
          let score = 0;
          let dealtTo: number | undefined;
          for (const { f, k } of foes) {
            const est = lab.damage(meRef, refOf(foe, f), m.id, { tera, spread: doubles && SPREAD.has(m.target) && foes.length > 1 });
            score += damageScore(est, f, assigned.get(k) ?? 0, me, move);
            if (!doubles || !SPREAD.has(m.target)) {
              dealtTo = k;
              break;
            }
          }
          if (doubles && m.target === "allAdjacent") {
            for (const ally of side.active) {
              if (!ally || ally === me || ally.fainted) continue;
              const est = lab.damage(meRef, refOf(side, ally), m.id, { tera, spread: true });
              if (est && !est.immune) score -= Math.min(1, (est.minPct + est.maxPct) / 2) * 0.8;
            }
          }
          options.push({ choice: `move ${j + 1}${tera ? " terastallize" : ""}`, score: score + (tera ? teraBonus(me, score, skill) : 0), target: dealtTo, tera });
        } else {
          for (const { f, k } of foes) {
            const est = lab.damage(meRef, refOf(foe, f), m.id, { tera });
            const score = damageScore(est, f, assigned.get(k) ?? 0, me, move);
            const dealt = est ? ((est.min + est.max) / 2) * ((est.hits[0] + est.hits[1]) / 2) : 0;
            options.push({ choice: `move ${j + 1} ${k + 1}${tera ? " terastallize" : ""}`, score: score + (tera ? teraBonus(me, score, skill) : 0), target: k, dealt, tera });
          }
        }
      }
    });

    // Skill 3 switches out of match-ups it is losing badly.
    if (skill === 3 && !active.trapped && !active.maybeTrapped && foes.length) {
      const now = foes.reduce((s: number, { f }: { f: Sim }) => s + matchup(lab, meRef, refOf(foe, f)), 0) / foes.length;
      let best: { i: number; v: number } | null = null;
      side.pokemon.forEach((p: Sim, i: number) => {
        if (i < side.active.length || p.fainted || switchedTo.has(i)) return;
        const v = foes.reduce((s: number, { f }: { f: Sim }) => s + matchup(lab, refOf(side, p), refOf(foe, f)), 0) / foes.length - hazardCost(side, p);
        if (!best || v > best.v) best = { i, v };
      });
      const top = Math.max(0, ...options.map((o) => o.score));
      const b = best as { i: number; v: number } | null;
      if (b && b.v - now > 0.6 && top < 0.7 && me.activeTurns > 0) options.push({ choice: `switch ${b.i + 1}`, score: top + (b.v - now) * 0.4 });
    }

    if (!options.length) {
      parts.push("default");
      return;
    }
    const pick = pickOption(options, skill);
    if (pick.tera) teraUsed = true;
    if (pick.choice.startsWith("switch")) switchedTo.add(Number(pick.choice.split(" ")[1]) - 1);
    if (pick.target !== undefined && pick.dealt) assigned.set(pick.target, (assigned.get(pick.target) ?? 0) + pick.dealt);
    parts.push(pick.choice);
  });
  return parts.join(", ");
}

function pickOption(options: Option[], skill: AiSkill): Option {
  const sorted = [...options].sort((a, b) => b.score - a.score);
  if (skill === 1) {
    if (Math.random() < 0.35) return options[Math.floor(Math.random() * options.length)];
    return sorted[0];
  }
  if (skill === 2) {
    const noisy = options.map((o) => ({ o, s: o.score * (0.85 + Math.random() * 0.3) })).sort((a, b) => b.s - a.s);
    return noisy[0].o;
  }
  return sorted[0];
}

function damageScore(est: ReturnType<Lab["damage"]>, target: Sim, alreadyAimed: number, me: Sim, move: Sim): number {
  if (!est || est.immune || !target) return 0;
  const hp = Math.max(1, target.hp - alreadyAimed);
  const acc = est.accuracy === true ? 1 : est.accuracy / 100;
  const hitsAvg = (est.hits[0] + est.hits[1]) / 2;
  const avg = ((est.min + est.max) / 2) * hitsAvg;
  let score = Math.min(1, avg / hp) * acc;
  if (est.min * est.hits[0] >= hp) score += 0.6 * acc;
  else if (est.max * est.hits[1] >= hp) score += 0.25 * acc;
  if (est.priority > 0 && est.max * est.hits[1] >= hp) score += 0.3;
  // Moves with a cost.
  if (move.recoil || move.mindBlownRecoil) score -= 0.08;
  if (move.self?.boosts && Object.values(move.self.boosts as Record<string, number>).some((v) => v < 0)) score -= 0.08;
  if (move.selfdestruct) score -= hpFrac(me) > 0.4 ? 0.6 : 0.1;
  if (move.id === "fakeout" || move.id === "firstimpression") score += me.activeMoveActions === 0 ? 0.35 : -2;
  if (move.id === "suckerpunch" || move.id === "thunderclap") score *= 0.75;
  if (move.flags?.charge && !me.volatiles?.[move.id]) score *= move.id === "solarbeam" || move.id === "electroshot" ? 0.8 : 0.5;
  if (move.selfSwitch) score += 0.05;
  return score;
}

function teraBonus(me: Sim, score: number, skill: AiSkill): number {
  // Save Tera for when it matters: a knock-out, or when this Pokémon is in trouble anyway.
  if (skill === 3) return score >= 1 || hpFrac(me) < 0.5 ? 0.15 : -0.3;
  return Math.random() < 0.3 ? 0.1 : -0.3;
}

function hazardCost(side: Sim, p: Sim): number {
  let cost = 0;
  const sc = side.sideConditions ?? {};
  if (sc.stealthrock && !p.hasItem?.("heavydutyboots")) cost += 0.125 * 2 ** (p.runEffectiveness?.({ type: "Rock" }) ?? 0);
  if (sc.spikes && p.isGrounded?.()) cost += [0, 1 / 8, 1 / 6, 1 / 4][sc.spikes.layers ?? 1];
  return cost;
}

function statusScore(battle: Sim, lab: Lab, side: Sim, me: Sim, target: Sim, move: Sim, threat: number, doubles: boolean): number {
  const foeSide = side.foe;
  const acc = move.accuracy === true ? 1 : move.accuracy / 100;
  const hp = hpFrac(me);
  const safe = threat < 0.45;
  const id = move.id as string;

  if (move.stallingMove) {
    if (me.volatiles?.stall) return 0;
    if (doubles) return threat >= 0.5 ? 0.35 : 0.12;
    return me.hasItem?.("leftovers") && target?.status ? 0.25 : 0.06;
  }
  if (HAZARDS[id] && move.sideCondition) {
    const cond = foeSide.sideConditions?.[move.sideCondition.toLowerCase?.() ?? id];
    const layers = cond?.layers ?? (cond ? 1 : 0);
    if (layers >= HAZARDS[id] || alive(foeSide) < 3) return 0;
    return id === "stealthrock" ? 0.55 : 0.4;
  }
  if (HAZARD_REMOVAL.has(id)) {
    const mine = Object.keys(side.sideConditions ?? {}).some((c) => HAZARDS[c]);
    return mine ? 0.45 : 0.02;
  }
  if (move.weather) return battle.field.isWeather(move.weather) ? 0 : 0.3;
  if (move.terrain) return battle.field.isTerrain(move.terrain) ? 0 : 0.3;
  if (id === "trickroom") {
    if (battle.field.pseudoWeather?.trickroom) return 0;
    const mineSpe = side.active.filter(Boolean).reduce((s: number, p: Sim) => s + p.getStat("spe"), 0);
    const theirSpe = foeSide.active.filter(Boolean).reduce((s: number, p: Sim) => s + p.getStat("spe"), 0);
    return mineSpe < theirSpe ? 0.6 : 0.02;
  }
  if (id === "tailwind") return side.sideConditions?.tailwind ? 0 : doubles ? 0.5 : 0.25;
  if (["reflect", "lightscreen", "auroraveil"].includes(id)) {
    if (side.sideConditions?.[id]) return 0;
    if (id === "auroraveil" && !battle.field.isWeather(["hail", "snowscape"])) return 0;
    return 0.35;
  }
  if (move.boosts && move.target === "self") {
    if (id === "bellydrum") return hp > 0.75 && safe ? 0.7 : 0;
    const gain = Object.entries(move.boosts as Record<string, number>).reduce((s, [stat, v]) => s + (me.boosts[stat] >= 2 ? 0 : v), 0);
    if (!gain) return 0.02;
    return hp > 0.55 && safe ? 0.25 + 0.12 * gain : 0.05;
  }
  if (move.self?.boosts && move.category === "Status") return safe ? 0.3 : 0.05; // e.g. Shed Tail-like support
  if ((move.heal || move.flags?.heal) && (move.target === "self" || move.target === "allies")) {
    if (hp < 0.45) return 0.7;
    if (hp < 0.7) return 0.35;
    return 0;
  }
  if (id === "rest") return hp < 0.4 && !me.status ? 0.6 : 0;
  if (!target) return 0.02;
  const targetRef = { side: foeSide.n, index: foeSide.pokemon.indexOf(target) };
  if (move.status) {
    if (target.status || target.volatiles?.substitute) return 0;
    const t = lab.mon(targetRef);
    if (!t || !t.runStatusImmunity(move.status) || !t.runImmunity(battle.dex.getActiveMove(id))) return 0;
    if (move.status === "slp") {
      const sleeping = foeSide.pokemon.some((p: Sim) => p.status === "slp");
      return sleeping ? 0 : 0.6 * acc;
    }
    if (move.status === "par") return (lab.speed(targetRef) > me.getStat("spe") ? 0.5 : 0.3) * acc;
    if (move.status === "brn") return (target.storedStats.atk > target.storedStats.spa ? 0.5 : 0.15) * acc;
    return 0.4 * acc;
  }
  if (move.volatileStatus === "leechseed") return target.hasType("Grass") || target.volatiles?.leechseed ? 0 : 0.3 * acc;
  if (["followme", "ragepowder"].includes(id)) return doubles && threat < 0.6 ? 0.25 : 0;
  if (id === "helpinghand") return doubles ? 0.15 : 0;
  if (["taunt", "encore", "disable"].includes(id)) return 0.15 * acc;
  if (["trick", "switcheroo"].includes(id)) return me.item && /choice/.test(me.item) ? 0.3 : 0.05;
  if (move.boosts && move.target !== "self") return 0.15 * acc; // lowers the foe's stats
  return 0.05 * acc;
}

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
