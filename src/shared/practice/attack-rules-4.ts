// Attack rules: see attack-rules.ts for how they work.
// Group 4: attaching Energy from the hand, discard pile and deck, discarding Tools, Energy and cards,
// copying attacks, devolving, Knock Outs, looking at the top of a deck, and "this attack does nothing" checks.

import { otherSeat, type Seat } from "../game-types";
import type { AttackCtx, AttackRule, Resume } from "./attack-rules";
import type { Attack, PCard, PPlayer, PSlot, PState, SlotKey } from "./types";
import {
  ask,
  attackCost,
  cantAttachEnergyReason,
  discardSlot,
  draw,
  energyProvides,
  evolveSlot,
  isBasicEnergy,
  isBasicPokemon,
  isEnergy,
  isPokemon,
  isSupporter,
  log,
  maxHp,
  plural,
  PRIZES,
  shuffle,
  slotAt,
  slotKeys,
  switchActive,
  topCard,
  win,
} from "./engine";
import {
  attachedTo,
  benchLimit,
  deckGuarded,
  hasRuleBox,
  hitWithAttack,
  hpLeft,
  inPlay,
  isEx,
  isV,
  onEnergyFromHand,
  putCounters,
  removeTool,
  setCondition,
  takeTools,
  toolsOn,
} from "./effects";
import { ATTACK_RESUME, benchDamage, finalDamage, resolveAttack, toCount } from "./attacks";
import { lock, mark, matchesFilter, oppNextTurn } from "./lasting";
import { discardedByOpponent, effectsProof, prizesToLost, tookPrizes } from "./abilities";
import { askChoice } from "./actions";
import { trainerFor } from "./trainers";
import { unitIs } from "./special-energy";

type Data = Record<string, unknown>;

const TYPE = "(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless)";
const CONDITIONS = ["asleep", "burned", "confused", "paralyzed", "poisoned"] as const;
const NO_WR = "This attack's damage isn't affected by Weakness or Resistance.";

const key = (i: number) => `bench:${i}`;
const pull = (zone: PCard[], uids: string[]) => {
  const out: PCard[] = [];
  for (const uid of uids) {
    const i = zone.findIndex((c) => c.uid === uid);
    if (i >= 0) out.push(zone.splice(i, 1)[0]);
  }
  return out;
};
const names = (cards: PCard[]) => cards.map((c) => c.name).join(", ");
/** A Pokémon in play found by its bottom card, which stays the same while it evolves or moves. */
const slotByUid = (p: PPlayer, uid: unknown) => inPlay(p).find((s) => s.pokemon[0].uid === uid) ?? null;
const keyOf = (p: PPlayer, slot: PSlot | null) => (slot ? (slotKeys(p).find((k) => slotAt(p, k) === slot) ?? null) : null);
const ko = (state: PState, slot: PSlot) => {
  slot.damage = Math.max(slot.damage, maxHp(state, slot));
};
/** Whether the attacking player's attack effects can't touch this Pokémon (protection, Abilities, Energy). */
function guarded(state: PState, seat: Seat, slot: PSlot) {
  const protect = slot.effects.protect;
  if (protect && protect.turn === state.turn && protect.effects) return true;
  const attacker = state.players[seat].active;
  return !!attacker && effectsProof(state, seat, attacker, slot);
}
const lastTurnKo = (state: PState, p: PPlayer, test: (c: PCard) => boolean = () => true) =>
  p.koTurn === state.turn - 1 && (p.koNames ?? []).some((n) => [...p.discard, ...(p.lost ?? []), ...p.hand].some((c) => c.name === n && test(c)));

/** Damage from an attack to one Pokémon other than by the attack's own damage line (Weakness and Resistance only for the Active). */
function hit(state: PState, seat: Seat, slot: PSlot, amount: number, noWR: boolean) {
  const p = state.players[seat];
  const opp = state.players[otherSeat(seat)];
  if (!p.active) return 0;
  if (slot !== opp.active) return benchDamage(state, seat, slot, amount);
  const protect = slot.effects.protect;
  if (protect && protect.turn === state.turn) {
    log(state, seat, `${topCard(slot).name} is protected, so it took no damage.`);
    return 0;
  }
  let done = finalDamage(state, seat, p.active, slot, amount, noWR ? NO_WR : "");
  const guard = slot.effects.guard;
  if (guard && guard.turn === state.turn) done = Math.max(0, done - guard.amount);
  hitWithAttack(state, seat, p.active, slot, done);
  return done;
}

function takePrizes(state: PState, seat: Seat, n: number) {
  const p = state.players[seat];
  const taken = p.prizes.splice(0, n);
  if (!taken.length) return;
  if (prizesToLost(state, seat)) {
    (p.lost ??= []).push(...taken);
    log(state, seat, `Lost Block: ${p.name}'s ${plural(taken.length, "Prize card")} went to the Lost Zone.`);
  } else {
    p.hand.push(...taken);
    log(state, seat, `${p.name} took ${plural(taken.length, "Prize card")}.`);
    tookPrizes(state, seat, taken);
  }
  if (!p.prizes.length) win(state, seat, `${p.name} took their last Prize card.`);
}

/** Takes a Pokémon out of play (its cards go to the discard pile or deck). An empty Active Spot is filled when the game settles. */
function removeSlot(state: PState, owner: Seat, slot: PSlot, to: "discard" | "deck") {
  const p = state.players[owner];
  if (to === "discard") discardSlot(p, slot);
  else {
    p.deck.push(...slot.pokemon, ...attachedTo(slot));
    shuffle(p.deck);
  }
  if (p.active === slot) p.active = null;
  else p.bench.splice(p.bench.indexOf(slot), 1);
}

function devolve(state: PState, seat: Seat, slot: PSlot, n: number, to: "hand" | "deck") {
  const owner = state.players[otherSeat(seat)];
  const off = slot.pokemon.splice(Math.max(1, slot.pokemon.length - n)).reverse();
  if (!off.length) return;
  slot.conditions = [];
  slot.effects = {};
  if (to === "hand") owner.hand.push(...off);
  else {
    owner.deck.push(...off);
    shuffle(owner.deck);
  }
  log(state, seat, `${topCard(slot).name} was devolved: ${names(off)} went ${to === "hand" ? `back to ${owner.name}'s hand` : `into ${owner.name}'s deck`}.`);
}

function randomFromHand(state: PState, seat: Seat, n: number, to: "discard" | "deck") {
  const opp = state.players[otherSeat(seat)];
  const gone: PCard[] = [];
  for (let i = 0; i < n && opp.hand.length; i++) gone.push(...opp.hand.splice(Math.floor(Math.random() * opp.hand.length), 1));
  if (!gone.length) return;
  if (to === "discard") {
    opp.discard.push(...gone);
    log(state, seat, `${names(gone)} was discarded at random from ${opp.name}'s hand.`);
    discardedByOpponent(state, otherSeat(seat), gone, "hand");
  } else {
    opp.deck.push(...gone);
    shuffle(opp.deck);
    log(state, seat, `${opp.name} revealed ${names(gone)} and shuffled ${gone.length === 1 ? "it" : "them"} into their deck.`);
  }
}

function discardTopOf(state: PState, seat: Seat, whose: Seat, n: number) {
  const who = state.players[whose];
  const gone = who.deck.splice(0, n);
  who.discard.push(...gone);
  if (gone.length) log(state, seat, `${who.name} discarded ${names(gone)} from the top of their deck.`);
  if (whose !== seat) discardedByOpponent(state, whose, gone, "deck");
  return gone;
}

// ----- Choosing Energy -----

/** Which Energy cards count: "basic", "any", or "basic:Water|Lightning" for Basic Energy of those types. */
function energyMatch(what: string) {
  const [kind, types] = what.split(":");
  return (c: PCard) => {
    if (!isEnergy(c)) return false;
    if (types) return isBasicEnergy(c) && types.split("|").some((t) => c.name.includes(t));
    return kind === "basic" ? isBasicEnergy(c) : true;
  };
}
const energyKey = (basic: string | undefined, type: string | undefined) => `${basic ? "basic" : "any"}${type ? `:${type.replace(/ or /g, "|")}` : ""}`;

/** What to do once Energy has been discarded (see afterEnergy). */
type Then = { kind: "none" } | { kind: "hit"; amount: number; bench: boolean } | { kind: "shuffleOppActive" } | { kind: "oppEnergy" } | { kind: "prize" };

/**
 * Discards n Energy (or all) matching `type` from `owner`'s Pokémon in `slots`. The player chooses
 * which when it makes a difference; then `then` happens.
 */
function discardEnergy(state: PState, seat: Seat, owner: Seat, slots: PSlot[], n: number | "all", type: string | null, then: Then) {
  const matches = (e: PCard) => !type || energyProvides(e).some((u) => unitIs(u, type));
  const found = slots.flatMap((s) => s.energy.filter(matches).map((e) => ({ s, e })));
  const count = n === "all" ? found.length : Math.min(n, found.length);
  const sameAll = new Set(found.map((f) => f.e.name)).size <= 1 && slots.length === 1;
  if (count === found.length || sameAll) {
    finishEnergy(
      state,
      seat,
      owner,
      found.slice(0, count).map((f) => f.e.uid),
      then,
    );
    return;
  }
  // The computer keeps Special Energy on its own Pokémon and takes it off the opponent's.
  const ranked = [...found].sort((a, b) => (Number(isBasicEnergy(a.e)) - Number(isBasicEnergy(b.e))) * (owner === seat ? -1 : 1));
  ask(state, {
    seat,
    title: `Choose ${plural(count, "Energy")} to discard${owner === seat ? "" : ` from ${state.players[owner].name}'s Pokémon`}`,
    zone: "choice",
    options: found.map((f) => f.e.uid),
    labels: Object.fromEntries(found.map((f) => [f.e.uid, slots.length > 1 ? `${f.e.name} on ${topCard(f.s).name}` : f.e.name])),
    min: count,
    max: count,
    effect: "atk:4:energyOff",
    data: { owner, then, botPick: ranked.slice(0, count).map((f) => f.e.uid) },
  });
}

function finishEnergy(state: PState, seat: Seat, owner: Seat, uids: string[], then: Then) {
  const p = state.players[owner];
  const gone: PCard[] = [];
  for (const slot of inPlay(p)) gone.push(...pull(slot.energy, uids));
  p.discard.push(...gone);
  if (gone.length) log(state, seat, `${names(gone)} ${gone.length === 1 ? "was" : "were"} discarded from ${p.name}'s Pokémon.`);
  afterEnergy(state, seat, gone.length, then);
}

function afterEnergy(state: PState, seat: Seat, count: number, then: Then) {
  const opp = state.players[otherSeat(seat)];
  switch (then.kind) {
    case "hit": {
      const options = [...(then.bench || !opp.active ? [] : ["active"]), ...opp.bench.map((_, i) => key(i))];
      if (options.length) askHit(state, seat, options, then.amount, 0);
      return;
    }
    case "shuffleOppActive":
      if (count && opp.active && !guarded(state, seat, opp.active)) {
        log(state, seat, `${opp.name} shuffled ${topCard(opp.active).name} and all attached cards into their deck.`);
        removeSlot(state, otherSeat(seat), opp.active, "deck");
      }
      return;
    case "oppEnergy":
      if (count && opp.active && !guarded(state, seat, opp.active)) discardEnergy(state, seat, otherSeat(seat), [opp.active], 1, null, { kind: "none" });
      return;
    case "prize":
      takePrizes(state, seat, 1);
      return;
  }
}

