// Attack rules: see attack-rules.ts for how they work.

import { otherSeat, type Condition, type Seat } from "../game-types";
import type { AttackCtx, AttackRule, Resume } from "./attack-rules";
import type { Attack, PCard, PPlayer, PSlot, PState, SlotKey } from "./types";
import {
  ENERGY_TYPES,
  ask,
  draw,
  energyProvides,
  evolveSlot,
  flip,
  isBasicEnergy,
  isBasicPokemon,
  isEnergy,
  isItem,
  isPokemon,
  isSupporter,
  isTool,
  log,
  plural,
  shuffle,
  slotAt,
  slotKeys,
  switchActive,
  topCard,
} from "./engine";
import {
  attackCost,
  benchLimit,
  baseName,
  deckGuarded,
  hitWithAttack,
  inPlay,
  attachedTo,
  isStage,
  isTera,
  maxHp,
  removeTool,
  retreatCost,
  toolsOn,
} from "./effects";
import { addCondition, benchDamage, finalDamage, resolveAttack, toCount } from "./attacks";
import { discardedByOpponent, effectsProof } from "./abilities";
import { unitIs } from "./special-energy";
import { playedThisTurn } from "./lasting";
import { heal } from "./trainers-more";
import { askChoice } from "./actions";

type Data = Record<string, unknown>;

const CONDITION = "(Asleep|Burned|Confused|Paralyzed|Poisoned)";
const R = (source: string) => new RegExp(source, "i");
const benchKeys = (p: PPlayer, test: (s: PSlot) => boolean = () => true) => p.bench.map((s, i) => (test(s) ? `bench:${i}` : "")).filter(Boolean);
const pokemonKeys = (p: PPlayer, test: (s: PSlot) => boolean = () => true) => slotKeys(p).filter((k) => test(slotAt(p, k)!));
const units = (slot: PSlot) => slot.energy.flatMap((e) => energyProvides(e));
const providesType = (c: PCard, type: string) => energyProvides(c).some((u) => unitIs(u, type));
const typeUnits = (slot: PSlot, type: string) => units(slot).filter((u) => unitIs(u, type)).length;
const basicEnergyOf = (type: string | undefined) => (c: PCard) => isBasicEnergy(c) && (!type || c.name.includes(type));

/** "Flip a coin" / "Flip 3 coins" / "Flip a coin until you get tails": the number of heads. */
function heads(ctx: AttackCtx, spec: string) {
  if (/until you get tails/i.test(spec)) return ctx.untilTails();
  const n = /^a coin$/i.test(spec.trim()) ? 1 : toCount(spec.replace(/coins?/i, "").trim());
  return n === 1 ? (ctx.coin() ? 1 : 0) : ctx.coins(n);
}
const FLIPS = "Flip (a coin until you get tails|a coin|\\w+ coins)";

/** Effects of this attack can't touch this Pokémon (protection, Abilities, Mist Energy). */
function proof(state: PState, seat: Seat, slot: PSlot) {
  const attacker = state.players[seat].active;
  if (slot.effects.protect?.turn === state.turn && slot.effects.protect.effects) return true;
  return !!attacker && effectsProof(state, seat, attacker, slot);
}

function condition(state: PState, seat: Seat, slot: PSlot, word: string) {
  addCondition(state, slot, word.toLowerCase() as Condition);
  log(state, seat, `${topCard(slot).name} is now ${word}.`);
}

/** Attack damage to the opponent's Active Pokémon from a later choice: Weakness, Resistance and protection apply. */
function hitActive(state: PState, seat: Seat, amount: number, text: string, name: string) {
  const p = state.players[seat];
  const defender = state.players[otherSeat(seat)].active;
  const attacker = p.active;
  if (!attacker || !defender) return 0;
  let damage = amount > 0 ? finalDamage(state, seat, attacker, defender, amount, text) : 0;
  if (damage > 0 && defender.effects.protect?.turn === state.turn) {
    log(state, seat, `${topCard(defender).name} is protected, so ${name} did no damage.`, "attack");
    return 0;
  }
  const guard = defender.effects.guard?.turn === state.turn ? defender.effects.guard.amount : 0;
  damage = Math.max(0, damage - guard);
  if (damage > 0) log(state, seat, `${name} did ${damage} damage to ${topCard(defender).name}.`, "attack");
  else log(state, seat, `${name} did no damage.`, "attack");
  hitWithAttack(state, seat, attacker, defender, damage);
  return damage;
}

/** Attack damage to one of the opponent's Pokémon by slot key. */
function hitKey(state: PState, seat: Seat, key: string, amount: number, text: string, name: string) {
  const opp = state.players[otherSeat(seat)];
  if (key === "active") return hitActive(state, seat, amount, text, name);
  const slot = opp.bench[Number(key.split(":")[1])];
  if (!slot || amount <= 0) return 0;
  const done = benchDamage(state, seat, slot, amount);
  log(state, seat, `${name} did ${done} damage to ${topCard(slot).name} on the Bench.`, "attack");
  return done;
}

/** Plain data describing the attack for resumes that do its damage later. */
const hitData = (ctx: AttackCtx, extra: Data = {}): Data => {
  const boost = ctx.attacker.effects.boost;
  const boosted = boost && boost.turn === ctx.state.turn && ctx.attack.damage.trim() !== "" ? boost.amount : 0;
  return { text: ctx.text, name: ctx.attack.name, base: ctx.base + boosted, ...extra };
};

function knockOut(state: PState, seat: Seat, slot: PSlot) {
  slot.damage = Math.max(slot.damage, maxHp(state, slot));
  log(state, seat, `${topCard(slot).name} is Knocked Out by ${state.players[seat].name}'s attack.`);
}

function discardOppDeck(ctx: AttackCtx, n: number) {
  const { state, seat, oppSeat, opp } = ctx;
  if (n <= 0) return [];
  if (deckGuarded(state, oppSeat)) {
    log(state, seat, `Patrol Cap stops ${opp.name}'s deck being discarded.`);
    return [];
  }
  const gone = opp.deck.splice(0, n);
  opp.discard.push(...gone);
  log(state, seat, `${opp.name} discarded the top ${plural(gone.length, "card")} of their deck.`);
  discardedByOpponent(state, oppSeat, gone, "deck");
  return gone;
}

function randomFromOppHand(ctx: AttackCtx, n: number) {
  const picked: PCard[] = [];
  for (let i = 0; i < n && ctx.opp.hand.length; i++) picked.push(ctx.opp.hand.splice(Math.floor(Math.random() * ctx.opp.hand.length), 1)[0]);
  return picked;
}

/** Takes up to n Energy off a Pokémon (Special Energy first, as the other player would usually rather keep it). */
function takeEnergy(slot: PSlot, n: number) {
  const gone = slot.energy.slice(-n);
  slot.energy = slot.energy.filter((e) => !gone.includes(e));
  return gone;
}

function discardOppEnergy(ctx: AttackCtx, n: number) {
  const d = ctx.defender;
  if (n <= 0 || ctx.shielded || !d.energy.length) return;
  const gone = takeEnergy(d, n);
  ctx.opp.discard.push(...gone);
  log(ctx.state, ctx.seat, `${plural(gone.length, "Energy")} was discarded from ${topCard(d).name}.`);
}

/** Moves the chosen cards (by uid) out of a player's hand or off their Pokémon, into the discard pile. */
function discardPicked(p: PPlayer, picks: string[]) {
  const gone: PCard[] = [];
  for (const c of p.hand.filter((x) => picks.includes(x.uid))) gone.push(c);
  p.hand = p.hand.filter((x) => !picks.includes(x.uid));
  for (const slot of inPlay(p)) {
    for (const e of slot.energy.filter((x) => picks.includes(x.uid))) gone.push(e);
    slot.energy = slot.energy.filter((x) => !picks.includes(x.uid));
    for (const t of toolsOn(slot).filter((x) => picks.includes(x.uid))) {
      removeTool(slot, t.uid);
      gone.push(t);
    }
  }
  p.discard.push(...gone);
  return gone;
}

/**
 * "Discard up to N ... This attack does X damage for each card you discarded in this way": asks which
 * cards to discard (from the hand or from Pokémon), then does the damage. `then: "pick"` asks for a target.
 */
function askPay(ctx: AttackCtx, title: string, cards: { card: PCard; slot?: PSlot }[], max: number, data: Data) {
  const { state, seat } = ctx;
  const n = Math.min(max, cards.length);
  if (!n) return RESUME1["atk:1:paid"](state, seat, [], data);
  const fromHand = cards.every((x) => !x.slot);
  const botPick = cards.slice(0, n).map((x) => x.card.uid);
  if (fromHand) {
    ask(state, { seat, title, zone: "hand", options: cards.map((x) => x.card.uid), min: 0, max: n, effect: "atk:1:paid", data: { ...data, botPick } });
  } else {
    askChoice(
      state,
      seat,
      title,
      cards.map((x) => ({ id: x.card.uid, label: `${x.card.name} on ${topCard(x.slot!).name}` })),
      "atk:1:paid",
      { min: 0, max: n, data: { ...data, botPick } },
    );
  }
}

