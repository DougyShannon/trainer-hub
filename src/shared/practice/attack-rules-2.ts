// Attack rules: see attack-rules.ts for how they work.
// Group 2: damage that depends on the board ("If your opponent has...", "for each..."), damage
// spread over chosen Pokémon, and attacks that pay something first ("You may discard...").

import { otherSeat, type Seat } from "../game-types";
import {
  ENERGY_TYPES,
  ask,
  energyProvides,
  flip,
  isBasicEnergy,
  isEnergy,
  isItem,
  isPokemon,
  isSupporter,
  isTool,
  log,
  plural,
  shuffle,
  switchActive,
  topCard,
} from "./engine";
import { baseName, hitWithAttack, hpLeft, inPlay, isEx, isV, maxHp, retreatCost, toolsOn } from "./effects";
import { benchDamage, countFor, finalDamage } from "./attacks";
import { unitIs } from "./special-energy";
import type { AttackCtx, AttackRule, Resume } from "./attack-rules";
import type { PCard, PPlayer, PSlot, PState } from "./types";

type Data = Record<string, unknown>;

const benchKeys = (p: PPlayer, ok: (s: PSlot) => boolean = () => true) => p.bench.map((s, i) => (ok(s) ? `bench:${i}` : "")).filter(Boolean);
const keysOf = (p: PPlayer, ok: (s: PSlot) => boolean) => [...(p.active && ok(p.active) ? ["active"] : []), ...benchKeys(p, ok)];
const slotOf = (p: PPlayer, key: string) => (key === "active" ? p.active : p.bench[Number(key.split(":")[1])]);
const units = (slots: PSlot[], type?: string) =>
  slots
    .flatMap((s) => s.energy)
    .flatMap((e) => energyProvides(e))
    .filter((u) => !type || unitIs(u, type)).length;
const provides = (e: PCard, type: string) => energyProvides(e).some((u) => unitIs(u, type));
const Q = `["“”]`;

/**
 * Which Pokémon a phrase on a card means: "Grass Pokémon", "Team Rocket's Pokémon", "Stage 1 Pokémon",
 * "Pokémon ex and Pokémon V", "Evolution Pokémon", or names ("Drifloon and this Pokémon").
 */
function cardTest(ctx: AttackCtx, phrase: string): (c: PCard) => boolean {
  const parts = phrase.split(/ and | or /);
  if (parts.length > 1) {
    const tests = parts.map((x) => cardTest(ctx, x.trim()));
    return (c) => tests.some((t) => t(c));
  }
  const w = phrase.trim();
  if (/^this Pokémon$/i.test(w)) {
    const own = baseName(topCard(ctx.attacker).name);
    return (c) => baseName(c.name) === own;
  }
  if (w === "Pokémon") return isPokemon;
  let m = w.match(/^Pokémon (ex|V|VMAX|VSTAR)$/);
  if (m) {
    const kind = m[1];
    return (c) => (kind === "ex" ? isEx(c) : kind === "V" ? isV(c) : c.subtypes.includes(kind));
  }
  m = w.match(/^(.+) Pokémon$/);
  if (m) {
    const word = m[1];
    if (word.endsWith("'s")) return (c) => isPokemon(c) && c.name.startsWith(`${word} `);
    if (ENERGY_TYPES.includes(word)) return (c) => isPokemon(c) && c.types.includes(word);
    if (word === "Evolution") return (c) => isPokemon(c) && !c.subtypes.includes("Basic");
    return (c) => isPokemon(c) && c.subtypes.includes(word);
  }
  return (c) => baseName(c.name) === w;
}

/** Which cards a phrase in "for each ... in your discard pile" means. */
function anyCardTest(ctx: AttackCtx, phrase: string): (c: PCard) => boolean {
  const w = phrase.replace(/ cards?$/i, "").trim();
  let m: RegExpMatchArray | null;
  if (/^Energy$/i.test(w)) return isEnergy;
  if (/^Basic Energy$/i.test(w)) return isBasicEnergy;
  if ((m = w.match(/^Basic (\w+) Energy$/i))) return (c) => isBasicEnergy(c) && c.name.includes(m![1]);
  if ((m = w.match(/^(\w+) Energy$/)) && ENERGY_TYPES.includes(m[1])) return (c) => isEnergy(c) && provides(c, m![1]);
  if (/^Item$/i.test(w)) return isItem;
  if (/^Supporter$/i.test(w)) return isSupporter;
  if (/^Trainer$/i.test(w)) return (c) => c.supertype === "Trainer";
  if (/^Pokémon Tool$/i.test(w)) return isTool;
  if (/^(Ancient|Future)$/.test(w)) return (c) => c.subtypes.includes(w);
  const test = cardTest(ctx, w);
  return /Pokémon$/.test(w) && w !== "this Pokémon" ? (c) => isPokemon(c) && test(c) : test;
}

/** Attack damage to the opponent's Active Pokémon worked out after a choice (like resolveAttack does). */
function strike(state: PState, seat: Seat, base: number, text: string, name: string) {
  const attacker = state.players[seat].active;
  const defender = state.players[otherSeat(seat)].active;
  if (!attacker || !defender) return;
  if (base <= 0) return void log(state, seat, `${name} did no damage.`, "attack");
  let damage = finalDamage(state, seat, attacker, defender, base, text);
  if (defender.effects.protect?.turn === state.turn)
    return void log(state, seat, `${topCard(defender).name} is protected, so ${name} did no damage.`, "attack");
  if (defender.effects.guard?.turn === state.turn) damage = Math.max(0, damage - defender.effects.guard.amount);
  if (damage > 0) log(state, seat, `${name} did ${damage} damage to ${topCard(defender).name}.`, "attack");
  else log(state, seat, `${name} did no damage.`, "attack");
  hitWithAttack(state, seat, attacker, defender, damage);
}