function askHit(state: PState, seat: Seat, options: string[], amount: number, more: number) {
  const opp = state.players[otherSeat(seat)];
  ask(state, {
    seat,
    title: `Choose 1 of ${opp.name}'s Pokémon to take ${amount} damage`,
    zone: options.includes("active") ? "oppPokemon" : "oppBench",
    options,
    min: 1,
    max: 1,
    effect: options.includes("active") ? "atk:4:hit" : "benchDamage",
    data: { amount, more },
  });
}

// ----- Attaching Energy -----

/** How an "attach Energy" effect goes: which cards it can take, how many, and where they can go. */
type AttachSpec = {
  /** The player choosing (the attacking player, or each player in turn). */
  seat: Seat;
  /** Whose cards and Pokémon: the chooser's, or their opponent's ("opp"). */
  side?: "opp";
  from: "hand" | "discard" | "deck";
  /** For cards from the deck: the cards being looked at. */
  pool?: string[];
  match: string;
  max: number;
  min: number;
  /** "self" (the attacking Pokémon), "one" (1 of your Pokémon, for all of them) or "each" (any way you like). */
  target: "self" | "one" | "each";
  /** Only Pokémon matching this (see matchesFilter). */
  filter?: string;
  self?: string;
  heal?: number;
  poison?: boolean;
  /** For cards from the deck: what happens to the rest. */
  after?: "shuffle" | "order";
  source: string;
  next?: AttachSpec;
};

const ownerSeat = (spec: AttachSpec): Seat => (spec.side === "opp" ? otherSeat(spec.seat) : spec.seat);
function zoneOf(state: PState, spec: AttachSpec) {
  const p = state.players[ownerSeat(spec)];
  return spec.from === "hand" ? p.hand : spec.from === "discard" ? p.discard : p.deck;
}

function startAttach(state: PState, spec: AttachSpec) {
  const zone = zoneOf(state, spec);
  const match = energyMatch(spec.match);
  const options = zone.filter((c) => match(c) && (!spec.pool || spec.pool.includes(c.uid))).map((c) => c.uid);
  const targets = attachTargets(state, spec, []);
  const max = Math.min(spec.max, options.length);
  if (!max || !targets.length) return finishAttach(state, spec);
  const promptZone = spec.from === "deck" ? "deck" : spec.from === "hand" ? "hand" : spec.side === "opp" ? "oppDiscard" : "discard";
  const where =
    spec.from === "deck"
      ? "the top of your deck"
      : spec.from === "hand"
        ? "your hand"
        : spec.side === "opp"
          ? "your opponent's discard pile"
          : "your discard pile";
  ask(state, {
    seat: spec.seat,
    title: `${spec.source}: choose ${spec.min ? (max === 1 ? "an" : max) : `up to ${max}`} Energy card${max === 1 ? "" : "s"} from ${where} to attach`,
    zone: promptZone,
    options,
    shown: spec.from === "deck" ? spec.pool : undefined,
    min: Math.min(spec.min, max),
    max,
    effect: "atk:4:attach",
    data: { spec, step: "pick", botPick: options.slice(0, max) },
  });
}

/** The Pokémon these cards can be attached to (Energy from the hand can be blocked by attack effects). */
function attachTargets(state: PState, spec: AttachSpec, cards: PCard[]): SlotKey[] {
  const p = state.players[ownerSeat(spec)];
  const keys = slotKeys(p).filter((k) => {
    const s = slotAt(p, k)!;
    if (spec.target === "self" && s.pokemon[0].uid !== spec.self) return false;
    if (spec.filter && !matchesFilter(state, s, spec.filter)) return false;
    return spec.from !== "hand" || cards.every((c) => !cantAttachEnergyReason(state, ownerSeat(spec), c, s));
  });
  return keys;
}

function attachTo(state: PState, spec: AttachSpec, uids: string[], slot: PSlot) {
  const owner = ownerSeat(spec);
  const cards = pull(zoneOf(state, spec), uids);
  if (!cards.length) return 0;
  slot.energy.push(...cards);
  log(state, spec.seat, `${state.players[spec.seat].name} attached ${names(cards)} to ${topCard(slot).name}.`);
  if (spec.from === "hand") for (const c of cards) onEnergyFromHand(state, owner, slot, c);
  return cards.length;
}

function askTarget(state: PState, spec: AttachSpec, cards: string[], step: "one" | "each", attached: number) {
  const zone = zoneOf(state, spec);
  const now = step === "one" ? cards : cards.slice(0, 1);
  const targets = attachTargets(
    state,
    spec,
    zone.filter((c) => now.includes(c.uid)),
  );
  if (!targets.length) return finishAttach(state, spec, attached);
  const first = zone.find((c) => c.uid === now[0]);
  ask(state, {
    seat: spec.seat,
    title: `Choose a Pokémon to attach ${step === "one" ? plural(now.length, "Energy card") : (first?.name ?? "the Energy")} to`,
    zone: spec.side === "opp" ? "oppPokemon" : "myPokemon",
    options: targets,
    min: 1,
    max: 1,
    effect: "atk:4:attach",
    data: { spec, step, cards, attached },
  });
}

function finishAttach(state: PState, spec: AttachSpec, attached = 0) {
  const p = state.players[spec.seat];
  const self = spec.self ? slotByUid(p, spec.self) : null;
  if (attached && self && spec.heal) {
    const before = self.damage;
    self.damage = Math.max(0, self.damage - spec.heal);
    log(state, spec.seat, `${topCard(self).name} was healed ${before - self.damage} damage.`);
  }
  if (attached && self && spec.poison) {
    setCondition(state, self, "poisoned");
    log(state, spec.seat, `${topCard(self).name} is now Poisoned.`);
  }
  if (spec.from === "deck") {
    const left = (spec.pool ?? []).filter((u) => p.deck.some((c) => c.uid === u));
    if (spec.after === "order") askOrder(state, spec.seat, spec.seat, left, []);
    else shuffle(p.deck);
  }
  if (spec.next) startAttach(state, spec.next);
}

// ----- Putting cards back in any order -----

