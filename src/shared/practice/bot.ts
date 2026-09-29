// The computer opponent. It picks one move at a time so the table can show each move as it
// happens. Stronger opponents make fewer mistakes, place Energy with a plan, retreat, and use
// Boss's Orders to reach a Pokémon they can Knock Out.

import { otherSeat, type Seat } from "../game-types";
import {
  canPay,
  cantAttackReason,
  cantPlayTrainerReason,
  cantRetreatReason,
  energyProvides,
  evolveTargets,
  hpLeft,
  isBasicEnergy,
  isBasicPokemon,
  isEnergy,
  isPokemon,
  isSupporter,
  isTool,
  prizeValue,
  slotAt,
  slotKeys,
  topCard,
  usableAttacks,
  attacksOf,
  isStadium,
  BENCH_SIZE,
} from "./engine";
import { countFor, finalDamage } from "./attacks";
import { trainerFor } from "./trainers";
import { baseName, benchLimit, isAutomatedTool, toolRoom } from "./effects";
import { unitIs } from "./special-energy";
import { cardActions } from "./actions";
import { abilityWorth } from "./abilities";
import type { Attack, PAction, PCard, PPlayer, PSlot, PState, SlotKey } from "./types";

export type BotSkill = {
  /** Chance of missing a good move (0 = never). Decided once per move per turn. */
  blunder: number;
  /** Plans Energy, retreats, and targets Knock Outs. */
  smart: boolean;
  /** How many Pokémon it likes to keep on its Bench. */
  benchMax: number;
};

// ----- Small helpers -----