/** Energy (or Tools) attached to some of a player's Pokémon, as choices. */
const attachedCards = (slots: PSlot[], test: (c: PCard) => boolean, tools = false) =>
  slots.flatMap((slot) => (tools ? toolsOn(slot) : slot.energy).filter(test).map((card) => ({ card, slot })));

/** Asks for up to `max` cards (from the deck or discard pile), then where to attach each one. */
function askAttach(state: PState, seat: Seat, from: "deck" | "discard", test: (c: PCard) => boolean, max: number, bench: boolean, what: string) {
  const p = state.players[seat];
  const zone = from === "deck" ? p.deck : p.discard;
  const options = zone.filter(test).map((c) => c.uid);
  const targets = bench ? p.bench.length : inPlay(p).length;
  if (!options.length || !targets || max <= 0) {
    if (from === "deck") shuffle(p.deck);
    return;
  }
  ask(state, {
    seat,
    title: `Choose up to ${max} ${what} to attach to your ${bench ? "Benched " : ""}Pokémon`,
    zone: from,
    options,
    ...(from === "deck" ? { shown: p.deck.map((c) => c.uid) } : {}),
    min: 0,
    max: Math.min(max, options.length),
    effect: "atk:1:attachPick",
    data: { from, bench },
  });
}

function askEvolveFromDeck(state: PState, seat: Seat, queue: string[]) {
  const p = state.players[seat];
  const key = queue.shift();
  if (!key) return void shuffle(p.deck);
  const slot = slotAt(p, key as SlotKey);
  const options = slot ? p.deck.filter((c) => c.evolvesFrom === topCard(slot).name).map((c) => c.uid) : [];
  if (!slot || !options.length) return askEvolveFromDeck(state, seat, queue);
  ask(state, {
    seat,
    title: `Choose a card to evolve ${topCard(slot).name} into`,
    zone: "deck",
    options,
    shown: p.deck.map((c) => c.uid),
    min: 1,
    max: 1,
    effect: "atk:1:evolveCard",
    data: { key, queue },
  });
}

// ----- Attacks used in earlier turns -----

type Used = { turn: number; seat: Seat; uid: string; name: string; attack: string; ancient: boolean };
type WithHistory = PState & { attacksUsed?: Used[] };
const attacksUsed = (state: PState) => (state as WithHistory).attacksUsed ?? [];
function noteAttack(ctx: AttackCtx) {
  const s = ctx.state as WithHistory;
  const c = topCard(ctx.attacker);
  const list = (s.attacksUsed ?? []).filter((u) => u.turn >= s.turn - 3);
  list.push({ turn: s.turn, seat: ctx.seat, uid: ctx.attacker.pokemon[0].uid, name: c.name, attack: ctx.attack.name, ancient: c.subtypes.includes("Ancient") });
  s.attacksUsed = list;
}
const usedLastTurn = (ctx: AttackCtx, test: (u: Used) => boolean) =>
  attacksUsed(ctx.state).some((u) => u.seat === ctx.seat && u.turn === ctx.state.turn - 2 && test(u));

/** Whether the Pokémon named `name` retreated during the opponent's last turn (read from the game log). */
function retreatedLastTurn(state: PState, seat: Seat, name: string) {
  const opp = state.players[otherSeat(seat)];
  let start = state.log.length - 1;
  while (start >= 0 && !(state.log[start].kind === "turn" && state.log[start].text.startsWith(`Turn ${state.turn - 1}:`))) start--;
  if (start < 0) return false;
  return state.log.slice(start).some((l) => l.seat === otherSeat(seat) && l.text.startsWith(`${opp.name} retreated ${name} and sent in `));
}

// ----- "If ..., this attack does N more damage." -----

type Check = (ctx: AttackCtx, m: RegExpMatchArray) => boolean;
const koLastTurn = (ctx: AttackCtx, prefix: string) =>
  ctx.p.koTurn === ctx.state.turn - 1 && (!prefix || (ctx.p.koNames ?? []).some((n) => n.startsWith(prefix)));
const benchHas = (p: PPlayer, words: string) => {
  if (!words) return p.bench.length > 0;
  const w = words.split(" ");
  return p.bench.some((s) => {
    const c = topCard(s);
    return w.every((x, i) =>
      x === "Stage" ? isStage(c, Number(w[i + 1]) as 1 | 2) : /^\d$/.test(x) ? true : x === "Tera" ? isTera(c) : c.types.includes(x) || c.subtypes.includes(x),
    );
  });
};
const CHECKS: [string, Check][] = [
  ["1 of your other Ancient Pokémon used an attack during your last turn", (x) => usedLastTurn(x, (u) => u.ancient && u.uid !== x.attacker.pokemon[0].uid)],
  ["1 of your (\\S+) used ([^,.]+?) during your last turn", (x, m) => usedLastTurn(x, (u) => baseName(u.name) === m[1] && u.attack === m[2])],
  ["this Pokémon used ([^,.]+?) during your last turn", (x, m) => usedLastTurn(x, (u) => u.uid === x.attacker.pokemon[0].uid && u.attack === m[1])],
  [
    "([A-Z][\\w' -]*(?:, [A-Z][\\w' -]*)*,? and [A-Z][\\w' -]*) are on your Bench",
    (x, m) => m[1].split(/,? and |, /).every((name) => x.p.bench.some((s) => baseName(topCard(s).name) === name.trim())),
  ],
  ["([^,.]+?) is in your discard pile", (x, m) => x.p.discard.some((c) => baseName(c.name) === m[1])],
  ["a Stadium is in play", (x) => !!x.state.stadium],
  ["all of your Benched Pokémon have at least 1 damage counter on them", (x) => x.p.bench.length > 0 && x.p.bench.every((s) => s.damage > 0)],
  ["any of your Benched (\\S+) have any damage counters on them", (x, m) => x.p.bench.some((s) => baseName(topCard(s).name) === m[1] && s.damage > 0)],
  ["any of your ((?:\\S+'s )?)Pokémon were Knocked Out (?:by damage from an attack )?during your opponent's last turn", (x, m) => koLastTurn(x, m[1])],
  [
    "any of your Pokémon in play are the same type as any of your opponent's Pokémon in play",
    (x) => {
      const theirs = new Set(inPlay(x.opp).flatMap((s) => topCard(s).types));
      return inPlay(x.p).some((s) => topCard(s).types.some((t) => theirs.has(t)));
    },
  ],
  ["the Retreat Cost of your opponent's Active Pokémon is ((?:Colorless)+) or more", (x, m) => retreatCost(x.state, x.defender) >= m[1].length / 9],
  ["there are (\\d+) or fewer cards in your deck", (x, m) => x.p.deck.length <= Number(m[1])],
  ["this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached", (x) => units(x.attacker).length === units(x.defender).length],
  ["this Pokémon has (\\d+) or more (\\w+) Energy attached", (x, m) => typeUnits(x.attacker, m[2]) >= Number(m[1])],
  ["this Pokémon has (\\d+) or more damage counters on it", (x, m) => x.attacker.damage >= Number(m[1]) * 10],
  ["this Pokémon has a Pokémon Tool attached", (x) => toolsOn(x.attacker).length > 0],
  [
    "this Pokémon has any (?!Special )([^,.]+?) Energy attached",
    (x, m) => (ENERGY_TYPES.includes(m[1]) ? typeUnits(x.attacker, m[1]) > 0 : x.attacker.energy.some((e) => baseName(e.name) === `${m[1]} Energy`)),
  ],
  [
    "this Pokémon has at least (\\d+) extra Energy attached",
    (x, m) => units(x.attacker).length - attackCost(x.state, x.attacker, x.attack).length >= Number(m[1]),
  ],
  ["this Pokémon has more Energy attached than your opponent's Active Pokémon", (x) => units(x.attacker).length > units(x.defender).length],
  ["this Pokémon is affected by a Special Condition", (x) => x.attacker.conditions.length > 0],
  ["you and your opponent have the same number of Benched Pokémon", (x) => x.p.bench.length === x.opp.bench.length],
  ["you have (\\d+) or more Basic (\\w+) Energy cards in your discard pile", (x, m) => x.p.discard.filter(basicEnergyOf(m[2])).length >= Number(m[1])],
  [
    "you have (\\d+) or more Pokémon that have the ([^,.]+?) Ability in your discard pile",
    (x, m) => x.p.discard.filter((c) => isPokemon(c) && c.abilities.some((a) => a.name === m[2])).length >= Number(m[1]),
  ],
  ["you have any ((?:Stage \\d )?(?:\\w+ )?)Pokémon on your Bench", (x, m) => benchHas(x.p, m[1].trim())],
  ["you have exactly (\\d+) Prize cards? remaining", (x, m) => x.p.prizes.length === Number(m[1])],
  ["you have more cards in your hand than your opponent", (x) => x.p.hand.length > x.opp.hand.length],
  ["you have no Supporter cards in your discard pile", (x) => !x.p.discard.some(isSupporter)],
  ["you have no cards in your hand", (x) => x.p.hand.length === 0],
  ["you have used your VSTAR Power", (x) => x.p.vstarUsed],
  ["your Benched Pokémon have any damage counters on them", (x) => x.p.bench.some((s) => s.damage > 0)],
  ["your Benched Pokémon have any ([^,.]+? Energy) attached", (x, m) => x.p.bench.some((s) => s.energy.some((e) => baseName(e.name) === m[1]))],
  ["your opponent has (\\d+) or fewer Prize cards remaining", (x, m) => x.opp.prizes.length <= Number(m[1])],
  ["your opponent has (\\d+) or fewer cards in their hand", (x, m) => x.opp.hand.length <= Number(m[1])],
];