const ORDINAL = ["", "top", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
function askOrder(state: PState, chooser: Seat, owner: Seat, uids: string[], placed: string[]) {
  const p = state.players[owner];
  if (uids.length <= 1) {
    const order = [...placed, ...uids];
    const cards = pull(p.deck, order);
    p.deck.unshift(...cards);
    if (cards.length > 1)
      log(
        state,
        chooser,
        `${state.players[chooser].name} put the top ${plural(cards.length, "card")} of ${chooser === owner ? "their" : `${p.name}'s`} deck back in the order they chose.`,
      );
    return;
  }
  ask(state, {
    seat: chooser,
    title: `Choose the card to put ${placed.length ? `${ORDINAL[placed.length + 1] ?? `${placed.length + 1}th`} from the top` : "on top"} of ${chooser === owner ? "your" : `${p.name}'s`} deck`,
    zone: chooser === owner ? "deck" : "oppDeck",
    options: uids,
    shown: uids,
    min: 1,
    max: 1,
    effect: "atk:4:order",
    data: { owner, uids, placed },
  });
}

// ----- Using another attack -----

type Choice = { label: string; attack: Attack };
function askAttack(state: PState, seat: Seat, choices: Choice[], why: string) {
  if (!choices.length) return log(state, seat, why);
  const best = choices.reduce((b, c, i) => ((parseInt(c.attack.damage, 10) || 0) > (parseInt(choices[b].attack.damage, 10) || 0) ? i : b), 0);
  askChoice(
    state,
    seat,
    "Choose the attack to use",
    choices.map((c, i) => ({ id: String(i), label: c.label })),
    "atk:4:copy",
    { data: { attacks: choices.map((c) => c.attack), botPick: [String(best)] } },
  );
}
const attacksOfCards = (cards: PCard[]): Choice[] => {
  const seen = new Set<string>();
  const out: Choice[] = [];
  for (const c of cards)
    for (const a of c.attacks) {
      const id = `${c.name}|${a.name}|${a.text}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ label: `${c.name}: ${a.name}${a.damage ? ` (${a.damage})` : ""}`, attack: a });
    }
  return out;
};

function useSupporter(state: PState, seat: Seat, card: PCard) {
  const effect = trainerFor(card.name);
  if (!effect || !isSupporter(card)) return log(state, seat, `${card.name}'s effect can't be used.`);
  const why = effect.canPlay?.(state, seat, card);
  if (why) return log(state, seat, `${card.name}'s effect did nothing: ${why}`);
  log(state, seat, `The attack used the effect of ${card.name}.`);
  effect.play(state, seat, card);
}

// ----- Switching first -----

function askSelfSwitch(state: PState, seat: Seat, then: Data) {
  const p = state.players[seat];
  if (!p.bench.length || !p.active) return;
  ask(state, {
    seat,
    title: "Choose a Benched Pokémon to switch with",
    zone: "myBench",
    options: p.bench.map((_, i) => key(i)),
    min: 1,
    max: 1,
    effect: "atk:4:switch",
    data: { ...then, self: p.active.pokemon[0].uid },
  });
}

// ----- Checks for "this attack does nothing" -----

function nothingUnless(ctx: AttackCtx, ok: boolean) {
  if (!ok) ctx.nothing = true;
}

export const rules4 = (): AttackRule[] => [
  // Iron Treads ex: Iron-Clad Roll
  {
    re: /After doing damage, you may discard all ([^.]+?) from this Pokémon\. If you do, during your opponent's next turn, this Pokémon takes (\d+) less damage from attacks\./,
    post(ctx, m) {
      const name = m[1].replace(/s$/, "");
      if (!toolsOn(ctx.attacker).some((t) => t.name.startsWith(name))) return;
      askChoice(
        ctx.state,
        ctx.seat,
        `Discard ${m[1]} from ${topCard(ctx.attacker).name} so it takes ${m[2]} less damage during your opponent's next turn?`,
        [
          { id: "yes", label: "Discard them" },
          { id: "no", label: "Keep them" },
        ],
        "atk:4:capsule",
        { data: { name, amount: Number(m[2]), self: ctx.attacker.pokemon[0].uid, botPick: ["yes"] } },
      );
    },
  },

  // ----- Attaching Energy -----
  {
    re: new RegExp(
      `This attack does (\\d+) damage for each ${TYPE} Energy attached to this Pokémon\\. Before doing damage, you may attach any number of Basic \\2 Energy cards from your hand to this Pokémon\\.`,
    ),
    pre(ctx) {
      ctx.skipDamage = true;
    },
    post(ctx, m) {
      const spec: AttachSpec = {
        seat: ctx.seat,
        from: "hand",
        match: `basic:${m[2]}`,
        max: 60,
        min: 0,
        target: "self",
        self: ctx.attacker.pokemon[0].uid,
        source: ctx.attack.name,
      };
      const data = { per: Number(m[1]), type: m[2] };
      const options = ctx.p.hand.filter(energyMatch(spec.match)).map((c) => c.uid);
      if (!options.length || attachTargets(ctx.state, spec, []).length === 0) return damageFor(ctx.state, ctx.seat, data);
      ask(ctx.state, {
        seat: ctx.seat,
        title: `${ctx.attack.name}: choose any number of Basic ${m[2]} Energy cards from your hand to attach first`,
        zone: "hand",
        options,
        min: 0,
        max: options.length,
        effect: "atk:4:attachThenHit",
        data: { ...data, spec, botPick: options },
      });
    },
  },
  {
    re: new RegExp(
      `Attach (a|an) (?:([Bb]asic) )?(?:${TYPE} )?Energy card from your (hand|discard pile) to (this Pokémon|1 of your (?:${TYPE} )?Pokémon)\\.(?: If you do, heal (\\d+) damage from this Pokémon\\.)?`,
    ),
    post(ctx, m) {
      startAttach(ctx.state, {
        seat: ctx.seat,
        from: m[4] === "hand" ? "hand" : "discard",
        match: energyKey(m[2], m[3]),
        max: 1,
        min: 1,
        target: m[5] === "this Pokémon" ? "self" : "one",
        filter: m[6],
        self: ctx.attacker.pokemon[0].uid,
        heal: m[7] ? Number(m[7]) : undefined,
        source: ctx.attack.name,
      });
    },
  },
  {
    re: new RegExp(
      `Attach (?!up to \\w+ Basic \\w+ Energy cards? from your discard pile to this Pokémon\\.)(?:up to (\\d+)|any number of) (?:([Bb]asic) )?(?:${TYPE} )?Energy cards from your (hand|discard pile) to (this Pokémon|1 of your Pokémon|your Pokémon in any way you like)\\.`,
    ),
    post(ctx, m) {
      startAttach(ctx.state, {
        seat: ctx.seat,
        from: m[4] === "hand" ? "hand" : "discard",
        match: energyKey(m[2], m[3]),
        max: m[1] ? Number(m[1]) : 60,
        min: 0,
        target: m[5] === "this Pokémon" ? "self" : m[5].startsWith("1 of") ? "one" : "each",
        self: ctx.attacker.pokemon[0].uid,
        source: ctx.attack.name,
      });
    },
  },
  {
    re: /Attach up to (\d+) Energy cards from your opponent's discard pile to their Pokémon in any way you like\./,
    post(ctx, m) {
      startAttach(ctx.state, {
        seat: ctx.seat,
        side: "opp",
        from: "discard",
        match: "any",
        max: Number(m[1]),
        min: 0,
        target: "each",
        source: ctx.attack.name,
      });
    },
  },
  {
    re: new RegExp(
      `Choose Basic ${TYPE} Energy cards from your discard pile up to the number of Prize cards your opponent has taken and attach them to your Pokémon in any way you like\\.`,
    ),
    post(ctx, m) {
      const max = PRIZES - ctx.opp.prizes.length;
      startAttach(ctx.state, { seat: ctx.seat, from: "discard", match: `basic:${m[1]}`, max, min: 0, target: "each", source: ctx.attack.name });
    },
  },
  {
    re: /Each player may attach up to (\d+) Basic Energy cards from their hand to their Pokémon in any way they like\. Your opponent does this first\./,
    post(ctx, m) {
      const spec = (seat: Seat): AttachSpec => ({ seat, from: "hand", match: "basic", max: Number(m[1]), min: 0, target: "each", source: ctx.attack.name });
      startAttach(ctx.state, { ...spec(ctx.oppSeat), next: spec(ctx.seat) });
    },
  },
  {
    re: new RegExp(
      `Search your deck for up to (\\d+) Basic ${TYPE} Energy cards and attach them to this Pokémon\\. Then, shuffle your deck\\. If you attached Energy to a Pokémon in this way, this Pokémon is now Poisoned\\.`,
    ),
    post(ctx, m) {
      const p = ctx.p;
      startAttach(ctx.state, {
        seat: ctx.seat,
        from: "deck",
        pool: p.deck.map((c) => c.uid),
        match: `basic:${m[2]}`,
        max: Number(m[1]),
        min: 0,
        target: "self",
        self: ctx.attacker.pokemon[0].uid,
        poison: true,
        after: "shuffle",
        source: ctx.attack.name,
      });
    },
  },
  {
    re: new RegExp(`For each of your Benched (.+?), search your deck for a Basic ${TYPE} Energy card and attach it to that \\1\\. Then, shuffle your deck\\.`),
    post(ctx, m) {
      const name = m[1] === "this Pokémon" ? topCard(ctx.attacker).name : m[1];
      for (const slot of ctx.p.bench) {
        if (name !== "Pokémon" && topCard(slot).name !== name) continue;
        const e = ctx.p.deck.find(energyMatch(`basic:${m[2]}`));
        if (!e) break;
        slot.energy.push(...pull(ctx.p.deck, [e.uid]));
        log(ctx.state, ctx.seat, `${ctx.p.name} attached ${e.name} from their deck to ${topCard(slot).name}.`);
      }
      shuffle(ctx.p.deck);
    },
  },
  {
    re: /Discard the top (\w+) cards of your deck\. If any of those cards are Energy cards, attach them to this Pokémon\./,
    post(ctx, m) {
      const gone = discardTopOf(ctx.state, ctx.seat, ctx.seat, toCount(m[1]));
      const energy = pull(
        ctx.p.discard,
        gone.filter(isEnergy).map((c) => c.uid),
      );
      if (!energy.length) return;
      ctx.attacker.energy.push(...energy);
      log(ctx.state, ctx.seat, `${ctx.p.name} attached ${names(energy)} to ${topCard(ctx.attacker).name}.`);
    },
  },

  // ----- Looking at the top of a deck -----
  {
    re: new RegExp(
      `Look at the top (\\d+) cards of your deck and attach any number of (?:((?:${TYPE.slice(1, -1)})(?: or (?:${TYPE.slice(1, -1)}))?) )?Energy cards you find there to your Pokémon in any way you like\\. Shuffle the other cards back into your deck\\.`,
    ),
    canUse: (state, seat, attack) => (/VSTAR Power/.test(attack.text) && state.players[seat].vstarUsed ? "You've already used a VSTAR Power this game." : null),
    pre(ctx) {
      if (/VSTAR Power/.test(ctx.attack.text)) ctx.p.vstarUsed = true;
    },
    post(ctx, m) {
      const pool = ctx.p.deck.slice(0, Number(m[1])).map((c) => c.uid);
      startAttach(ctx.state, {
        seat: ctx.seat,
        from: "deck",
        pool,
        match: energyKey(m[2] ? "basic" : undefined, m[2]),
        max: 60,
        min: 0,
        target: "each",
        after: "shuffle",
        source: ctx.attack.name,
      });
    },
  },
  {
    re: /Look at the top (\d+) cards of your deck\. You may attach any number of ([Bb]asic )?Energy cards you find there to (this Pokémon|1 of your Pokémon)\. (Shuffle the other cards back into your deck|Put the other cards back in any order)\./,
    post(ctx, m) {
      const pool = ctx.p.deck.slice(0, Number(m[1])).map((c) => c.uid);
      startAttach(ctx.state, {
        seat: ctx.seat,
        from: "deck",
        pool,
        match: m[2] ? "basic" : "any",
        max: 60,
        min: 0,
        target: m[3] === "this Pokémon" ? "self" : "one",
        self: ctx.attacker.pokemon[0].uid,
        after: m[4].startsWith("Shuffle") ? "shuffle" : "order",
        source: ctx.attack.name,
      });
    },
  },
  {
    re: /Look at the top (\d+) cards of your deck(?:\.|, and) [Yy]ou may put any number of Pokémon you find there onto your Bench\. Shuffle the other cards back into your deck\./,
    post(ctx, m) {
      const { state, seat, p } = ctx;
      const top = p.deck.slice(0, Number(m[1]));
      const room = benchLimit(state, seat) - p.bench.length;
      const options = top.filter(isBasicPokemon).map((c) => c.uid);
      if (room <= 0 || !options.length) {
        shuffle(p.deck);
        return log(state, seat, `${p.name} didn't put any Pokémon onto their Bench.`);
      }
      ask(state, {
        seat,
        title: `Top ${plural(top.length, "card")} of your deck: choose up to ${Math.min(room, options.length)} Basic Pokémon for your Bench`,
        zone: "deck",
        options,
        shown: top.map((c) => c.uid),
        min: 0,
        max: Math.min(room, options.length),
        effect: "benchFromDeck",
      });
    },
  },
  {
    re: /Look at the top (\d+) cards of your deck, and you may reveal any number of Pokémon you find there and put them into your hand\. Shuffle the other cards back into your deck\./,
    post(ctx, m) {
      const top = ctx.p.deck.slice(0, Number(m[1]));
      const options = top.filter(isPokemon).map((c) => c.uid);
      if (!options.length) {
        shuffle(ctx.p.deck);
        return log(ctx.state, ctx.seat, `${ctx.p.name} found no Pokémon.`);
      }
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Top ${plural(top.length, "card")} of your deck: choose any number of Pokémon to put into your hand`,
        zone: "deck",
        options,
        shown: top.map((c) => c.uid),
        min: 0,
        max: options.length,
        effect: "handFromDeck",
      });
    },
  },
  {
    re: /Look at the top (\d+) cards of your deck and put (\d+) of them into your hand\. Put the other cards in the Lost Zone\./,
    post(ctx, m) {
      const top = ctx.p.deck.slice(0, Number(m[1]));
      if (!top.length) return;
      const n = Math.min(Number(m[2]), top.length);
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Top ${plural(top.length, "card")} of your deck: choose ${n} to put into your hand (the rest go to the Lost Zone)`,
        zone: "deck",
        options: top.map((c) => c.uid),
        shown: top.map((c) => c.uid),
        min: n,
        max: n,
        effect: "atk:4:toHandRestLost",
        data: { top: top.map((c) => c.uid) },
      });
    },
  },
  {
    re: /Look at the top (\d+) cards of (your|your opponent's|either player's) deck and put them back in any order\./,
    post(ctx, m) {
      const n = Number(m[1]);
      if (m[2] === "either player's") {
        askChoice(
          ctx.state,
          ctx.seat,
          `Look at the top ${n} cards of whose deck?`,
          [
            { id: "me", label: "My deck" },
            { id: "opp", label: `${ctx.opp.name}'s deck` },
          ],
          "atk:4:whoseDeck",
          { data: { n, botPick: ["me"] } },
        );
        return;
      }
      const owner = m[2] === "your" ? ctx.seat : ctx.oppSeat;
      askOrder(
        ctx.state,
        ctx.seat,
        owner,
        ctx.state.players[owner].deck.slice(0, n).map((c) => c.uid),
        [],
      );
    },
  },
  {
    re: /Look at the (top card|top (\d+) cards) of your deck\. You may put (?:that card|those cards) into your hand\. If you don't, discard (?:that card|those cards) and draw (a card|\d+ cards)\./,
    post(ctx, m) {
      const n = m[2] ? Number(m[2]) : 1;
      const top = ctx.p.deck.slice(0, n);
      if (!top.length) return;
      askChoice(
        ctx.state,
        ctx.seat,
        `The top of your deck: ${names(top)}. Put ${n === 1 ? "it" : "them"} into your hand?`,
        [
          { id: "hand", label: "Put into my hand" },
          { id: "discard", label: `Discard and draw ${n}` },
        ],
        "atk:4:lookTake",
        { data: { top: top.map((c) => c.uid), draw: toCount(m[3].split(" ")[0]), botPick: ["hand"] } },
      );
    },
  },
  {
    re: /Look at the top card of your deck\. You may discard that card\./,
    post(ctx) {
      const top = ctx.p.deck[0];
      if (!top) return;
      askChoice(
        ctx.state,
        ctx.seat,
        `The top card of your deck is ${top.name}. Discard it?`,
        [
          { id: "discard", label: "Discard it" },
          { id: "keep", label: "Leave it on top" },
        ],
        "atk:4:maybeDiscardTop",
        { data: { uid: top.uid, botPick: [isEnergy(top) || isPokemon(top) ? "keep" : "discard"] } },
      );
    },
  },
  {
    re: /Look at 1 of your opponent's face-down Prize cards\./,
    post(ctx) {
      const n = ctx.opp.prizes.length;
      if (!n) return;
      askChoice(
        ctx.state,
        ctx.seat,
        `Choose 1 of ${ctx.opp.name}'s Prize cards to look at`,
        ctx.opp.prizes.map((_, i) => ({ id: String(i), label: `Prize card ${i + 1}` })),
        "atk:4:peekPrize",
        { data: { botPick: ["0"] } },
      );
    },
  },

  // ----- Pokémon Tools and Special Energy -----
  {
    re: /Before doing damage, discard all Pokémon Tools from this Pokémon\. If you can't discard any, this attack does nothing\./,
    pre(ctx) {
      const tools = takeTools(ctx.attacker);
      if (!tools.length) return void (ctx.nothing = true);
      ctx.p.discard.push(...tools);
      log(ctx.state, ctx.seat, `${names(tools)} ${tools.length === 1 ? "was" : "were"} discarded from ${topCard(ctx.attacker).name}.`);
    },
  },
  {
    re: /Before doing damage, discard all Pokémon Tools( and Special Energy)? from your opponent's Active Pokémon\.(?: If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now (Paralyzed|Asleep|Confused|Burned|Poisoned)\.)?/,
    pre(ctx, m) {
      if (guarded(ctx.state, ctx.seat, ctx.defender)) return;
      const tools = takeTools(ctx.defender);
      const special = m[1] ? ctx.defender.energy.filter((e) => !isBasicEnergy(e)) : [];
      pull(
        ctx.defender.energy,
        special.map((e) => e.uid),
      );
      const gone = [...tools, ...special];
      ctx.opp.discard.push(...gone);
      if (gone.length) log(ctx.state, ctx.seat, `${names(gone)} ${gone.length === 1 ? "was" : "were"} discarded from ${topCard(ctx.defender).name}.`);
      ctx.memo.toolsGone = tools.length;
    },
    post(ctx, m) {
      if (!m[2] || !ctx.memo.toolsGone || guarded(ctx.state, ctx.seat, ctx.defender) || ctx.opp.active !== ctx.defender) return;
      setCondition(ctx.state, ctx.defender, m[2].toLowerCase() as (typeof CONDITIONS)[number]);
      log(ctx.state, ctx.seat, `${topCard(ctx.defender).name} is now ${m[2]}.`);
    },
  },
  {
    re: /Discard all (Pokémon Tools and Special Energy|Special Energy) from all of your opponent's Pokémon\./,
    post(ctx, m) {
      const gone: PCard[] = [];
      for (const slot of inPlay(ctx.opp)) {
        if (guarded(ctx.state, ctx.seat, slot)) continue;
        if (m[1].startsWith("Pokémon Tools")) gone.push(...takeTools(slot));
        gone.push(
          ...pull(
            slot.energy,
            slot.energy.filter((e) => !isBasicEnergy(e)).map((e) => e.uid),
          ),
        );
      }
      ctx.opp.discard.push(...gone);
      log(
        ctx.state,
        ctx.seat,
        gone.length ? `${names(gone)} ${gone.length === 1 ? "was" : "were"} discarded from ${ctx.opp.name}'s Pokémon.` : "There was nothing to discard.",
      );
    },
  },
  {
    re: /Discard up to (\d+) Pokémon Tools from your opponent's Pokémon\./,
    post(ctx, m) {
      const found = inPlay(ctx.opp)
        .filter((s) => !guarded(ctx.state, ctx.seat, s))
        .flatMap((s) => toolsOn(s).map((t) => ({ s, t })));
      if (!found.length) return;
      const max = Math.min(Number(m[1]), found.length);
      askChoice(
        ctx.state,
        ctx.seat,
        `Choose up to ${plural(max, "Pokémon Tool")} to discard`,
        found.map((f) => ({ id: f.t.uid, label: `${f.t.name} on ${topCard(f.s).name}` })),
        "atk:4:toolsOff",
        { min: 0, max, data: { botPick: found.slice(0, max).map((f) => f.t.uid) } },
      );
    },
  },

  // ----- Discarding Energy -----
  {
    re: new RegExp(
      `Discard (all|\\d+|an?) (?:${TYPE} )?Energy from this Pokémon, and this attack (?:also )?does (\\d+) damage to 1 of your opponent's (Benched )?Pokémon\\.`,
    ),
    post(ctx, m) {
      const n = m[1] === "all" ? "all" : toCount(m[1]);
      discardEnergy(ctx.state, ctx.seat, ctx.seat, [ctx.attacker], n, m[2] ?? null, { kind: "hit", amount: Number(m[3]), bench: !!m[4] });
    },
  },
  {
    re: /Discard all Energy from this Pokémon, and take a Prize card\./,
    post(ctx) {
      discardEnergy(ctx.state, ctx.seat, ctx.seat, [ctx.attacker], "all", null, { kind: "prize" });
    },
  },
  {
    re: new RegExp(`Discard (\\d+) ${TYPE} Energy from your Pokémon\\.`),
    post(ctx, m) {
      discardEnergy(ctx.state, ctx.seat, ctx.seat, inPlay(ctx.p), Number(m[1]), m[2], { kind: "none" });
    },
  },
  {
    re: /Discard (\d+|an?) Energy from this Pokémon\. If (?:you discarded any Energy in this way|you do), (your opponent shuffles their Active Pokémon and all attached cards into their deck|discard an Energy from your opponent's Active Pokémon)\./,
    post(ctx, m) {
      discardEnergy(ctx.state, ctx.seat, ctx.seat, [ctx.attacker], toCount(m[1]), null, { kind: m[2].startsWith("your") ? "shuffleOppActive" : "oppEnergy" });
    },
  },
  {
    re: /Discard an Energy from your opponent's Active Pokémon ex\./,
    post(ctx) {
      if (!isEx(topCard(ctx.defender)) || ctx.shielded || ctx.opp.active !== ctx.defender) return;
      discardEnergy(ctx.state, ctx.seat, ctx.oppSeat, [ctx.defender], 1, null, { kind: "none" });
    },
  },
  {
    re: /Discard a ([^.]+? Energy) from this Pokémon\. If you do, discard your opponent's Active Pokémon and all attached cards\./,
    post(ctx, m) {
      const e = ctx.attacker.energy.find((c) => c.name === m[1]);
      if (!e) return log(ctx.state, ctx.seat, `${topCard(ctx.attacker).name} has no ${m[1]} to discard.`);
      ctx.p.discard.push(...pull(ctx.attacker.energy, [e.uid]));
      log(ctx.state, ctx.seat, `${e.name} was discarded from ${topCard(ctx.attacker).name}.`);
      const target = ctx.opp.active;
      if (!target || guarded(ctx.state, ctx.seat, target)) return;
      log(ctx.state, ctx.seat, `${topCard(target).name} and all attached cards were discarded.`);
      removeSlot(ctx.state, ctx.oppSeat, target, "discard");
    },
  },
  {
    re: /If your opponent has a Stadium in play, discard it\. If (?:you discarded a Stadium in this way|you do), (discard (\d+) Energy from your opponent's Active Pokémon|your opponent can't play any Stadium cards from their hand during their next turn)\./,
    post(ctx, m) {
      const { state } = ctx;
      if (!state.stadium || state.stadium.owner !== ctx.oppSeat) return;
      ctx.opp.discard.push(state.stadium.card);
      log(state, ctx.seat, `${state.stadium.card.name} was discarded.`);
      state.stadium = null;
      if (m[2]) {
        if (ctx.opp.active === ctx.defender && !ctx.shielded) discardEnergy(state, ctx.seat, ctx.oppSeat, [ctx.defender], Number(m[2]), null, { kind: "none" });
      } else {
        lock(state, { kind: "Stadium", seat: ctx.oppSeat, turn: oppNextTurn(state), source: ctx.attack.name });
      }
    },
  },
  {
    re: /Discard a Stadium in play\. If you can't, this attack does nothing\./,
    pre(ctx) {
      nothingUnless(ctx, !!ctx.state.stadium);
    },
    post(ctx) {
      const s = ctx.state.stadium;
      if (!s) return;
      ctx.state.players[s.owner].discard.push(s.card);
      log(ctx.state, ctx.seat, `${s.card.name} was discarded.`);
      ctx.state.stadium = null;
    },
  },

  // ----- Discarding cards from the hand and deck -----
  {
    re: new RegExp(
      `Discard (\\d+|a) Basic ${TYPE} Energy cards? from your hand(, and Knock Out your opponent's Active Pokémon)?\\. If you can't(?: discard \\d+ cards in this way)?, this attack does nothing\\.`,
    ),
    pre(ctx, m) {
      const n = toCount(m[1]);
      const cards = ctx.p.hand.filter(energyMatch(`basic:${m[2]}`)).slice(0, n);
      if (cards.length < n) return void (ctx.nothing = true);
      ctx.p.discard.push(
        ...pull(
          ctx.p.hand,
          cards.map((c) => c.uid),
        ),
      );
      log(ctx.state, ctx.seat, `${ctx.p.name} discarded ${plural(n, `Basic ${m[2]} Energy card`)} from their hand.`);
    },
    post(ctx, m) {
      if (!m[3] || ctx.shielded || ctx.opp.active !== ctx.defender) return;
      ko(ctx.state, ctx.defender);
      log(ctx.state, ctx.seat, `${topCard(ctx.defender).name} is Knocked Out.`);
    },
  },
  {
    re: /Discard a card from your hand\. If (you can't, this attack does nothing|you do, draw (\w+) cards?|you do, your opponent discards a card from their hand)\./,
    pre(ctx, m) {
      if (m[1].startsWith("you can't")) nothingUnless(ctx, ctx.p.hand.length > 0);
    },
    post(ctx, m) {
      if (!ctx.p.hand.length) return;
      ask(ctx.state, {
        seat: ctx.seat,
        title: "Discard a card from your hand",
        zone: "hand",
        options: ctx.p.hand.map((c) => c.uid),
        min: 1,
        max: 1,
        effect: "atk:4:discardOne",
        data: { step: "cost", draw: m[2] ? toCount(m[2]) : 0, oppDiscards: m[1].includes("opponent discards") },
      });
    },
  },
  {
    re: /Discard your hand and draw (\w+) cards\./,
    post(ctx, m) {
      const gone = ctx.p.hand.splice(0);
      ctx.p.discard.push(...gone);
      draw(ctx.p, toCount(m[1]));
      log(ctx.state, ctx.seat, `${ctx.p.name} discarded their hand (${plural(gone.length, "card")}) and drew ${plural(toCount(m[1]), "card")}.`);
    },
  },
  {
    re: /Discard a random card from your opponent's hand\./,
    post(ctx) {
      randomFromHand(ctx.state, ctx.seat, 1, "discard");
    },
  },
  {
    re: /Choose (a|\d+) random cards? from your opponent's hand(?:\.|,) (?:and )?[Yy]our opponent reveals (?:that card|those cards) and shuffles (?:it|them) into their deck\./,
    post(ctx, m) {
      randomFromHand(ctx.state, ctx.seat, toCount(m[1]), "deck");
    },
  },
  {
    re: /Discard the top card of your deck, and if that card is (a Pokémon that doesn't have a Rule Box, choose 1 of its attacks and use it as this attack|a Supporter card, use the effect of that card as the effect of this attack)\./,
    post(ctx, m) {
      const [card] = discardTopOf(ctx.state, ctx.seat, ctx.seat, 1);
      if (!card) return;
      if (m[1].startsWith("a Supporter")) {
        if (isSupporter(card)) useSupporter(ctx.state, ctx.seat, card);
        return;
      }
      if (isPokemon(card) && !hasRuleBox(card)) askAttack(ctx.state, ctx.seat, attacksOfCards([card]), `${card.name} has no attacks to use.`);
    },
  },
  {
    re: /Discard the top card of (your|your opponent's) deck\.(?!\s*If\b)/,
    post(ctx, m) {
      discardTop(ctx, m[1] === "your" ? ctx.seat : ctx.oppSeat, 1);
    },
  },
  {
    re: new RegExp(`For each ${TYPE} Energy attached to this Pokémon, discard the top card of your opponent's deck\\.`),
    post(ctx, m) {
      const n = ctx.attacker.energy.flatMap((e) => energyProvides(e)).filter((u) => unitIs(u, m[1])).length;
      if (n) discardTop(ctx, ctx.oppSeat, n);
    },
  },

  // ----- Drawing -----
  {
    re: /Draw (\w+) cards from the bottom of your deck\./,
    post(ctx, m) {
      const cards = ctx.p.deck.splice(Math.max(0, ctx.p.deck.length - toCount(m[1])));
      ctx.p.hand.push(...cards);
      log(ctx.state, ctx.seat, `${ctx.p.name} drew ${plural(cards.length, "card")} from the bottom of their deck.`);
    },
  },
  {
    re: /^\s*Draw cards until you have (\d+ cards|the same number of cards) in your hand(?: as your opponent)?\./,
    post(ctx, m) {
      const want = m[1].startsWith("the same") ? ctx.opp.hand.length : Number(m[1].split(" ")[0]);
      const before = ctx.p.hand.length;
      draw(ctx.p, Math.max(0, want - before));
      log(ctx.state, ctx.seat, `${ctx.p.name} drew ${plural(ctx.p.hand.length - before, "card")}.`);
    },
  },
  {
    re: /Each player (?:draws (\w+) cards|reveals the top (\w+) cards of their deck, then draws those cards)\./,
    post(ctx, m) {
      const n = toCount(m[1] ?? m[2]);
      for (const p of [ctx.p, ctx.opp]) {
        if (m[2]) log(ctx.state, ctx.seat, `${p.name} revealed ${names(p.deck.slice(0, n)) || "nothing"}.`);
        draw(p, n);
      }
      log(ctx.state, ctx.seat, `Each player drew ${plural(n, "card")}.`);
    },
  },
  {
    re: /Choose a player\. That player shuffles their hand into their deck and draws (\w+) cards\./,
    post(ctx, m) {
      const n = toCount(m[1]);
      askChoice(
        ctx.state,
        ctx.seat,
        `Choose a player to shuffle their hand into their deck and draw ${n} cards`,
        [
          { id: "me", label: "Me" },
          { id: "opp", label: ctx.opp.name },
        ],
        "atk:4:shuffleDraw",
        { data: { n, botPick: [ctx.p.hand.length < n ? "me" : "opp"] } },
      );
    },
  },

  // ----- Using other attacks and Supporters -----
  {
    re: /Choose 1 of your Benched ((?:[A-Z][\w.]*'s )?Pokémon)'s attacks and use it as this attack\./,
    post(ctx, m) {
      const owner = m[1].match(/^(.+)'s Pokémon$/)?.[1];
      const cards = ctx.p.bench.map(topCard).filter((c) => !owner || c.name.startsWith(`${owner}'s `));
      askAttack(ctx.state, ctx.seat, attacksOfCards(cards), `${ctx.p.name} has no Benched ${m[1]} with attacks.`);
    },
  },
  {
    re: /Choose 1 of your opponent's Active (Tera )?Pokémon's attacks and use it as this attack\./,
    post(ctx, m) {
      const d = ctx.opp.active;
      if (!d || (m[1] && !topCard(d).subtypes.includes("Tera"))) return log(ctx.state, ctx.seat, `${ctx.opp.name}'s Active Pokémon isn't a Tera Pokémon.`);
      askAttack(ctx.state, ctx.seat, attacksOfCards([topCard(d)]), `${topCard(d).name} has no attacks.`);
    },
  },
  {
    re: /Choose an attack from 1 of this Pokémon's previous Evolutions and use it as this attack\./,
    post(ctx) {
      askAttack(
        ctx.state,
        ctx.seat,
        attacksOfCards(ctx.attacker.pokemon.slice(0, -1)),
        `${topCard(ctx.attacker).name} has no previous Evolutions with attacks.`,
      );
    },
  },
  {
    re: new RegExp(`Choose an attack from an? ${TYPE} Pokémon in your discard pile and use it as this attack\\.`),
    post(ctx, m) {
      const cards = ctx.p.discard.filter((c) => isPokemon(c) && c.types.includes(m[1]));
      askAttack(ctx.state, ctx.seat, attacksOfCards(cards), `There are no ${m[1]} Pokémon with attacks in ${ctx.p.name}'s discard pile.`);
    },
  },
  {
    re: /If you have no cards in your hand, choose an attack from 1 of your opponent's Pokémon in play and use it as this attack\./,
    post(ctx) {
      if (ctx.p.hand.length) return log(ctx.state, ctx.seat, `${ctx.p.name} has cards in their hand, so the attack did nothing more.`);
      askAttack(ctx.state, ctx.seat, attacksOfCards(inPlay(ctx.opp).map(topCard)), `${ctx.opp.name}'s Pokémon have no attacks.`);
    },
  },
  {
    re: /Choose a Supporter card from your opponent's discard pile and use the effect of that card as the effect of this attack\./,
    post(ctx) {
      const options = ctx.opp.discard.filter((c) => isSupporter(c) && trainerFor(c.name)).map((c) => c.uid);
      if (!options.length) return log(ctx.state, ctx.seat, `There are no Supporter cards in ${ctx.opp.name}'s discard pile.`);
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Choose a Supporter card from ${ctx.opp.name}'s discard pile to use its effect`,
        zone: "oppDiscard",
        options,
        min: 1,
        max: 1,
        effect: "atk:4:supporter",
      });
    },
  },

  // ----- Damage to chosen Pokémon -----
  {
    re: /This attack does (\d+) damage to 1 of your opponent's Pokémon\. If 1 of your opponent's Pokémon is Knocked Out by damage from this attack, take (\w+) more Prize cards?\./,
    post(ctx, m) {
      askHit(ctx.state, ctx.seat, ["active", ...ctx.opp.bench.map((_, i) => key(i))], Number(m[1]), toCount(m[2]));
    },
  },
  {
    re: /Choose 1 of your opponent's Pokémon (\d+) times\. For each time you chose a Pokémon, do (\d+) damage to it\. This damage isn't affected by Weakness or Resistance\./,
    canUse: (state, seat, attack) => (/VSTAR Power/.test(attack.text) && state.players[seat].vstarUsed ? "You've already used a VSTAR Power this game." : null),
    pre(ctx) {
      if (/VSTAR Power/.test(ctx.attack.text)) ctx.p.vstarUsed = true;
    },
    post(ctx, m) {
      askTimes(ctx.state, ctx.seat, Number(m[1]), Number(m[2]), []);
    },
  },
  {
    re: /Discard a number of your Benched (.+?) up to the number of your opponent's Pokémon in play\. Then, for each \1 you discarded in this way, choose 1 of your opponent's Pokémon and do (\d+) damage to it\. You can't choose the same Pokémon more than once\. This damage isn't affected by Weakness or Resistance\./,
    post(ctx, m) {
      const name = m[1] === "this Pokémon" ? topCard(ctx.attacker).name : m[1];
      const options = ctx.p.bench.map((s, i) => (topCard(s).name === name ? key(i) : "")).filter(Boolean);
      const max = Math.min(options.length, inPlay(ctx.opp).length);
      if (!max) return log(ctx.state, ctx.seat, `${ctx.p.name} has no Benched ${name}.`);
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Choose up to ${plural(max, `Benched ${name}`)} to discard (${m[2]} damage to 1 of your opponent's Pokémon for each)`,
        zone: "myBench",
        options,
        min: 0,
        max,
        effect: "atk:4:launch",
        data: { amount: Number(m[2]), botPick: options.slice(0, max) },
      });
    },
  },
  {
    re: /If you have (\d+) or more Pokémon that have the ([^.]+?) Ability in your discard pile, choose (\d+) of your opponent's Pokémon and quadruple the number of damage counters on each of them\./,
    post(ctx, m) {
      const count = ctx.p.discard.filter((c) => isPokemon(c) && c.abilities.some((a) => a.name === m[2])).length;
      if (count < Number(m[1])) return log(ctx.state, ctx.seat, `${ctx.p.name} has only ${plural(count, "Pokémon")} with ${m[2]} in their discard pile.`);
      const options = slotKeys(ctx.opp).filter((k) => !guarded(ctx.state, ctx.seat, slotAt(ctx.opp, k)!));
      const n = Math.min(Number(m[3]), options.length);
      if (!n) return;
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Choose ${n} of ${ctx.opp.name}'s Pokémon to quadruple the damage counters on`,
        zone: "oppPokemon",
        options,
        min: n,
        max: n,
        effect: "atk:4:quadruple",
      });
    },
  },
  {
    re: new RegExp(
      `If (there are (\\d+) or fewer cards in your deck|this Pokémon has at least (\\d+) extra Energy attached|(this Pokémon|[A-Z][^,.]*?) is on your Bench|your opponent's Active Pokémon is affected by a Special Condition), this attack also does (\\d+) damage to (\\d+) of your opponent's Benched Pokémon\\.`,
    ),
    post(ctx, m) {
      const { state, p, attacker, defender } = ctx;
      let ok: boolean;
      if (m[2]) ok = p.deck.length <= Number(m[2]);
      else if (m[3]) ok = attacker.energy.flatMap((e) => energyProvides(e)).length >= attackCost(state, attacker, ctx.attack).length + Number(m[3]);
      else if (m[4]) {
        const name = m[4] === "this Pokémon" ? topCard(attacker).name : m[4];
        ok = p.bench.some((s) => topCard(s).name === name);
      } else ok = defender.conditions.length > 0;
      const n = Math.min(Number(m[6]), ctx.opp.bench.length);
      if (!ok || !n) return;
      ask(state, {
        seat: ctx.seat,
        title: `Choose ${n} of ${ctx.opp.name}'s Benched Pokémon to take ${m[5]} damage`,
        zone: "oppBench",
        options: ctx.opp.bench.map((_, i) => key(i)),
        min: n,
        max: n,
        effect: "benchDamage",
        data: { amount: Number(m[5]) },
      });
    },
  },

  // ----- Knock Outs -----
  {
    re: /If your opponent's Active Pokémon (has (\d+) HP or less remaining|has any Special Energy attached|is Asleep|is a Basic Pokémon|is affected by a Special Condition), it is Knocked Out\./,
    post(ctx, m) {
      const { state, defender } = ctx;
      if (ctx.opp.active !== defender || ctx.shielded || defender.damage >= maxHp(state, defender)) return;
      const ok = m[2]
        ? hpLeft(state, defender) <= Number(m[2])
        : m[1].includes("Special Energy")
          ? defender.energy.some((e) => !isBasicEnergy(e))
          : m[1] === "is Asleep"
            ? defender.conditions.includes("asleep")
            : m[1].includes("Basic")
              ? isBasicPokemon(topCard(defender))
              : defender.conditions.length > 0;
      if (!ok) return;
      ko(state, defender);
      log(state, ctx.seat, `${topCard(defender).name} is Knocked Out.`);
    },
  },
  {
    re: /Both Active Pokémon are Knocked Out\./,
    post(ctx) {
      if (ctx.opp.active === ctx.defender && !ctx.shielded) ko(ctx.state, ctx.defender);
      ko(ctx.state, ctx.attacker);
      log(ctx.state, ctx.seat, "Both Active Pokémon are Knocked Out.");
    },
  },
  {
    re: /Knock Out your opponent's Active Pokémon\. If your opponent's Active Pokémon is Knocked Out in this way, this Pokémon does (\d+) damage to itself\./,
    post(ctx, m) {
      if (ctx.opp.active !== ctx.defender || ctx.shielded) return;
      ko(ctx.state, ctx.defender);
      ctx.attacker.damage += Number(m[1]);
      log(ctx.state, ctx.seat, `${topCard(ctx.defender).name} is Knocked Out, and ${topCard(ctx.attacker).name} did ${m[1]} damage to itself.`);
    },
  },
  {
    re: /Knock Out 1 of your opponent's (\w+) Pokémon\./,
    post(ctx, m) {
      const options = slotKeys(ctx.opp).filter(
        (k) => topCard(slotAt(ctx.opp, k)!).subtypes.includes(m[1]) && !guarded(ctx.state, ctx.seat, slotAt(ctx.opp, k)!),
      );
      if (!options.length) return log(ctx.state, ctx.seat, `${ctx.opp.name} has no ${m[1]} Pokémon to Knock Out.`);
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Choose 1 of ${ctx.opp.name}'s ${m[1]} Pokémon to Knock Out`,
        zone: "oppPokemon",
        options,
        min: 1,
        max: 1,
        effect: "atk:4:knockOut",
      });
    },
  },
  {
    re: /Choose a Pokémon in play that has the least HP remaining, except for this Pokémon, and it is Knocked Out\./,
    post(ctx) {
      const { state, seat } = ctx;
      const all = [
        ...inPlay(ctx.p)
          .filter((s) => s !== ctx.attacker)
          .map((s) => ({ s, id: `me:${keyOf(ctx.p, s)}`, label: `Your ${topCard(s).name}` })),
        ...inPlay(ctx.opp).map((s) => ({ s, id: `opp:${keyOf(ctx.opp, s)}`, label: `${ctx.opp.name}'s ${topCard(s).name}` })),
      ];
      if (!all.length) return;
      const least = Math.min(...all.map((x) => hpLeft(state, x.s)));
      const options = all.filter((x) => hpLeft(state, x.s) === least);
      askChoice(
        state,
        seat,
        `Choose a Pokémon with the least HP remaining (${least}) to Knock Out`,
        options.map((x) => ({ id: x.id, label: `${x.label} (${least} HP left)` })),
        "atk:4:leastHp",
        { data: { botPick: [(options.find((x) => x.id.startsWith("opp:")) ?? options[0]).id] } },
      );
    },
  },
  {
    re: /Discard each player's Active Pokémon and all attached cards\./,
    post(ctx) {
      const { state, seat } = ctx;
      if (ctx.opp.active && !guarded(state, seat, ctx.opp.active)) {
        log(state, seat, `${topCard(ctx.opp.active).name} and all attached cards were discarded.`);
        removeSlot(state, ctx.oppSeat, ctx.opp.active, "discard");
      }
      if (ctx.p.active) {
        log(state, seat, `${topCard(ctx.p.active).name} and all attached cards were discarded.`);
        removeSlot(state, seat, ctx.p.active, "discard");
      }
      // The attacking player chooses their new Active Pokémon first.
      if (ctx.p.bench.length)
        ask(state, {
          seat,
          title: "Choose a Pokémon to move to your Active Spot",
          zone: "myBench",
          options: ctx.p.bench.map((_, i) => key(i)),
          min: 1,
          max: 1,
          effect: "promote",
        });
    },
  },
  {
    re: /Discard this Pokémon and all attached cards\./,
    post(ctx) {
      if (ctx.p.active !== ctx.attacker) return;
      log(ctx.state, ctx.seat, `${topCard(ctx.attacker).name} and all attached cards were discarded.`);
      removeSlot(ctx.state, ctx.seat, ctx.attacker, "discard");
    },
  },

  // ----- Prize cards -----
  {
    re: /If your opponent's Pokémon is Knocked Out by damage from this attack, (take (\w+) more Prize cards?|during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon)\./,
    post(ctx, m) {
      const d = ctx.defender;
      if (!ctx.damageDone || d.damage < maxHp(ctx.state, d)) return;
      if (m[2]) mark(d, { kind: "prizes", turn: ctx.state.turn, amount: toCount(m[2]), source: ctx.attack.name });
      else {
        ctx.attacker.effects.protect = { turn: ctx.state.turn + 1, effects: true };
        log(ctx.state, ctx.seat, `${topCard(ctx.attacker).name} will be protected from attacks during ${ctx.opp.name}'s next turn.`);
      }
    },
  },
  {
    re: /If you use this attack when you have (?:exactly|only) 1 Prize card remaining, you win this game\./,
    post(ctx) {
      if (ctx.p.prizes.length === 1) win(ctx.state, ctx.seat, `${ctx.attack.name} with 1 Prize card left.`);
    },
  },

  // ----- Devolving -----
  {
    re: /Devolve 1 of your opponent's evolved Pokémon by (putting the highest Stage Evolution card on it into your opponent's hand|removing any number of Evolution cards from it\. Your opponent shuffles those cards into their deck)\./,
    post(ctx, m) {
      const options = slotKeys(ctx.opp).filter((k) => slotAt(ctx.opp, k)!.pokemon.length > 1 && !guarded(ctx.state, ctx.seat, slotAt(ctx.opp, k)!));
      if (!options.length) return log(ctx.state, ctx.seat, `${ctx.opp.name} has no evolved Pokémon to devolve.`);
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Choose 1 of ${ctx.opp.name}'s evolved Pokémon to devolve`,
        zone: "oppPokemon",
        options,
        min: 1,
        max: 1,
        effect: "atk:4:devolve",
        data: { any: m[1].startsWith("removing") },
      });
    },
  },
  {
    re: /Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on it into your opponent's deck\./,
    post(ctx) {
      for (const slot of inPlay(ctx.opp)) if (slot.pokemon.length > 1 && !guarded(ctx.state, ctx.seat, slot)) devolve(ctx.state, ctx.seat, slot, 1, "deck");
    },
  },
  {
    re: /If your opponent's Active Pokémon is an evolved Pokémon, devolve it by putting the highest Stage Evolution card on it into your opponent's hand\./,
    post(ctx) {
      const d = ctx.opp.active;
      if (d && d === ctx.defender && d.pokemon.length > 1 && !ctx.shielded) devolve(ctx.state, ctx.seat, d, 1, "hand");
    },
  },
  {
    re: new RegExp(
      `Choose up to (\\d+) of your ${TYPE} Pokémon\\. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it\\. Then, shuffle your deck\\.`,
    ),
    post(ctx, m) {
      const p = ctx.p;
      const options = slotKeys(p).filter((k) => {
        const s = slotAt(p, k)!;
        return topCard(s).types.includes(m[2]) && p.deck.some((c) => c.evolvesFrom === topCard(s).name);
      });
      if (!options.length) {
        shuffle(p.deck);
        return log(ctx.state, ctx.seat, `${p.name} has no ${m[2]} Pokémon to evolve from their deck.`);
      }
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Choose up to ${m[1]} of your ${m[2]} Pokémon to evolve from your deck`,
        zone: "myPokemon",
        options,
        min: 0,
        max: Math.min(Number(m[1]), options.length),
        effect: "atk:4:evolve",
        data: { botPick: options.slice(0, Number(m[1])) },
      });
    },
  },

  // ----- Switching -----
  {
    re: new RegExp(
      `Switch this Pokémon with 1 of your Benched Pokémon\\. If you do, (attach up to (\\d+) Basic ${TYPE} Energy cards from your hand to this Pokémon|search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it\\. Then, shuffle your deck|switch out your opponent's Active Pokémon to the Bench)\\.`,
    ),
    post(ctx, m) {
      if (!ctx.p.bench.length) return;
      const then = m[2] ? { then: "attach", max: Number(m[2]), type: m[3] } : m[1].startsWith("search") ? { then: "evolve" } : { then: "gust" };
      askSelfSwitch(ctx.state, ctx.seat, { ...then, source: ctx.attack.name });
      if (then.then === "gust" && ctx.opp.bench.length && !ctx.shielded)
        ask(ctx.state, {
          seat: ctx.oppSeat,
          title: `${ctx.p.name}'s attack switches out your Active Pokémon. Choose a Benched Pokémon to send in`,
          zone: "myBench",
          options: ctx.opp.bench.map((_, i) => key(i)),
          min: 1,
          max: 1,
          effect: "switchOut",
        });
    },
  },
  {
    re: /Choose 1 of your Benched (.+?) and shuffle that Pokémon and all attached cards into your deck\. If you can't shuffle an? \1 into your deck, this attack does nothing\./,
    pre(ctx, m) {
      const name = m[1] === "this Pokémon" ? topCard(ctx.attacker).name : m[1];
      const options = ctx.p.bench.map((s, i) => (topCard(s).name === name ? key(i) : "")).filter(Boolean);
      if (!options.length) return void (ctx.nothing = true);
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Choose 1 of your Benched ${name} to shuffle into your deck`,
        zone: "myBench",
        options,
        min: 1,
        max: 1,
        effect: "atk:4:shuffleBenched",
      });
    },
  },

  // ----- Weakness -----
  {
    re: /Choose ((?:\w+, )+(?:or )?\w+) type\. Until the Defending Pokémon leaves the Active Spot, its Weakness is now that type\./,
    post(ctx, m) {
      if (ctx.shielded || ctx.opp.active !== ctx.defender) return;
      const types = m[1].replace(/\bor /, "").split(", ");
      const mine = [...topCard(ctx.attacker).types, ...ctx.p.bench.flatMap((s) => topCard(s).types)].find((t) => types.includes(t)) ?? types[0];
      askChoice(
        ctx.state,
        ctx.seat,
        `Choose ${topCard(ctx.defender).name}'s new Weakness`,
        types.map((t) => ({ id: t, label: t })),
        "atk:4:weakness",
        { data: { botPick: [mine] } },
      );
    },
  },

  // ----- "This attack does nothing" unless... -----
  {
    re: /If you don't have ([A-Z][^,.]*?) on your Bench, this attack does nothing\./,
    pre(ctx, m) {
      const want = m[1].split(" and ").map((n) => (n === "this Pokémon" ? topCard(ctx.attacker).name : n));
      nothingUnless(
        ctx,
        want.every((n) => ctx.p.bench.some((s) => topCard(s).name === n)),
      );
    },
  },
  {
    re: /If you don't have (exactly (\d+) cards|the same number of cards) in your hand(?: as your opponent)?, this attack does nothing\./,
    pre(ctx, m) {
      nothingUnless(ctx, ctx.p.hand.length === (m[2] ? Number(m[2]) : ctx.opp.hand.length));
    },
  },
  {
    re: new RegExp(`If you don't have (\\d+) or more Basic ${TYPE} Energy cards in your discard pile, this attack does nothing\\.`),
    pre(ctx, m) {
      nothingUnless(ctx, ctx.p.discard.filter(energyMatch(`basic:${m[2]}`)).length >= Number(m[1]));
    },
  },
  {
    re: /If your opponent doesn't have exactly (\d+) or (\d+) Prize cards remaining, this attack does nothing\./,
    pre(ctx, m) {
      nothingUnless(ctx, [Number(m[1]), Number(m[2])].includes(ctx.opp.prizes.length));
    },
  },
  {
    re: /If your opponent has (\d+) or fewer cards in their hand, this attack does nothing\./,
    pre(ctx, m) {
      nothingUnless(ctx, ctx.opp.hand.length > Number(m[1]));
    },
  },
  {
    re: /If your opponent's Active Pokémon isn't (Burned|Confused|Asleep|Paralyzed|Poisoned|a Pokémon ex), this attack does nothing\./,
    pre(ctx, m) {
      const d = ctx.defender;
      nothingUnless(ctx, m[1] === "a Pokémon ex" ? isEx(topCard(d)) : d.conditions.includes(m[1].toLowerCase() as (typeof CONDITIONS)[number]));
    },
  },
  {
    re: /If there is no Stadium in play, this attack does nothing\./,
    pre(ctx) {
      nothingUnless(ctx, !!ctx.state.stadium);
    },
  },
  {
    re: /If this Pokémon has no ([^.,]+?) attached, this attack does nothing\./,
    pre(ctx, m) {
      nothingUnless(ctx, m[1] === "Energy" ? ctx.attacker.energy.length > 0 : attachedTo(ctx.attacker).some((c) => c.name === m[1]));
    },
  },

  // ----- More damage and Special Conditions -----
  {
    re: new RegExp(
      `If any of your ${TYPE} Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does (\\d+) more damage\\.`,
    ),
    pre(ctx, m) {
      if (lastTurnKo(ctx.state, ctx.p, (c) => c.types.includes(m[1]))) ctx.base += Number(m[2]);
    },
  },
  {
    re: /If any of your Pokémon were Knocked Out by damage from an attack from your opponent's Pokémon during their last turn, (?:this attack does (\d+) more damage, and )?your opponent's Active Pokémon is now (Asleep|Burned|Confused|Paralyzed|Poisoned)\./,
    pre(ctx, m) {
      ctx.memo.avenge = lastTurnKo(ctx.state, ctx.p);
      if (ctx.memo.avenge && m[1]) ctx.base += Number(m[1]);
    },
    post(ctx, m) {
      if (ctx.memo.avenge) setStatus(ctx, m[2]);
    },
  },
  {
    re: /If your opponent's Active Pokémon moved from the Bench to the Active Spot during your opponent's last turn, this attack does (\d+) more damage\./,
    pre(ctx, m) {
      const t = (ctx.opp as PPlayer & { turnLog?: { turn: number; movedUp: string[] } }).turnLog;
      if (t && t.turn === ctx.state.turn - 1 && t.movedUp.includes(ctx.defender.pokemon[0].uid)) ctx.base += Number(m[1]);
    },
  },
  {
    re: /If you have exactly (\d+) Prize cards? remaining, your opponent's Active Pokémon is now (Asleep|Burned|Confused|Paralyzed|Poisoned)\./,
    post(ctx, m) {
      if (ctx.p.prizes.length === Number(m[1])) setStatus(ctx, m[2]);
    },
  },
  {
    re: new RegExp(`If your opponent's Active Pokémon is an? ${TYPE} Pokémon, it is now (Asleep|Burned|Confused|Paralyzed|Poisoned)\\.`),
    post(ctx, m) {
      if (topCard(ctx.defender).types.includes(m[1])) setStatus(ctx, m[2]);
    },
  },

  // ----- Searching -----
  {
    re: /Search your deck for a Basic Pokémon and put it onto your Bench\. Then, shuffle your deck\. If your opponent's Active Pokémon is a Pokémon V, you may put up to (\d+) Basic Pokémon onto your Bench in this way instead\./,
    post(ctx, m) {
      const { state, seat, p } = ctx;
      const room = benchLimit(state, seat) - p.bench.length;
      const options = p.deck.filter(isBasicPokemon).map((c) => c.uid);
      const n = Math.min(room, isV(topCard(ctx.defender)) ? Number(m[1]) : 1);
      if (n <= 0 || !options.length) return void shuffle(p.deck);
      ask(state, {
        seat,
        title: `Choose up to ${plural(n, "Basic Pokémon")} for your Bench`,
        zone: "deck",
        options,
        shown: p.deck.map((c) => c.uid),
        min: 0,
        max: n,
        effect: "benchFromDeck",
      });
    },
  },
];