/** Attack damage to one of the opponent's Pokémon ("active" or "bench:n"). `raw`: no Weakness, Resistance or effects on it. */
function hitKey(state: PState, seat: Seat, key: string, amount: number, text: string, name: string, raw = false) {
  const opp = state.players[otherSeat(seat)];
  const attacker = state.players[seat].active;
  const slot = slotOf(opp, key);
  if (!slot || !attacker || amount <= 0) return;
  if (raw) {
    hitWithAttack(state, seat, attacker, slot, amount);
    return void log(state, seat, `${name} did ${amount} damage to ${topCard(slot).name}.`, "attack");
  }
  if (key === "active") return strike(state, seat, amount, text, name);
  log(state, seat, `${name} did ${benchDamage(state, seat, slot, amount)} damage to ${topCard(slot).name} on the Bench.`, "attack");
}

/** Damage to your own Pokémon from your own attack (no Weakness or Resistance). */
function selfHit(state: PState, seat: Seat, slot: PSlot, amount: number) {
  slot.damage += amount;
  log(state, seat, `${topCard(slot).name} took ${amount} damage.`);
}

const boostOf = (ctx: AttackCtx) => {
  const b = ctx.attacker.effects.boost;
  return b && b.turn === ctx.state.turn && ctx.attack.damage.trim() ? b.amount : 0;
};

/** The shared bits a deferred-damage choice needs to finish the attack. */
const finish = (ctx: AttackCtx, extra: Data): Data => ({ base: ctx.base + boostOf(ctx), text: ctx.text, name: ctx.attack.name, ...extra });

/** Energy attached to the player's own Pokémon, as choice options. */
function energyChoices(ctx: AttackCtx, where: "this" | "all" | "bench", ok: (e: PCard) => boolean) {
  const slots = where === "this" ? [ctx.attacker] : where === "bench" ? ctx.p.bench : inPlay(ctx.p);
  const list = slots.flatMap((s) => s.energy.filter(ok).map((e) => ({ e, s })));
  return {
    options: list.map((x) => x.e.uid),
    labels: Object.fromEntries(list.map((x) => [x.e.uid, where === "this" ? x.e.name : `${x.e.name} on ${topCard(x.s).name}`])),
    // The computer spends Energy from the Bench first.
    ranked: [...list].sort((a, b) => (a.s === ctx.attacker ? 1 : 0) - (b.s === ctx.attacker ? 1 : 0)).map((x) => x.e.uid),
  };
}

/** How many of `per` the computer needs to Knock Out the Defending Pokémon (at least 1). */
const needed = (ctx: AttackCtx, per: number, have = 0) => Math.max(1, Math.ceil((hpLeft(ctx.state, ctx.defender) - have) / Math.max(1, per)));

type Pay = {
  kind: "energy" | "hand" | "reveal" | "lost" | "counters" | "top" | "handAll" | "allEnergy" | "prize";
  per: number;
  /** A flat bonus if anything was paid, instead of `per` each. */
  flat?: number;
  more: boolean;
  /** Where discarded Energy goes. */
  dest?: "discard" | "deck" | "hand";
  types?: boolean;
  type?: string;
};

/**
 * "You may discard ... This attack does N damage for each card you discarded in this way." The damage
 * is skipped in `pre` and done once the player has chosen (see the "atk:2:pay" resume).
 */
function payRule(
  re: RegExp,
  build: (ctx: AttackCtx, m: RegExpMatchArray) => { pay: Pay; prompt: Omit<Parameters<typeof ask>[1], "seat" | "effect" | "data">; bot: string[] },
): AttackRule {
  return {
    re,
    pre: (ctx) => {
      ctx.skipDamage = true;
    },
    post: (ctx, m) => {
      const got = build(ctx, m);
      if (!got.prompt.options.length) return strike(ctx.state, ctx.seat, got.pay.more ? ctx.base + boostOf(ctx) : 0, ctx.text, ctx.attack.name);
      const pay = got.pay;
      ask(ctx.state, { seat: ctx.seat, ...got.prompt, effect: "atk:2:pay", data: finish(ctx, { ...pay, botPick: got.bot }) });
    },
  };
}

const PHRASE = "[^.]+?";
/** A phrase that doesn't go on to describe the Pokémon further ("... that has any damage counters on it"). */
const PLAIN = "(?:(?!that )[^.])+?";

