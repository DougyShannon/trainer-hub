// Attacks in practice games. Each attack's text is read sentence by sentence: the patterns below
// cover the most common wording on modern cards (coin flips, "for each" damage, Special
// Conditions, bench damage, switching, searching, protection for a turn and so on). Anything
// left over is shown in the game log as not automated, so players know to apply it themselves.

import { otherSeat, type Condition, type Seat } from "../game-types";
import {
  ENERGY_TYPES,
  PRIZES,
  ask,
  draw,
  energyProvides,
  flip,
  isBasicEnergy,
  isBasicPokemon,
  isPokemon,
  isSupporter,
  isItem,
  log,
  newSlot,
  plural,
  shuffle,
  switchActive,
  topCard,
  BENCH_SIZE,
} from "./engine";
import { toolDamageBonus } from "./trainers";
import type { Attack, PCard, PSlot, PState } from "./types";

const COUNT_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
export const toCount = (s: string) => (/^\d+$/.test(s) ? Number(s) : (COUNT_WORDS[s.toLowerCase()] ?? 1));

const CONDITION = "(Asleep|Burned|Confused|Paralyzed|Poisoned)";
const asCondition = (word: string) => word.toLowerCase() as Condition;

export function addCondition(slot: PSlot, condition: Condition) {
  // Asleep, Confused and Paralyzed replace each other.
  if (["asleep", "confused", "paralyzed"].includes(condition)) {
    slot.conditions = slot.conditions.filter((c) => !["asleep", "confused", "paralyzed"].includes(c));
  }
  if (!slot.conditions.includes(condition)) slot.conditions.push(condition);
}

const isEx = (c: PCard) => c.subtypes.includes("ex") || c.subtypes.includes("EX");
const isV = (c: PCard) => c.subtypes.some((s) => s === "V" || s === "VMAX" || s === "VSTAR");

/** Counts for "for each ..." attack text. Returns null if the phrase isn't understood. */
export function countFor(state: PState, seat: Seat, what: string): number | null {
  const p = state.players[seat];
  const opp = state.players[otherSeat(seat)];
  const attacker = p.active!;
  const w = what.toLowerCase();
  const energyType = ENERGY_TYPES.find((t) => w.includes(t.toLowerCase()));
  if (w.includes("energy attached to this pokémon")) {
    const units = attacker.energy.flatMap(energyProvides);
    return energyType ? units.filter((u) => u === energyType).length : units.length;
  }
  if (w.includes("energy attached to your opponent's active") || w.includes("energy attached to the defending")) {
    return opp.active ? opp.active.energy.flatMap(energyProvides).length : 0;
  }
  if (w.includes("energy attached to all of your pokémon")) {
    return [p.active, ...p.bench].flatMap((s) => s?.energy ?? []).flatMap(energyProvides).filter((u) => !energyType || u === energyType).length;
  }
  if (w.includes("damage counter on this pokémon")) return attacker.damage / 10;
  if (w.includes("damage counter on your opponent's active") || w.includes("damage counter on the defending")) {
    return opp.active ? opp.active.damage / 10 : 0;
  }
  if (w.includes("benched pokémon (both yours and your opponent's)")) return p.bench.length + opp.bench.length;
  if (w.includes("of your opponent's benched pokémon")) return opp.bench.length;
  if (w.includes("of your benched pokémon")) return p.bench.length;
  if (w.includes("prize card your opponent has taken")) return PRIZES - opp.prizes.length;
  if (w.includes("prize card you have taken")) return PRIZES - p.prizes.length;
  if (w.includes("card in your opponent's hand")) return opp.hand.length;
  if (w.includes("card in your hand")) return p.hand.length;
  return null;
}