function setStatus(ctx: AttackCtx, word: string) {
  if (ctx.shielded || ctx.opp.active !== ctx.defender) return;
  setCondition(ctx.state, ctx.defender, word.toLowerCase() as (typeof CONDITIONS)[number]);
  log(ctx.state, ctx.seat, `${topCard(ctx.defender).name} is now ${word}.`);
}

function discardTop(ctx: AttackCtx, whose: Seat, n: number) {
  if (whose !== ctx.seat && deckGuarded(ctx.state, whose))
    return log(ctx.state, ctx.seat, `Patrol Cap stops ${ctx.state.players[whose].name}'s deck being discarded.`);
  discardTopOf(ctx.state, ctx.seat, whose, n);
}

function damageFor(state: PState, seat: Seat, data: Data) {
  const p = state.players[seat];
  const opp = state.players[otherSeat(seat)];
  if (!p.active || !opp.active) return;
  const count = p.active.energy.flatMap((e) => energyProvides(e)).filter((u) => unitIs(u, String(data.type))).length;
  const done = hit(state, seat, opp.active, Number(data.per) * count, false);
  log(state, seat, `${done} damage to ${topCard(opp.active).name}.`);
}

function askTimes(state: PState, seat: Seat, left: number, amount: number, picks: string[]) {
  const opp = state.players[otherSeat(seat)];
  if (!left || !opp.active) {
    const count = new Map<PSlot, number>();
    for (const k of picks) {
      const slot = slotAt(opp, k as SlotKey);
      if (slot) count.set(slot, (count.get(slot) ?? 0) + 1);
    }
    for (const [slot, times] of count) log(state, seat, `${hit(state, seat, slot, amount * times, true)} damage to ${topCard(slot).name}.`);
    return;
  }
  ask(state, {
    seat,
    title: `Choose 1 of ${opp.name}'s Pokémon to take ${amount} damage (${plural(left, "choice")} left)`,
    zone: "oppPokemon",
    options: slotKeys(opp),
    min: 1,
    max: 1,
    effect: "atk:4:times",
    data: { left, amount, picks },
  });
}