function conditionalRules(): AttackRule[] {
  return CHECKS.map(([phrase, check]) => ({
    re: R(
      `If ${phrase}, this attack does (?<more>\\d+) more damage(?:, and your opponent's Active Pokémon is now (?<c1>${CONDITION.slice(1, -1)})(?: and (?<c2>${CONDITION.slice(1, -1)}))?)?\\.`,
    ),
    pre: (ctx, m) => {
      const ok = check(ctx, m);
      ctx.memo[`if:${phrase}`] = ok;
      if (ok) ctx.base += Number(m.groups!.more);
    },
    post: (ctx, m) => {
      if (!ctx.memo[`if:${phrase}`] || ctx.shielded) return;
      for (const c of [m.groups!.c1, m.groups!.c2].filter(Boolean)) condition(ctx.state, ctx.seat, ctx.defender, c);
    },
  }));
}

// ----- Discarding cards to power up an attack -----

function payRules(): AttackRule[] {
  return [
    {
      re: R(
        "Before doing damage, you may discard any number of Pokémon Tools from your Pokémon\\. This attack does (\\d+) more damage for each card you discarded in this way\\.",
      ),
      pre: (ctx) => void (ctx.skipDamage = true),
      post: (ctx, m) =>
        askPay(
          ctx,
          "Discard any number of Pokémon Tools from your Pokémon",
          attachedCards(inPlay(ctx.p), () => true, true),
          99,
          hitData(ctx, { per: Number(m[1]) }),
        ),
    },
    {
      // Energy attached to Pokémon: "Discard up to 2 Energy cards from this Pokémon, and this attack does 120 damage for each card ..."
      re: R(
        "(?<!may )Discard (up to (\\w+)|any amount of) (?:(\\w+) )?Energy(?: cards?)? from (this Pokémon|your Pokémon|among your Pokémon)(?:, and|\\.) [Tt]his attack does (\\d+) damage for each card you discarded in this way\\.",
      ),
      pre: (ctx) => {
        ctx.skipDamage = true;
        ctx.base = 0;
      },
      post: (ctx, m) => {
        const type = m[3] && ENERGY_TYPES.includes(m[3]) ? m[3] : undefined;
        const slots = /this/i.test(m[4]) ? [ctx.attacker] : inPlay(ctx.p);
        const cards = attachedCards(slots, (c) => !type || providesType(c, type));
        const max = m[2] ? toCount(m[2]) : 99;
        askPay(
          ctx,
          `Discard ${m[2] ? `up to ${max}` : "any amount of"} ${type ? `${type} ` : ""}Energy from ${m[4]}`,
          cards,
          max,
          hitData(ctx, { per: Number(m[5]) }),
        );
      },
    },
    {
      // Cards from the hand. (The plain "Discard up to N Basic X Energy cards from your hand. This attack does ..." is in attacks.ts.)
      re: R(
        "Discard (?!up to \\w+ Basic \\w+ Energy cards? from your hand\\. )(any number of|up to (\\w+)) (Basic (?:(\\w+) )?Energy cards|Energy cards|Pokémon Tool cards) from your hand(, and|\\.) [Tt]his attack does (\\d+) damage (to 1 of your opponent's Pokémon )?for each (?:Energy )?card you discarded in this way\\.",
      ),
      pre: (ctx) => {
        ctx.skipDamage = true;
        ctx.base = 0;
      },
      post: (ctx, m) => {
        const kind = m[3].toLowerCase();
        const type = m[4] && ENERGY_TYPES.includes(m[4]) ? m[4] : undefined;
        const test = (c: PCard) => (kind.startsWith("pokémon tool") ? isTool(c) : kind.startsWith("basic") ? basicEnergyOf(type)(c) : isEnergy(c));
        const cards = ctx.p.hand.filter(test).map((card) => ({ card }));
        const max = m[2] ? toCount(m[2]) : 99;
        askPay(ctx, `Discard ${m[2] ? `up to ${max}` : "any number of"} ${m[3]} from your hand`, cards, max, hitData(ctx, { per: Number(m[6]), pick: !!m[7] }));
      },
    },
  ];
}

// ----- Discarding from the deck or hand, then damage -----

function deckRules(): AttackRule[] {
  return [
    {
      re: R(
        "Discard cards from the top of your deck until only 1 card remains\\. This attack does (\\d+) more damage for each Energy card you discarded in this way\\.",
      ),
      pre: (ctx, m) => {
        const gone = ctx.p.deck.splice(0, Math.max(0, ctx.p.deck.length - 1));
        ctx.p.discard.push(...gone);
        const n = gone.filter(isEnergy).length;
        log(ctx.state, ctx.seat, `${ctx.p.name} discarded ${plural(gone.length, "card")} from their deck (${plural(n, "Energy card")}).`);
        ctx.base += Number(m[1]) * n;
      },
    },
    {
      re: R(
        "Discard the top (\\w+) cards of your deck, and this attack does (\\d+) damage for each (Basic (\\w+) Energy card|(\\S+'s) Pokémon) (?:that )?you discarded in this way\\.",
      ),
      pre: (ctx, m) => {
        const gone = ctx.p.deck.splice(0, toCount(m[1]));
        ctx.p.discard.push(...gone);
        const n = gone.filter((c) => (m[4] ? basicEnergyOf(m[4])(c) : isPokemon(c) && c.name.startsWith(`${m[5]} `))).length;
        log(
          ctx.state,
          ctx.seat,
          `${ctx.p.name} discarded the top ${plural(gone.length, "card")} of their deck: ${gone.map((c) => c.name).join(", ") || "none"}.`,
        );
        ctx.base = Number(m[2]) * n;
      },
    },
    {
      re: R("Discard the top card of each player's deck\\. This attack does (\\d+) more damage for each Energy card discarded in this way\\."),
      pre: (ctx, m) => {
        const mine = ctx.p.deck.splice(0, 1);
        ctx.p.discard.push(...mine);
        const theirs = discardOppDeck(ctx, 1);
        const all = [...mine, ...theirs];
        log(ctx.state, ctx.seat, `Discarded: ${all.map((c) => c.name).join(", ") || "nothing"}.`);
        ctx.base += Number(m[1]) * all.filter(isEnergy).length;
      },
    },
    {
      re: R(
        "Discard the top card of your deck\\. If that card is an Energy card, this attack does (\\d+) more damage, and attach that card to this Pokémon\\.",
      ),
      pre: (ctx, m) => {
        const card = ctx.p.deck.shift();
        if (!card) return;
        ctx.p.discard.push(card);
        log(ctx.state, ctx.seat, `${ctx.p.name} discarded ${card.name} from the top of their deck.`);
        if (!isEnergy(card)) return;
        ctx.base += Number(m[1]);
        ctx.memo.attach = card.uid;
      },
      post: (ctx) => {
        const card = ctx.p.discard.find((c) => c.uid === ctx.memo.attach);
        if (!card || !ctx.p.active) return;
        ctx.p.discard.splice(ctx.p.discard.indexOf(card), 1);
        ctx.p.active.energy.push(card);
        log(ctx.state, ctx.seat, `${ctx.p.name} attached ${card.name} to ${topCard(ctx.p.active).name}.`);
      },
    },
    {
      re: R("Discard your hand\\. If you discarded (\\d+) or more cards in this way, this attack does (\\d+) more damage\\."),
      pre: (ctx, m) => {
        const gone = ctx.p.hand.splice(0);
        ctx.p.discard.push(...gone);
        log(ctx.state, ctx.seat, `${ctx.p.name} discarded their hand (${plural(gone.length, "card")}).`);
        if (gone.length >= Number(m[1])) ctx.base += Number(m[2]);
      },
    },
    {
      re: R(
        "Each player reveals their hand\\. If a card in your opponent's hand has the same name as a card in your hand, this attack does (\\d+) more damage\\.",
      ),
      pre: (ctx, m) => {
        const show = (p: PPlayer) => `${p.name}'s hand: ${p.hand.map((c) => c.name).join(", ") || "empty"}.`;
        log(ctx.state, ctx.seat, show(ctx.p));
        log(ctx.state, ctx.seat, show(ctx.opp));
        const mine = new Set(ctx.p.hand.map((c) => c.name));
        if (ctx.opp.hand.some((c) => mine.has(c.name))) ctx.base += Number(m[1]);
      },
    },
  ];
}