/** "for each ..." phrases the common patterns in attacks.ts don't know. */
function counts(): [string, (ctx: AttackCtx, m: string[]) => number][] {
  const own = (ctx: AttackCtx) => inPlay(ctx.p);
  const theirs = (ctx: AttackCtx) => inPlay(ctx.opp);
  const both = (ctx: AttackCtx) => [...own(ctx), ...theirs(ctx)];
  return [
    [`of your Pokémon in play that has the (${PHRASE}) attack`, (ctx, m) => own(ctx).filter((s) => topCard(s).attacks.some((a) => a.name === m[0])).length],
    [`of your opponent's Pokémon in play that has an Ability`, (ctx) => theirs(ctx).filter((s) => topCard(s).abilities.length > 0).length],
    [
      `of your Pokémon that has ${Q}([^"“”]+)${Q} in its name that has any damage counters on it`,
      (ctx, m) => own(ctx).filter((s) => s.damage > 0 && topCard(s).name.includes(m[0])).length,
    ],
    [`of your Pokémon that has any damage counters on it`, (ctx) => own(ctx).filter((s) => s.damage > 0).length],
    [
      `of your (opponent's )?(Benched )?(${PLAIN})(?: in play)?`,
      (ctx, m) => {
        const p = m[0] ? ctx.opp : ctx.p;
        const test = cardTest(ctx, m[2]);
        return (m[1] ? p.bench : inPlay(p)).filter((s) => test(topCard(s))).length;
      },
    ],
    [`Stage (\\d) Pokémon on your Bench`, (ctx, m) => ctx.p.bench.filter((s) => topCard(s).subtypes.includes(`Stage ${m[0]}`)).length],
    [`different type of Pokémon on your Bench`, (ctx) => new Set(ctx.p.bench.flatMap((s) => topCard(s).types)).size],
    [`Benched Pokémon`, (ctx) => ctx.p.bench.length + ctx.opp.bench.length],
    [
      `Pokémon in play that has ${Q}(\\w+)${Q} or ${Q}(\\w+)${Q} in its name`,
      (ctx, m) => both(ctx).filter((s) => [m[0], m[1]].some((n) => topCard(s).name.includes(n))).length,
    ],
    [
      `Pokémon in your discard pile that has the (${PHRASE}) attack`,
      (ctx, m) => ctx.p.discard.filter((c) => isPokemon(c) && c.attacks.some((a) => a.name === m[0])).length,
    ],
    [
      `Supporter card that has ${Q}([^"“”]+)${Q} in its name in your discard pile`,
      (ctx, m) => ctx.p.discard.filter((c) => isSupporter(c) && c.name.includes(m[0])).length,
    ],
    [
      `(${PHRASE}) in (your|your opponent's) discard pile`,
      (ctx, m) => {
        const test = anyCardTest(ctx, m[0]);
        return (m[1] === "your" ? ctx.p : ctx.opp).discard.filter(test).length;
      },
    ],
    [`Pokémon Tool card in the Lost Zone`, (ctx) => [...(ctx.p.lost ?? []), ...(ctx.opp.lost ?? [])].filter(isTool).length],
    [`Special Energy card attached to this Pokémon`, (ctx) => ctx.attacker.energy.filter((e) => !isBasicEnergy(e)).length],
    [
      `(?:(\\w+) )?Energy attached to (both Active Pokémon|all Pokémon|all of your opponent's Pokémon|(?<=less damage for each (?:\\w+ )?Energy attached to )your opponent's Active Pokémon|all of your (?!Pokémon\\.)(${PLAIN}))`,
      (ctx, m) => {
        const where = m[1];
        const slots =
          where === "both Active Pokémon"
            ? [ctx.attacker, ctx.defender]
            : where === "all Pokémon"
              ? both(ctx)
              : where === "all of your opponent's Pokémon"
                ? theirs(ctx)
                : where === "your opponent's Active Pokémon"
                  ? [ctx.defender]
                  : own(ctx).filter((s) => cardTest(ctx, m[2])(topCard(s)));
        if (m[0] === "Special") return slots.flatMap((s) => s.energy).filter((e) => !isBasicEnergy(e)).length;
        return units(slots, m[0] && ENERGY_TYPES.includes(m[0]) ? m[0] : undefined);
      },
    ],
    [`Pokémon Tool attached to (all Pokémon|all of your Pokémon)`, (ctx, m) => (m[0] === "all Pokémon" ? both(ctx) : own(ctx)).flatMap(toolsOn).length],
    [`Colorless in your opponent's Active Pokémon's Retreat Cost`, (ctx) => retreatCost(ctx.state, ctx.defender)],
    [
      `Special Condition affecting (this Pokémon|your opponent's Active Pokémon)`,
      (ctx, m) => (m[0] === "this Pokémon" ? ctx.attacker : ctx.defender).conditions.length,
    ],
    [`damage counter on all of your opponent's Pokémon`, (ctx) => theirs(ctx).reduce((n, s) => n + s.damage / 10, 0)],
    [
      `damage counter on all of your (Benched )?(${PLAIN})`,
      (ctx, m) => {
        const test = cardTest(ctx, m[1]);
        return (m[0] ? ctx.p.bench : own(ctx)).filter((s) => test(topCard(s))).reduce((n, s) => n + s.damage / 10, 0);
      },
    ],
    // attacks.ts counts these for "more" damage.
    [`(?<=less damage for each )damage counter on this Pokémon`, (ctx) => ctx.attacker.damage / 10],
    [
      `Prize card your opponent took during their last turn`,
      (ctx) => {
        // The Pokémon they Knocked Out last turn are in the discard pile (or the Lost Zone).
        if (ctx.p.koTurn !== ctx.state.turn - 1) return 0;
        const gone = [...ctx.p.discard, ...(ctx.p.lost ?? [])].reverse();
        return (ctx.p.koNames ?? []).reduce((n, name) => n + prizeCount(gone.find((c) => c.name === name)), 0);
      },
    ],
  ];
}

const prizeCount = (c: PCard | undefined) => {
  if (!c) return 1;
  if (c.subtypes.includes("VMAX")) return 3;
  if (c.subtypes.includes("MEGA") && isEx(c)) return 3;
  return isEx(c) || isV(c) ? 2 : 1;
};

/** "If ..., this attack does N more damage." conditions the common patterns don't know. */
function conditions(): [string, (ctx: AttackCtx, m: string[]) => boolean][] {
  const d = (ctx: AttackCtx) => topCard(ctx.defender);
  return [
    [`your opponent has (\\d+) or more Benched Pokémon`, (ctx, m) => ctx.opp.bench.length >= Number(m[0])],
    [`your opponent has (\\d+) or fewer Prize cards remaining`, (ctx, m) => ctx.opp.prizes.length <= Number(m[0])],
    [`your opponent has (\\d+) or fewer cards in their hand`, (ctx, m) => ctx.opp.hand.length <= Number(m[0])],
    [
      `your opponent has exactly (\\d+)(?: or (\\d+))? Prize cards? remaining`,
      (ctx, m) => [m[0], m[1]].filter(Boolean).map(Number).includes(ctx.opp.prizes.length),
    ],
    [
      `your opponent has any (Pokémon V|Pokémon VMAX|Pokémon ex|\\w+ Pokémon) in play`,
      (ctx, m) => inPlay(ctx.opp).some((s) => cardTest(ctx, m[0])(topCard(s))),
    ],
    [`your opponent has used their VSTAR Power during this game`, (ctx) => ctx.opp.vstarUsed],
    [`your opponent's Active Pokémon has (\\w+) Resistance`, (ctx, m) => d(ctx).resistances.some((r) => r.type === m[0])],
    [`your opponent's Active Pokémon has a Pokémon Tool attached`, (ctx) => toolsOn(ctx.defender).length > 0],
    [`your opponent's Active Pokémon has no Retreat Cost`, (ctx) => retreatCost(ctx.state, ctx.defender) === 0],
    [`your opponent's Active Pokémon is an? (Pokémon V|Pokémon VMAX|Stage \\d Pokémon|Evolution Pokémon)`, (ctx, m) => cardTest(ctx, m[0])(d(ctx))],
    [`your opponent's Active Pokémon is affected by a Special Condition`, (ctx) => ctx.defender.conditions.length > 0],
  ];
}