export const resumes4 = (): Record<string, Resume> => ({
  "atk:4:capsule"(state, seat, picks, data) {
    const p = state.players[seat];
    const self = slotByUid(p, data.self);
    if (picks[0] !== "yes" || !self) return;
    const tools = toolsOn(self).filter((t) => t.name.startsWith(String(data.name)));
    for (const t of tools) removeTool(self, t.uid);
    p.discard.push(...tools);
    mark(self, { kind: "takesLess", turn: oppNextTurn(state), amount: Number(data.amount), source: String(data.name) });
    log(
      state,
      seat,
      `${names(tools)} ${tools.length === 1 ? "was" : "were"} discarded; ${topCard(self).name} takes ${data.amount} less damage during the next turn.`,
    );
  },
  "atk:4:attach"(state, seat, picks, data) {
    const spec = data.spec as AttachSpec;
    const p = state.players[ownerSeat(spec)];
    const step = String(data.step);
    const attached = Number(data.attached ?? 0);
    if (step === "pick") {
      if (!picks.length) return finishAttach(state, spec);
      if (spec.target === "self") {
        const self = slotByUid(state.players[spec.seat], spec.self);
        return finishAttach(state, spec, self ? attachTo(state, spec, picks, self) : 0);
      }
      return askTarget(state, spec, picks, spec.target === "one" ? "one" : "each", 0);
    }
    const slot = slotAt(p, picks[0] as SlotKey);
    const cards = data.cards as string[];
    if (step === "one") return finishAttach(state, spec, slot ? attachTo(state, spec, cards, slot) : 0);
    const done = attached + (slot ? attachTo(state, spec, cards.slice(0, 1), slot) : 0);
    if (cards.length > 1) return askTarget(state, spec, cards.slice(1), "each", done);
    finishAttach(state, spec, done);
  },
  "atk:4:attachThenHit"(state, seat, picks, data) {
    const spec = data.spec as AttachSpec;
    const self = slotByUid(state.players[seat], spec.self);
    if (self && picks.length) attachTo(state, spec, picks, self);
    damageFor(state, seat, data);
  },
  "atk:4:energyOff"(state, seat, picks, data) {
    finishEnergy(state, seat, data.owner as Seat, picks, data.then as Then);
  },
  "atk:4:hit"(state, seat, picks, data) {
    const opp = state.players[otherSeat(seat)];
    const slot = slotAt(opp, picks[0] as SlotKey);
    if (!slot) return;
    const done = hit(state, seat, slot, Number(data.amount), false);
    log(state, seat, `${done} damage to ${topCard(slot).name}.`);
    if (Number(data.more) && done > 0 && slot.damage >= maxHp(state, slot)) mark(slot, { kind: "prizes", turn: state.turn, amount: Number(data.more) });
  },
  "atk:4:times"(state, seat, picks, data) {
    askTimes(state, seat, Number(data.left) - 1, Number(data.amount), [...(data.picks as string[]), picks[0]]);
  },
  "atk:4:launch"(state, seat, picks, data) {
    const p = state.players[seat];
    const opp = state.players[otherSeat(seat)];
    const gone = picks.map((k) => slotAt(p, k as SlotKey)).filter((s): s is PSlot => !!s);
    for (const s of gone) removeSlot(state, seat, s, "discard");
    if (gone.length) log(state, seat, `${p.name} discarded ${names(gone.map(topCard))} from their Bench.`);
    const n = Math.min(gone.length, inPlay(opp).length);
    if (!n) return;
    ask(state, {
      seat,
      title: `Choose ${n} of ${opp.name}'s Pokémon to take ${data.amount} damage each`,
      zone: "oppPokemon",
      options: slotKeys(opp),
      min: n,
      max: n,
      effect: "atk:4:launchHit",
      data: { amount: data.amount },
    });
  },
  "atk:4:launchHit"(state, seat, picks, data) {
    const opp = state.players[otherSeat(seat)];
    const slots = picks.map((k) => slotAt(opp, k as SlotKey)).filter((s): s is PSlot => !!s);
    for (const slot of slots) log(state, seat, `${hit(state, seat, slot, Number(data.amount), true)} damage to ${topCard(slot).name}.`);
  },
  "atk:4:quadruple"(state, seat, picks) {
    const opp = state.players[otherSeat(seat)];
    for (const k of picks) {
      const slot = slotAt(opp, k as SlotKey);
      if (!slot || !slot.damage) continue;
      putCounters(state, seat, slot, (slot.damage / 10) * 3);
      log(state, seat, `The damage counters on ${topCard(slot).name} were quadrupled.`);
    }
  },
  "atk:4:toolsOff"(state, seat, picks) {
    const opp = state.players[otherSeat(seat)];
    for (const slot of inPlay(opp))
      for (const t of toolsOn(slot).filter((c) => picks.includes(c.uid))) {
        removeTool(slot, t.uid);
        opp.discard.push(t);
        log(state, seat, `${t.name} was discarded from ${topCard(slot).name}.`);
      }
  },
  "atk:4:discardOne"(state, seat, picks, data) {
    const p = state.players[seat];
    const gone = pull(p.hand, picks);
    if (!gone.length) return;
    p.discard.push(...gone);
    log(state, seat, `${p.name} discarded ${names(gone)}.`);
    if (Number(data.draw)) {
      const before = p.hand.length;
      draw(p, Number(data.draw));
      log(state, seat, `${p.name} drew ${plural(p.hand.length - before, "card")}.`);
    }
    const opp = state.players[otherSeat(seat)];
    if (data.oppDiscards && opp.hand.length)
      ask(state, {
        seat: otherSeat(seat),
        title: "Discard a card from your hand",
        zone: "hand",
        options: opp.hand.map((c) => c.uid),
        min: 1,
        max: 1,
        effect: "discardHand",
        data: { step: "cost" },
      });
  },
  "atk:4:shuffleDraw"(state, seat, picks, data) {
    const who = picks[0] === "me" ? seat : otherSeat(seat);
    const p = state.players[who];
    p.deck.push(...p.hand.splice(0));
    shuffle(p.deck);
    draw(p, Number(data.n));
    log(state, seat, `${p.name} shuffled their hand into their deck and drew ${plural(Math.min(Number(data.n), p.hand.length), "card")}.`);
  },
  "atk:4:copy"(state, seat, picks, data) {
    const attack = (data.attacks as Attack[])[Number(picks[0])];
    const p = state.players[seat];
    const opp = state.players[otherSeat(seat)];
    if (!attack || !p.active || !opp.active) return;
    log(state, seat, `${topCard(p.active).name} used ${attack.name} as its attack.`);
    resolveAttack(state, seat, attack);
  },
  "atk:4:supporter"(state, seat, picks) {
    const card = state.players[otherSeat(seat)].discard.find((c) => c.uid === picks[0]);
    if (card) useSupporter(state, seat, card);
  },
  "atk:4:toHandRestLost"(state, seat, picks, data) {
    const p = state.players[seat];
    const taken = pull(p.deck, picks);
    p.hand.push(...taken);
    const rest = pull(
      p.deck,
      (data.top as string[]).filter((u) => !picks.includes(u)),
    );
    (p.lost ??= []).push(...rest);
    log(state, seat, `${p.name} put ${plural(taken.length, "card")} into their hand and ${plural(rest.length, "card")} in the Lost Zone.`);
  },
  "atk:4:whoseDeck"(state, seat, picks, data) {
    const owner = picks[0] === "me" ? seat : otherSeat(seat);
    askOrder(
      state,
      seat,
      owner,
      state.players[owner].deck.slice(0, Number(data.n)).map((c) => c.uid),
      [],
    );
  },
  "atk:4:order"(state, seat, picks, data) {
    const uids = (data.uids as string[]).filter((u) => u !== picks[0]);
    askOrder(state, seat, data.owner as Seat, uids, [...(data.placed as string[]), picks[0]]);
  },
  "atk:4:lookTake"(state, seat, picks, data) {
    const p = state.players[seat];
    const top = pull(p.deck, data.top as string[]);
    if (picks[0] === "hand") {
      p.hand.push(...top);
      return log(state, seat, `${p.name} put ${plural(top.length, "card")} from the top of their deck into their hand.`);
    }
    p.discard.push(...top);
    const before = p.hand.length;
    draw(p, Number(data.draw));
    log(state, seat, `${p.name} discarded ${names(top)} and drew ${plural(p.hand.length - before, "card")}.`);
  },
  "atk:4:maybeDiscardTop"(state, seat, picks, data) {
    const p = state.players[seat];
    if (picks[0] !== "discard") return;
    const gone = pull(p.deck, [String(data.uid)]);
    p.discard.push(...gone);
    if (gone.length) log(state, seat, `${p.name} discarded ${gone[0].name} from the top of their deck.`);
  },
  "atk:4:peekPrize"(state, seat, picks) {
    const opp = state.players[otherSeat(seat)];
    const card = opp.prizes[Number(picks[0])];
    if (!card) return;
    log(state, seat, `${state.players[seat].name} looked at 1 of ${opp.name}'s Prize cards.`);
    askChoice(state, seat, `${opp.name}'s Prize card ${Number(picks[0]) + 1} is ${card.name}`, [{ id: "ok", label: "OK" }], "atk:4:seen");
  },
  "atk:4:seen"() {},
  "atk:4:knockOut"(state, seat, picks) {
    const opp = state.players[otherSeat(seat)];
    const slot = slotAt(opp, picks[0] as SlotKey);
    if (!slot) return;
    ko(state, slot);
    log(state, seat, `${topCard(slot).name} is Knocked Out.`);
  },
  "atk:4:leastHp"(state, seat, picks) {
    const [side, ...rest] = picks[0].split(":");
    const owner = side === "me" ? seat : otherSeat(seat);
    const slot = slotAt(state.players[owner], rest.join(":") as SlotKey);
    if (!slot) return;
    if (owner !== seat && guarded(state, seat, slot)) return log(state, seat, `${topCard(slot).name} is protected from the attack's effects.`);
    ko(state, slot);
    log(state, seat, `${topCard(slot).name} is Knocked Out.`);
  },
  "atk:4:devolve"(state, seat, picks, data) {
    const opp = state.players[otherSeat(seat)];
    const slot = slotAt(opp, picks[0] as SlotKey);
    if (!slot || slot.pokemon.length < 2) return;
    if (!data.any) return devolve(state, seat, slot, 1, "hand");
    const stack = slot.pokemon.slice(1).reverse();
    askChoice(
      state,
      seat,
      `How many Evolution cards should come off ${topCard(slot).name}?`,
      stack.map((_, i) => ({ id: String(i + 1), label: names(stack.slice(0, i + 1)) })),
      "atk:4:devolveMany",
      { data: { key: picks[0], botPick: [String(stack.length)] } },
    );
  },
  "atk:4:devolveMany"(state, seat, picks, data) {
    const slot = slotAt(state.players[otherSeat(seat)], data.key as SlotKey);
    if (slot) devolve(state, seat, slot, Number(picks[0]), "deck");
  },
  "atk:4:evolve"(state, seat, picks, data) {
    const p = state.players[seat];
    const queue = [...((data.queue as string[] | undefined) ?? picks.map((k) => slotAt(p, k as SlotKey)?.pokemon[0].uid ?? ""))];
    const uid = queue.shift();
    if (uid === undefined) return void shuffle(p.deck);
    const slot = slotByUid(p, uid);
    const options = slot ? p.deck.filter((c) => c.evolvesFrom === topCard(slot).name).map((c) => c.uid) : [];
    if (!slot || !options.length) return resumes4()["atk:4:evolve"](state, seat, [], { queue });
    ask(state, {
      seat,
      title: `Choose a card to evolve ${topCard(slot).name} into`,
      zone: "deck",
      options,
      shown: p.deck.map((c) => c.uid),
      min: 1,
      max: 1,
      effect: "atk:4:evolveCard",
      data: { uid, queue },
    });
  },
  "atk:4:evolveCard"(state, seat, picks, data) {
    const p = state.players[seat];
    const slot = slotByUid(p, data.uid);
    const [card] = pull(p.deck, picks);
    if (slot && card) {
      const from = topCard(slot).name;
      evolveSlot(state, slot, card);
      log(state, seat, `${p.name} evolved ${from} into ${card.name}.`);
    } else if (card) p.deck.push(card);
    resumes4()["atk:4:evolve"](state, seat, [], { queue: data.queue });
  },
  "atk:4:switch"(state, seat, picks, data) {
    const p = state.players[seat];
    const i = Number(picks[0].split(":")[1]);
    const incoming = p.bench[i];
    if (!incoming) return;
    switchActive(p, i);
    log(state, seat, `${p.name} switched ${topCard(incoming).name} into the Active Spot.`);
    const self = slotByUid(p, data.self);
    if (!self) return;
    if (data.then === "attach")
      startAttach(state, {
        seat,
        from: "hand",
        match: `basic:${data.type}`,
        max: Number(data.max),
        min: 0,
        target: "self",
        self: String(data.self),
        source: String(data.source),
      });
    if (data.then === "evolve") {
      const options = p.deck.filter((c) => c.evolvesFrom === topCard(self).name).map((c) => c.uid);
      if (!options.length) return void shuffle(p.deck);
      ask(state, {
        seat,
        title: `Choose a card to evolve ${topCard(self).name} into`,
        zone: "deck",
        options,
        shown: p.deck.map((c) => c.uid),
        min: 0,
        max: 1,
        effect: "atk:4:evolveCard",
        data: { uid: data.self, queue: [] },
      });
    }
  },
  "atk:4:shuffleBenched"(state, seat, picks) {
    const p = state.players[seat];
    const slot = slotAt(p, picks[0] as SlotKey);
    if (!slot) return;
    log(state, seat, `${p.name} shuffled ${topCard(slot).name} and all attached cards into their deck.`);
    removeSlot(state, seat, slot, "deck");
  },
  "atk:4:weakness"(state, seat, picks) {
    const d = state.players[otherSeat(seat)].active;
    if (!d) return;
    // Until it leaves the Active Spot: marks for the turns it can be attacked in (they go if it moves or evolves).
    for (let t = state.turn; t <= state.turn + 40; t += 2) mark(d, { kind: "weakness", turn: t, data: picks[0], source: "Conversion" });
    log(state, seat, `${topCard(d).name}'s Weakness is now ${picks[0]}.`);
  },
});