// ----- Coin flips -----

function coinRules(): AttackRule[] {
  const flipsThen = (effect: string) => R(`${FLIPS}\\. ${effect}`);
  const cond = CONDITION;
  return [
    {
      re: flipsThen("For each heads, discard the top (card|(\\w+) cards) of your opponent's deck\\."),
      post: (ctx, m) => void discardOppDeck(ctx, Number(ctx.memo.heads) * (m[3] ? toCount(m[3]) : 1)),
      pre: (ctx, m) => void (ctx.memo.heads = heads(ctx, m[1])),
    },
    {
      re: flipsThen("For each heads, discard a random card from your opponent's hand\\."),
      pre: (ctx, m) => void (ctx.memo.heads = heads(ctx, m[1])),
      post: (ctx) => {
        const gone = randomFromOppHand(ctx, Number(ctx.memo.heads));
        if (!gone.length) return;
        ctx.opp.discard.push(...gone);
        log(ctx.state, ctx.seat, `${ctx.opp.name} discarded ${gone.map((c) => c.name).join(", ")} from their hand.`);
        discardedByOpponent(ctx.state, ctx.oppSeat, gone, "hand");
      },
    },
    {
      re: R(
        "Flip a coin until you get tails\\. For each heads, choose a random card from your opponent's hand\\. Your opponent reveals those cards and shuffles them into their deck\\.",
      ),
      pre: (ctx) => void (ctx.memo.heads = ctx.untilTails()),
      post: (ctx) => {
        const gone = randomFromOppHand(ctx, Number(ctx.memo.heads));
        if (!gone.length) return;
        ctx.opp.deck.push(...gone);
        shuffle(ctx.opp.deck);
        log(ctx.state, ctx.seat, `${ctx.opp.name} shuffled ${gone.map((c) => c.name).join(", ")} from their hand into their deck.`);
      },
    },
    {
      re: flipsThen("For each heads, discard an Energy from your opponent's Active Pokémon\\."),
      pre: (ctx, m) => void (ctx.memo.heads = heads(ctx, m[1])),
      post: (ctx) => discardOppEnergy(ctx, Number(ctx.memo.heads)),
    },
    {
      re: flipsThen("For each heads, shuffle an Energy attached to your opponent's Active Pokémon into their deck\\."),
      pre: (ctx, m) => void (ctx.memo.heads = heads(ctx, m[1])),
      post: (ctx) => {
        const n = Number(ctx.memo.heads);
        if (!n || ctx.shielded || !ctx.defender.energy.length) return;
        const gone = takeEnergy(ctx.defender, n);
        ctx.opp.deck.push(...gone);
        shuffle(ctx.opp.deck);
        log(ctx.state, ctx.seat, `${plural(gone.length, "Energy")} from ${topCard(ctx.defender).name} was shuffled into ${ctx.opp.name}'s deck.`);
      },
    },
    {
      re: flipsThen("For each heads, draw a card\\."),
      pre: (ctx, m) => void (ctx.memo.heads = heads(ctx, m[1])),
      post: (ctx) => {
        const n = Number(ctx.memo.heads);
        if (!n) return;
        draw(ctx.p, n);
        log(ctx.state, ctx.seat, `${ctx.p.name} drew ${plural(n, "card")}.`);
      },
    },
    {
      re: flipsThen("For each tails, discard an Energy from this Pokémon\\."),
      pre: (ctx, m) => {
        const n = toCount(m[1].split(" ")[0]);
        ctx.memo.tails = n - heads(ctx, m[1]);
      },
      post: (ctx) => {
        const n = Number(ctx.memo.tails);
        if (!n || !ctx.p.active) return;
        const gone = takeEnergy(ctx.p.active, n);
        ctx.p.discard.push(...gone);
        if (gone.length) log(ctx.state, ctx.seat, `${topCard(ctx.p.active).name} discarded ${plural(gone.length, "Energy")}.`);
      },
    },
    {
      re: flipsThen("Search your deck for a number of cards up to the number of heads and put them into your hand\\. Then, shuffle your deck\\."),
      pre: (ctx, m) => void (ctx.memo.heads = heads(ctx, m[1])),
      post: (ctx) => {
        const n = Number(ctx.memo.heads);
        if (!n || !ctx.p.deck.length) return void shuffle(ctx.p.deck);
        ask(ctx.state, {
          seat: ctx.seat,
          title: `Choose up to ${plural(n, "card")} to put into your hand`,
          zone: "deck",
          options: ctx.p.deck.map((c) => c.uid),
          shown: ctx.p.deck.map((c) => c.uid),
          min: 0,
          max: Math.min(n, ctx.p.deck.length),
          effect: "handFromDeck",
        });
      },
    },
    {
      re: flipsThen("Search your deck for a number of (\\w+) Pokémon up to the number of heads and put them onto your Bench\\. Then, shuffle your deck\\."),
      pre: (ctx, m) => void (ctx.memo.heads = heads(ctx, m[1])),
      post: (ctx, m) => benchSearch(ctx, Number(ctx.memo.heads), (c) => c.types.includes(m[2]), `${m[2]} Pokémon`),
    },
    {
      re: flipsThen(
        "Attach (?:a number|an amount) of (Basic (?:(\\w+) )?Energy)(?: cards)? up to the number of heads from your discard pile to your Benched Pokémon in any way you like\\.",
      ),
      pre: (ctx, m) => void (ctx.memo.heads = heads(ctx, m[1])),
      post: (ctx, m) => askAttach(ctx.state, ctx.seat, "discard", basicEnergyOf(m[3]), Number(ctx.memo.heads), true, `${m[2]} cards`),
    },
    {
      re: flipsThen(
        "Choose a number of your Pokémon in play up to the number of heads\\. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it\\. Then, shuffle your deck\\.",
      ),
      pre: (ctx, m) => void (ctx.memo.heads = heads(ctx, m[1])),
      post: (ctx) => {
        const n = Number(ctx.memo.heads);
        const options = pokemonKeys(ctx.p, (s) => ctx.p.deck.some((c) => c.evolvesFrom === topCard(s).name));
        if (!n || !options.length) return void shuffle(ctx.p.deck);
        ask(ctx.state, {
          seat: ctx.seat,
          title: `Choose up to ${plural(n, "Pokémon")} to evolve from your deck`,
          zone: "myPokemon",
          options,
          min: 0,
          max: Math.min(n, options.length),
          effect: "atk:1:evolvePick",
        });
      },
    },
    {
      re: flipsThen("Put a number of cards up to the number of heads from your discard pile into your hand\\."),
      pre: (ctx, m) => void (ctx.memo.heads = heads(ctx, m[1])),
      post: (ctx) => {
        const n = Math.min(Number(ctx.memo.heads), ctx.p.discard.length);
        if (!n) return;
        ask(ctx.state, {
          seat: ctx.seat,
          title: `Choose up to ${plural(n, "card")} to put into your hand`,
          zone: "discard",
          options: ctx.p.discard.map((c) => c.uid),
          min: 0,
          max: n,
          effect: "atk:1:toHand",
        });
      },
    },
    {
      // Weavile, Watchog: "If either/any of them is heads, your opponent reveals their hand. For each heads, choose a card ..."
      re: flipsThen(
        "If (?:either|any) of them (?:is|are) heads, your opponent reveals their hand\\. For each heads, choose a card you find there and (put it on the bottom of|shuffle it into) your opponent's deck(?: in any order)?\\.",
      ),
      pre: (ctx, m) => void (ctx.memo.heads = heads(ctx, m[1])),
      post: (ctx, m) => {
        const n = Math.min(Number(ctx.memo.heads), ctx.opp.hand.length);
        if (!Number(ctx.memo.heads)) return;
        log(ctx.state, ctx.seat, `${ctx.opp.name}'s hand: ${ctx.opp.hand.map((c) => c.name).join(", ") || "empty"}.`);
        if (!n) return;
        const bottom = /bottom/i.test(m[2]);
        ask(ctx.state, {
          seat: ctx.seat,
          title: `Choose ${plural(n, "card")} from ${ctx.opp.name}'s hand to ${bottom ? "put on the bottom of" : "shuffle into"} their deck`,
          zone: "oppHand",
          options: ctx.opp.hand.map((c) => c.uid),
          min: n,
          max: n,
          effect: "atk:1:oppHandToDeck",
          data: { bottom },
        });
      },
    },
    {
      re: R(
        "Flip (\\w+) coins\\. If 1 of them is heads, this attack does (\\d+) more damage\\. If 2 of them are heads, this attack does (\\d+) more damage\\. If all of them are heads, this attack does (\\d+) more damage\\.",
      ),
      pre: (ctx, m) => {
        const h = ctx.coins(toCount(m[1]));
        ctx.base += [0, Number(m[2]), Number(m[3]), Number(m[4])][Math.min(h, 3)];
      },
    },
    {
      re: R(
        "Flip (\\w+) coins\\. This attack does (\\d+) damage for each heads\\. If (at least (\\d+)|either|both) of them (?:is|are) (heads|tails),\\s+your opponent's Active Pokémon is now " +
          cond +
          "\\.",
      ),
      pre: (ctx, m) => {
        const n = toCount(m[1]);
        const h = ctx.coins(n);
        ctx.base = Number(m[2]) * h;
        const want = m[5].toLowerCase() === "heads" ? h : n - h;
        ctx.memo.ok = m[4] ? want >= Number(m[4]) : /either/i.test(m[3]) ? want >= 1 : want === n;
      },
      post: (ctx, m) => {
        if (ctx.memo.ok && !ctx.shielded) condition(ctx.state, ctx.seat, ctx.defender, m[6]);
      },
    },
    {
      re: R(
        `Flip a coin until you get tails\\. This attack does (\\d+) damage for each heads\\. If the first flip is tails, your opponent's Active Pokémon is now ${cond}\\.`,
      ),
      pre: (ctx, m) => {
        const h = ctx.untilTails();
        ctx.base = Number(m[1]) * h;
        ctx.memo.ok = h === 0;
      },
      post: (ctx, m) => {
        if (ctx.memo.ok && !ctx.shielded) condition(ctx.state, ctx.seat, ctx.defender, m[2]);
      },
    },
    {
      re: R(
        "Flip a coin for each (?:(\\w+) )?(Energy attached to (?:this Pokémon|both Active Pokémon)|Pokémon you have in play)\\. This attack does (\\d+) damage for each heads\\.",
      ),
      pre: (ctx, m) => {
        const type = m[1];
        let n: number;
        if (/Pokémon you have in play/.test(m[2])) n = inPlay(ctx.p).filter((s) => topCard(s).types.includes(type)).length;
        else {
          const slots = /both/.test(m[2]) ? [ctx.attacker, ctx.defender] : [ctx.attacker];
          n = slots.reduce((k, s) => k + (type ? typeUnits(s, type) : units(s).length), 0);
        }
        ctx.base = Number(m[3]) * ctx.coins(n);
      },
    },
    ...bothRules(),
    ...headsRules(),
  ];
}

