// Attack rules: see attack-rules.ts for how they work.
// Group 3: healing, damage counters, bench damage, moving and attaching Energy, switching.

import { otherSeat, type Seat } from "../game-types";
import type { AttackCtx, AttackRule, Resume } from "./attack-rules";
import type { PCard, PPlayer, PSlot, PState, SlotKey } from "./types";
import {
  ENERGY_TYPES,
  ask,
  benchPokemon,
  draw,
  energyProvides,
  isBasicEnergy,
  isBasicPokemon,
  isEnergy,
  log,
  plural,
  shuffle,
  slotAt,
  switchActive,
  topCard,
} from "./engine";
import { attachedTo, benchLimit, isActive, maxHp, hpLeft, onEnergyFromHand, ownerOf, putCounters, hitWithAttack, inPlay } from "./effects";
import { ATTACK_RESUME, addCondition, benchDamage, countFor, finalDamage, toCount } from "./attacks";
import { countersMove, effectsProof, pickUpLocked } from "./abilities";
import { matchesFilter } from "./lasting";
import { heal } from "./trainers-more";
import { askChoice } from "./actions";
import { unitIs } from "./special-energy";

type Data = Record<string, unknown>;

/** A whole sentence: at the start of what's left, or after a full stop. */
const sen = (src: string) => new RegExp(`(?<=^\\s*|[.!]\\s+)${src}`, "i");

const bk = (i: number) => `bench:${i}`;
const idx = (key: string) => Number(key.split(":")[1]);
const nameOf = (slot: PSlot) => topCard(slot).name;
const me = (state: PState, seat: Seat) => state.players[seat];
const them = (state: PState, seat: Seat) => state.players[otherSeat(seat)];
const oppSlot = (state: PState, seat: Seat, key: string) => slotAt(them(state, seat), key as SlotKey);
const mySlot = (state: PState, seat: Seat, key: string) => slotAt(me(state, seat), key as SlotKey);
const keyOf = (p: PPlayer, slot: PSlot) => (p.active === slot ? "active" : bk(p.bench.indexOf(slot)));

/** Whether this attack's effects can't touch one of the opponent's Pokémon (protection, Abilities, Mist Energy). */
function guarded(state: PState, seat: Seat, slot: PSlot) {
  if (ownerOf(state, slot) === seat) return false;
  if (isActive(state, slot) && slot.effects.protect?.turn === state.turn && slot.effects.protect.effects) return true;
  const attacker = me(state, seat).active;
  return !!attacker && effectsProof(state, seat, attacker, slot);
}

/** The opponent's Pokémon this attack's effects can reach (keys), optionally only the Bench. */
function oppTargets(state: PState, seat: Seat, benchOnly: boolean, ok: (slot: PSlot) => boolean = () => true) {
  const opp = them(state, seat);
  return (benchOnly ? opp.bench : inPlay(opp)).filter((s) => ok(s) && !guarded(state, seat, s)).map((s) => keyOf(opp, s));
}

/** Puts damage counters on a Pokémon from an attack's effect. */
function counters(state: PState, seat: Seat, slot: PSlot, n: number) {
  if (n <= 0) return 0;
  if (guarded(state, seat, slot)) {
    log(state, seat, `${nameOf(slot)} isn't affected by the attack's effects.`);
    return 0;
  }
  const before = slot.damage;
  putCounters(state, seat, slot, n);
  const put = (slot.damage - before) / 10;
  if (put) log(state, seat, `${plural(put, "damage counter")} put on ${nameOf(slot)}.`);
  return put;
}

function healLog(state: PState, seat: Seat, slot: PSlot, amount: number) {
  const done = heal(slot, amount);
  if (done) log(state, seat, `${nameOf(slot)} healed ${done} damage.`);
  return done;
}

function knockOut(state: PState, seat: Seat, slot: PSlot) {
  slot.damage = Math.max(slot.damage, maxHp(state, slot));
  log(state, seat, `The attack Knocks Out ${nameOf(slot)}.`);
}

/** Damage from an attack to one of the attacker's own Benched Pokémon. */
function ownBenchDamage(state: PState, seat: Seat, slot: PSlot, amount: number) {
  slot.damage += amount;
  log(state, seat, `${amount} damage to ${nameOf(slot)} on ${me(state, seat).name}'s Bench.`);
}

/** Whether a Pokémon fits a word like "Psychic", "Ancient", "Basic" or "Team Rocket's". */
const fits = (state: PState, slot: PSlot, word: string | undefined) =>
  !word ? true : word === "Team Rocket's" ? nameOf(slot).startsWith("Team Rocket's") : matchesFilter(state, slot, word);

const provides = (c: PCard, type: string | undefined) => !type || energyProvides(c).some((u) => unitIs(u, type));
/** Basic Energy of a type ("Fighting Energy card" on a card means basic Fighting Energy). */
const basicOf = (type: string | undefined) => (c: PCard) => isBasicEnergy(c) && (!type || !ENERGY_TYPES.includes(type) || c.name.includes(type));
const typeWord = (w: string | undefined) => (w && ENERGY_TYPES.includes(w) ? w : undefined);

const labelled = (cards: PCard[]) => cards.map((c) => ({ id: c.uid, label: c.name }));
const sameCards = (cards: PCard[]) => new Set(cards.map((c) => c.name)).size <= 1;

// ----- Where Energy comes from while it's being attached -----

type From = "deck" | "discard" | "self" | "opp";
function pile(state: PState, seat: Seat, from: From): PCard[] {
  const p = me(state, seat);
  if (from === "deck") return p.deck;
  if (from === "discard") return p.discard;
  if (from === "opp") return them(state, seat).active?.energy ?? [];
  return p.active?.energy ?? [];
}
function attach(state: PState, seat: Seat, from: From, uids: string[], slot: PSlot) {
  const list = pile(state, seat, from);
  const moved: PCard[] = [];
  for (const uid of uids) {
    const i = list.findIndex((c) => c.uid === uid);
    if (i < 0) continue;
    moved.push(...list.splice(i, 1));
  }
  slot.energy.push(...moved);
  if (moved.length) {
    const how = from === "self" || from === "opp" ? "moved" : "attached";
    log(state, seat, `${me(state, seat).name} ${how} ${moved.map((c) => c.name).join(", ")} to ${nameOf(slot)}.`);
  }
  return moved.length;
}

/** Starts attaching the chosen Energy cards to Benched Pokémon ("in any way you like", or all to one with `single`). */
function spread(state: PState, seat: Seat, from: From, uids: string[], single = false) {
  R["atk:3:spread"](state, seat, [], { from, uids, single, step: "start" });
}

/** Lets the player choose `n` of these Energy (all at once when they're alike), then carries on with `then`. */
function pickEnergy(state: PState, seat: Seat, cards: PCard[], n: number, title: string, then: string, data: Data) {
  if (cards.length <= n || sameCards(cards))
    return R[then](
      state,
      seat,
      cards.slice(0, n).map((c) => c.uid),
      data,
    );
  askChoice(state, seat, title, labelled(cards), then, { min: n, max: n, data: { ...data, botPick: cards.slice(0, n).map((c) => c.uid) } });
}

/** A deck or discard pile search for Energy to attach. */
function findEnergy(ctx: AttackCtx, zone: "deck" | "discard", match: (c: PCard) => boolean, max: number, single: boolean) {
  const { state, seat, p } = ctx;
  const list = zone === "deck" ? p.deck : p.discard;
  const options = list.filter(match).map((c) => c.uid);
  if (!options.length || !p.bench.length) {
    if (zone === "deck") shuffle(p.deck);
    return;
  }
  ask(state, {
    seat,
    title: `Choose up to ${plural(max, "Energy card")} to attach to ${single ? "1 of your Benched Pokémon" : "your Benched Pokémon"}`,
    zone,
    options,
    ...(zone === "deck" ? { shown: p.deck.map((c) => c.uid) } : {}),
    min: 0,
    max: Math.min(max, options.length),
    effect: "atk:3:found",
    data: { from: zone, single },
  });
}