/** Asks which of the attacker's Energy to discard (or discards it all when there's no choice). */
function discardOwnEnergy(ctx: AttackCtx, n: number | "all") {
  const { state, seat, attacker, p } = ctx;
  if (n === "all" || attacker.energy.length <= n) {
    const gone = attacker.energy.splice(0);
    p.discard.push(...gone);
    return void log(state, seat, `${topCard(attacker).name} discarded ${plural(gone.length, "Energy")}.`);
  }
  const { options, labels } = energyChoices(ctx, "this", () => true);
  ask(state, {
    seat,
    title: `Choose ${plural(n, "Energy")} to discard from ${topCard(attacker).name}`,
    zone: "choice",
    options,
    labels,
    min: n,
    max: n,
    effect: "atk:2:dropEnergy",
  });
}

/** Removes Energy cards (by uid) from a player's Pokémon. */
function takeEnergy(p: PPlayer, uids: string[]) {
  const out: PCard[] = [];
  for (const s of inPlay(p)) {
    for (const e of s.energy.filter((x) => uids.includes(x.uid))) {
      s.energy.splice(s.energy.indexOf(e), 1);
      out.push(e);
    }
  }
  return out;
}

export const rules2 = (): AttackRule[] => {
  const rules: AttackRule[] = [];

  // A VSTAR Power attack counts as the player's one VSTAR Power for the game (the reminder is in brackets, so it's matched on the full text).
  const vstar = (text: string | undefined) => /can't use more than 1 VSTAR Power in a game/i.test(text ?? "");
  rules.push({
    re: /^/,
    pre: (ctx) => {
      if (vstar(ctx.attack.text) && !ctx.p.vstarUsed) {
        ctx.p.vstarUsed = true;
        log(ctx.state, ctx.seat, `${ctx.p.name} used their VSTAR Power.`);
      }
    },
    canUse: (state, seat, attack) => (vstar(attack.text) && state.players[seat].vstarUsed ? "You've already used a VSTAR Power this game." : null),
  });

  // ----- Conditions -----
  for (const [src, test] of conditions()) {
    rules.push({
      re: new RegExp(`If ${src}, this attack does (\\d+) more damage(?:, and discard (all|\\d+) Energy from this Pokémon)?\\.`),
      pre: (ctx, m) => {
        const groups = m.slice(1, -2);
        ctx.memo.cond2 = test(ctx, groups);
        if (ctx.memo.cond2) ctx.base += Number(m[m.length - 2]);
      },
      post: (ctx, m) => {
        const n = m[m.length - 1];
        if (ctx.memo.cond2 && n) discardOwnEnergy(ctx, n === "all" ? "all" : Number(n));
      },
    });
  }
  rules.push({
    re: /If your opponent's Active Pokémon already has any damage counters on it, this attack's base damage is (\d+)\./,
    pre: (ctx, m) => {
      if (ctx.defender.damage > 0) ctx.base = Number(m[1]);
    },
  });

  // ----- "for each" damage -----
  rules.push({
    re: /This attack does (\d+) damage for each (Basic (\w+) Energy|basic Energy) card in your discard pile\. Then, shuffle those cards into your deck\./,
    pre: (ctx, m) => {
      const cards = ctx.p.discard.filter((c) => isBasicEnergy(c) && (!m[3] || c.name.includes(m[3])));
      ctx.base = Number(m[1]) * cards.length;
      ctx.memo.shuffle2 = cards.map((c) => c.uid);
    },
    post: (ctx) => {
      const uids = ctx.memo.shuffle2 as string[];
      const cards = ctx.p.discard.filter((c) => uids.includes(c.uid));
      ctx.p.discard = ctx.p.discard.filter((c) => !uids.includes(c.uid));
      ctx.p.deck.push(...cards);
      shuffle(ctx.p.deck);
      log(ctx.state, ctx.seat, `${ctx.p.name} shuffled ${plural(cards.length, "Energy card")} into their deck.`);
    },
  });
  rules.push({
    re: /This attack does (\d+) damage for each of your (\w+) and (\w+|this Pokémon) in play\. This attack also does (\d+) damage to each of your \2 and \3\./,
    pre: (ctx, m) => {
      const test = cardTest(ctx, `${m[2]} and ${m[3]}`);
      ctx.base = Number(m[1]) * inPlay(ctx.p).filter((s) => test(topCard(s))).length;
    },
    post: (ctx, m) => {
      const test = cardTest(ctx, `${m[2]} and ${m[3]}`);
      for (const s of inPlay(ctx.p).filter((x) => test(topCard(x)))) selfHit(ctx.state, ctx.seat, s, Number(m[4]));
    },
  });
  for (const [src, count] of counts()) {
    rules.push({
      re: new RegExp(`This attack does (\\d+) (more |less )?damage for each ${src}\\.(?: This damage isn't affected by Weakness or Resistance\\.)?`),
      pre: (ctx, m) => {
        const n = count(ctx, m.slice(3));
        const amount = Number(m[1]) * n;
        const how = (m[2] ?? "").trim();
        ctx.base = how === "more" ? ctx.base + amount : how === "less" ? Math.max(0, ctx.base - amount) : amount;
      },
    });
  }
  // Coins the opponent flips.
  rules.push({
    re: /Your opponent flips a coin for each of their Benched Pokémon\. This attack does (\d+) damage to your opponent's Active Pokémon for each tails\./,
    pre: (ctx, m) => {
      const n = ctx.opp.bench.length;
      let tails = 0;
      for (let i = 0; i < n; i++) if (!flip()) tails++;
      log(ctx.state, ctx.oppSeat, `${ctx.opp.name} flipped ${plural(n, "coin")}: ${plural(tails, "tails")}.`, "coin");
      ctx.base = Number(m[1]) * tails;
    },
  });
  // Looking at a hand.
  rules.push({
    re: /Your opponent reveals their hand(?:, and this|\. This) attack does (\d+) damage for each (Energy|Trainer) card you find there\./,
    pre: (ctx, m) => {
      const per = Number(m[1]);
      const kind = m[2];
      const hand = ctx.opp.hand;
      log(
        ctx.state,
        ctx.oppSeat,
        hand.length ? `${ctx.opp.name} revealed their hand: ${hand.map((c) => c.name).join(", ")}.` : `${ctx.opp.name}'s hand is empty.`,
      );
      ctx.base = per * hand.filter((c) => (kind === "Energy" ? isEnergy(c) : c.supertype === "Trainer")).length;
    },
  });
  rules.push({
    re: /Reveal any number of ([^.]+?) cards from your hand\. This attack does (\d+) damage for each card you revealed in this way\./,
    pre: (ctx) => {
      ctx.skipDamage = true;
    },
    post: (ctx, m) => {
      const options = ctx.p.hand.filter((c) => baseName(c.name) === m[1]).map((c) => c.uid);
      if (!options.length) return strike(ctx.state, ctx.seat, 0, ctx.text, ctx.attack.name);
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Reveal any number of ${m[1]} cards from your hand`,
        zone: "hand",
        options,
        min: 0,
        max: options.length,
        effect: "atk:2:pay",
        data: finish(ctx, { kind: "reveal", per: Number(m[2]), more: false, botPick: options }),
      });
    },
  });
  // Cards off the top of the deck.
  rules.push({
    re: /Discard the top (\d+) cards of your deck\. This attack does (\d+) damage for each (Energy card|Pokémon with a Retreat Cost of exactly (\d+)) (?:that )?you discarded in this way\./,
    pre: (ctx, m) => {
      const n = Number(m[1]);
      const per = Number(m[2]);
      const what = m[3];
      const gone = ctx.p.deck.splice(0, n);
      ctx.p.discard.push(...gone);
      log(ctx.state, ctx.seat, `${ctx.p.name} discarded ${gone.length ? gone.map((c) => c.name).join(", ") : "nothing"} from the top of their deck.`);
      const hits = gone.filter((c) => (what === "Energy card" ? isEnergy(c) : isPokemon(c) && c.retreat === Number(m[4])));
      ctx.base = per * hits.length;
    },
  });
  rules.push({
    re: /Reveal the top (\d+) cards of your deck\. This attack does (\d+) damage to 1 of your opponent's Pokémon for each Energy card you find there\. Then, discard those Energy cards and shuffle the other cards back into your deck\./,
    pre: (ctx) => {
      ctx.skipDamage = true;
    },
    post: (ctx, m) => {
      const { state, seat, p, opp } = ctx;
      const top = p.deck.slice(0, Number(m[1]));
      log(state, seat, `${p.name} revealed ${top.length ? top.map((c) => c.name).join(", ") : "nothing"}.`);
      const energy = top.filter(isEnergy);
      p.deck = p.deck.filter((c) => !energy.includes(c));
      p.discard.push(...energy);
      shuffle(p.deck);
      if (energy.length) log(state, seat, `${p.name} discarded ${plural(energy.length, "Energy card")} and shuffled the rest back.`);
      const amount = Number(m[2]) * energy.length;
      if (amount > 0)
        askHit(
          ctx,
          keysOf(opp, () => true),
          1,
          amount,
          "oppPokemon",
        );
    },
  });

  // ----- Damage to chosen Pokémon -----
  rules.push({
    re: /This attack does (\d+) damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon\./,
    pre: (ctx) => {
      ctx.skipDamage = true;
    },
    post: (ctx, m) => {
      const options = benchKeys(ctx.opp, (s) => s.damage > 0);
      if (options.length) askHit(ctx, options, 1, 0, "oppBench", { perCounter: Number(m[1]) });
    },
  });
  rules.push({
    re: new RegExp(
      `This attack does (\\d+) damage to 1 of your opponent's (Benched )?Pokémon for each ((?:\\w+ )?Energy attached to this Pokémon|damage counter on this Pokémon|Prize card your opponent has taken|of your ${PHRASE} in play)\\.`,
    ),
    pre: (ctx) => {
      ctx.skipDamage = true;
    },
    post: (ctx, m) => {
      const what = m[3];
      let n: number | null;
      const own = what.match(/^of your (.+?) in play$/i);
      if (own) {
        const test = cardTest(ctx, own[1]);
        n = inPlay(ctx.p).filter((s) => test(topCard(s))).length;
      } else n = countFor(ctx.state, ctx.seat, what);
      const amount = Number(m[1]) * (n ?? 0);
      const options = m[2] ? benchKeys(ctx.opp) : keysOf(ctx.opp, () => true);
      if (amount > 0 && options.length) askHit(ctx, options, 1, amount, m[2] ? "oppBench" : "oppPokemon");
    },
  });
  rules.push({
    re: /This attack does (\d+) damage to 1 of your opponent's (Benched Pokémon ex or Benched Pokémon V|Pokémon V|Pokémon that has any Special Energy attached)\.(?: This damage isn't affected by Weakness or Resistance\.)?/,
    pre: (ctx) => {
      ctx.skipDamage = true;
    },
    post: (ctx, m) => {
      const which = m[2];
      const exV = (s: PSlot) => isEx(topCard(s)) || isV(topCard(s));
      const options = which.startsWith("Benched")
        ? benchKeys(ctx.opp, exV)
        : which === "Pokémon V"
          ? keysOf(ctx.opp, (s) => isV(topCard(s)))
          : keysOf(ctx.opp, (s) => s.energy.some((e) => !isBasicEnergy(e)));
      if (options.length) askHit(ctx, options, 1, Number(m[1]), which.startsWith("Benched") ? "oppBench" : "oppPokemon");
    },
  });
  rules.push({
    re: /This attack does (\d+) damage to (?:each of )?([2-9]) of your opponent's Pokémon( that have any damage counters on them)?\.( This attack's damage isn't affected by Weakness or Resistance, or by any effects on those Pokémon\.)?/,
    pre: (ctx) => {
      ctx.skipDamage = true;
    },
    post: (ctx, m) => {
      const options = keysOf(ctx.opp, (s) => !m[3] || s.damage > 0);
      const n = Math.min(Number(m[2]), options.length);
      if (n) askHit(ctx, options, n, Number(m[1]), "oppPokemon", m[4] ? { raw: true } : {});
    },
  });
  rules.push({
    re: /This attack does (\d+) damage to each of your opponent's (Pokémon ex and Pokémon V|Pokémon V|Pokémon ex|Pokémon that has a Pokémon Tool attached)\.(?: This (?:attack's )?damage isn't affected by Weakness or Resistance\.)?/,
    pre: (ctx) => {
      ctx.skipDamage = true;
    },
    post: (ctx, m) => {
      const which = m[2];
      const test = which.includes("Tool") ? (s: PSlot) => toolsOn(s).length > 0 : (s: PSlot) => cardTest(ctx, which)(topCard(s));
      for (const key of keysOf(ctx.opp, test)) hitKey(ctx.state, ctx.seat, key, Number(m[1]), ctx.text, ctx.attack.name);
    },
  });
  rules.push({
    re: /This attack does (\d+) damage to each Pokémon that has any damage counters on it, except for this Pokémon\./,
    pre: (ctx) => {
      ctx.skipDamage = true;
    },
    post: (ctx, m) => {
      const amount = Number(m[1]);
      for (const key of keysOf(ctx.opp, (s) => s.damage > 0)) hitKey(ctx.state, ctx.seat, key, amount, ctx.text, ctx.attack.name);
      for (const s of ctx.p.bench.filter((x) => x.damage > 0)) selfHit(ctx.state, ctx.seat, s, amount);
    },
  });
  rules.push({
    re: /Switch (?:in 1 of your opponent's Benched Pokémon to the Active Spot|1 of your opponent's Benched Pokémon with their Active Pokémon)\. This attack does (\d+) damage to the new Active Pokémon\./,
    pre: (ctx) => {
      ctx.skipDamage = true;
    },
    post: (ctx, m) => {
      const data = finish(ctx, { amount: Number(m[1]) });
      if (!ctx.opp.bench.length) return strike(ctx.state, ctx.seat, Number(m[1]), ctx.text, ctx.attack.name);
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Choose 1 of ${ctx.opp.name}'s Benched Pokémon to switch into the Active Spot`,
        zone: "oppBench",
        options: benchKeys(ctx.opp),
        min: 1,
        max: 1,
        effect: "atk:2:dragOff",
        data,
      });
    },
  });
  rules.push({
    re: /This Pokémon does (\d+) damage to itself\. Flip a coin\. If heads, your opponent's Active Pokémon is Knocked Out\./,
    post: (ctx, m) => {
      selfHit(ctx.state, ctx.seat, ctx.attacker, Number(m[1]));
      if (ctx.coin() && !ctx.shielded && ctx.opp.active === ctx.defender) {
        ctx.defender.damage = Math.max(ctx.defender.damage, maxHp(ctx.state, ctx.defender));
        log(ctx.state, ctx.seat, `${topCard(ctx.defender).name} is Knocked Out.`);
      }
    },
  });

  // ----- Paying for more damage -----
  rules.push({
    re: /Discard all (\w+) Energy from this Pokémon\. This attack does (\d+) (more )?damage for each card you discarded in this way\./,
    pre: (ctx, m) => {
      const gone = ctx.attacker.energy.filter((e) => provides(e, m[1]));
      ctx.attacker.energy = ctx.attacker.energy.filter((e) => !gone.includes(e));
      ctx.p.discard.push(...gone);
      log(ctx.state, ctx.seat, `${topCard(ctx.attacker).name} discarded ${plural(gone.length, "Energy")}.`);
      const amount = Number(m[2]) * gone.length;
      ctx.base = m[3] ? ctx.base + amount : amount;
    },
  });
  const typeTest = (word: string | undefined) => (e: PCard) =>
    !word ? true : /^basic$/i.test(word) ? isBasicEnergy(e) : word.startsWith("Basic ") ? isBasicEnergy(e) && provides(e, word.slice(6)) : provides(e, word);
  rules.push(
    payRule(
      /You may discard (any amount of|up to (\d+)|all|an?) (?:(Basic|basic|\w+) )?Energy from (this Pokémon|your Pokémon|your Benched Pokémon)\. (?:This attack does (\d+) (more )?damage for each card you discarded in this way|If you do, this attack does (\d+) more damage)\./,
      (ctx, m) => {
        const where = m[4] === "this Pokémon" ? "this" : m[4] === "your Pokémon" ? "all" : "bench";
        const { options, labels, ranked } = energyChoices(ctx, where, typeTest(m[3]));
        const flat = m[7] ? Number(m[7]) : undefined;
        const per = Number(m[5] ?? 0);
        if (m[1] === "all") {
          return {
            pay: { kind: "allEnergy", per: 0, flat, more: true, type: m[3] },
            prompt: {
              title: `Discard all ${m[3]} Energy from ${topCard(ctx.attacker).name} for ${flat} more damage?`,
              zone: "choice",
              options: options.length ? ["yes", "no"] : [],
              labels: { yes: "Discard them", no: "Don't discard" },
              min: 1,
              max: 1,
            },
            bot: ["yes"],
          };
        }
        const cap = m[2] ? Number(m[2]) : /^an?$/.test(m[1]) ? 1 : options.length;
        const more = !!m[6] || !!flat;
        const want = flat ? 1 : needed(ctx, per, more ? ctx.base : 0);
        return {
          pay: { kind: "energy", per, flat, more, dest: "discard" },
          prompt: {
            title: `You may discard ${m[1] === "any amount of" ? "any amount of" : `up to ${cap}`} ${m[3] ? `${m[3]} ` : ""}Energy from ${where === "this" ? topCard(ctx.attacker).name : where === "bench" ? "your Benched Pokémon" : "your Pokémon"}`,
            zone: "choice",
            options,
            labels,
            min: 0,
            max: Math.min(cap, options.length),
          },
          bot: ranked.slice(0, Math.min(cap, want)),
        };
      },
    ),
  );
  rules.push(
    payRule(
      /Shuffle any amount of (\w+) Energy from your Pokémon into your deck\. This attack does (\d+) damage for each card you shuffled into your deck in this way\./i,
      (ctx, m) => {
        const { options, labels, ranked } = energyChoices(ctx, "all", typeTest(m[1]));
        return {
          pay: { kind: "energy", per: Number(m[2]), more: false, dest: "deck" },
          prompt: {
            title: `Shuffle any amount of ${m[1]} Energy from your Pokémon into your deck`,
            zone: "choice",
            options,
            labels,
            min: 0,
            max: options.length,
          },
          bot: ranked.slice(0, needed(ctx, Number(m[2]))),
        };
      },
    ),
  );
  rules.push(
    payRule(/You may put an Energy attached to this Pokémon into your hand\. If you do, this attack does (\d+) more damage\./i, (ctx, m) => {
      const { options, labels } = energyChoices(ctx, "this", () => true);
      return {
        pay: { kind: "energy", per: 0, flat: Number(m[1]), more: true, dest: "hand" },
        prompt: { title: `You may put an Energy from ${topCard(ctx.attacker).name} into your hand`, zone: "choice", options, labels, min: 0, max: 1 },
        bot: options.slice(0, 1),
      };
    }),
  );
  rules.push(
    payRule(
      new RegExp(
        `You may discard (up to (\\d+)|any number of|as many|an?) (Energy cards|Basic Energy cards|Supporter cards that have ${Q}([^"“”]+)${Q} in their name|${PHRASE} card)(?: as you like)? from your hand(?:\\.|, and) (?:[Tt]his attack does (\\d+) (more )?damage for each (card|type of Basic Energy) you discarded in this way|If you do, this attack does (\\d+) more damage)\\.`,
      ),
      (ctx, m) => {
        const what = m[3];
        const test = /^Energy cards$/i.test(what)
          ? isEnergy
          : /^Basic Energy cards$/i.test(what)
            ? isBasicEnergy
            : m[4]
              ? (c: PCard) => isSupporter(c) && c.name.includes(m[4])
              : (c: PCard) => baseName(c.name) === what.replace(/^(an?|any) /i, "").replace(/ card$/i, "");
        const options = ctx.p.hand.filter(test).map((c) => c.uid);
        const cap = m[2] ? Number(m[2]) : /^an?$/i.test(m[1]) ? 1 : options.length;
        const flat = m[8] ? Number(m[8]) : undefined;
        const types = m[7] === "type of Basic Energy";
        let bot = options.slice(0, cap);
        if (types) {
          const seen = new Set<string>();
          bot = options.filter((uid) => {
            const t = energyProvides(ctx.p.hand.find((c) => c.uid === uid)!)[0];
            return !seen.has(t) && !!seen.add(t);
          });
        }
        return {
          pay: { kind: "hand", per: Number(m[5] ?? 0), flat, more: !!m[6] || !!flat, types },
          prompt: { title: `You may discard ${m[1].toLowerCase()} ${what} from your hand`, zone: "hand", options, min: 0, max: Math.min(cap, options.length) },
          bot,
        };
      },
    ),
  );
  rules.push(
    payRule(/You may discard your hand\. If you discarded any cards in this way, this attack does (\d+) more damage\./i, (ctx, m) => ({
      pay: { kind: "handAll", per: 0, flat: Number(m[1]), more: true },
      prompt: {
        title: `Discard your hand (${plural(ctx.p.hand.length, "card")}) for ${m[1]} more damage?`,
        zone: "choice",
        options: ctx.p.hand.length ? ["yes", "no"] : [],
        labels: { yes: "Discard my hand", no: "Keep my hand" },
        min: 1,
        max: 1,
      },
      bot: [ctx.p.hand.length <= 3 || hpLeft(ctx.state, ctx.defender) > ctx.base ? "yes" : "no"],
    })),
  );
  rules.push(
    payRule(
      /Put any number of Pokémon Tool cards from your discard pile in the Lost Zone\. This attack does (\d+) more damage for each card you put in the Lost Zone in this way\./i,
      (ctx, m) => {
        const options = ctx.p.discard.filter(isTool).map((c) => c.uid);
        return {
          pay: { kind: "lost", per: Number(m[1]), more: true },
          prompt: {
            title: "Put any number of Pokémon Tool cards from your discard pile in the Lost Zone",
            zone: "discard",
            options,
            min: 0,
            max: options.length,
          },
          bot: options.slice(0, needed(ctx, Number(m[1]), ctx.base)),
        };
      },
    ),
  );
  rules.push(
    payRule(/Put up to (\d+) damage counters on this Pokémon\. This attack does (\d+) damage for each damage counter you placed in this way\./i, (ctx, m) => {
      const cap = Number(m[1]);
      const options = Array.from({ length: cap + 1 }, (_, i) => String(i));
      // The computer places what it needs for a Knock Out without Knocking itself Out.
      const safe = Math.max(0, Math.ceil(hpLeft(ctx.state, ctx.attacker) / 10) - 1);
      return {
        pay: { kind: "counters", per: Number(m[2]), more: false },
        prompt: {
          title: `Put up to ${cap} damage counters on ${topCard(ctx.attacker).name}`,
          zone: "choice",
          options,
          labels: Object.fromEntries(options.map((o) => [o, plural(Number(o), "damage counter")])),
          min: 1,
          max: 1,
        },
        bot: [String(Math.min(cap, safe, needed(ctx, Number(m[2]))))],
      };
    }),
  );
  rules.push(
    payRule(
      /You may discard up to (\d+) cards from the top of your deck\. This attack does (\d+) more damage for each card you discarded in this way\./i,
      (ctx, m) => {
        const cap = Math.min(Number(m[1]), ctx.p.deck.length);
        const options = Array.from({ length: cap + 1 }, (_, i) => String(i));
        return {
          pay: { kind: "top", per: Number(m[2]), more: true },
          prompt: {
            title: `Discard up to ${cap} cards from the top of your deck`,
            zone: "choice",
            options: cap ? options : [],
            labels: Object.fromEntries(options.map((o) => [o, plural(Number(o), "card")])),
            min: 1,
            max: 1,
          },
          bot: [String(Math.min(cap, Math.max(0, ctx.p.deck.length - 10), needed(ctx, Number(m[2]), ctx.base)))],
        };
      },
    ),
  );
  rules.push(
    payRule(/You may turn 1 of your face-down Prize cards face up\. If you do, this attack does (\d+) more damage\./i, (ctx, m) => {
      const up = faceUp(ctx.p);
      const options = ctx.p.prizes.filter((c) => !up.includes(c.uid)).map((c) => c.uid);
      return {
        pay: { kind: "prize", per: 0, flat: Number(m[1]), more: true },
        prompt: { title: "You may turn 1 of your face-down Prize cards face up", zone: "prizes", options, min: 0, max: 1 },
        bot: options.slice(0, 1),
      };
    }),
  );

  return rules;
};