/** "Flip 2 coins. If both of them are heads/tails, ..." */
function bothRules(): AttackRule[] {
  const both = (effect: string, pre: AttackRule["pre"], post?: AttackRule["post"]): AttackRule => ({
    re: R(`Flip (\\w+) coins\\. If (?:both|all) of them are (heads|tails), ${effect}`),
    pre: (ctx, m) => {
      const n = toCount(m[1]);
      const h = ctx.coins(n);
      ctx.memo.ok = m[2].toLowerCase() === "heads" ? h === n : h === 0;
      if (ctx.memo.ok) pre?.(ctx, m);
    },
    post: post && ((ctx, m) => void (ctx.memo.ok && post(ctx, m))),
  });
  return [
    both("this attack does (\\d+) more damage\\.", (ctx, m) => void (ctx.base += Number(m[3]))),
    both("this Pokémon also does (\\d+) damage to itself\\.", undefined, (ctx, m) => {
      ctx.attacker.damage += Number(m[3]);
      log(ctx.state, ctx.seat, `${topCard(ctx.attacker).name} did ${m[3]} damage to itself.`);
    }),
    both("heal all damage from 1 of your Pokémon\\.", undefined, (ctx) => {
      const options = pokemonKeys(ctx.p, (s) => s.damage > 0);
      if (options.length)
        ask(ctx.state, {
          seat: ctx.seat,
          title: "Choose 1 of your Pokémon to heal all damage from",
          zone: "myPokemon",
          options,
          min: 1,
          max: 1,
          effect: "atk:1:healAll",
        });
    }),
    both("search your deck for a Pokémon and put it onto your Bench\\. Then, shuffle your deck\\.", undefined, (ctx) =>
      benchSearch(ctx, 1, () => true, "Pokémon"),
    ),
    both("your opponent's Active Pokémon is Knocked Out\\.", undefined, (ctx) => {
      if (!ctx.shielded && ctx.opp.active === ctx.defender) knockOut(ctx.state, ctx.seat, ctx.defender);
    }),
    both("Knock Out 1 of your opponent's Pokémon\\.", undefined, (ctx) => {
      const options = pokemonKeys(ctx.opp, (s) => !proof(ctx.state, ctx.seat, s));
      if (options.length)
        ask(ctx.state, {
          seat: ctx.seat,
          title: `Choose 1 of ${ctx.opp.name}'s Pokémon to Knock Out`,
          zone: "oppPokemon",
          options,
          min: 1,
          max: 1,
          effect: "atk:1:knockOut",
          data: { amount: 999 },
        });
    }),
  ];
}

function benchSearch(ctx: AttackCtx, n: number, test: (c: PCard) => boolean, what: string) {
  const { state, seat, p } = ctx;
  const room = Math.max(0, benchLimit(state, seat) - p.bench.length);
  const options = p.deck.filter((c) => isBasicPokemon(c) && test(c)).map((c) => c.uid);
  if (!n || !room || !options.length) return void shuffle(p.deck);
  ask(state, {
    seat,
    title: `Choose up to ${Math.min(n, room)} ${what} for your Bench`,
    zone: "deck",
    options,
    shown: p.deck.map((c) => c.uid),
    min: 0,
    max: Math.min(n, room, options.length),
    effect: "benchFromDeck",
  });
}