/** Asks for a Benched Pokémon of the player's (skipped when there's only one). */
function askBench(state: PState, seat: Seat, options: string[], title: string, effect: string, data: Data = {}) {
  if (!options.length) return;
  if (options.length === 1) return R[effect](state, seat, options, data);
  ask(state, { seat, title, zone: "myBench", options, min: 1, max: 1, effect, data });
}

/** Asks for one of the opponent's Pokémon (the zone depends on whether the Active can be chosen). */
function askOpp(state: PState, seat: Seat, options: string[], title: string, effect: string, data: Data = {}, n = 1) {
  const k = Math.min(n, options.length);
  if (!k) return;
  ask(state, {
    seat,
    title,
    zone: options.includes("active") ? "oppPokemon" : "oppBench",
    options,
    min: k,
    max: k,
    effect,
    data,
  });
}

// ----- Damage counters -----

/** "Put N damage counters on your opponent's (Benched) Pokémon in any way you like." */
function spreadCounters(state: PState, seat: Seat, left: number, benchOnly: boolean) {
  R["atk:3:counters"](state, seat, [], { left, benchOnly, step: "start" });
}

/** Moves damage counters from one Pokémon to another (not healing). */
function moveCounters(state: PState, seat: Seat, from: PSlot, to: PSlot, n: number) {
  const k = Math.min(n, from.damage / 10);
  if (k <= 0) return 0;
  from.damage -= k * 10;
  to.damage += k * 10;
  log(state, seat, `${plural(k, "damage counter")} moved from ${nameOf(from)} to ${nameOf(to)}.`);
  return k;
}

type Used = PPlayer & { atk3Used?: Record<string, number> };