/** Prize cards turned face up for the rest of the game (Crescent Purge). */
const faceUp = (p: PPlayer) => ((p as PPlayer & { faceUpPrizes?: string[] }).faceUpPrizes ??= []);

/** Asks the attacker to choose which of the opponent's Pokémon take the damage. */
function askHit(ctx: AttackCtx, options: string[], n: number, amount: number, zone: "oppPokemon" | "oppBench", extra: Data = {}) {
  ask(ctx.state, {
    seat: ctx.seat,
    title: n === 1 ? `Choose 1 of ${ctx.opp.name}'s Pokémon to damage` : `Choose ${n} of ${ctx.opp.name}'s Pokémon to damage`,
    zone,
    options,
    min: n,
    max: n,
    effect: "atk:2:hit",
    data: { amount, text: ctx.text, name: ctx.attack.name, ...extra },
  });
}

export const resumes2 = (): Record<string, Resume> => ({
  "atk:2:hit": (state, seat, picks, data) => {
    const opp = state.players[otherSeat(seat)];
    for (const key of picks) {
      const slot = slotOf(opp, key);
      if (!slot) continue;
      const amount = data.perCounter ? (Number(data.perCounter) * slot.damage) / 10 : Number(data.amount);
      hitKey(state, seat, key, amount, String(data.text), String(data.name), !!data.raw);
    }
  },
  "atk:2:dragOff": (state, seat, picks, data) => {
    const opp = state.players[otherSeat(seat)];
    const i = Number(picks[0]?.split(":")[1]);
    const incoming = opp.bench[i];
    if (incoming) {
      switchActive(opp, i);
      log(state, seat, `${topCard(incoming).name} was switched into ${opp.name}'s Active Spot.`);
    }
    strike(state, seat, Number(data.amount), String(data.text), String(data.name));
  },
  "atk:2:dropEnergy": (state, seat, picks) => {
    const p = state.players[seat];
    const gone = takeEnergy(p, picks);
    p.discard.push(...gone);
    log(state, seat, `${p.name} discarded ${gone.map((c) => c.name).join(", ")}.`);
  },
  "atk:2:pay": (state, seat, picks, data) => {
    const p = state.players[seat];
    const pay = data as unknown as Pay;
    let n = 0;
    switch (pay.kind) {
      case "energy": {
        const cards = takeEnergy(p, picks);
        n = cards.length;
        if (pay.dest === "deck") {
          p.deck.push(...cards);
          shuffle(p.deck);
        } else if (pay.dest === "hand") p.hand.push(...cards);
        else p.discard.push(...cards);
        const where = pay.dest === "deck" ? "shuffled into their deck" : pay.dest === "hand" ? "put into their hand" : "discarded";
        if (n) log(state, seat, `${p.name} ${where} ${cards.map((c) => c.name).join(", ")}.`);
        break;
      }
      case "allEnergy": {
        if (picks[0] !== "yes" || !p.active) break;
        const gone = p.active.energy.filter((e) => provides(e, String(pay.type)));
        p.active.energy = p.active.energy.filter((e) => !gone.includes(e));
        p.discard.push(...gone);
        n = gone.length;
        log(state, seat, `${topCard(p.active).name} discarded ${plural(n, "Energy")}.`);
        break;
      }
      case "hand": {
        const cards = p.hand.filter((c) => picks.includes(c.uid));
        p.hand = p.hand.filter((c) => !picks.includes(c.uid));
        p.discard.push(...cards);
        n = pay.types ? new Set(cards.map((c) => energyProvides(c)[0])).size : cards.length;
        if (cards.length) log(state, seat, `${p.name} discarded ${cards.map((c) => c.name).join(", ")} from their hand.`);
        break;
      }
      case "reveal": {
        const cards = p.hand.filter((c) => picks.includes(c.uid));
        n = cards.length;
        if (n) log(state, seat, `${p.name} revealed ${cards.map((c) => c.name).join(", ")}.`);
        break;
      }
      case "handAll": {
        if (picks[0] !== "yes") break;
        const cards = p.hand.splice(0);
        p.discard.push(...cards);
        n = cards.length;
        log(state, seat, `${p.name} discarded their hand (${plural(n, "card")}).`);
        break;
      }
      case "lost": {
        const cards = p.discard.filter((c) => picks.includes(c.uid));
        p.discard = p.discard.filter((c) => !picks.includes(c.uid));
        (p.lost ??= []).push(...cards);
        n = cards.length;
        if (n) log(state, seat, `${p.name} put ${cards.map((c) => c.name).join(", ")} in the Lost Zone.`);
        break;
      }
      case "counters": {
        n = Number(picks[0]) || 0;
        if (n && p.active) {
          p.active.damage += n * 10;
          log(state, seat, `${p.name} put ${plural(n, "damage counter")} on ${topCard(p.active).name}.`);
        }
        break;
      }
      case "top": {
        const gone = p.deck.splice(0, Number(picks[0]) || 0);
        p.discard.push(...gone);
        n = gone.length;
        if (n) log(state, seat, `${p.name} discarded the top ${plural(n, "card")} of their deck.`);
        break;
      }
      case "prize": {
        const card = p.prizes.find((c) => c.uid === picks[0]);
        if (card) {
          faceUp(p).push(card.uid);
          n = 1;
          log(state, seat, `${p.name} turned a Prize card face up: ${card.name}.`);
        }
        break;
      }
    }
    const bonus = pay.flat !== undefined ? (n > 0 ? pay.flat : 0) : pay.per * n;
    strike(state, seat, (pay.more ? Number(data.base) : 0) + bonus, String(data.text), String(data.name));
  },
});