/** "Flip a coin. If heads, ..." and "If tails, ..." */
function headsRules(): AttackRule[] {
  const on = (side: "heads" | "tails", effect: string, post: AttackRule["post"], pre?: AttackRule["pre"]): AttackRule => ({
    // Not when the card goes on with "If heads/tails, ..." (attacks.ts reads some of those whole).
    re: R(`Flip a coin\\. If ${side}, ${effect}(?! If (?:heads|tails),)`),
    pre: (ctx, m) => {
      ctx.memo.ok = ctx.coin() === (side === "heads");
      if (ctx.memo.ok) pre?.(ctx, m);
    },
    post: (ctx, m) => void (ctx.memo.ok && post?.(ctx, m)),
  });
  const cond = CONDITION;
  return [
    {
      re: R(
        "Flip a coin\\. If heads, search your deck for a card and put it into your hand\\. Then, shuffle your deck\\. If tails, discard a card from your hand\\.",
      ),
      pre: (ctx) => void (ctx.memo.ok = ctx.coin()),
      post: (ctx) => {
        const { state, seat, p } = ctx;
        if (ctx.memo.ok) {
          if (!p.deck.length) return;
          ask(state, {
            seat,
            title: "Choose a card to put into your hand",
            zone: "deck",
            options: p.deck.map((c) => c.uid),
            shown: p.deck.map((c) => c.uid),
            min: 1,
            max: 1,
            effect: "handFromDeck",
          });
        } else if (p.hand.length) {
          ask(state, {
            seat,
            title: "Discard a card from your hand",
            zone: "hand",
            options: p.hand.map((c) => c.uid),
            min: 1,
            max: 1,
            effect: "atk:1:selfDiscard",
            data: { step: "cost" },
          });
        }
      },
    },
    {
      re: R("Flip a coin\\. If heads, Knock Out your opponent's Active Basic Pokémon\\. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon\\."),
      pre: (ctx) => void (ctx.memo.ok = ctx.coin()),
      post: (ctx) => {
        const { state, seat, opp, defender } = ctx;
        if (ctx.memo.ok) {
          if (!ctx.shielded && opp.active === defender && isBasicPokemon(topCard(defender))) knockOut(state, seat, defender);
          return;
        }
        const options = benchKeys(opp, (s) => isBasicPokemon(topCard(s)) && !proof(state, seat, s));
        if (options.length)
          ask(state, {
            seat,
            title: `Choose 1 of ${opp.name}'s Benched Basic Pokémon to Knock Out`,
            zone: "oppBench",
            options,
            min: 1,
            max: 1,
            effect: "atk:1:knockOut",
            data: { amount: 999 },
          });
      },
    },
    {
      re: R(`Flip a coin\\. If heads, your opponent's Active Pokémon is now ${cond} and ${cond}\\. If tails, your opponent's Active Pokémon is now ${cond}\\.`),
      pre: (ctx) => void (ctx.memo.ok = ctx.coin()),
      post: (ctx, m) => {
        if (ctx.shielded) return;
        for (const c of ctx.memo.ok ? [m[1], m[2]] : [m[3]]) condition(ctx.state, ctx.seat, ctx.defender, c);
      },
    },
    on("tails", "this Pokémon also does (\\d+) damage to itself\\.", (ctx, m) => {
      ctx.attacker.damage += Number(m[1]);
      log(ctx.state, ctx.seat, `${topCard(ctx.attacker).name} did ${m[1]} damage to itself.`);
    }),
    on("tails", "during your next turn, this Pokémon can't (?:attack|use attacks)\\.", (ctx) => void (ctx.attacker.cantAttackTurn = ctx.state.turn + 2)),
    on("tails", "discard all Energy from this Pokémon\\.", (ctx) => {
      const gone = ctx.attacker.energy.splice(0);
      ctx.p.discard.push(...gone);
      log(ctx.state, ctx.seat, `${topCard(ctx.attacker).name} discarded ${plural(gone.length, "Energy")}.`);
    }),
    on(
      "heads",
      "this attack does (\\d+) more damage, and heal (\\d+) damage from this Pokémon\\.",
      (ctx, m) => void heal(ctx.attacker, Number(m[2])),
      (ctx, m) => void (ctx.base += Number(m[1])),
    ),
    on(
      "heads",
      `this attack does (\\d+) more damage, and your opponent's Active Pokémon is now ${cond}\\.`,
      (ctx, m) => void (!ctx.shielded && condition(ctx.state, ctx.seat, ctx.defender, m[2])),
      (ctx, m) => void (ctx.base += Number(m[1])),
    ),
    on("heads", `your opponent's Active Pokémon is now ${cond}, and discard an Energy from that Pokémon\\.`, (ctx, m) => {
      if (ctx.shielded) return;
      condition(ctx.state, ctx.seat, ctx.defender, m[1]);
      discardOppEnergy(ctx, 1);
    }),
    on("heads", "heal (\\d+) damage from this Pokémon\\.", (ctx, m) => {
      const done = heal(ctx.attacker, Number(m[1]));
      if (done) log(ctx.state, ctx.seat, `${topCard(ctx.attacker).name} healed ${done} damage.`);
    }),
    on("heads", "during your opponent's next turn, the Defending Pokémon can't attack\\.", (ctx) => {
      if (!ctx.shielded) ctx.defender.cantAttackTurn = ctx.state.turn + 1;
    }),
    on("heads", "this attack does (\\d+) damage to 1 of your opponent's Pokémon\\.", (ctx, m) =>
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Choose 1 of ${ctx.opp.name}'s Pokémon to take ${m[1]} damage`,
        zone: "oppPokemon",
        options: pokemonKeys(ctx.opp),
        min: 1,
        max: 1,
        effect: "atk:1:hit",
        data: { ...hitData(ctx), amount: Number(m[1]) },
      }),
    ),
    on("heads", "switch this Pokémon with 1 of your Benched Pokémon\\.", (ctx) => {
      if (ctx.p.bench.length)
        ask(ctx.state, {
          seat: ctx.seat,
          title: "Choose a Benched Pokémon to switch with",
          zone: "myBench",
          options: benchKeys(ctx.p),
          min: 1,
          max: 1,
          effect: "selfSwitch",
        });
    }),
    on("heads", "switch 1 of your opponent's Benched Pokémon with their Active Pokémon\\.", (ctx) => {
      if (ctx.opp.bench.length)
        ask(ctx.state, {
          seat: ctx.seat,
          title: `Choose 1 of ${ctx.opp.name}'s Benched Pokémon to switch into the Active Spot`,
          zone: "oppBench",
          options: benchKeys(ctx.opp),
          min: 1,
          max: 1,
          effect: "gustAttack",
        });
    }),
    on("heads", "discard a random card from your opponent's hand\\.", (ctx) => {
      const gone = randomFromOppHand(ctx, 1);
      if (!gone.length) return;
      ctx.opp.discard.push(...gone);
      log(ctx.state, ctx.seat, `${ctx.opp.name} discarded ${gone[0].name} from their hand.`);
      discardedByOpponent(ctx.state, ctx.oppSeat, gone, "hand");
    }),
    on("heads", "discard the top card of your opponent's deck\\.", (ctx) => void discardOppDeck(ctx, 1)),
    on("heads", "move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon\\.", (ctx) => {
      const { state, seat, opp, defender } = ctx;
      if (ctx.shielded || !defender.energy.length || !opp.bench.length) return;
      if (defender.energy.length === 1) return void RESUME1["atk:1:moveEnergy"](state, seat, [defender.energy[0].uid], {});
      askChoice(
        state,
        seat,
        `Choose an Energy on ${topCard(defender).name} to move`,
        defender.energy.map((e) => ({ id: e.uid, label: e.name })),
        "atk:1:moveEnergy",
      );
    }),
    on("heads", "put an Item card from your discard pile into your hand\\.", (ctx) => {
      const options = ctx.p.discard.filter(isItem).map((c) => c.uid);
      if (options.length)
        ask(ctx.state, {
          seat: ctx.seat,
          title: "Choose an Item card to put into your hand",
          zone: "discard",
          options,
          min: 1,
          max: 1,
          effect: "atk:1:toHand",
        });
    }),
    on("heads", "put your opponent's Active Pokémon and all attached cards into your opponent's hand\\.", (ctx) => {
      const { opp, defender } = ctx;
      if (ctx.shielded || opp.active !== defender) return;
      opp.hand.push(...defender.pokemon, ...attachedTo(defender));
      opp.active = null;
      log(ctx.state, ctx.seat, `${topCard(defender).name} and everything attached went back to ${opp.name}'s hand.`);
    }),
    on("heads", "choose 1 of your opponent's (Benched )?Pokémon\\. Shuffle that Pokémon and all attached cards into their deck\\.", (ctx, m) => {
      const options = (m[1] ? benchKeys(ctx.opp) : pokemonKeys(ctx.opp)).filter((k) => !proof(ctx.state, ctx.seat, slotAt(ctx.opp, k as SlotKey)!));
      if (options.length)
        ask(ctx.state, {
          seat: ctx.seat,
          title: `Choose 1 of ${ctx.opp.name}'s Pokémon to shuffle into their deck`,
          zone: m[1] ? "oppBench" : "oppPokemon",
          options,
          min: 1,
          max: 1,
          effect: "atk:1:shuffleIn",
        });
    }),
    on("heads", "choose a Special Condition\\. Your opponent's Active Pokémon is now affected by that Special Condition\\.", (ctx) => {
      if (ctx.shielded) return;
      askChoice(
        ctx.state,
        ctx.seat,
        `Choose a Special Condition for ${topCard(ctx.defender).name}`,
        ["Asleep", "Burned", "Confused", "Paralyzed", "Poisoned"].map((c) => ({ id: c, label: c })),
        "atk:1:condition",
        { data: { botPick: ["Paralyzed"] } },
      );
    }),
    on(
      "heads",
      "choose (1 of your opponent's Active Pokémon's attacks|an attack from 1 of your opponent's Pokémon in play) and use it as this attack\\.",
      (ctx, m) => {
        const slots = /Active/.test(m[1]) ? [ctx.defender] : inPlay(ctx.opp);
        const list = slots.flatMap((s) => topCard(s).attacks.map((a) => ({ a, from: topCard(s).name })));
        if (!list.length) return;
        const best = list.reduce((b, x, i) => ((parseInt(x.a.damage, 10) || 0) > (parseInt(list[b].a.damage, 10) || 0) ? i : b), 0);
        askChoice(
          ctx.state,
          ctx.seat,
          "Choose an attack to use",
          list.map((x, i) => ({ id: String(i), label: slots.length > 1 ? `${x.from}: ${x.a.name}` : x.a.name })),
          "atk:1:copy",
          { data: { attacks: list.map((x) => x.a), botPick: [String(best)] } },
        );
      },
    ),
    on("heads", "search your deck for an? ([^.]+?) and put it onto this [^.]+? to evolve it\\. Then, shuffle your deck\\.", (ctx, m) => {
      const options = ctx.p.deck.filter((c) => baseName(c.name) === m[1]).map((c) => c.uid);
      if (!options.length) return void shuffle(ctx.p.deck);
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Choose a ${m[1]} to evolve ${topCard(ctx.attacker).name} into`,
        zone: "deck",
        options,
        shown: ctx.p.deck.map((c) => c.uid),
        min: 0,
        max: 1,
        effect: "atk:1:evolveCard",
        data: { key: "active", queue: [] },
      });
    }),
    on(
      "heads",
      "search your deck for up to (\\d+) (\\w+) Energy cards and attach them to your Pokémon in any way you like\\. Then, shuffle your deck\\.",
      (ctx, m) => askAttach(ctx.state, ctx.seat, "deck", basicEnergyOf(m[2]), Number(m[1]), false, `${m[2]} Energy cards`),
    ),
    on("heads", "search your deck for an Item card, reveal it, and put it into your hand\\. Then, shuffle your deck\\.", (ctx) => {
      const options = ctx.p.deck.filter(isItem).map((c) => c.uid);
      if (!options.length) return void shuffle(ctx.p.deck);
      ask(ctx.state, {
        seat: ctx.seat,
        title: "Choose an Item card to put into your hand",
        zone: "deck",
        options,
        shown: ctx.p.deck.map((c) => c.uid),
        min: 0,
        max: 1,
        effect: "handFromDeck",
      });
    }),
  ];
}

// ----- Damage to other Pokémon, and switching first -----

function targetRules(): AttackRule[] {
  return [
    {
      re: R(
        'Choose 1 of your opponent\'s Pokémon and flip a coin for each of your Pokémon in play that has "([^"]+)" in its name\\. This attack does (\\d+) damage to the chosen Pokémon for each heads\\.',
      ),
      pre: (ctx) => void (ctx.skipDamage = true),
      post: (ctx, m) => {
        const name = m[1] === "this Pokémon" ? baseName(topCard(ctx.attacker).name) : m[1];
        const n = inPlay(ctx.p).filter((s) => topCard(s).name.includes(name)).length;
        ask(ctx.state, {
          seat: ctx.seat,
          title: `Choose 1 of ${ctx.opp.name}'s Pokémon (then flip ${plural(n, "coin")}: ${m[2]} damage for each heads)`,
          zone: "oppPokemon",
          options: pokemonKeys(ctx.opp),
          min: 1,
          max: 1,
          effect: "atk:1:hit",
          data: { ...hitData(ctx), amount: Number(m[2]), coins: n },
        });
      },
    },
    {
      re: R("Discard (\\w+) Energy from this Pokémon, and this attack does (\\d+) damage to each of (\\w+) of your opponent's Pokémon\\."),
      pre: (ctx) => void (ctx.skipDamage = true),
      post: (ctx, m) => {
        const gone = takeEnergy(ctx.attacker, toCount(m[1]));
        ctx.p.discard.push(...gone);
        log(ctx.state, ctx.seat, `${topCard(ctx.attacker).name} discarded ${plural(gone.length, "Energy")}.`);
        const options = pokemonKeys(ctx.opp);
        const n = Math.min(toCount(m[3]), options.length);
        ask(ctx.state, {
          seat: ctx.seat,
          title: `Choose ${n} of ${ctx.opp.name}'s Pokémon to take ${m[2]} damage`,
          zone: "oppPokemon",
          options,
          min: n,
          max: n,
          effect: "atk:1:hit",
          data: { ...hitData(ctx), amount: Number(m[2]) },
        });
      },
    },
    {
      re: R("Discard all Energy from this Pokémon, and this attack does (\\d+) damage to 1 of your opponent's Benched Pokémon ex\\."),
      pre: (ctx) => void (ctx.skipDamage = true),
      post: (ctx, m) => {
        const gone = ctx.attacker.energy.splice(0);
        ctx.p.discard.push(...gone);
        log(ctx.state, ctx.seat, `${topCard(ctx.attacker).name} discarded ${plural(gone.length, "Energy")}.`);
        const options = benchKeys(ctx.opp, (s) => topCard(s).subtypes.includes("ex"));
        if (options.length)
          ask(ctx.state, {
            seat: ctx.seat,
            title: `Choose 1 of ${ctx.opp.name}'s Benched Pokémon ex to take ${m[1]} damage`,
            zone: "oppBench",
            options,
            min: 1,
            max: 1,
            effect: "benchDamage",
            data: { amount: Number(m[1]) },
          });
      },
    },
    {
      re: R(
        "This attack does (\\d+) damage to 1 of your opponent's Benched Pokémon\\. If that Pokémon retreated from the Active Spot during your opponent's last turn, this attack does (\\d+) damage instead\\.",
      ),
      pre: (ctx) => void (ctx.skipDamage = true),
      post: (ctx, m) => {
        if (!ctx.opp.bench.length) return;
        ask(ctx.state, {
          seat: ctx.seat,
          title: `Choose 1 of ${ctx.opp.name}'s Benched Pokémon to take ${m[1]} damage (${m[2]} if it retreated last turn)`,
          zone: "oppBench",
          options: benchKeys(ctx.opp),
          min: 1,
          max: 1,
          effect: "atk:1:hit",
          data: { ...hitData(ctx), amount: Number(m[1]), retreated: Number(m[2]) },
        });
      },
    },
    {
      re: R(
        "Switch in 1 of your opponent's Benched Pokémon to the Active Spot\\. If you do, this attack does (\\d+) damage to the new Active Pokémon\\. If you didn't play (.+?) from your hand during this turn, this attack does nothing\\.",
      ),
      pre: (ctx, m) => {
        ctx.skipDamage = true;
        if (!playedThisTurn(ctx.state, ctx.seat, (n) => baseName(n) === m[2])) ctx.nothing = true;
      },
      post: (ctx, m) => gustThenHit(ctx, Number(m[1]), false),
    },
    {
      re: R(
        `Switch in 1 of your opponent's Benched Pokémon to the Active Spot\\. If you do, this attack does (\\d+) damage to the new Active Pokémon, and then flip a coin\\. If heads, that Pokémon is now ${CONDITION}\\.`,
      ),
      pre: (ctx) => void (ctx.skipDamage = true),
      post: (ctx, m) => gustThenHit(ctx, Number(m[1]), false, m[2]),
    },
    {
      re: R("Switch out your opponent's Active Pokémon to the Bench\\. If you do, this attack does (\\d+) damage to the new Active Pokémon\\."),
      pre: (ctx) => void (ctx.skipDamage = true),
      post: (ctx, m) => gustThenHit(ctx, Number(m[1]), true),
    },
    {
      re: R("You may discard a Stadium in play\\. If you do, this attack does (\\d+) more damage\\."),
      pre: (ctx) => {
        if (ctx.state.stadium) ctx.skipDamage = true;
      },
      post: (ctx, m) => {
        if (!ctx.state.stadium) return;
        askChoice(
          ctx.state,
          ctx.seat,
          `Discard ${ctx.state.stadium.card.name} for ${m[1]} more damage?`,
          [
            { id: "yes", label: `Discard ${ctx.state.stadium.card.name}` },
            { id: "no", label: "Don't discard it" },
          ],
          "atk:1:stadium",
          { data: { ...hitData(ctx), more: Number(m[1]), botPick: ["yes"] } },
        );
      },
    },
    {
      re: R("If a Stadium is in play, this attack does (\\d+) more damage\\. Then, discard that Stadium\\."),
      pre: (ctx, m) => {
        if (ctx.state.stadium) ctx.base += Number(m[1]);
      },
      post: (ctx) => discardStadium(ctx.state, ctx.seat),
    },
  ];
}