/** Whether an "If ..., this attack does ..." condition holds. Null if the wording isn't understood. */
function holds(state: PState, seat: Seat, attacker: PSlot, defender: PSlot, phrase: string): boolean | null {
  const p = state.players[seat];
  const opp = state.players[otherSeat(seat)];
  const w = phrase.trim();
  let m: RegExpMatchArray | null;
  if (/^(heads|tails)$/i.test(w)) return null;
  if (/^this Pokémon has any damage counters on it$/i.test(w)) return attacker.damage > 0;
  if (/^this Pokémon has no damage counters on it$/i.test(w)) return attacker.damage === 0;
  if (/^your opponent's Active Pokémon (?:already )?has any damage counters on it$/i.test(w)) return defender.damage > 0;
  if (/^you have more Prize cards remaining than your opponent$/i.test(w)) return p.prizes.length > opp.prizes.length;
  if (/^you have fewer Prize cards remaining than your opponent$/i.test(w)) return p.prizes.length < opp.prizes.length;
  if (/^your opponent's Active Pokémon is a Pokémon ex or Pokémon V$/i.test(w)) return isEx(topCard(defender)) || isV(topCard(defender));
  if (/^your opponent's Active Pokémon is a Pokémon ex$/i.test(w)) return isEx(topCard(defender));
  if (/^your opponent's Active Pokémon is an evolved Pokémon$/i.test(w)) return defender.pokemon.length > 1;
  if (/^your opponent's Active Pokémon is a Basic Pokémon$/i.test(w)) return isBasicPokemon(topCard(defender));
  if ((m = w.match(/^your opponent's Active Pokémon is an? (\w+) Pokémon$/i))) return topCard(defender).types.includes(m[1]);
  if ((m = w.match(new RegExp(`^your opponent's Active Pokémon is ${CONDITION}$`, "i")))) return defender.conditions.includes(asCondition(m[1]));
  if ((m = w.match(new RegExp(`^this Pokémon (?:isn't|is not) ${CONDITION}$`, "i")))) return !attacker.conditions.includes(asCondition(m[1]));
  if ((m = w.match(new RegExp(`^this Pokémon is ${CONDITION}$`, "i")))) return attacker.conditions.includes(asCondition(m[1]));
  if (/^this Pokémon evolved during this turn$/i.test(w)) return attacker.pokemon.length > 1 && attacker.playedTurn === state.turn;
  if (/^you have the same number of cards in your hand as your opponent$/i.test(w)) return p.hand.length === opp.hand.length;
  if (/^you have no cards in your hand$/i.test(w)) return p.hand.length === 0;
  if (/^this Pokémon has any Special Energy attached$/i.test(w)) return attacker.energy.some((e) => !isBasicEnergy(e));
  if ((m = w.match(/^(.+) is on your Bench$/i))) return p.bench.some((s) => topCard(s).name === m![1]);
  if ((m = w.match(/^you have (.+) in play$/i))) return [p.active, ...p.bench].some((s) => s && topCard(s).name === m![1]);
  return null;
}

/** Applies Double Turbo Energy, Tools, Weakness and Resistance to an attack's base damage. */
export function finalDamage(state: PState, seat: Seat, attacker: PSlot, defender: PSlot, base: number, text: string) {
  if (base <= 0) return 0;
  let damage = base;
  if (attacker.energy.some((e) => e.name === "Double Turbo Energy")) damage = Math.max(0, damage - 20);
  damage += toolDamageBonus(state, seat, attacker, defender);
  const types = topCard(attacker).types;
  if (!/isn't affected by Weakness/i.test(text)) {
    const weak = topCard(defender).weaknesses.find((w) => types.includes(w.type));
    if (weak) damage = weak.value.includes("+") ? damage + (parseInt(weak.value.replace(/\D/g, ""), 10) || 0) : damage * 2;
  }
  if (!/isn't affected by (?:Weakness (?:or|and) )?Resistance/i.test(text)) {
    const resist = topCard(defender).resistances.find((r) => types.includes(r.type));
    if (resist) damage = Math.max(0, damage - (parseInt(resist.value.replace(/\D/g, ""), 10) || 30));
  }
  return damage;
}

/** Takes the named Energy off a Pokémon and puts it in its owner's discard pile. */
function discardEnergy(state: PState, owner: Seat, slot: PSlot, n: number, type: string | null) {
  const matching = slot.energy.filter((e) => !type || energyProvides(e).includes(type));
  // Special Energy goes first when it's the opponent's (it's usually worth more to them).
  const gone = matching.slice(-n);
  for (const e of gone) slot.energy.splice(slot.energy.indexOf(e), 1);
  state.players[owner].discard.push(...gone);
  return gone.length;
}

const benchOptions = (slots: PSlot[]) => slots.map((_, i) => `bench:${i}`);

/** Works out an attack's damage and effects. Wording that isn't recognised is logged. */
export function resolveAttack(state: PState, seat: Seat, attack: Attack) {
  const oppSeat = otherSeat(seat);
  const p = state.players[seat];
  const opp = state.players[oppSeat];
  const attacker = p.active!;
  const defender = opp.active!;
  // Older cards name themselves ("Discard 2 Energy attached to Charizard"); read that as "this Pokémon".
  const text = (attack.text ?? "").split(topCard(attacker).name).join("this Pokémon");
  // Bracketed reminder text explains the rules; it isn't an effect of its own.
  let rest = text.replace(/\s*\([^)]*\)/g, "");
  const find = (re: RegExp) => {
    const m = rest.match(re);
    if (m) rest = rest.replace(m[0], " ");
    return m;
  };
  let lastFlip: boolean | null = null;
  const coin = () => {
    lastFlip = flip();
    log(state, seat, `Coin flip: ${lastFlip ? "heads" : "tails"}.`, "coin");
    return lastFlip;
  };
  /** For "Flip a coin. If heads, ..." (or a bare "If heads," reusing the last flip). */
  const headsFor = (m: RegExpMatchArray, flipGroup: number, ifGroup: number) => {
    if (!m[ifGroup]) return true;
    return m[flipGroup] || lastFlip === null ? coin() : lastFlip;
  };
  const coins = (n: number) => {
    let heads = 0;
    for (let i = 0; i < n; i++) if (flip()) heads++;
    log(state, seat, `Flipped ${plural(n, "coin")}: ${plural(heads, "heads")}.`, "coin");
    return heads;
  };

  log(state, seat, `${topCard(attacker).name} used ${attack.name}.`, "attack");
  let base = parseInt(attack.damage, 10) || 0;
  const hasDamage = attack.damage.trim() !== "";
  let nothing = false;
  let m: RegExpMatchArray | null;

  // ----- Damage -----
  if ((m = find(/Flip (\w+) coins?\. This attack does (\d+) damage (?:for|times the number of) (?:each )?heads\./i))) {
    base = Number(m[2]) * coins(toCount(m[1]));
  } else if ((m = find(/Flip a coin until you get tails\. This attack does (\d+) (more )?damage for each heads\./i))) {
    let heads = 0;
    while (flip()) heads++;
    log(state, seat, `Flipped until tails: ${plural(heads, "heads")}.`, "coin");
    base = m[2] ? base + Number(m[1]) * heads : Number(m[1]) * heads;
  } else if ((m = find(/Flip (\w+) coins?\. This attack does (\d+) more damage for each heads\./i))) {
    base += Number(m[2]) * coins(toCount(m[1]));
  } else if ((m = find(/Flip a coin\. If tails, this Pokémon also does (\d+) damage to itself\. If heads, this attack does (\d+) more damage\./i))) {
    if (coin()) base += Number(m[2]);
    else attacker.damage += Number(m[1]);
  } else if ((m = find(/Flip a coin\. If heads, this attack does (\d+) more damage\./i))) {
    if (coin()) base += Number(m[1]);
  } else if (find(/Flip a coin\. If tails, this attack does nothing\./i)) {
    if (!coin()) nothing = true;
  }
  if ((m = find(/Discard up to (\w+) Basic (\w+) Energy cards? from your hand\. This attack does (\d+) damage for each card you discard(?:ed)?(?: in this way)?\./i))) {
    const cards = p.hand.filter((c) => isBasicEnergy(c) && c.name.includes(m![2])).slice(0, toCount(m[1]));
    for (const c of cards) p.hand.splice(p.hand.indexOf(c), 1);
    p.discard.push(...cards);
    log(state, seat, `${p.name} discarded ${plural(cards.length, "Energy card")} from their hand.`);
    base = Number(m[3]) * cards.length;
  }
  if ((m = find(/This attack does (\d+) (more )?damage for each ([^.]+)\./i))) {
    const count = countFor(state, seat, m[3]);
    if (count === null) rest += ` ${m[0]}`;
    else base = m[2] ? base + Number(m[1]) * count : Number(m[1]) * count;
  }
  while ((m = rest.match(/If ([^,.]+), this attack does (\d+) more damage\./i))) {
    const ok = holds(state, seat, attacker, defender, m[1]);
    if (ok === null) break;
    find(new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    if (ok) base += Number(m[2]);
  }
  if ((m = rest.match(/If ([^,.]+), this attack does nothing\./i))) {
    const ok = holds(state, seat, attacker, defender, m[1]);
    if (ok !== null) {
      find(/If ([^,.]+), this attack does nothing\./i);
      if (ok) nothing = true;
    }
  }
  const boost = attacker.effects.boost;
  if (boost && boost.turn === state.turn && hasDamage) base += boost.amount;
  find(/This attack's damage isn't affected by [^.]*\./i);

  if (nothing) {
    log(state, seat, "The attack did nothing.", "attack");
    return;
  }

  // ----- Damage to the opponent's Active Pokémon -----
  let damage = finalDamage(state, seat, attacker, defender, base, text);
  const protect = defender.effects.protect?.turn === state.turn ? defender.effects.protect : null;
  const guard = defender.effects.guard?.turn === state.turn ? defender.effects.guard.amount : 0;
  if (protect && damage > 0) {
    log(state, seat, `${topCard(defender).name} is protected, so ${attack.name} did no damage.`, "attack");
    damage = 0;
  } else if (guard && damage > 0) {
    damage = Math.max(0, damage - guard);
  }
  if (damage > 0) {
    defender.damage += damage;
    log(state, seat, `${attack.name} did ${damage} damage to ${topCard(defender).name}.`, "attack");
  } else if (hasDamage && !protect) {
    log(state, seat, `${attack.name} did no damage.`, "attack");
  }
  const shielded = !!protect?.effects;

  // ----- Effects -----
  if ((m = find(new RegExp(`(?:(Flip a coin\\. )?(If heads, ))?(?:the Defending Pokémon|your opponent's Active Pokémon) is now ${CONDITION}(?:,? and ${CONDITION})?\\.`, "i")))) {
    if (headsFor(m, 1, 2) && !shielded) {
      for (const word of [m[3], m[4]].filter(Boolean)) {
        addCondition(defender, asCondition(word));
        log(state, seat, `${topCard(defender).name} is now ${word}.`);
      }
    }
  }
  if ((m = find(new RegExp(`Both Active Pokémon are now ${CONDITION}\\.`, "i")))) {
    if (!shielded) addCondition(defender, asCondition(m[1]));
    addCondition(attacker, asCondition(m[1]));
    log(state, seat, `Both Active Pokémon are now ${m[1]}.`);
  }
  if ((m = find(new RegExp(`This Pokémon is now ${CONDITION}\\.`, "i")))) {
    addCondition(attacker, asCondition(m[1]));
    log(state, seat, `${topCard(attacker).name} is now ${m[1]}.`);
  }
  if ((m = find(/Discard (all|an|a|one|two|three|four|five|\d+) (?:(\w+) )?Energy(?: cards?)? (?:from|attached to) this Pokémon\./i))) {
    const type = m[2] && ENERGY_TYPES.includes(m[2]) ? m[2] : null;
    const n = m[1].toLowerCase() === "all" ? attacker.energy.length : toCount(m[1]);
    const gone = discardEnergy(state, seat, attacker, n, type);
    log(state, seat, `${topCard(attacker).name} discarded ${plural(gone, "Energy")}.`);
  }
  if ((m = find(/(?:(Flip a coin\. )?(If heads, ))?[Dd]iscard (an|a|one|two|\d+) (?:(\w+) )?Energy (?:card )?(?:from|attached to) (?:your opponent's Active Pokémon|the Defending Pokémon)\./i))) {
    if (headsFor(m, 1, 2) && !shielded) {
      const type = m[4] && ENERGY_TYPES.includes(m[4]) ? m[4] : null;
      const gone = discardEnergy(state, oppSeat, defender, toCount(m[3]), type);
      if (gone) log(state, seat, `${plural(gone, "Energy")} was discarded from ${topCard(defender).name}.`);
    }
  }
  if ((m = find(/Heal (\d+) damage from this Pokémon(, and it recovers from all Special Conditions)?\./i))) {
    attacker.damage = Math.max(0, attacker.damage - Number(m[1]));
    if (m[2]) attacker.conditions = [];
  }
  if ((m = find(/This Pokémon also does (\d+) damage to itself\./i))) {
    attacker.damage += Number(m[1]);
    log(state, seat, `${topCard(attacker).name} took ${m[1]} damage itself.`);
  }
  if ((m = find(/(?:^|\s)Draw (\w+) cards?\./i))) {
    draw(p, toCount(m[1]));
    log(state, seat, `${p.name} drew ${plural(toCount(m[1]), "card")}.`);
  }
  if (find(/If tails, during your next turn, this Pokémon can't attack\./i) && lastFlip === false) attacker.cantAttackTurn = state.turn + 2;
  if (find(/During your next turn, this Pokémon can't (?:attack|use [^.]+)\./i)) attacker.cantAttackTurn = state.turn + 2;
  if ((m = find(/During Pokémon Checkup, put (\d+) damage counters on that Pokémon instead of 1\./i)) && defender.conditions.includes("poisoned")) {
    defender.effects.poisonDamage = Number(m[1]) * 10;
  }
  if (find(/During your opponent's next turn, attacks used by the Defending Pokémon cost Colorless more, and its Retreat Cost is Colorless more\./i) && !shielded) {
    defender.effects.attackTax = state.turn + 1;
    defender.effects.retreatTax = state.turn + 1;
  }
  if (find(/During your opponent's next turn, the Defending Pokémon's Retreat Cost is Colorless more\./i) && !shielded) defender.effects.retreatTax = state.turn + 1;
  if (find(/During your opponent's next turn, the Defending Pokémon can't attack\./i) && !shielded) defender.cantAttackTurn = state.turn + 1;
  if (find(/During your opponent's next turn, the Defending Pokémon can't retreat\./i) && !shielded) defender.effects.cantRetreat = state.turn + 1;
  if ((m = find(/(?:(Flip a coin\. )?(If heads, ))?[Dd]uring your opponent's next turn, prevent all damage (from and effects of attacks done to|done to) this Pokémon(?: by attacks)?\./i))) {
    if (headsFor(m, 1, 2)) {
      attacker.effects.protect = { turn: state.turn + 1, effects: m[3].includes("effects") };
      log(state, seat, `${topCard(attacker).name} will be protected from attacks during ${opp.name}'s next turn.`);
    }
  }
  if ((m = find(/During your opponent's next turn, this Pokémon takes (\d+) less damage from attacks\./i))) {
    attacker.effects.guard = { turn: state.turn + 1, amount: Number(m[1]) };
  }
  if ((m = find(/During your next turn, (?:attacks used by this Pokémon do|this Pokémon's [^.]+? attack does) (\d+) more damage[^.]*\./i))) {
    attacker.effects.boost = { turn: state.turn + 2, amount: Number(m[1]) };
  }

  // Damage to more than one Pokémon.
  if ((m = find(/This attack does (\d+) damage to each of your opponent's Pokémon\./i))) {
    const extra = protect ? 0 : finalDamage(state, seat, attacker, defender, Number(m[1]), text);
    defender.damage += extra;
    for (const s of opp.bench) s.damage += Number(m[1]);
    log(state, seat, `${attack.name} did ${m[1]} damage to each of ${opp.name}'s Pokémon.`);
  }
  if ((m = find(/(?:This attack )?(?:also )?does (\d+) damage to each of your opponent's Benched Pokémon\./i))) {
    for (const s of opp.bench) s.damage += Number(m[1]);
    if (opp.bench.length) log(state, seat, `${attack.name} did ${m[1]} damage to each of ${opp.name}'s Benched Pokémon.`);
  }
  if ((m = find(/(?:This attack )?(?:also )?does (\d+) damage to (\w+) of your opponent's Benched Pokémon\./i))) {
    const n = Math.min(toCount(m[2]), opp.bench.length);
    if (n) {
      ask(state, {
        seat,
        title: `Choose ${n} of ${opp.name}'s Benched Pokémon to take ${m[1]} damage`,
        zone: "oppBench",
        options: benchOptions(opp.bench),
        min: n,
        max: n,
        effect: "benchDamage",
        data: { amount: Number(m[1]) },
      });
    }
  }
  if ((m = find(/This attack does (\d+) damage to 1 of your opponent's Pokémon\./i))) {
    ask(state, {
      seat,
      title: `Choose 1 of ${opp.name}'s Pokémon to take ${m[1]} damage`,
      zone: "oppPokemon",
      options: ["active", ...benchOptions(opp.bench)],
      min: 1,
      max: 1,
      effect: "hitOne",
      data: { amount: Number(m[1]), text },
    });
  }
  if ((m = find(/This attack does (\d+) damage to 1 of your opponent's Benched Pokémon that has any damage counters on it\./i))) {
    const hurt = opp.bench.map((s, i) => (s.damage ? `bench:${i}` : "")).filter(Boolean);
    if (hurt.length) {
      ask(state, {
        seat,
        title: `Choose 1 of ${opp.name}'s damaged Benched Pokémon to take ${m[1]} damage`,
        zone: "oppBench",
        options: hurt,
        min: 1,
        max: 1,
        effect: "benchDamage",
        data: { amount: Number(m[1]) },
      });
    }
  }

  // Moving Pokémon around.
  if (find(/Switch this Pokémon with 1 of your Benched Pokémon\./i) && p.bench.length) {
    ask(state, { seat, title: "Choose a Benched Pokémon to switch with", zone: "myBench", options: benchOptions(p.bench), min: 1, max: 1, effect: "selfSwitch" });
  }
  if ((m = find(/(?:(Flip a coin\. )?(If heads, ))?[Ss]witch out your opponent's Active Pokémon to the Bench\./i)) && opp.bench.length && !shielded) {
    if (headsFor(m, 1, 2)) {
      ask(state, {
        seat: oppSeat,
        title: `${p.name}'s attack switches out your Active Pokémon. Choose a Benched Pokémon to send in`,
        zone: "myBench",
        options: benchOptions(opp.bench),
        min: 1,
        max: 1,
        effect: "switchOut",
      });
    }
  }
  if ((m = find(/(?:(Flip a coin\. )?(If heads, ))?[Ss]witch in 1 of your opponent's Benched Pokémon to the Active Spot\./i)) && opp.bench.length) {
    if (headsFor(m, 1, 2)) {
      ask(state, {
        seat,
        title: `Choose 1 of ${opp.name}'s Benched Pokémon to switch into the Active Spot`,
        zone: "oppBench",
        options: benchOptions(opp.bench),
        min: 1,
        max: 1,
        effect: "gustAttack",
      });
    }
  }

  // Cards moving between zones.
  if ((m = find(/Discard the top (\w+) cards? of (your|your opponent's) deck\./i))) {
    const who = m[2].toLowerCase() === "your" ? p : opp;
    const gone = who.deck.splice(0, toCount(m[1]));
    who.discard.push(...gone);
    log(state, seat, `${who.name} discarded the top ${plural(gone.length, "card")} of their deck.`);
  }
  if ((m = find(/Your opponent discards (\w+) cards? from their hand\./i))) {
    const n = Math.min(toCount(m[1]), opp.hand.length);
    if (n) {
      ask(state, {
        seat: oppSeat,
        title: `Discard ${plural(n, "card")} from your hand`,
        zone: "hand",
        options: opp.hand.map((c) => c.uid),
        min: n,
        max: n,
        effect: "discardHand",
        data: { step: "cost" },
      });
    }
  }
  if ((m = find(/Attach up to (\w+) Basic (\w+) Energy cards? from your discard pile to this Pokémon\./i))) {
    const cards = p.discard.filter((c) => isBasicEnergy(c) && c.name.includes(m![2])).slice(0, toCount(m[1]));
    for (const c of cards) p.discard.splice(p.discard.indexOf(c), 1);
    attacker.energy.push(...cards);
    if (cards.length) log(state, seat, `${p.name} attached ${plural(cards.length, "Energy card")} from their discard pile.`);
  }
  if ((m = find(/(?:(Flip a coin\. )?(If heads, ))?[Ss]earch your deck for (?:up to )?(\w+) Basic (\w+) Energy cards? and attach (?:it|them) to this Pokémon\. Then, shuffle your deck\./i))) {
    if (headsFor(m, 1, 2)) {
      const cards = p.deck.filter((c) => isBasicEnergy(c) && c.name.includes(m![4])).slice(0, toCount(m[3]));
      for (const c of cards) p.deck.splice(p.deck.indexOf(c), 1);
      attacker.energy.push(...cards);
      shuffle(p.deck);
      log(state, seat, `${p.name} attached ${plural(cards.length, "Energy card")} from their deck.`);
    }
  }
  if ((m = find(/Attach (?:a|an|1) Basic (\w+) Energy card from your discard pile to 1 of your Benched Pokémon\./i))) {
    if (p.bench.length && p.discard.some((c) => isBasicEnergy(c) && c.name.includes(m![1]))) {
      ask(state, {
        seat,
        title: `Choose a Benched Pokémon to attach a ${m[1]} Energy to`,
        zone: "myBench",
        options: benchOptions(p.bench),
        min: 1,
        max: 1,
        effect: "energyToBench",
        data: { type: m[1] },
      });
    }
  }
  if ((m = find(/Search your deck for (?:up to )?(\w+) (Basic Pokémon|[A-Z][^.,]*?) and put (?:it|them) onto your Bench\. Then, shuffle your deck\./))) {
    const room = BENCH_SIZE - p.bench.length;
    const named = m[2] === "Basic Pokémon" ? null : m[2];
    const options = p.deck.filter((c) => isBasicPokemon(c) && (!named || c.name === named)).map((c) => c.uid);
    if (room > 0 && options.length) {
      ask(state, {
        seat,
        title: `Choose up to ${Math.min(room, toCount(m[1]))} ${named ?? "Basic Pokémon"} for your Bench`,
        zone: "deck",
        options,
        shown: p.deck.map((c) => c.uid),
        min: 0,
        max: Math.min(room, toCount(m[1])),
        effect: "benchFromDeck",
      });
    } else {
      shuffle(p.deck);
    }
  }
  if ((m = find(/Search your deck for (?:up to )?(\w+) (cards?|Pokémon|Supporter cards?|Item cards?|Basic Energy cards?)(?:, reveal (?:it|them),)? and put (?:it|them) into your hand\. Then, shuffle your deck\./i))) {
    const kind = m[2].toLowerCase();
    const match = (c: PCard) =>
      kind.startsWith("pokémon") ? isPokemon(c) : kind.startsWith("supporter") ? isSupporter(c) : kind.startsWith("item") ? isItem(c) : kind.startsWith("basic energy") ? isBasicEnergy(c) : true;
    const options = p.deck.filter(match).map((c) => c.uid);
    if (options.length) {
      ask(state, {
        seat,
        title: `Choose up to ${toCount(m[1])} ${m[2]} to put into your hand`,
        zone: "deck",
        options,
        shown: p.deck.map((c) => c.uid),
        min: 0,
        max: toCount(m[1]),
        effect: "handFromDeck",
      });
    } else {
      shuffle(p.deck);
    }
  }
  if ((m = find(/Put up to (\w+) (Basic (\w+) Energy cards|Pokémon) from your discard pile into your hand\./i))) {
    const cards = p.discard.filter((c) => (m![3] ? isBasicEnergy(c) && c.name.includes(m![3]) : isPokemon(c))).slice(0, toCount(m[1]));
    for (const c of cards) p.discard.splice(p.discard.indexOf(c), 1);
    p.hand.push(...cards);
    log(state, seat, `${p.name} put ${plural(cards.length, "card")} from their discard pile into their hand.`);
  }
  if (find(/(?:You may d|D)iscard a Stadium in play\./i) && state.stadium) {
    state.players[state.stadium.owner].discard.push(state.stadium.card);
    log(state, seat, `${state.stadium.card.name} was discarded.`);
    state.stadium = null;
  }

  const leftover = rest.replace(/\s+/g, " ").trim();
  if (/[a-z]/i.test(leftover)) {
    log(state, seat, `Not automated in practice games: “${leftover.length > 140 ? `${leftover.slice(0, 137)}...` : leftover}”`, "system");
  }
}

type Resume = (state: PState, seat: Seat, picks: string[], data: Record<string, unknown>) => void;
const slotIndex = (key: string) => Number(key.split(":")[1]);

/** What happens once a player makes a choice an attack asked for. */
export const ATTACK_RESUME: Record<string, Resume> = {
  benchDamage(state, seat, picks, data) {
    const opp = state.players[otherSeat(seat)];
    for (const key of picks) {
      const slot = opp.bench[slotIndex(key)];
      if (!slot) continue;
      slot.damage += Number(data.amount);
      log(state, seat, `${data.amount} damage to ${topCard(slot).name} on the Bench.`);
    }
  },
  hitOne(state, seat, picks, data) {
    const p = state.players[seat];
    const opp = state.players[otherSeat(seat)];
    const slot = picks[0] === "active" ? opp.active : opp.bench[slotIndex(picks[0])];
    if (!slot || !p.active) return;
    const amount = picks[0] === "active" ? finalDamage(state, seat, p.active, slot, Number(data.amount), String(data.text ?? "")) : Number(data.amount);
    slot.damage += amount;
    log(state, seat, `${amount} damage to ${topCard(slot).name}.`);
  },
  selfSwitch(state, seat, picks) {
    const p = state.players[seat];
    const incoming = p.bench[slotIndex(picks[0])];
    if (!incoming) return;
    switchActive(p, slotIndex(picks[0]));
    log(state, seat, `${p.name} switched ${topCard(incoming).name} into the Active Spot.`);
  },
  switchOut(state, seat, picks) {
    const p = state.players[seat];
    const incoming = p.bench[slotIndex(picks[0])];
    if (!incoming) return;
    switchActive(p, slotIndex(picks[0]));
    log(state, seat, `${p.name} sent in ${topCard(incoming).name}.`);
  },
  gustAttack(state, seat, picks) {
    const opp = state.players[otherSeat(seat)];
    const incoming = opp.bench[slotIndex(picks[0])];
    if (!incoming) return;
    switchActive(opp, slotIndex(picks[0]));
    log(state, seat, `${topCard(incoming).name} was switched into ${opp.name}'s Active Spot.`);
  },
  discardHand(state, seat, picks) {
    const p = state.players[seat];
    const gone = p.hand.filter((c) => picks.includes(c.uid));
    p.hand = p.hand.filter((c) => !picks.includes(c.uid));
    p.discard.push(...gone);
    log(state, seat, `${p.name} discarded ${gone.map((c) => c.name).join(", ")}.`);
  },
  energyToBench(state, seat, picks, data) {
    const p = state.players[seat];
    const slot = p.bench[slotIndex(picks[0])];
    const card = p.discard.find((c) => isBasicEnergy(c) && c.name.includes(String(data.type)));
    if (!slot || !card) return;
    p.discard.splice(p.discard.indexOf(card), 1);
    slot.energy.push(card);
    log(state, seat, `${p.name} attached ${card.name} to ${topCard(slot).name}.`);
  },
  benchFromDeck(state, seat, picks) {
    const p = state.players[seat];
    const found = p.deck.filter((c) => picks.includes(c.uid)).slice(0, BENCH_SIZE - p.bench.length);
    p.deck = p.deck.filter((c) => !found.includes(c));
    for (const c of found) p.bench.push(newSlot(c, state.turn));
    shuffle(p.deck);
    log(state, seat, found.length ? `${p.name} put ${found.map((c) => c.name).join(", ")} onto their Bench.` : `${p.name} didn't take any Pokémon.`);
  },
  handFromDeck(state, seat, picks) {
    const p = state.players[seat];
    const found = p.deck.filter((c) => picks.includes(c.uid));
    p.deck = p.deck.filter((c) => !found.includes(c));
    p.hand.push(...found);
    shuffle(p.deck);
    log(state, seat, found.length ? `${p.name} put ${found.map((c) => c.name).join(", ")} into their hand.` : `${p.name} didn't take any cards.`);
  },
};