export const rules3 = (): AttackRule[] => [
  // ----- Compound wording that other patterns would only partly read -----
  {
    re: sen(String.raw`Your opponent's Active Pokémon is now Poisoned\. During Pokémon Checkup, place (\d+) damage counters on that Pokémon instead of 1\.`),
    post(ctx, m) {
      if (ctx.shielded) return;
      addCondition(ctx.state, ctx.defender, "poisoned");
      if (!ctx.defender.conditions.includes("poisoned")) return;
      ctx.defender.effects.poisonDamage = Number(m[1]) * 10;
      log(ctx.state, ctx.seat, `${nameOf(ctx.defender)} is now Poisoned (${m[1]} damage counters each Pokémon Checkup).`);
    },
  },
  {
    re: /(?<=This Pokémon is now Asleep\.\s*)Heal (\d+) damage from it\./i,
    post: (ctx, m) => void healLog(ctx.state, ctx.seat, ctx.attacker, Number(m[1])),
  },
  {
    re: sen(
      String.raw`Search your deck for a Basic Pokémon and put it onto your Bench\. Then, shuffle your deck\. If you put any Pokémon onto your Bench in this way, move an Energy from this Pokémon to the new Benched Pokémon\.`,
    ),
    post(ctx) {
      const { state, seat, p } = ctx;
      const options = p.deck.filter(isBasicPokemon).map((c) => c.uid);
      if (!options.length || p.bench.length >= benchLimit(state, seat)) return void shuffle(p.deck);
      ask(state, {
        seat,
        title: "Choose a Basic Pokémon to put onto your Bench",
        zone: "deck",
        options,
        shown: p.deck.map((c) => c.uid),
        min: 0,
        max: 1,
        effect: "atk:3:benchThenEnergy",
      });
    },
  },
  {
    re: sen(String.raw`Discard an Energy from this Pokémon\. If you do, switch it with 1 of your Benched Pokémon\.`),
    post(ctx) {
      pickEnergy(ctx.state, ctx.seat, ctx.attacker.energy, 1, "Choose an Energy to discard", "atk:3:discardSelf", { then: "switch" });
    },
  },
  {
    re: sen(String.raw`Discard an Energy from this Pokémon and heal all damage from it\.`),
    post(ctx) {
      pickEnergy(ctx.state, ctx.seat, ctx.attacker.energy, 1, "Choose an Energy to discard", "atk:3:discardSelf", { then: "heal" });
    },
  },
  {
    re: sen(String.raw`Discard all Energy from this Pokémon and place (\d+) damage counters on 1 of your opponent's Pokémon\.`),
    post(ctx, m) {
      const gone = ctx.attacker.energy.splice(0);
      ctx.p.discard.push(...gone);
      if (gone.length) log(ctx.state, ctx.seat, `${nameOf(ctx.attacker)} discarded ${plural(gone.length, "Energy")}.`);
      const n = Number(m[1]);
      askOpp(ctx.state, ctx.seat, oppTargets(ctx.state, ctx.seat, false), `Choose 1 of ${ctx.opp.name}'s Pokémon for ${n} damage counters`, "atk:3:put", {
        n,
        amount: n * 10,
      });
    },
  },

  // ----- Healing -----
  {
    re: sen(String.raw`Heal (\d+|all) damage from 1 of your (Benched )?(?:(Team Rocket's|\w+) )?Pokémon\.`),
    post(ctx, m) {
      const { state, seat, p } = ctx;
      const amount = m[1].toLowerCase() === "all" ? 9999 : Number(m[1]);
      const word = m[3] === "Benched" ? undefined : m[3];
      const pool = m[2] || m[3] === "Benched" ? p.bench : inPlay(p);
      const options = pool.filter((s) => s.damage > 0 && fits(state, s, word)).map((s) => keyOf(p, s));
      if (!options.length) return;
      const title = `Choose 1 of your ${m[2] ? "Benched " : ""}${word ? `${word} ` : ""}Pokémon to heal`;
      if (options.length === 1) return R["atk:3:heal"](state, seat, options, { amount });
      ask(state, { seat, title, zone: "myPokemon", options, min: 1, max: 1, effect: "atk:3:heal", data: { amount } });
    },
  },
  {
    re: sen(String.raw`Heal (\d+) damage from each of your (Benched |Basic )?Pokémon\.`),
    post(ctx, m) {
      const which = m[2]?.trim();
      const pool = which === "Benched" ? ctx.p.bench : inPlay(ctx.p).filter((s) => which !== "Basic" || fits(ctx.state, s, "Basic"));
      for (const s of pool) healLog(ctx.state, ctx.seat, s, Number(m[1]));
    },
  },
  {
    re: sen(String.raw`Heal (\d+) damage from each Pokémon\.`),
    post(ctx, m) {
      for (const s of [...inPlay(ctx.p), ...inPlay(ctx.opp)]) healLog(ctx.state, ctx.seat, s, Number(m[1]));
    },
  },
  {
    re: sen(String.raw`Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon\.`),
    post: (ctx) => void healLog(ctx.state, ctx.seat, ctx.attacker, ctx.damageDone),
  },

  // ----- Damage counters -----
  {
    re: sen(
      String.raw`If you have (\d+) or more Pokémon that have the ([^.]+?) Ability in your discard pile, place (\d+) damage counters on each of your opponent's Pokémon\.`,
    ),
    post(ctx, m) {
      const n = ctx.p.discard.filter((c) => c.abilities.some((a) => a.name === m[2])).length;
      if (n < Number(m[1])) return void log(ctx.state, ctx.seat, `${ctx.p.name} has only ${n} Pokémon with ${m[2]} in their discard pile.`);
      for (const s of inPlay(ctx.opp)) counters(ctx.state, ctx.seat, s, Number(m[3]));
    },
  },
  {
    re: sen(
      String.raw`If your opponent's Active Pokémon is affected by a Special Condition, place (\d+) damage counters on 1 of your opponent's Benched Pokémon\.`,
    ),
    post(ctx, m) {
      if (!ctx.opp.active?.conditions.length) return;
      const n = Number(m[1]);
      askOpp(
        ctx.state,
        ctx.seat,
        oppTargets(ctx.state, ctx.seat, true),
        `Choose 1 of ${ctx.opp.name}'s Benched Pokémon for ${n} damage counters`,
        "atk:3:put",
        {
          n,
          amount: n * 10,
        },
      );
    },
  },
  {
    re: sen(
      String.raw`Put (\d+) damage counters on 1 of your opponent's Pokémon for each Basic (\w+) Energy card in your discard pile\. Then, shuffle those Energy cards into your deck\.`,
    ),
    post(ctx, m) {
      const cards = ctx.p.discard.filter(basicOf(m[2]));
      const n = Number(m[1]) * cards.length;
      if (n)
        askOpp(ctx.state, ctx.seat, oppTargets(ctx.state, ctx.seat, false), `Choose 1 of ${ctx.opp.name}'s Pokémon for ${n} damage counters`, "atk:3:put", {
          n,
          amount: n * 10,
        });
      ctx.p.discard = ctx.p.discard.filter((c) => !cards.includes(c));
      ctx.p.deck.push(...cards);
      shuffle(ctx.p.deck);
      log(ctx.state, ctx.seat, `${ctx.p.name} shuffled ${plural(cards.length, "Energy card")} into their deck.`);
    },
  },
  {
    re: sen(
      String.raw`(?:Put|Place) (\d+) damage counters? on your opponent's Active Pokémon for each (card in your hand|of your opponent's Benched Pokémon)\.`,
    ),
    post(ctx, m) {
      if (!ctx.shielded) counters(ctx.state, ctx.seat, ctx.defender, Number(m[1]) * (countFor(ctx.state, ctx.seat, m[2]) ?? 0));
    },
  },
  {
    re: sen(String.raw`Put (\d+) damage counters? on each of your opponent's Pokémon for each of your this Pokémon in play\.`),
    post(ctx, m) {
      const n = inPlay(ctx.p).filter((s) => nameOf(s) === nameOf(ctx.attacker)).length;
      for (const s of inPlay(ctx.opp)) counters(ctx.state, ctx.seat, s, Number(m[1]) * n);
    },
  },
  {
    re: sen(String.raw`(?:Put|Place) (\d+) damage counters? on your opponent's Active Pokémon\.`),
    post(ctx, m) {
      if (!ctx.shielded) counters(ctx.state, ctx.seat, ctx.defender, Number(m[1]));
    },
  },
  {
    re: sen(String.raw`(?:Put|Place) (\d+) damage counters? on 1 of your opponent's (Benched )?Pokémon\.`),
    post(ctx, m) {
      const n = Number(m[1]);
      const where = m[2] ? "Benched Pokémon" : "Pokémon";
      askOpp(
        ctx.state,
        ctx.seat,
        oppTargets(ctx.state, ctx.seat, !!m[2]),
        `Choose 1 of ${ctx.opp.name}'s ${where} for ${plural(n, "damage counter")}`,
        "atk:3:put",
        {
          n,
          amount: n * 10,
        },
      );
    },
  },
  {
    re: sen(String.raw`Choose (\w+) of your opponent's (Benched )?Pokémon and put (\d+) damage counters on each of them\.`),
    post(ctx, m) {
      const n = Number(m[3]);
      const k = toCount(m[1]);
      const where = m[2] ? "Benched Pokémon" : "Pokémon";
      askOpp(
        ctx.state,
        ctx.seat,
        oppTargets(ctx.state, ctx.seat, !!m[2]),
        `Choose ${k} of ${ctx.opp.name}'s ${where} for ${n} damage counters each`,
        "atk:3:put",
        { n, amount: n * 10 },
        k,
      );
    },
  },
  {
    re: sen(String.raw`Put (\d+) damage counters? on your opponent's (Benched )?Pokémon in any way you like\.`),
    post: (ctx, m) => spreadCounters(ctx.state, ctx.seat, Number(m[1]), !!m[2]),
  },
  {
    re: sen(String.raw`(?:Put|Place) (\d+) damage counters? on each of your opponent's (Benched )?Pokémon( that has any damage counters on it)?\.`),
    post(ctx, m) {
      const pool = (m[2] ? ctx.opp.bench : inPlay(ctx.opp)).filter((s) => !m[3] || s.damage > 0);
      for (const s of pool) counters(ctx.state, ctx.seat, s, Number(m[1]));
    },
  },
  {
    re: sen(String.raw`Put (\d+) damage counters on each Pokémon that has an Ability\.`),
    post(ctx, m) {
      for (const s of [...inPlay(ctx.p), ...inPlay(ctx.opp)]) if (topCard(s).abilities.length) counters(ctx.state, ctx.seat, s, Number(m[1]));
    },
  },
  {
    re: sen(
      String.raw`Put damage counters on (your opponent's Active Pokémon|1 of your opponent's Pokémon|each of your opponent's Benched Pokémon) until its remaining HP is (\d+)\.(\s*If you placed any damage counters in this way, this attack also does (\d+) damage to this Pokémon\.)?`,
    ),
    post(ctx, m) {
      const { state, seat } = ctx;
      const hp = Number(m[2]);
      const need = (s: PSlot) => Math.max(0, Math.ceil((hpLeft(state, s) - hp) / 10));
      let placed = 0;
      if (/^your/i.test(m[1])) {
        if (!ctx.shielded) placed = counters(state, seat, ctx.defender, need(ctx.defender));
      } else if (/^each/i.test(m[1])) {
        for (const s of ctx.opp.bench) placed += counters(state, seat, s, need(s));
      } else {
        const options = oppTargets(state, seat, false, (s) => need(s) > 0);
        askOpp(state, seat, options, `Choose 1 of ${ctx.opp.name}'s Pokémon to leave with ${hp} HP`, "atk:3:untilHp", { hp, amount: 990 });
      }
      if (m[3] && placed) {
        ctx.attacker.damage += Number(m[4]);
        log(state, seat, `${nameOf(ctx.attacker)} took ${m[4]} damage itself.`);
      }
    },
  },
  {
    re: sen(String.raw`Double the number of damage counters on each of your opponent's Pokémon\.`),
    post(ctx) {
      for (const s of inPlay(ctx.opp)) counters(ctx.state, ctx.seat, s, s.damage / 10);
    },
  },
  {
    re: sen(
      String.raw`Move all damage counters from 1 of your Benched (?:(Team Rocket's|\w+) )?Pokémon to (your opponent's Active Pokémon|1 of your opponent's Pokémon)\.`,
    ),
    post(ctx, m) {
      const { state, seat, p } = ctx;
      if (!countersMove(state)) return void log(state, seat, "Damage counters can't be moved right now.");
      const options = p.bench.filter((s) => s.damage > 0 && fits(state, s, m[1])).map((s) => keyOf(p, s));
      if (!options.length) return;
      const toActive = /Active/.test(m[2]);
      if (toActive && ctx.shielded) return;
      ask(state, {
        seat,
        title: "Choose a Benched Pokémon to move all damage counters from",
        zone: "myBench",
        options,
        min: 1,
        max: 1,
        effect: "atk:3:moveAll",
        data: { toActive, step: "from", botPick: [options.reduce((a, b) => (mySlot(state, seat, b)!.damage > mySlot(state, seat, a)!.damage ? b : a))] },
      });
    },
  },
  {
    re: sen(String.raw`Move (\d+) damage counters from each of your Pokémon to 1 of your opponent's Pokémon\.`),
    post(ctx, m) {
      const { state, seat } = ctx;
      if (!countersMove(state)) return void log(state, seat, "Damage counters can't be moved right now.");
      const total = inPlay(ctx.p).reduce((n, s) => n + Math.min(Number(m[1]), s.damage / 10), 0);
      if (!total) return;
      askOpp(
        state,
        seat,
        oppTargets(state, seat, false),
        `Choose 1 of ${ctx.opp.name}'s Pokémon to move ${plural(total, "damage counter")} to`,
        "atk:3:gatherTo",
        {
          n: Number(m[1]),
          amount: total * 10,
        },
      );
    },
  },
  {
    re: sen(String.raw`You may move any number of damage counters from your opponent's Benched Pokémon to their Active Pokémon\.`),
    post(ctx) {
      if (!countersMove(ctx.state) || ctx.shielded) return;
      R["atk:3:shiftCounters"](ctx.state, ctx.seat, [], { step: "start", toActive: true });
    },
  },
  {
    re: sen(String.raw`You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like\.`),
    post(ctx) {
      if (!countersMove(ctx.state)) return;
      R["atk:3:shiftCounters"](ctx.state, ctx.seat, [], { step: "start", toActive: false });
    },
  },
  {
    re: sen(String.raw`If your opponent's Active Pokémon has (exactly )?(\d+)( or more)? damage counters on it, that Pokémon is Knocked Out\.`),
    post(ctx, m) {
      const d = ctx.opp.active;
      if (!d || ctx.shielded || d !== ctx.defender) return;
      const n = d.damage / 10;
      if (m[3] ? n >= Number(m[2]) : n === Number(m[2])) knockOut(ctx.state, ctx.seat, d);
    },
  },
  {
    re: sen(String.raw`Knock Out 1 of your opponent's Pokémon that has exactly (\d+) damage counters on it\.`),
    post(ctx, m) {
      const options = oppTargets(ctx.state, ctx.seat, false, (s) => s.damage === Number(m[1]) * 10);
      askOpp(ctx.state, ctx.seat, options, `Choose 1 of ${ctx.opp.name}'s Pokémon to Knock Out`, "atk:3:knockOut", { amount: 9999 });
    },
  },

  // ----- Damage to Benched Pokémon -----
  {
    re: sen(String.raw`This attack also does (\d+) damage to each Benched Pokémon( that has any damage counters on it)?\.`),
    post(ctx, m) {
      const n = Number(m[1]);
      const hurt = (s: PSlot) => !m[2] || s.damage > 0;
      const mine = ctx.p.bench.filter(hurt);
      const theirs = ctx.opp.bench.filter(hurt);
      for (const s of theirs) log(ctx.state, ctx.seat, `${benchDamage(ctx.state, ctx.seat, s, n)} damage to ${nameOf(s)} on the Bench.`);
      for (const s of mine) ownBenchDamage(ctx.state, ctx.seat, s, n);
    },
  },
  {
    re: sen(String.raw`This attack also does (\d+) damage to each of your Benched Pokémon\.`),
    post(ctx, m) {
      for (const s of ctx.p.bench) ownBenchDamage(ctx.state, ctx.seat, s, Number(m[1]));
    },
  },
  {
    re: sen(String.raw`This attack also does (\d+) damage to 1 of your Benched Pokémon\.`),
    post(ctx, m) {
      const { state, seat, p } = ctx;
      const options = p.bench.map((_, i) => bk(i));
      // The computer picks the Pokémon with the most HP left.
      const sturdy = options.reduce((a, b) => (hpLeft(state, mySlot(state, seat, b)!) > hpLeft(state, mySlot(state, seat, a)!) ? b : a), options[0]);
      askBench(state, seat, options, `Choose 1 of your Benched Pokémon to take ${m[1]} damage`, "atk:3:ownBench", { amount: Number(m[1]), botPick: [sturdy] });
    },
  },
  {
    re: sen(String.raw`This attack also does (\d+) damage to 1 of your opponent's Benched Pokémon( V| that has any damage counters on it)\.`),
    post(ctx, m) {
      const ok = (s: PSlot) => (m[2].trim() === "V" ? matchesFilter(ctx.state, s, "V") : s.damage > 0);
      const options = ctx.opp.bench.filter(ok).map((s) => keyOf(ctx.opp, s));
      askOpp(ctx.state, ctx.seat, options, `Choose 1 of ${ctx.opp.name}'s Benched Pokémon to take ${m[1]} damage`, "atk:3:benchHit", { amount: Number(m[1]) });
    },
  },
  {
    re: sen(String.raw`If a Stadium is in play, this attack also does (\d+) damage to each of your opponent's Benched Pokémon, and discard that Stadium\.`),
    post(ctx, m) {
      const { state, seat } = ctx;
      if (!state.stadium) return;
      for (const s of ctx.opp.bench) log(state, seat, `${benchDamage(state, seat, s, Number(m[1]))} damage to ${nameOf(s)} on the Bench.`);
      state.players[state.stadium.owner].discard.push(state.stadium.card);
      log(state, seat, `${state.stadium.card.name} was discarded.`);
      state.stadium = null;
    },
  },
  {
    re: sen(String.raw`This attack also does (\d+) damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken\.`),
    post(ctx, m) {
      const n = Number(m[1]) * (countFor(ctx.state, ctx.seat, "prize card your opponent has taken") ?? 0);
      if (!n) return;
      for (const s of ctx.opp.bench) log(ctx.state, ctx.seat, `${benchDamage(ctx.state, ctx.seat, s, n)} damage to ${nameOf(s)} on the Bench.`);
    },
  },
  {
    re: sen(String.raw`This Pokémon also does (\d+) damage to itself for each damage counter on it\.`),
    pre(ctx) {
      ctx.memo.selfCounters = ctx.attacker.damage / 10;
    },
    post(ctx, m) {
      const n = Number(m[1]) * Number(ctx.memo.selfCounters ?? 0);
      if (!n) return;
      ctx.attacker.damage += n;
      log(ctx.state, ctx.seat, `${nameOf(ctx.attacker)} took ${n} damage itself.`);
    },
  },
  {
    re: sen(String.raw`This attack does (\d+) damage to 1 of your opponent's Pokémon\. Also apply Weakness and Resistance for Benched Pokémon\.`),
    post(ctx, m) {
      const options = inPlay(ctx.opp).map((s) => keyOf(ctx.opp, s));
      askOpp(ctx.state, ctx.seat, options, `Choose 1 of ${ctx.opp.name}'s Pokémon to take ${m[1]} damage`, "atk:3:hitAny", {
        amount: Number(m[1]),
        text: ctx.text,
      });
    },
  },

  // ----- Attaching Energy -----
  {
    re: sen(
      String.raw`Search your deck for up to (\w+) (?:Basic |basic )?(?:(\w+) )?Energy cards and attach them to (your Benched Pokémon in any way you like|1 of your Benched Pokémon)\. Then, shuffle your deck\.`,
    ),
    post: (ctx, m) => findEnergy(ctx, "deck", basicOf(typeWord(m[2])), toCount(m[1]), m[3].startsWith("1")),
  },
  {
    re: sen(
      String.raw`Attach up to (\w+) (?:Basic|basic) (?:(\w+) )?Energy cards from your discard pile to (your Benched Pokémon in any way you like|1 of your Benched Pokémon)\.`,
    ),
    post: (ctx, m) => findEnergy(ctx, "discard", basicOf(typeWord(m[2])), toCount(m[1]), m[3].startsWith("1")),
  },
  {
    re: sen(String.raw`Attach a (?:Basic|basic) Energy card from your discard pile to 1 of your Benched Pokémon\.`),
    post: (ctx) => findEnergy(ctx, "discard", isBasicEnergy, 1, true),
  },
  {
    re: sen(
      String.raw`For each of your Benched Pokémon, search your deck for a Basic (\w+) Energy card and attach it to that Pokémon\. Then, shuffle your deck\.`,
    ),
    post(ctx, m) {
      for (const s of ctx.p.bench) {
        const e = ctx.p.deck.find(basicOf(m[1]));
        if (e) attach(ctx.state, ctx.seat, "deck", [e.uid], s);
      }
      shuffle(ctx.p.deck);
    },
  },
  {
    re: sen(String.raw`Attach a Basic (\w+) Energy card from your discard pile to each of your Benched Pokémon\.`),
    post(ctx, m) {
      for (const s of ctx.p.bench) {
        const e = ctx.p.discard.find(basicOf(m[1]));
        if (e) attach(ctx.state, ctx.seat, "discard", [e.uid], s);
      }
    },
  },
  {
    re: sen(
      String.raw`Choose up to (\w+) of your Benched Pokémon\. For each of those Pokémon, search your deck for a (?:Basic|basic) (?:(\w+) )?Energy card and attach it to that Pokémon\. Then, shuffle your deck\.`,
    ),
    post(ctx, m) {
      askEachBench(ctx, toCount(m[1]), "deck", typeWord(m[2]));
    },
  },
  {
    re: sen(String.raw`Choose up to (\w+) of your Benched Pokémon and attach a Basic (\w+) Energy card from your discard pile to each of them\.`),
    post(ctx, m) {
      askEachBench(ctx, toCount(m[1]), "discard", typeWord(m[2]));
    },
  },
  {
    re: sen(String.raw`Attach a Basic (\w+) Energy card from your hand to 1 of your Benched Pokémon\.(\s*If you do, heal all damage from that Pokémon\.)?`),
    post(ctx, m) {
      const { state, seat, p } = ctx;
      const e = p.hand.find(basicOf(m[1]));
      if (!e || !p.bench.length) return;
      askBench(
        state,
        seat,
        p.bench.map((_, i) => bk(i)),
        `Choose a Benched Pokémon to attach ${e.name} to`,
        "atk:3:fromHand",
        { uid: e.uid, heal: !!m[2] },
      );
    },
  },

  // ----- Moving Energy -----
  {
    re: sen(String.raw`Move all Energy from this Pokémon to your Benched Pokémon in any way you like\.`),
    post(ctx) {
      spread(
        ctx.state,
        ctx.seat,
        "self",
        ctx.attacker.energy.map((c) => c.uid),
      );
    },
  },
  {
    re: sen(String.raw`Move (an|a|all|\d+) (Basic |basic )?(?:(\w+) )?Energy from this Pokémon to 1 of your Benched Pokémon\.`),
    post(ctx, m) {
      const { state, seat, attacker, p } = ctx;
      if (!p.bench.length) return;
      const type = typeWord(m[3]);
      const cards = attacker.energy.filter((c) => (!m[2] || isBasicEnergy(c)) && provides(c, type));
      const n = m[1].toLowerCase() === "all" ? cards.length : toCount(m[1]);
      if (!cards.length) return;
      pickEnergy(state, seat, cards, Math.min(n, cards.length), `Choose ${plural(Math.min(n, cards.length), "Energy")} to move`, "atk:3:picked", {
        from: "self",
      });
    },
  },
  {
    re: sen(String.raw`You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon\.`),
    post(ctx) {
      const { state, seat, defender, opp } = ctx;
      if (ctx.shielded || !defender.energy.length || !opp.bench.length || opp.active !== defender) return;
      askChoice(
        state,
        seat,
        `You may move an Energy from ${nameOf(defender)} to 1 of ${opp.name}'s Benched Pokémon`,
        labelled(defender.energy),
        "atk:3:oppEnergy",
        {
          min: 0,
          max: 1,
          data: { step: "which", botPick: [defender.energy[defender.energy.length - 1].uid] },
        },
      );
    },
  },
  {
    re: sen(String.raw`Put a Special Energy attached to 1 of your opponent's Pokémon in the Lost Zone\.`),
    post(ctx) {
      const options = oppTargets(ctx.state, ctx.seat, false, (s) => s.energy.some((e) => isEnergy(e) && !isBasicEnergy(e)));
      askOpp(ctx.state, ctx.seat, options, `Choose 1 of ${ctx.opp.name}'s Pokémon to take a Special Energy from`, "atk:3:lostEnergy", { step: "slot" });
    },
  },

  // ----- Switching and moving Pokémon -----
  {
    re: sen(String.raw`(You may )?[Ss]witch this Pokémon with 1 of your Benched (?!Pokémon\.)([^.,]+?)\.`),
    post(ctx, m) {
      const { state, seat, p } = ctx;
      const what = m[2].replace(/ Pokémon$/, "");
      const ok = (s: PSlot) => (/ Pokémon$/.test(m[2]) ? fits(state, s, what) : nameOf(s) === what);
      const options = p.bench.filter(ok).map((s) => keyOf(p, s));
      if (!options.length) return;
      ask(state, {
        seat,
        title: `Choose a Benched ${m[2]} to switch with${m[1] ? " (or none)" : ""}`,
        zone: "myBench",
        options,
        min: m[1] ? 0 : 1,
        max: 1,
        effect: "atk:3:selfSwitch",
      });
    },
  },
  {
    re: sen(String.raw`Your opponent chooses 1 of their Benched Pokémon and switches it with their Active Pokémon\. The new Active Pokémon is now (\w+)\.`),
    post(ctx, m) {
      if (ctx.shielded || !ctx.opp.bench.length) return;
      ask(ctx.state, {
        seat: ctx.oppSeat,
        title: `${ctx.p.name}'s attack switches out your Active Pokémon. Choose a Benched Pokémon to send in`,
        zone: "myBench",
        options: ctx.opp.bench.map((_, i) => bk(i)),
        min: 1,
        max: 1,
        effect: "atk:3:oppSwitch",
        data: { condition: m[1], attacker: ctx.seat },
      });
    },
  },
  {
    re: sen(String.raw`(You may have your opponent switch|Your opponent switches) their Active Pokémon with 1 of their Benched Pokémon\.`),
    post(ctx, m) {
      if (ctx.shielded || !ctx.opp.bench.length) return;
      if (/^You may/i.test(m[1])) {
        askChoice(
          ctx.state,
          ctx.seat,
          `Have ${ctx.opp.name} switch their Active Pokémon?`,
          [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ],
          "atk:3:maySwitch",
          { data: { botPick: ["yes"] } },
        );
      } else R["atk:3:maySwitch"](ctx.state, ctx.seat, ["yes"], {});
    },
  },
  {
    re: sen(
      String.raw`(?:Switch in 1 of your opponent's Benched Pokémon to the Active Spot|Switch 1 of your opponent's Benched Pokémon with their Active Pokémon)\. The new Active Pokémon is now (\w+)\.`,
    ),
    post(ctx, m) {
      if (!ctx.opp.bench.length) return;
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Choose 1 of ${ctx.opp.name}'s Benched Pokémon to switch into the Active Spot`,
        zone: "oppBench",
        options: ctx.opp.bench.map((_, i) => bk(i)),
        min: 1,
        max: 1,
        effect: "atk:3:gust",
        data: { condition: m[1] },
      });
    },
  },
  {
    re: sen(String.raw`Put 1 of your Benched Pokémon and all attached cards into your hand\.`),
    post(ctx) {
      const { state, seat, p } = ctx;
      if (!p.bench.length) return;
      if (pickUpLocked(state, seat)) return void log(state, seat, `${p.name}'s Pokémon can't be put into their hand right now.`);
      ask(state, {
        seat,
        title: "Choose a Benched Pokémon to put into your hand",
        zone: "myBench",
        options: p.bench.map((_, i) => bk(i)),
        min: 1,
        max: 1,
        effect: "atk:3:benchAway",
        data: { to: "hand" },
      });
    },
  },
  {
    re: sen(String.raw`Shuffle 1 of your Benched Pokémon and all attached cards into your deck\.`),
    post(ctx) {
      const { state, seat, p } = ctx;
      if (!p.bench.length) return;
      ask(state, {
        seat,
        title: "Choose a Benched Pokémon to shuffle into your deck",
        zone: "myBench",
        options: p.bench.map((_, i) => bk(i)),
        min: 1,
        max: 1,
        effect: "atk:3:benchAway",
        data: { to: "deck" },
      });
    },
  },
  {
    re: sen(
      String.raw`Choose 1 of your opponent's Benched Pokémon\. Shuffle that Pokémon and all attached cards into their deck, and then shuffle this Pokémon and all attached cards into your deck\. If your opponent has no Benched Pokémon, this attack does nothing\.`,
    ),
    pre(ctx) {
      if (!ctx.opp.bench.length) ctx.nothing = true;
    },
    post(ctx) {
      const options = oppTargets(ctx.state, ctx.seat, true);
      if (!options.length) return R["atk:3:byeBye"](ctx.state, ctx.seat, [], {});
      askOpp(ctx.state, ctx.seat, options, `Choose 1 of ${ctx.opp.name}'s Benched Pokémon to shuffle into their deck`, "atk:3:byeBye");
    },
  },
  {
    re: sen(
      String.raw`Choose (\w+) of your opponent's Benched Pokémon\. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck\.`,
    ),
    post(ctx, m) {
      const k = toCount(m[1]);
      if (ctx.opp.bench.length <= k) return;
      askOpp(
        ctx.state,
        ctx.seat,
        ctx.opp.bench.map((_, i) => bk(i)),
        `Choose ${k} of ${ctx.opp.name}'s Benched Pokémon to keep`,
        "atk:3:keepBench",
        {},
        k,
      );
    },
  },
  {
    re: sen(String.raw`Choose (\w+) of your opponent's Benched Pokémon\. Shuffle those Pokémon and all attached cards into your opponent's deck\.`),
    post(ctx, m) {
      const options = oppTargets(ctx.state, ctx.seat, true);
      askOpp(
        ctx.state,
        ctx.seat,
        options,
        `Choose ${m[1]} of ${ctx.opp.name}'s Benched Pokémon to shuffle into their deck`,
        "atk:3:shuffleOpp",
        {},
        toCount(m[1]),
      );
    },
  },
  {
    re: sen(String.raw`If 1 of your Pokémon used ([^.]+?) during your last turn, this attack can't be used\.`),
    canUse(state, seat, attack, m) {
      const used = (state.players[seat] as Used).atk3Used?.[m[1]];
      return used !== undefined && used === state.turn - 2
        ? `${attack.name} can't be used because 1 of your Pokémon used ${m[1]} during your last turn.`
        : null;
    },
    post(ctx) {
      ((ctx.p as Used).atk3Used ??= {})[ctx.attack.name] = ctx.state.turn;
    },
  },

  // ----- Whether the attack does anything, and its damage -----
  {
    re: sen(String.raw`If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing\.`),
    pre(ctx) {
      if (!ctx.defender.damage) ctx.nothing = true;
    },
  },
  {
    re: sen(String.raw`If you have (\d+) or fewer Benched Pokémon, this attack does nothing\.`),
    pre(ctx, m) {
      if (ctx.p.bench.length <= Number(m[1])) ctx.nothing = true;
    },
  },
  {
    re: sen(String.raw`If this Pokémon has (\d+) or more damage counters on it, this attack does nothing\.`),
    pre(ctx, m) {
      if (ctx.attacker.damage / 10 >= Number(m[1])) ctx.nothing = true;
    },
  },
  {
    re: sen(String.raw`If this Pokémon has any damage counters on it, this attack does (\d+) more\.`),
    pre(ctx, m) {
      if (ctx.attacker.damage > 0) ctx.base += Number(m[1]);
    },
  },

  // ----- Cards -----
  {
    re: sen(String.raw`Shuffle your hand into your deck\. Then, draw a card for each Benched Pokémon\.`),
    post(ctx) {
      const { state, seat, p, opp } = ctx;
      p.deck.push(...p.hand.splice(0));
      shuffle(p.deck);
      const n = p.bench.length + opp.bench.length;
      draw(p, n);
      log(state, seat, `${p.name} shuffled their hand into their deck and drew ${plural(n, "card")}.`);
    },
  },
  {
    re: sen(
      String.raw`For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it\. Then, shuffle your deck\.`,
    ),
    post(ctx) {
      const { p } = ctx;
      const queue = p.bench.map((s, i) => (p.deck.some((c) => c.evolvesFrom === nameOf(s)) ? bk(i) : "")).filter(Boolean);
      ATTACK_RESUME.tmEvolve(ctx.state, ctx.seat, [], { queue });
    },
  },
];