function discardStadium(state: PState, seat: Seat) {
  if (!state.stadium) return;
  state.players[state.stadium.owner].discard.push(state.stadium.card);
  log(state, seat, `${state.stadium.card.name} was discarded.`);
  state.stadium = null;
}

/** Brings a new Active Pokémon in (chosen by the attacker, or by the opponent for "switch out"), then damages it. */
function gustThenHit(ctx: AttackCtx, amount: number, theyChoose: boolean, cond?: string) {
  const { state, seat, oppSeat, opp } = ctx;
  if (!opp.bench.length || (theyChoose && ctx.shielded)) return;
  ask(state, {
    seat: theyChoose ? oppSeat : seat,
    title: theyChoose
      ? `${ctx.p.name}'s attack switches out your Active Pokémon. Choose a Benched Pokémon to send in`
      : `Choose 1 of ${opp.name}'s Benched Pokémon to switch into the Active Spot`,
    zone: theyChoose ? "myBench" : "oppBench",
    options: benchKeys(opp),
    min: 1,
    max: 1,
    effect: "atk:1:gustHit",
    data: { ...hitData(ctx), amount, attackerSeat: seat, cond: cond ?? null },
  });
}

export const rules1 = (): AttackRule[] => [
  // Keeps a note of every attack used, for "If this Pokémon used ... during your last turn". Uses no words.
  { re: /(?:)/, pre: (ctx) => noteAttack(ctx) },
  ...payRules(),
  ...deckRules(),
  ...targetRules(),
  ...coinRules(),
  ...conditionalRules(),
];