/** A repeatable 0–1 number, so a mistake the bot "decides" to make sticks for the whole turn. */
function roll(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
const blunders = (state: PState, skill: BotSkill, key: string) => skill.blunder > 0 && roll(`${state.turn}:${key}:${seedOf(state)}`) < skill.blunder;
// Mixes in something unique to this game so two games don't blunder identically.
const seedOf = (state: PState) => state.players.p1.prizes[0]?.uid ?? "";

/** How many Energy are still missing to pay `cost`. */
export function missing(cost: string[], energy: PCard[]) {
  const pool = energy.flatMap((e) => energyProvides(e));
  let miss = 0;
  for (const need of cost.filter((c) => c !== "Colorless" && c !== "Free")) {
    let i = pool.indexOf(need);
    if (i < 0) i = pool.findIndex((u) => unitIs(u, need));
    if (i < 0) miss++;
    else pool.splice(i, 1);
  }
  return miss + Math.max(0, cost.filter((c) => c === "Colorless").length - pool.length);
}

/** Roughly how much damage an attack would do, counting coin flips at their average. */
function estimate(state: PState, seat: Seat, attacker: PSlot, attack: Attack, defender: PSlot) {
  const text = (attack.text ?? "").split(topCard(attacker).name).join("this Pokémon");
  let base = parseInt(attack.damage, 10) || 0;
  let m: RegExpMatchArray | null;
  if ((m = text.match(/Flip (\w+) coins?\. This attack does (\d+) damage (?:for|times the number of) (?:each )?heads/i))) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : (({ a: 1, two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[m[1].toLowerCase()] ?? 1);
    base = (Number(m[2]) * n) / 2;
  } else if ((m = text.match(/Flip a coin until you get tails\. This attack does (\d+)/i))) {
    base = text.includes("more damage") ? base + Number(m[1]) : Number(m[1]);
  } else if ((m = text.match(/If heads, this attack does (\d+) more damage/i))) {
    base += Number(m[1]) / 2;
  } else if (/If tails, this attack does nothing/i.test(text)) {
    base /= 2;
  } else if (attacker === state.players[seat].active && (m = text.match(/This attack does (\d+) (more )?damage for each ([^.]+)\./i))) {
    const count = countFor(state, seat, m[3]);
    if (count !== null) base = m[2] ? base + Number(m[1]) * count : Number(m[1]) * count;
  }
  return finalDamage(state, seat, attacker, defender, Math.round(base), text);
}

/** How good an attack is right now: damage, plus a little for useful effects. */
function attackValue(state: PState, seat: Seat, attack: Attack) {
  const p = state.players[seat];
  const opp = state.players[otherSeat(seat)];
  if (!p.active || !opp.active) return 0;
  const damage = estimate(state, seat, p.active, attack, opp.active);
  let value = damage;
  if (damage >= hpLeft(state, opp.active)) value += 1000 + prizeValue(topCard(opp.active)) * 100;
  const text = attack.text ?? "";
  if (/is now (Asleep|Burned|Confused|Paralyzed|Poisoned)/i.test(text)) value += 20;
  if (/damage to each of your opponent's Benched/i.test(text)) value += 10 * opp.bench.length;
  if (/^Draw \w+ cards?/i.test(text)) value += 10;
  if (/This Pokémon also does (\d+) damage to itself/i.test(text) && p.active.damage + 50 >= hpLeft(state, p.active)) value -= 60;
  if (/Discard (all|\d+|an?|two|three) (\w+ )?Energy/i.test(text)) value -= 15;
  return value;
}

/** How ready a Pokémon is to fight: can it attack, and how much HP does it have left. */
function readiness(state: PState, slot: PSlot) {
  const best = Math.min(...topCard(slot).attacks.map((a) => missing(a.cost, slot.energy)), 9);
  const strongest = Math.max(
    0,
    ...topCard(slot)
      .attacks.filter((a) => canPay(a.cost, slot.energy))
      .map((a) => parseInt(a.damage, 10) || 0),
  );
  return (best === 0 ? 200 : 100 - best * 25) + strongest + hpLeft(state, slot) / 5;
}

const benchIndexOf = (key: string) => Number(key.split(":")[1]);

// ----- Choosing what to do -----

/** The bot's next move, or null if it's waiting on the other player. */
export function botAction(state: PState, seat: Seat, skill: BotSkill): PAction | null {
  if (state.status === "finished") return null;
  if (state.prompt) return state.prompt.seat === seat ? { type: "choose", picks: answerPrompt(state, seat, skill) } : null;
  if (state.status === "setup") return state.setupDone[seat] ? null : chooseSetup(state, seat, skill);
  if (state.current !== seat || state.pendingEnd) return null;
  return mainPhase(state, seat, skill);
}

function chooseSetup(state: PState, seat: Seat, skill: BotSkill): PAction {
  const p = state.players[seat];
  const basics = p.hand.filter(isBasicPokemon);
  const starter = (c: PCard) => {
    const cheapest = Math.min(9, ...c.attacks.map((a) => a.cost.length));
    const hasPlans = [...p.hand, ...p.deck].some((x) => x.evolvesFrom === c.name);
    return (c.hp ?? 0) / 10 - cheapest * 3 - (prizeValue(c) > 1 ? 8 : 0) - (hasPlans ? 4 : 0);
  };
  const ordered = skill.smart ? [...basics].sort((a, b) => starter(b) - starter(a)) : basics;
  const [active, ...rest] = ordered;
  return {
    type: "setup",
    active: active.uid,
    bench: rest.slice(0, skill.benchMax).map((c) => c.uid),
  };
}

function mainPhase(state: PState, seat: Seat, skill: BotSkill): PAction {
  const p = state.players[seat];
  const opp = state.players[otherSeat(seat)];
  const playable = (c: PCard) => cantPlayTrainerReason(state, seat, c) === null;
  const inHand = (name: string) => p.hand.find((c) => c.name.replace(/\s*\(.*\)$/, "") === name && playable(c));
  const skip = (key: string) => blunders(state, skill, key);
  const play = (c: PCard | undefined): PAction | null => (c && !skip(c.uid) ? { type: "playTrainer", uid: c.uid } : null);

  // 1. A Supporter.
  if (!p.supporterPlayed) {
    const handAfter = p.hand.length - 1;
    const gust = skill.smart ? gustTarget(state, seat) : null;
    const choice =
      (gust !== null && inHand("Boss's Orders")) ||
      (handAfter <= 3 && (inHand("Professor's Research") || inHand("Judge") || inHand("Marnie") || inHand("Iono"))) ||
      (skill.smart && opp.prizes.length <= 2 && opp.hand.length >= 5 && inHand("Iono")) ||
      (p.deck.some((c) => c.supertype === "Trainer" && !isSupporter(c)) && inHand("Arven")) ||
      (handAfter <= 5 && (inHand("Iono") || inHand("Judge") || inHand("Marnie")));
    const action = play(choice || undefined);
    if (action) return action;
  }

  // 2. Items.
  const benchRoom = p.bench.length < Math.min(skill.benchMax, benchLimit(state, seat));
  const deckHasBasic = p.deck.some(isBasicPokemon);
  const items: [string, boolean][] = [
    ["Rare Candy", true],
    ["Battle VIP Pass", benchRoom && deckHasBasic],
    ["Buddy-Buddy Poffin", benchRoom && p.deck.some((c) => isBasicPokemon(c) && (c.hp ?? 0) <= 70)],
    ["Nest Ball", benchRoom && deckHasBasic],
    ["Poké Ball", true],
    ["Great Ball", true],
    ["Level Ball", true],
    ["Ultra Ball", p.hand.length >= 4],
    ["Quick Ball", p.hand.length >= 3 && benchRoom],
    ["Pokégear 3.0", !p.supporterPlayed && !p.hand.some(isSupporter)],
    ["Energy Search", !p.hand.some(isEnergy)],
    ["Earthen Vessel", !p.hand.some(isEnergy) && p.hand.length >= 3],
    ["Energy Retrieval", p.hand.filter(isEnergy).length <= 1],
    ["Night Stretcher", true],
    ["Super Rod", p.deck.length < 20],
    ["Potion", slotKeys(p).some((k) => slotAt(p, k)!.damage >= 30)],
  ];
  for (const [name, worth] of items) {
    if (!worth) continue;
    const action = play(inHand(name));
    if (action) return action;
  }
  if (skill.smart && gustTarget(state, seat) !== null) {
    const action = play(inHand("Counter Catcher") ?? inHand("Pokémon Catcher"));
    if (action) return action;
  }
  if (skill.smart && p.active && p.bench.length) {
    const stuck = p.active.conditions.some((c) => c === "asleep" || c === "paralyzed") || !canAttackSoon(p, p.active);
    const better = p.bench.some((s) => usableOn(s).length);
    if (stuck && better) {
      const action = play(inHand("Switch") ?? inHand("Switch Cart"));
      if (action) return action;
    }
  }

  // 3. Basic Pokémon onto the Bench.
  if (p.bench.length < Math.min(skill.benchMax, benchLimit(state, seat))) {
    const basic = p.hand.find((c) => isBasicPokemon(c) && !skip(c.uid));
    if (basic) return { type: "playBasic", uid: basic.uid };
  }

  // 4. Evolve.
  for (const c of p.hand) {
    const targets = evolveTargets(state, seat, c);
    if (targets.length && !skip(c.uid)) {
      const slot = targets.includes("active") ? "active" : targets[0];
      return { type: "evolve", uid: c.uid, slot };
    }
  }

  // 5. Tools that do something (Technical Machines are left for people to use).
  const tool = p.hand.find((c) => isTool(c) && isAutomatedTool(baseName(c.name)) && !c.name.startsWith("Technical Machine") && playable(c));
  if (tool && !skip(tool.uid)) {
    const target = toolTarget(state, p, tool);
    if (target) return { type: "attachTool", uid: tool.uid, slot: target };
  }

  // 5b. A Stadium, if there isn't one of ours in play.
  const stadium = p.hand.find((c) => isStadium(c) && playable(c));
  if (stadium && state.stadium?.owner !== seat && !skip(stadium.uid)) return { type: "playTrainer", uid: stadium.uid };

  // 5c. Stadium uses and other card actions that are worth it.
  for (const a of cardActions(state, seat)) {
    if (a.blocked || skip(a.id) || !actionWorthIt(state, seat, a.id, a.card)) continue;
    return { type: "special", id: a.id };
  }

  // 6. Energy.
  if (!p.energyAttached) {
    const choice = energyChoice(state, seat, skill);
    if (choice && !skip(`energy:${choice.uid}`)) return { type: "attachEnergy", ...choice };
  }

  // 7. Retreat to a Pokémon that can attack.
  if (skill.smart && !cantRetreatReason(state, seat) && p.active && !usableAttacks(state, seat).length && state.turn > 1) {
    let best = -1;
    let bestScore = 0;
    p.bench.forEach((s, i) => {
      if (!usableOn(s).length) return;
      const score = readiness(state, s);
      if (score > bestScore) [best, bestScore] = [i, score];
    });
    const cost = topCard(p.active).retreat;
    const spareEnergy = p.active.energy.flatMap((e) => energyProvides(e)).length >= cost;
    if (best >= 0 && spareEnergy && !skip("retreat")) return { type: "retreat", bench: best };
  }

  // 8. Attack, or end the turn.
  const attacks = usableAttacks(state, seat);
  if (attacks.length && !cantAttackReason(state, seat)) {
    const active = { attacks: attacksOf(state, p.active!) };
    if (skip("attack-choice")) {
      const pick = attacks[Math.floor(roll(`${state.turn}:pick`) * attacks.length)];
      return { type: "attack", index: pick };
    }
    let best = attacks[0];
    let bestValue = -Infinity;
    for (const i of attacks) {
      const value = attackValue(state, seat, active.attacks[i]);
      if (value > bestValue) [best, bestValue] = [i, value];
    }
    if (bestValue > 0) return { type: "attack", index: best };
  }
  return { type: "endTurn" };
}

/** Whether a card action (usually a Stadium's) helps the computer right now. */
function actionWorthIt(state: PState, seat: Seat, id: string, card: PCard) {
  const p = state.players[seat];
  if (id.startsWith("ab:")) return abilityWorth(state, seat, id);
  if (id.startsWith("fossil:") || id.startsWith("grant:")) return false;
  if (id.startsWith("seal:")) return baseName(card.name) === "Forest Seal Stone";
  const name = baseName(card.name);
  if (name === "Jubilife Village") return p.hand.length <= 2;
  if (name === "Prism Tower") return p.hand.length >= 7;
  if (name === "Cycling Road") return p.hand.filter(isBasicEnergy).length >= 3;
  if (name === "Moonlit Hill") return slotKeys(p).some((k) => slotAt(p, k)!.damage >= 30);
  if (name === "Academy at Night" || name === "Primordial Altar") return false;
  return true;
}

function usableOn(slot: PSlot) {
  return topCard(slot).attacks.filter((a) => canPay(a.cost, slot.energy));
}

/** Whether one more Energy would let this Pokémon attack. */
function canAttackSoon(p: PPlayer, slot: PSlot) {
  return topCard(slot).attacks.some((a) => missing(a.cost, slot.energy) <= (p.energyAttached ? 0 : 1));
}

/** An opponent's Benched Pokémon we could Knock Out right now if it were Active, worth more than the Active. */
function gustTarget(state: PState, seat: Seat): number | null {
  const p = state.players[seat];
  const opp = state.players[otherSeat(seat)];
  if (!p.active || !opp.active || !opp.bench.length || cantAttackReason(state, seat)) return null;
  const attacks = usableOn(p.active);
  if (!attacks.length) return null;
  const knocksOut = (slot: PSlot) => attacks.some((a) => estimate(state, seat, p.active!, a, slot) >= hpLeft(state, slot));
  const activeValue = knocksOut(opp.active) ? prizeValue(topCard(opp.active)) : 0;
  let best: number | null = null;
  let bestValue = activeValue;
  opp.bench.forEach((s, i) => {
    if (!knocksOut(s)) return;
    const value = prizeValue(topCard(s)) + (opp.bench.length === 1 && !activeValue ? 0.5 : 0);
    if (value > bestValue) [best, bestValue] = [i, value];
  });
  return best;
}

function toolTarget(state: PState, p: PPlayer, tool: PCard): SlotKey | null {
  const free = slotKeys(p).filter((k) => toolRoom(state, slotAt(p, k)!));
  if (!free.length) return null;
  if (tool.name === "Bravery Charm") return free.find((k) => isBasicPokemon(topCard(slotAt(p, k)!))) ?? null;
  return free.includes("active") ? "active" : free[0];
}

/** Which Energy to attach, and where. */
function energyChoice(state: PState, seat: Seat, skill: BotSkill): { uid: string; slot: SlotKey } | null {
  const p = state.players[seat];
  const energy = p.hand.filter(isEnergy);
  if (!energy.length) return null;
  const keys = slotKeys(p);
  if (!skill.smart) {
    // Simple: help the Active Pokémon if any Energy does, otherwise just put one on it.
    const active = p.active!;
    const helps = energy.find((e) => topCard(active).attacks.some((a) => missing(a.cost, [...active.energy, e]) < missing(a.cost, active.energy)));
    return { uid: (helps ?? energy[0]).uid, slot: "active" };
  }
  let best: { uid: string; slot: SlotKey } | null = null;
  let bestScore = -Infinity;
  const future = (slot: PSlot) => [...p.hand, ...p.deck].filter((c) => c.evolvesFrom === topCard(slot).name || c.candyFrom === topCard(slot).name);
  for (const key of keys) {
    const slot = slotAt(p, key)!;
    const attacks = [...topCard(slot).attacks, ...future(slot).flatMap((c) => c.attacks)];
    for (const e of energy) {
      let score = 0;
      for (const a of attacks) {
        const before = missing(a.cost, slot.energy);
        const after = missing(a.cost, [...slot.energy, e]);
        if (after < before) score = Math.max(score, 30 + (after === 0 ? 40 : 0) + (parseInt(a.damage, 10) || 0) / 5);
      }
      if (!score) continue;
      if (key === "active") score += 25;
      if (key === "active" && state.players[otherSeat(seat)].active && hpLeft(state, slot) <= 40) score -= 30; // about to be Knocked Out
      if (score > bestScore) [best, bestScore] = [{ uid: e.uid, slot: key }, score];
    }
  }
  return best ?? (isBasicEnergy(energy[0]) ? { uid: energy[0].uid, slot: keys[keys.length - 1] } : null);
}

// ----- Answering choices -----

function answerPrompt(state: PState, seat: Seat, skill: BotSkill): string[] {
  const prompt = state.prompt!;
  const p = state.players[seat];
  const opp = state.players[otherSeat(seat)];
  const byUid = (zone: PCard[]) => new Map(zone.map((c) => [c.uid, c]));
  const take = (ranked: string[]) => ranked.slice(0, Math.max(prompt.min, prompt.max));
  const shuffled = [...prompt.options].sort((a, b) => roll(`${state.turn}:${a}`) - roll(`${state.turn}:${b}`));
  const pickCount = Math.max(1, prompt.min);

  if (prompt.max === 0) return [];
  const hint = prompt.data?.botPick as string[] | undefined;
  if (hint && hint.every((h) => prompt.options.includes(h))) return hint;

  switch (prompt.zone) {
    case "choice":
      return prompt.options.slice(0, Math.max(1, prompt.min));
    case "prizes":
    case "lost":
      return prompt.options.slice(0, Math.max(prompt.min, Math.min(1, prompt.max)));
    case "oppHand":
    case "oppDeck":
    case "oppDiscard": {
      // Take the cards the other player would most like to keep.
      const zone = prompt.zone === "oppHand" ? opp.hand : prompt.zone === "oppDeck" ? opp.deck : opp.discard;
      const cards = byUid(zone);
      const ranked = [...prompt.options].sort((a, b) => want(state, otherSeat(seat), cards.get(b)!) - want(state, otherSeat(seat), cards.get(a)!));
      return take(ranked);
    }
    case "anyPokemon":
      return prompt.options.slice(0, Math.max(1, prompt.min));
    case "myBench": {
      if (!skill.smart) return shuffled.slice(0, pickCount);
      return [...prompt.options].sort((a, b) => readiness(state, p.bench[benchIndexOf(b)]) - readiness(state, p.bench[benchIndexOf(a)])).slice(0, pickCount);
    }
    case "oppBench": {
      if (!skill.smart) return shuffled.slice(0, pickCount);
      if (prompt.effect === "benchDamage") {
        const amount = Number(prompt.data?.amount ?? 0);
        const score = (key: string) => {
          const s = opp.bench[benchIndexOf(key)];
          return (hpLeft(state, s) <= amount ? 1000 + prizeValue(topCard(s)) * 100 : 0) - hpLeft(state, s);
        };
        return [...prompt.options].sort((a, b) => score(b) - score(a)).slice(0, pickCount);
      }
      const target = gustTarget(state, seat);
      if (pickCount === 1 && target !== null && prompt.options.includes(`bench:${target}`)) return [`bench:${target}`];
      // Nothing to Knock Out: pull up something that's slow to retreat or has no Energy.
      const stuck = (key: string) => {
        const s = opp.bench[benchIndexOf(key)];
        return topCard(s).retreat * 10 - s.energy.length * 15 - hpLeft(state, s) / 10;
      };
      return [...prompt.options].sort((a, b) => stuck(b) - stuck(a)).slice(0, pickCount);
    }
    case "oppPokemon": {
      const amount = Number(prompt.data?.amount ?? 0);
      const slotOf = (key: string) => (key === "active" ? opp.active! : opp.bench[benchIndexOf(key)]);
      const score = (key: string) => (hpLeft(state, slotOf(key)) <= amount ? 1000 + prizeValue(topCard(slotOf(key))) * 100 : 0) - hpLeft(state, slotOf(key));
      return skill.smart ? [...prompt.options].sort((a, b) => score(b) - score(a)).slice(0, pickCount) : shuffled.slice(0, pickCount);
    }
    case "myPokemon": {
      if (prompt.effect === "Rare Candy") return [prompt.options.includes("active") ? "active" : prompt.options[0]];
      if (["attach", "target"].includes(String(prompt.data?.step))) return [prompt.options.includes("active") ? "active" : prompt.options[0]];
      const hurt = (key: string) => slotAt(p, key as SlotKey)!.damage;
      return [...prompt.options].sort((a, b) => hurt(b) - hurt(a)).slice(0, pickCount);
    }
    case "hand": {
      const cards = byUid(p.hand);
      if (prompt.data?.step === "cost") {
        // Discard the least useful cards.
        return [...prompt.options].sort((a, b) => keepValue(state, seat, cards.get(a)!) - keepValue(state, seat, cards.get(b)!)).slice(0, prompt.min);
      }
      return [prompt.options[0]];
    }
    case "deck":
    case "discard": {
      const cards = byUid(prompt.zone === "deck" ? p.deck : p.discard);
      const ranked = [...prompt.options].sort((a, b) => want(state, seat, cards.get(b)!) - want(state, seat, cards.get(a)!));
      return skill.smart ? take(ranked) : take(shuffled);
    }
  }
}

/** How much the bot wants a card it's searching for. */
function want(state: PState, seat: Seat, c: PCard) {
  const p = state.players[seat];
  const inPlay = slotKeys(p).map((k) => topCard(slotAt(p, k)!));
  if (isPokemon(c)) {
    if (c.evolvesFrom && inPlay.some((x) => x.name === c.evolvesFrom)) return 100;
    if (c.candyFrom && inPlay.some((x) => x.name === c.candyFrom) && p.hand.some((x) => x.name === "Rare Candy")) return 95;
    if (isBasicPokemon(c)) {
      if (p.bench.length >= benchLimit(state, seat)) return 5;
      const line = [...p.deck, ...p.hand].some((x) => x.evolvesFrom === c.name);
      const already = inPlay.filter((x) => x.name === c.name).length + p.hand.filter((x) => x.name === c.name).length;
      return 60 + (line ? 15 : 0) + (c.hp ?? 0) / 20 - already * 10;
    }
    if (c.evolvesFrom && p.hand.some((x) => x.name === c.evolvesFrom)) return 50;
    return 20;
  }
  if (isEnergy(c)) {
    const needed = inPlay.some((x) => x.attacks.some((a) => energyProvides(c).some((t) => a.cost.includes(t))));
    return needed ? 40 : 15;
  }
  if (isSupporter(c)) return 45;
  if (isTool(c)) return 25;
  return trainerFor(c.name) ? 30 : 5;
}

/** How much the bot wants to keep a card in its hand (low = discard first). */
function keepValue(state: PState, seat: Seat, c: PCard) {
  const p = state.players[seat];
  if (isEnergy(c)) return p.hand.filter(isEnergy).length >= 3 ? 10 : 35;
  if (c.supertype === "Trainer" && !trainerFor(c.name) && !isTool(c)) return 0;
  return want(state, seat, c);
}