/** "Choose up to N of your Benched Pokémon" and attach an Energy card to each from the deck or discard pile. */
function askEachBench(ctx: AttackCtx, max: number, from: "deck" | "discard", type: string | undefined) {
  const { state, seat, p } = ctx;
  const has = pile(state, seat, from).some(basicOf(type));
  if (!has || !p.bench.length) {
    if (from === "deck") shuffle(p.deck);
    return;
  }
  ask(state, {
    seat,
    title: `Choose up to ${plural(max, "Benched Pokémon")} to attach ${type ? `a Basic ${type}` : "a Basic"} Energy card to`,
    zone: "myBench",
    options: p.bench.map((_, i) => bk(i)),
    min: 0,
    max: Math.min(max, p.bench.length),
    effect: "atk:3:eachBench",
    data: { from, type: type ?? "", step: "bench" },
  });
}

const R: Record<string, Resume> = {
  "atk:3:heal"(state, seat, picks, data) {
    const slot = mySlot(state, seat, picks[0]);
    if (slot) healLog(state, seat, slot, Number(data.amount));
  },
  "atk:3:put"(state, seat, picks, data) {
    for (const key of picks) {
      const slot = oppSlot(state, seat, key);
      if (slot) counters(state, seat, slot, Number(data.n));
    }
  },
  "atk:3:untilHp"(state, seat, picks, data) {
    const slot = oppSlot(state, seat, picks[0]);
    if (slot) counters(state, seat, slot, Math.max(0, Math.ceil((hpLeft(state, slot) - Number(data.hp)) / 10)));
  },
  "atk:3:knockOut"(state, seat, picks) {
    const slot = oppSlot(state, seat, picks[0]);
    if (slot) knockOut(state, seat, slot);
  },
  "atk:3:counters"(state, seat, picks, data) {
    const opp = them(state, seat);
    let left = Number(data.left);
    if (data.step === "to" && picks.length) {
      const slot = oppSlot(state, seat, picks[0]);
      if (slot && left > 1) {
        const need = Math.max(1, Math.min(left, Math.ceil(hpLeft(state, slot) / 10)));
        askChoice(
          state,
          seat,
          `How many damage counters on ${nameOf(slot)}?`,
          Array.from({ length: left }, (_, i) => ({ id: String(i + 1), label: String(i + 1) })),
          "atk:3:counters",
          { data: { ...data, step: "count", target: picks[0], botPick: [String(need)] } },
        );
        return;
      }
      if (slot) left -= counters(state, seat, slot, 1) || 1;
    } else if (data.step === "count") {
      const slot = oppSlot(state, seat, String(data.target));
      const n = Math.min(left, Number(picks[0]) || 1);
      if (slot) counters(state, seat, slot, n);
      left -= n;
    }
    if (left <= 0) return;
    const options = oppTargets(state, seat, !!data.benchOnly);
    if (!options.length) return;
    if (options.length === 1) return void counters(state, seat, oppSlot(state, seat, options[0])!, left);
    askOpp(state, seat, options, `Put ${plural(left, "damage counter")} on ${opp.name}'s Pokémon: choose where the next go`, "atk:3:counters", {
      ...data,
      left,
      step: "to",
      amount: left * 10,
    });
  },
  "atk:3:moveAll"(state, seat, picks, data) {
    const p = me(state, seat);
    const opp = them(state, seat);
    if (data.step === "from") {
      const from = mySlot(state, seat, picks[0]);
      if (!from) return;
      if (data.toActive) {
        if (opp.active && !guarded(state, seat, opp.active)) moveCounters(state, seat, from, opp.active, from.damage / 10);
        return;
      }
      askOpp(state, seat, oppTargets(state, seat, false), `Choose 1 of ${opp.name}'s Pokémon to move ${nameOf(from)}'s damage counters to`, "atk:3:moveAll", {
        step: "to",
        from: picks[0],
        amount: from.damage,
      });
      return;
    }
    const from = slotAt(p, String(data.from) as SlotKey);
    const to = oppSlot(state, seat, picks[0]);
    if (from && to) moveCounters(state, seat, from, to, from.damage / 10);
  },
  "atk:3:gatherTo"(state, seat, picks, data) {
    const to = oppSlot(state, seat, picks[0]);
    if (!to) return;
    for (const s of inPlay(me(state, seat))) moveCounters(state, seat, s, to, Number(data.n));
  },
  "atk:3:shiftCounters"(state, seat, picks, data) {
    const opp = them(state, seat);
    if (data.step === "from") {
      if (!picks.length) return;
      if (data.toActive) {
        return R["atk:3:shiftCounters"](state, seat, ["active"], { ...data, step: "to", from: picks[0] });
      }
      const options = oppTargets(state, seat, false).filter((k) => k !== picks[0]);
      if (!options.length) return;
      askOpp(state, seat, options, "Choose a Pokémon to move the damage counters to", "atk:3:shiftCounters", { ...data, step: "to", from: picks[0] });
      return;
    }
    if (data.step === "to") {
      const from = oppSlot(state, seat, String(data.from));
      if (!from || !picks.length) return;
      const n = from.damage / 10;
      if (n === 1) return R["atk:3:shiftCounters"](state, seat, ["1"], { ...data, step: "count", to: picks[0] });
      askChoice(
        state,
        seat,
        `How many damage counters to move from ${nameOf(from)}?`,
        Array.from({ length: n }, (_, i) => ({ id: String(n - i), label: String(n - i) })),
        "atk:3:shiftCounters",
        { data: { ...data, step: "count", to: picks[0], botPick: [String(n)] } },
      );
      return;
    }
    if (data.step === "count") {
      const from = oppSlot(state, seat, String(data.from));
      const to = oppSlot(state, seat, String(data.to));
      if (from && to) moveCounters(state, seat, from, to, Number(picks[0]) || 0);
    }
    // Pick the next Pokémon to move counters from (choosing none stops).
    const sources = oppTargets(state, seat, !!data.toActive, (s) => s.damage > 0);
    if (!sources.length || !opp.active) return;
    const most = sources.reduce((a, b) => (oppSlot(state, seat, b)!.damage > oppSlot(state, seat, a)!.damage ? b : a));
    ask(state, {
      seat,
      title: data.toActive
        ? `Move damage counters from 1 of ${opp.name}'s Benched Pokémon to their Active Pokémon (or stop)`
        : `Move damage counters from 1 of ${opp.name}'s Pokémon (or stop)`,
      zone: sources.includes("active") ? "oppPokemon" : "oppBench",
      options: sources,
      min: 0,
      max: 1,
      effect: "atk:3:shiftCounters",
      data: { toActive: data.toActive, step: "from", botPick: data.toActive ? [most] : [] },
    });
  },
  "atk:3:ownBench"(state, seat, picks, data) {
    const slot = mySlot(state, seat, picks[0]);
    if (slot) ownBenchDamage(state, seat, slot, Number(data.amount));
  },
  "atk:3:benchHit"(state, seat, picks, data) {
    const slot = oppSlot(state, seat, picks[0]);
    if (slot) log(state, seat, `${benchDamage(state, seat, slot, Number(data.amount))} damage to ${nameOf(slot)} on the Bench.`);
  },
  "atk:3:hitAny"(state, seat, picks, data) {
    const attacker = me(state, seat).active;
    const slot = oppSlot(state, seat, picks[0]);
    if (!slot || !attacker) return;
    const protectedNow = isActive(state, slot) && slot.effects.protect?.turn === state.turn;
    const amount = protectedNow ? 0 : finalDamage(state, seat, attacker, slot, Number(data.amount), String(data.text ?? ""));
    hitWithAttack(state, seat, attacker, slot, amount);
    log(state, seat, `${amount} damage to ${nameOf(slot)}.`);
  },
  "atk:3:found"(state, seat, picks, data) {
    const from = data.from as "deck" | "discard";
    if (!picks.length) {
      if (from === "deck") shuffle(me(state, seat).deck);
      return;
    }
    spread(state, seat, from, picks, !!data.single);
  },
  "atk:3:picked"(state, seat, picks, data) {
    spread(state, seat, data.from as From, picks, true);
  },
  "atk:3:spread"(state, seat, picks, data) {
    const p = me(state, seat);
    const from = data.from as From;
    const list = pile(state, seat, from);
    let uids = (data.uids as string[]).filter((u) => list.some((c) => c.uid === u));
    const finish = () => {
      if (from === "deck") shuffle(p.deck);
    };
    if (data.step === "to" && picks.length) {
      const slot = p.bench[idx(picks[0])];
      if (slot && (data.single || uids.length === 1)) {
        attach(state, seat, from, uids, slot);
        uids = [];
      } else if (slot) {
        const cards = uids.map((u) => list.find((c) => c.uid === u)!);
        askChoice(state, seat, `Choose the Energy to attach to ${nameOf(slot)}`, labelled(cards), "atk:3:spread", {
          min: 1,
          max: cards.length,
          data: { ...data, uids, step: "which", target: picks[0] },
        });
        return;
      }
    } else if (data.step === "which") {
      const slot = p.bench[idx(String(data.target))];
      if (slot) attach(state, seat, from, picks, slot);
      uids = uids.filter((u) => !picks.includes(u));
    }
    if (!uids.length || !p.bench.length) return finish();
    if (p.bench.length === 1) {
      attach(state, seat, from, uids, p.bench[0]);
      return finish();
    }
    ask(state, {
      seat,
      title: data.single ? "Choose a Benched Pokémon to attach the Energy to" : `Choose a Benched Pokémon to attach Energy to (${uids.length} left)`,
      zone: "myBench",
      options: p.bench.map((_, i) => bk(i)),
      min: 1,
      max: 1,
      effect: "atk:3:spread",
      data: { ...data, uids, step: "to" },
    });
  },
  "atk:3:eachBench"(state, seat, picks, data) {
    const p = me(state, seat);
    const from = data.from as "deck" | "discard";
    const type = String(data.type) || undefined;
    const queue = data.step === "bench" ? [...picks] : [...(data.queue as string[])];
    if (data.step === "card" && picks.length) {
      const slot = p.bench[idx(String(data.key))];
      if (slot) attach(state, seat, from, picks, slot);
    }
    for (let key = queue.shift(); key; key = queue.shift()) {
      const slot = p.bench[idx(key)];
      const cards = pile(state, seat, from).filter(basicOf(type));
      if (!slot || !cards.length) continue;
      if (sameCards(cards)) {
        attach(state, seat, from, [cards[0].uid], slot);
        continue;
      }
      const seen = new Set<string>();
      const options = cards.filter((c) => !seen.has(c.name) && seen.add(c.name));
      ask(state, {
        seat,
        title: `Choose an Energy card to attach to ${nameOf(slot)}`,
        zone: from,
        options: options.map((c) => c.uid),
        ...(from === "deck" ? { shown: p.deck.map((c) => c.uid) } : {}),
        min: 0,
        max: 1,
        effect: "atk:3:eachBench",
        data: { from, type: data.type, step: "card", key, queue },
      });
      return;
    }
    if (from === "deck") shuffle(p.deck);
  },
  "atk:3:fromHand"(state, seat, picks, data) {
    const p = me(state, seat);
    const slot = p.bench[idx(picks[0])];
    const i = p.hand.findIndex((c) => c.uid === data.uid);
    if (!slot || i < 0) return;
    const card = p.hand.splice(i, 1)[0];
    slot.energy.push(card);
    log(state, seat, `${p.name} attached ${card.name} to ${nameOf(slot)}.`);
    onEnergyFromHand(state, seat, slot, card);
    if (data.heal) healLog(state, seat, slot, 9999);
  },
  "atk:3:discardSelf"(state, seat, picks, data) {
    const p = me(state, seat);
    const a = p.active;
    if (!a) return;
    const e = a.energy.find((c) => c.uid === picks[0]);
    if (e) {
      a.energy.splice(a.energy.indexOf(e), 1);
      p.discard.push(e);
      log(state, seat, `${nameOf(a)} discarded ${e.name}.`);
    }
    if (data.then === "heal") healLog(state, seat, a, 9999);
    else if (data.then === "switch" && e && p.bench.length)
      ask(state, {
        seat,
        title: "Choose a Benched Pokémon to switch with",
        zone: "myBench",
        options: p.bench.map((_, i) => bk(i)),
        min: 1,
        max: 1,
        effect: "selfSwitch",
      });
  },
  "atk:3:selfSwitch"(state, seat, picks) {
    if (picks.length) ATTACK_RESUME.selfSwitch(state, seat, picks, {});
  },
  "atk:3:oppSwitch"(state, seat, picks, data) {
    const p = me(state, seat);
    const incoming = p.bench[idx(picks[0])];
    if (!incoming) return;
    switchActive(p, idx(picks[0]));
    log(state, seat, `${p.name} sent in ${nameOf(incoming)}.`);
    const by = data.attacker as Seat;
    if (!guarded(state, by, incoming)) {
      addCondition(state, incoming, String(data.condition).toLowerCase() as PSlot["conditions"][number]);
      if (incoming.conditions.includes(String(data.condition).toLowerCase() as PSlot["conditions"][number]))
        log(state, seat, `${nameOf(incoming)} is now ${data.condition}.`);
    }
  },
  "atk:3:maySwitch"(state, seat, picks) {
    const opp = them(state, seat);
    if (picks[0] !== "yes" || !opp.bench.length) return;
    ask(state, {
      seat: otherSeat(seat),
      title: `${me(state, seat).name}'s attack switches out your Active Pokémon. Choose a Benched Pokémon to send in`,
      zone: "myBench",
      options: opp.bench.map((_, i) => bk(i)),
      min: 1,
      max: 1,
      effect: "switchOut",
    });
  },
  "atk:3:gust"(state, seat, picks, data) {
    const opp = them(state, seat);
    const incoming = opp.bench[idx(picks[0])];
    if (!incoming) return;
    switchActive(opp, idx(picks[0]));
    log(state, seat, `${nameOf(incoming)} was switched into ${opp.name}'s Active Spot.`);
    if (guarded(state, seat, incoming)) return;
    const c = String(data.condition).toLowerCase() as PSlot["conditions"][number];
    addCondition(state, incoming, c);
    if (incoming.conditions.includes(c)) log(state, seat, `${nameOf(incoming)} is now ${data.condition}.`);
  },
  "atk:3:benchAway"(state, seat, picks, data) {
    const p = me(state, seat);
    const slot = p.bench[idx(picks[0])];
    if (!slot) return;
    p.bench.splice(p.bench.indexOf(slot), 1);
    const cards = [...slot.pokemon, ...attachedTo(slot)];
    if (data.to === "hand") {
      p.hand.push(...cards);
      log(state, seat, `${p.name} put ${nameOf(slot)} and its attached cards into their hand.`);
    } else {
      p.deck.push(...cards);
      shuffle(p.deck);
      log(state, seat, `${p.name} shuffled ${nameOf(slot)} and its attached cards into their deck.`);
    }
  },
  "atk:3:byeBye"(state, seat, picks) {
    const p = me(state, seat);
    const opp = them(state, seat);
    const slot = picks.length ? oppSlot(state, seat, picks[0]) : null;
    if (slot) {
      opp.bench.splice(opp.bench.indexOf(slot), 1);
      opp.deck.push(...slot.pokemon, ...attachedTo(slot));
      shuffle(opp.deck);
      log(state, seat, `${nameOf(slot)} and its attached cards were shuffled into ${opp.name}'s deck.`);
    }
    const self = p.active;
    if (!self) return;
    p.active = null;
    p.deck.push(...self.pokemon, ...attachedTo(self));
    shuffle(p.deck);
    log(state, seat, `${p.name} shuffled ${nameOf(self)} and its attached cards into their deck.`);
  },
  "atk:3:keepBench"(state, seat, picks) {
    const opp = them(state, seat);
    const gone = opp.bench.filter((s, i) => !picks.includes(bk(i)) && !guarded(state, seat, s));
    for (const s of gone) {
      opp.bench.splice(opp.bench.indexOf(s), 1);
      opp.deck.push(...s.pokemon, ...attachedTo(s));
    }
    shuffle(opp.deck);
    if (gone.length) log(state, seat, `${gone.map(nameOf).join(", ")} and their attached cards were shuffled into ${opp.name}'s deck.`);
  },
  "atk:3:shuffleOpp"(state, seat, picks) {
    const opp = them(state, seat);
    const gone = picks.map((k) => oppSlot(state, seat, k)).filter((s): s is PSlot => !!s);
    for (const s of gone) {
      opp.bench.splice(opp.bench.indexOf(s), 1);
      opp.deck.push(...s.pokemon, ...attachedTo(s));
    }
    shuffle(opp.deck);
    if (gone.length) log(state, seat, `${gone.map(nameOf).join(", ")} and their attached cards were shuffled into ${opp.name}'s deck.`);
  },
  "atk:3:oppEnergy"(state, seat, picks, data) {
    const opp = them(state, seat);
    if (data.step === "which") {
      if (!picks.length || !opp.active) return;
      const options = opp.bench.map((_, i) => bk(i));
      if (options.length === 1) return R["atk:3:oppEnergy"](state, seat, options, { step: "to", uid: picks[0] });
      askOpp(state, seat, options, `Choose 1 of ${opp.name}'s Benched Pokémon to move the Energy to`, "atk:3:oppEnergy", { step: "to", uid: picks[0] });
      return;
    }
    const to = oppSlot(state, seat, picks[0]);
    if (to) attach(state, seat, "opp", [String(data.uid)], to);
  },
  "atk:3:lostEnergy"(state, seat, picks, data) {
    const opp = them(state, seat);
    if (data.step === "slot") {
      const slot = oppSlot(state, seat, picks[0]);
      if (!slot) return;
      const special = slot.energy.filter((e) => isEnergy(e) && !isBasicEnergy(e));
      if (special.length > 1 && !sameCards(special)) {
        askChoice(state, seat, `Choose a Special Energy on ${nameOf(slot)} to put in the Lost Zone`, labelled(special), "atk:3:lostEnergy", {
          data: { step: "card", key: picks[0], botPick: [special[0].uid] },
        });
        return;
      }
      return R["atk:3:lostEnergy"](
        state,
        seat,
        special.slice(0, 1).map((c) => c.uid),
        { step: "card", key: picks[0] },
      );
    }
    const slot = oppSlot(state, seat, String(data.key));
    const e = slot?.energy.find((c) => c.uid === picks[0]);
    if (!slot || !e) return;
    slot.energy.splice(slot.energy.indexOf(e), 1);
    (opp.lost ??= []).push(e);
    log(state, seat, `${e.name} on ${nameOf(slot)} was put in the Lost Zone.`);
  },
  "atk:3:benchThenEnergy"(state, seat, picks) {
    const p = me(state, seat);
    const card = p.deck.find((c) => c.uid === picks[0]);
    if (!card || p.bench.length >= benchLimit(state, seat)) return void shuffle(p.deck);
    p.deck.splice(p.deck.indexOf(card), 1);
    const slot = benchPokemon(state, seat, card);
    shuffle(p.deck);
    log(state, seat, `${p.name} put ${card.name} onto their Bench.`);
    const a = p.active;
    if (!a || !a.energy.length) return;
    const key = bk(p.bench.indexOf(slot));
    pickEnergy(state, seat, a.energy, 1, `Choose an Energy to move to ${card.name}`, "atk:3:toNew", { key });
  },
  "atk:3:toNew"(state, seat, picks, data) {
    const slot = mySlot(state, seat, String(data.key));
    if (slot) attach(state, seat, "self", picks, slot);
  },
};

export const resumes3 = (): Record<string, Resume> => R;