const RESUME1: Record<string, Resume> = {
  "atk:1:paid"(state, seat, picks, data) {
    const p = state.players[seat];
    const gone = discardPicked(p, picks);
    if (gone.length) log(state, seat, `${p.name} discarded ${gone.map((c) => c.name).join(", ")}.`);
    const damage = Number(data.base ?? 0) + Number(data.per) * gone.length;
    if (!data.pick) return void hitActive(state, seat, damage, String(data.text), String(data.name));
    const opp = state.players[otherSeat(seat)];
    if (!gone.length) return;
    ask(state, {
      seat,
      title: `Choose 1 of ${opp.name}'s Pokémon to take ${damage} damage`,
      zone: "oppPokemon",
      options: pokemonKeys(opp),
      min: 1,
      max: 1,
      effect: "atk:1:hit",
      data: { ...data, amount: damage },
    });
  },
  "atk:1:hit"(state, seat, picks, data) {
    const opp = state.players[otherSeat(seat)];
    let amount = Number(data.amount);
    if (data.coins !== undefined) {
      let h = 0;
      for (let i = 0; i < Number(data.coins); i++) if (flip()) h++;
      log(state, seat, `Flipped ${plural(Number(data.coins), "coin")}: ${plural(h, "heads")}.`, "coin");
      amount *= h;
    }
    for (const key of picks) {
      const slot = key === "active" ? opp.active : opp.bench[Number(key.split(":")[1])];
      if (!slot) continue;
      const hit = data.retreated && retreatedLastTurn(state, seat, topCard(slot).name) ? Number(data.retreated) : amount;
      hitKey(state, seat, key, hit, String(data.text), String(data.name));
    }
  },
  "atk:1:gustHit"(state, _seat, picks, data) {
    const seat = data.attackerSeat as Seat;
    const opp = state.players[otherSeat(seat)];
    const incoming = opp.bench[Number(picks[0].split(":")[1])];
    if (!incoming) return;
    switchActive(opp, Number(picks[0].split(":")[1]));
    log(state, seat, `${topCard(incoming).name} was switched into ${opp.name}'s Active Spot.`);
    hitActive(state, seat, Number(data.amount), String(data.text), String(data.name));
    if (data.cond && opp.active === incoming) {
      const h = flip();
      log(state, seat, `Coin flip: ${h ? "heads" : "tails"}.`, "coin");
      if (h && !proof(state, seat, incoming)) condition(state, seat, incoming, String(data.cond));
    }
  },
  "atk:1:stadium"(state, seat, picks, data) {
    const yes = picks[0] === "yes" && !!state.stadium;
    if (yes) discardStadium(state, seat);
    hitActive(state, seat, Number(data.base) + (yes ? Number(data.more) : 0), String(data.text), String(data.name));
  },
  "atk:1:healAll"(state, seat, picks) {
    const slot = slotAt(state.players[seat], picks[0] as SlotKey);
    if (!slot) return;
    const done = heal(slot, slot.damage);
    log(state, seat, `${topCard(slot).name} healed ${done} damage.`);
  },
  "atk:1:knockOut"(state, seat, picks) {
    const opp = state.players[otherSeat(seat)];
    const slot = slotAt(opp, picks[0] as SlotKey);
    if (slot) knockOut(state, seat, slot);
  },
  "atk:1:shuffleIn"(state, seat, picks) {
    const opp = state.players[otherSeat(seat)];
    const slot = slotAt(opp, picks[0] as SlotKey);
    if (!slot) return;
    opp.deck.push(...slot.pokemon, ...attachedTo(slot));
    if (opp.active === slot) opp.active = null;
    else opp.bench.splice(opp.bench.indexOf(slot), 1);
    shuffle(opp.deck);
    log(state, seat, `${topCard(slot).name} and everything attached was shuffled into ${opp.name}'s deck.`);
  },
  "atk:1:condition"(state, seat, picks) {
    const slot = state.players[otherSeat(seat)].active;
    if (slot && picks[0]) condition(state, seat, slot, picks[0]);
  },
  "atk:1:copy"(state, seat, picks, data) {
    const attack = (data.attacks as Attack[])[Number(picks[0])];
    if (!attack || !state.players[seat].active || !state.players[otherSeat(seat)].active) return;
    resolveAttack(state, seat, attack);
  },
  "atk:1:moveEnergy"(state, seat, picks) {
    const opp = state.players[otherSeat(seat)];
    if (!opp.active || !opp.bench.length) return;
    const e = opp.active.energy.find((c) => c.uid === picks[0]);
    if (!e) return;
    ask(state, {
      seat,
      title: `Choose 1 of ${opp.name}'s Benched Pokémon to move ${e.name} to`,
      zone: "oppBench",
      options: benchKeys(opp),
      min: 1,
      max: 1,
      effect: "atk:1:moveEnergyTo",
      data: { uid: e.uid },
    });
  },
  "atk:1:moveEnergyTo"(state, seat, picks, data) {
    const opp = state.players[otherSeat(seat)];
    const to = opp.bench[Number(picks[0].split(":")[1])];
    const e = opp.active?.energy.find((c) => c.uid === data.uid);
    if (!to || !e || !opp.active) return;
    opp.active.energy = opp.active.energy.filter((c) => c !== e);
    to.energy.push(e);
    log(state, seat, `${e.name} moved from ${topCard(opp.active).name} to ${topCard(to).name}.`);
  },
  "atk:1:toHand"(state, seat, picks) {
    const p = state.players[seat];
    const found = p.discard.filter((c) => picks.includes(c.uid));
    p.discard = p.discard.filter((c) => !picks.includes(c.uid));
    p.hand.push(...found);
    if (found.length) log(state, seat, `${p.name} put ${found.map((c) => c.name).join(", ")} into their hand from their discard pile.`);
  },
  "atk:1:selfDiscard"(state, seat, picks) {
    const p = state.players[seat];
    const gone = p.hand.filter((c) => picks.includes(c.uid));
    p.hand = p.hand.filter((c) => !picks.includes(c.uid));
    p.discard.push(...gone);
    if (gone.length) log(state, seat, `${p.name} discarded ${gone.map((c) => c.name).join(", ")}.`);
  },
  "atk:1:oppHandToDeck"(state, seat, picks, data) {
    const opp = state.players[otherSeat(seat)];
    const cards = picks.map((uid) => opp.hand.find((c) => c.uid === uid)).filter((c): c is PCard => !!c);
    opp.hand = opp.hand.filter((c) => !cards.includes(c));
    opp.deck.push(...cards);
    if (!data.bottom) shuffle(opp.deck);
    log(state, seat, `${cards.map((c) => c.name).join(", ")} ${data.bottom ? "went on the bottom of" : "was shuffled into"} ${opp.name}'s deck.`);
  },
  "atk:1:attachPick"(state, seat, picks, data) {
    RESUME1["atk:1:attachTo"](state, seat, [], { ...data, cards: picks });
  },
  "atk:1:attachTo"(state, seat, picks, data) {
    const p = state.players[seat];
    const zone = data.from === "deck" ? p.deck : p.discard;
    const cards = [...(data.cards as string[])];
    if (picks.length && data.current) {
      const slot = slotAt(p, picks[0] as SlotKey);
      const card = zone.find((c) => c.uid === data.current);
      if (slot && card) {
        zone.splice(zone.indexOf(card), 1);
        slot.energy.push(card);
        log(state, seat, `${p.name} attached ${card.name} to ${topCard(slot).name}.`);
      }
    }
    const next = cards.shift();
    const card = next && zone.find((c) => c.uid === next);
    const options = data.bench ? benchKeys(p) : pokemonKeys(p);
    if (!card || !options.length) {
      if (data.from === "deck") shuffle(p.deck);
      return;
    }
    ask(state, {
      seat,
      title: `Choose a Pokémon to attach ${card.name} to`,
      zone: data.bench ? "myBench" : "myPokemon",
      options,
      min: 1,
      max: 1,
      effect: "atk:1:attachTo",
      data: { ...data, cards, current: next, step: "attach" },
    });
  },
  "atk:1:evolvePick"(state, seat, picks) {
    askEvolveFromDeck(state, seat, [...picks]);
  },
  "atk:1:evolveCard"(state, seat, picks, data) {
    const p = state.players[seat];
    const slot = slotAt(p, String(data.key) as SlotKey);
    const card = p.deck.find((c) => c.uid === picks[0]);
    if (slot && card) {
      p.deck.splice(p.deck.indexOf(card), 1);
      const from = topCard(slot).name;
      evolveSlot(state, slot, card);
      log(state, seat, `${p.name} evolved ${from} into ${card.name}.`);
    }
    askEvolveFromDeck(state, seat, [...((data.queue as string[]) ?? [])]);
  },
};

export const resumes1 = (): Record<string, Resume> => RESUME1;
