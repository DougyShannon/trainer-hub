// Pokémon Abilities a player uses on purpose ("Once during your turn, you may..."), and the ones
// that go off when something happens to the Pokémon (evolving it from the hand, putting it on the
// Bench, moving it to the Active Spot). Each is written in the same shape as a Trainer card: when
// it can be used, what it does, and what happens once a choice is made. The table shows the ones
// a player can use as buttons, and the computer uses them too (see abilities.ts).

import { otherSeat, type Seat } from "../game-types";
import {
  ask,
  benchPokemon,
  draw,
  energyProvides,
  evolveSlot,
  flip,
  isBasicEnergy,
  isBasicPokemon,
  isEnergy,
  isItem,
  isPokemon,
  isStadium,
  isSupporter,
  isTool,
  log,
  maxHp,
  plural,
  shuffle,
  slotAt,
  slotKeys,
  switchActive,
  topCard,
} from "./engine";
import { askChoice, askDiscard } from "./actions";
import {
  addEffect,
  addTool,
  attachedTo,
  baseName,
  benchLimit,
  hasRuleBox,
  hasTool,
  hpLeft,
  inPlay,
  isEx,
  isMegaEx,
  isStage,
  isTera,
  isV,
  ofType,
  putCounters,
  setCondition,
  stadiumIs,
  takeTools,
  toolOf,
  toolRoom,
  trainersPokemon,
} from "./effects";
import { drawCards, drawUntil, either, heal, healOne, isEvolution, recover, searchToHand, topCards } from "./trainers-more";
import { benchSlots, me, names, pull, resumeGust, them, toBench, type TrainerEffect } from "./trainers";
import {
  askAttach,
  attachedChoices,
  chain,
  coin,
  devolve,
  endTurnNow,
  energyOf,
  fromAttachedId,
  isSpecialEnergy,
  myKeys,
  revealHand,
  search,
} from "./trainers-extra";
import { abilityProof, countersMove, discardedByOpponent, noHealing } from "./abilities";
import type { PCard, PPlayer, PSlot, PState, SlotKey } from "./types";

type Data = Record<string, unknown>;
type Match = (c: PCard) => boolean;
type SelfTest = (state: PState, seat: Seat, slot: PSlot, self: PSlot | null) => boolean;

/** An Ability someone uses, in the Trainer card shape plus where and how often it can be used. */
export type Use = TrainerEffect & {
  /** Only from this spot ("Once during your turn, if this Pokémon is in the Active Spot..."). */
  where?: "active" | "bench";
  /** Used from the hand or discard pile instead of from play. */
  from?: "hand" | "discard";
  /**
   * How often: once per Pokémon per turn (the default), "free" (as often as you like), "name"
   * (once per turn whichever Pokémon uses it), "vstar" (once a game), "first" (first turn only).
   */
  limit?: "free" | "name" | "vstar" | "first" | "firstName";
  /** Whether the computer thinks it's worth using right now. */
  worth?: (state: PState, seat: Seat, self: PSlot | null) => boolean;
  /** It Knocks Out its own Pokémon (Damp stops these). */
  selfKo?: boolean;
};

// ----- Small helpers -----

const toCount = (s: string) =>
  /^\d+$/.test(s) ? Number(s) : (({ a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 } as Record<string, number>)[s] ?? 1);
/** A number from the Ability's own text (cards with the same Ability name can differ). */
const num = (card: PCard, re: RegExp, fallback: number) => {
  const m = (card.rules[0] ?? "").match(re);
  return m ? toCount(m[1].toLowerCase()) : fallback;
};
export const selfOf = (state: PState, seat: Seat, uid: unknown) => inPlay(me(state, seat)).find((s) => topCard(s).uid === uid) ?? null;
const keyOf = (p: PPlayer, slot: PSlot) => slotKeys(p).find((k) => slotAt(p, k) === slot) ?? null;
const benchIndex = (key: string) => Number(key.split(":")[1]);
const src = (card: PCard) => ({ src: card.uid, card: card.name });
const basic = (type: string) => (c: PCard) => isBasicEnergy(c) && c.name.includes(type);
const pokemonOf = (type: string) => (c: PCard) => isPokemon(c) && ofType(c, type);
const prizesTaken = (p: PPlayer) => 6 - p.prizes.length;
const any: SelfTest = () => true;
const isSelf: SelfTest = (_s, _p, slot, self) => slot === self;
const onBench: SelfTest = (state, seat, slot) => me(state, seat).active !== slot;
const koSelf = (state: PState, seat: Seat, self: PSlot | null, why: string) => {
  if (!self) return;
  self.damage = Math.max(self.damage, maxHp(state, self));
  log(state, seat, `${topCard(self).name} is Knocked Out by ${why}.`);
};

/** Adds a condition to a Use: `test` must pass or the button says `reason`. */
function only(use: Use, test: (state: PState, seat: Seat, self: PSlot | null, card: PCard) => boolean, reason: string): Use {
  return {
    ...use,
    canPlay: (state, seat, card) => (test(state, seat, selfOf(state, seat, card.uid), card) ? (use.canPlay?.(state, seat, card) ?? null) : reason),
  };
}

/** "You must discard ... from your hand in order to use this Ability." */
function paying(match: Match, n: number, what: string, use: Use): Use {
  return {
    ...use,
    canPlay: (state, seat, card) => {
      const p = me(state, seat);
      if (p.hand.filter((c) => c.uid !== card.uid && match(c)).length < n) return `You need ${what} in your hand to discard.`;
      return use.canPlay?.(state, seat, card) ?? null;
    },
    play: (state, seat, card) =>
      askDiscard(state, seat, `${card.name}: discard ${what} from your hand`, match, n, card.name, { ...src(card), paid: false, rules: card.rules }),
    resume(state, seat, picks, data) {
      if (data.step === "cost" && data.paid === false) {
        const p = me(state, seat);
        const gone = pull(p.hand, picks);
        p.discard.push(...gone);
        log(state, seat, `${p.name} discarded ${names(gone)}.`);
        const card = {
          ...(selfOf(state, seat, data.src) ? topCard(selfOf(state, seat, data.src)!) : ({} as PCard)),
          name: String(data.card),
          rules: data.rules as string[],
        };
        return use.play(state, seat, card);
      }
      use.resume?.(state, seat, picks, data);
    },
  };
}

// ----- Shapes -----

/** Attach one Energy card from the hand, discard pile or deck to one of your Pokémon. */
function attachOne(o: {
  from: "hand" | "discard" | "deck";
  energy: Match;
  target: SelfTest;
  then?: (state: PState, seat: Seat, target: PSlot, self: PSlot | null) => void;
}): Use {
  const zone = (p: PPlayer) => (o.from === "hand" ? p.hand : o.from === "discard" ? p.discard : p.deck);
  const targets = (state: PState, seat: Seat, uid: unknown) => {
    const p = me(state, seat);
    const self = selfOf(state, seat, uid);
    return slotKeys(p).filter((k) => o.target(state, seat, slotAt(p, k)!, self));
  };
  const finish = (state: PState, seat: Seat, energy: string, key: SlotKey, data: Data) => {
    const p = me(state, seat);
    const [e] = pull(zone(p), [energy]);
    const slot = slotAt(p, key);
    if (o.from === "deck") shuffle(p.deck);
    if (!e || !slot) return;
    slot.energy.push(e);
    log(state, seat, `${p.name} attached ${e.name} to ${topCard(slot).name} with ${data.card}.`);
    o.then?.(state, seat, slot, selfOf(state, seat, data.src));
  };
  const toTarget = (state: PState, seat: Seat, energy: string, data: Data) => {
    const keys = targets(state, seat, data.src);
    if (!keys.length) return void (o.from === "deck" && shuffle(me(state, seat).deck));
    if (keys.length === 1) return finish(state, seat, energy, keys[0], data);
    const e = zone(me(state, seat)).find((c) => c.uid === energy);
    ask(state, {
      seat,
      title: `Choose a Pokémon to attach ${e?.name ?? "the Energy"} to`,
      zone: "myPokemon",
      options: keys,
      min: 1,
      max: 1,
      effect: String(data.card),
      data: { ...data, step: "target", energy },
    });
  };
  return {
    canPlay(state, seat, card) {
      if (o.from === "deck" ? !me(state, seat).deck.length : !zone(me(state, seat)).some(o.energy)) return "There's no Energy card for this.";
      return targets(state, seat, card.uid).length ? null : "None of your Pokémon can take the Energy.";
    },
    play(state, seat, card) {
      const p = me(state, seat);
      const options = zone(p).filter(o.energy);
      if (o.from !== "deck" && new Set(options.map((c) => c.name)).size === 1) return toTarget(state, seat, options[0].uid, src(card));
      if (o.from === "deck" && !options.length) {
        shuffle(p.deck);
        return log(state, seat, `${p.name} searched their deck but found no Energy for ${card.name}.`);
      }
      ask(state, {
        seat,
        title: `Choose an Energy card to attach (${card.name})`,
        zone: o.from,
        options: options.map((c) => c.uid),
        shown: o.from === "deck" ? p.deck.map((c) => c.uid) : undefined,
        min: o.from === "deck" ? 0 : 1,
        max: 1,
        effect: card.name,
        data: { ...src(card), step: "energy" },
      });
    },
    resume(state, seat, picks, data) {
      if (data.step === "energy") {
        if (!picks.length) return void shuffle(me(state, seat).deck);
        return toTarget(state, seat, picks[0], data);
      }
      finish(state, seat, String(data.energy), picks[0] as SlotKey, data);
    },
  };
}

/**
 * Attach up to `max` Energy cards to your Pokémon "in any way you like" (or all to one Pokémon
 * with `single`). `pair` allows at most one card of each listed type ("a Fire, a Fighting, or 1 of each").
 */
function attachMany(o: {
  from: "hand" | "discard" | "deck";
  energy: Match;
  max: number | ((card: PCard) => number);
  target: SelfTest;
  single?: boolean;
  pair?: string[];
  after?: "shuffle" | "endTurn" | "none";
  koSelf?: boolean;
}): Use {
  const zone = (p: PPlayer) => (o.from === "hand" ? p.hand : o.from === "discard" ? p.discard : p.deck);
  const max = (card: PCard) => (typeof o.max === "number" ? o.max : o.max(card));
  const targets = (state: PState, seat: Seat, uid: unknown) => {
    const p = me(state, seat);
    const self = selfOf(state, seat, uid);
    return slotKeys(p).filter((k) => o.target(state, seat, slotAt(p, k)!, self));
  };
  return chain({
    canPlay(state, seat, card) {
      if (o.from === "deck" ? !me(state, seat).deck.length : !zone(me(state, seat)).some(o.energy)) return "There's no Energy card for this.";
      return targets(state, seat, card.uid).length ? null : "None of your Pokémon can take the Energy.";
    },
    play(state, seat, card) {
      const p = me(state, seat);
      const options = zone(p).filter(o.energy);
      if (o.koSelf) koSelf(state, seat, selfOf(state, seat, card.uid), card.name);
      if (!options.length) {
        if (o.from === "deck") shuffle(p.deck);
        if (o.after === "endTurn") endTurnNow(state, seat, card.name);
        return log(state, seat, `${p.name} found no Energy for ${card.name}.`);
      }
      ask(state, {
        seat,
        title: `Choose up to ${max(card)} Energy cards to attach (${card.name})`,
        zone: o.from,
        options: options.map((c) => c.uid),
        shown: o.from === "deck" ? p.deck.map((c) => c.uid) : undefined,
        min: 0,
        max: max(card),
        effect: card.name,
        data: { ...src(card), step: "energy" },
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      let chosen = picks;
      if (o.pair) {
        const seen = new Set<string>();
        chosen = picks.filter((u) => {
          const c = zone(p).find((x) => x.uid === u);
          const t = o.pair!.find((type) => c?.name.includes(type));
          if (!t || seen.has(t)) return false;
          seen.add(t);
          return true;
        });
      }
      const keys = targets(state, seat, data.src);
      const after = o.after ?? (o.from === "deck" ? "shuffle" : "none");
      if (data.step === "single") {
        const slot = slotAt(p, picks[0] as SlotKey);
        const cards = pull(zone(p), data.energy as string[]);
        if (slot) slot.energy.push(...cards);
        if (slot) log(state, seat, `${p.name} attached ${names(cards)} to ${topCard(slot).name}.`);
        if (o.from === "deck") shuffle(p.deck);
        if (after === "endTurn") endTurnNow(state, seat, String(data.card));
        return;
      }
      if (!chosen.length || !keys.length) {
        if (o.from === "deck") shuffle(p.deck);
        if (after === "endTurn") endTurnNow(state, seat, String(data.card));
        return;
      }
      if (o.single && keys.length > 1) {
        ask(state, {
          seat,
          title: `Choose 1 Pokémon to attach ${plural(chosen.length, "Energy card")} to`,
          zone: "myPokemon",
          options: keys,
          min: 1,
          max: 1,
          effect: String(data.card),
          data: { ...data, step: "single", energy: chosen },
        });
        return;
      }
      askAttach(state, seat, String(data.card), o.from, chosen, keys, after, { card: data.card });
    },
  });
}

/** Look at the top cards of your deck and attach Energy you find there to your Pokémon. */
function attachFromTop(n: number, energy: Match, rest: "shuffle" | "discard" | "bottom", target: SelfTest = any): Use {
  return chain({
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const p = me(state, seat);
      const top = p.deck.slice(0, n);
      const options = top.filter(energy).map((c) => c.uid);
      ask(state, {
        seat,
        title: `Top ${plural(top.length, "card")} of your deck: choose Energy to attach`,
        zone: "deck",
        options,
        shown: top.map((c) => c.uid),
        min: 0,
        max: options.length,
        effect: card.name,
        data: { ...src(card), step: "top", top: top.map((c) => c.uid) },
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      const others = (data.top as string[]).filter((u) => !picks.includes(u));
      const self = selfOf(state, seat, data.src);
      const keys = slotKeys(p).filter((k) => target(state, seat, slotAt(p, k)!, self));
      // Put the rest away first, then attach the chosen ones (they stay on top until placed).
      const rest_ = pull(p.deck, others);
      if (rest === "discard") p.discard.push(...rest_);
      else if (rest === "bottom") p.deck.push(...shuffle(rest_));
      else p.deck.push(...rest_);
      if (rest_.length)
        log(
          state,
          seat,
          `${p.name} ${rest === "discard" ? "discarded" : rest === "bottom" ? "put on the bottom of their deck" : "shuffled back"} ${plural(rest_.length, "card")}.`,
        );
      if (picks.length && keys.length)
        return askAttach(state, seat, String(data.card), "deck", picks, keys, rest === "shuffle" ? "shuffle" : "none", { card: data.card });
      if (rest === "shuffle") shuffle(p.deck);
    },
  });
}

/** Move Energy between your Pokémon. `many` moves any amount onto the chosen target. */
function moveEnergy(o: { which: Match; from: SelfTest; to: SelfTest; many?: boolean; toSelf?: boolean }): Use {
  const choices = (state: PState, seat: Seat, uid: unknown) => {
    const self = selfOf(state, seat, uid);
    const p = me(state, seat);
    return attachedChoices(state, [seat], (c, slot) => isEnergy(c) && o.which(c) && o.from(state, seat, slot, self) && (!o.toSelf || slot !== self)).filter(
      (ch) => {
        const at = fromAttachedId(state, ch.id);
        return at && slotKeys(p).some((k) => slotAt(p, k) !== at.slot && o.to(state, seat, slotAt(p, k)!, self));
      },
    );
  };
  return {
    canPlay: (state, seat, card) => (choices(state, seat, card.uid).length ? null : "There's no Energy to move."),
    play(state, seat, card) {
      const list = choices(state, seat, card.uid);
      askChoice(state, seat, o.many ? `${card.name}: choose any Energy to move` : `${card.name}: choose an Energy to move`, list, card.name, {
        min: o.many ? 0 : 1,
        max: o.many ? list.length : 1,
        data: { ...src(card), step: "pick" },
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      const self = selfOf(state, seat, data.src);
      const moving = (data.step === "pick" ? picks : (data.picks as string[])).map((id) => fromAttachedId(state, id)).filter(Boolean) as ReturnType<
        typeof fromAttachedId
      >[];
      if (!moving.length) return;
      let target: PSlot | null = null;
      if (data.step === "to") target = slotAt(p, picks[0] as SlotKey);
      else {
        const keys = slotKeys(p).filter((k) => o.to(state, seat, slotAt(p, k)!, self) && moving.some((m) => m!.slot !== slotAt(p, k)));
        if (keys.length > 1) {
          ask(state, {
            seat,
            title: "Choose a Pokémon to move the Energy to",
            zone: "myPokemon",
            options: keys,
            min: 1,
            max: 1,
            effect: String(data.card),
            data: { ...data, step: "to", picks },
          });
          return;
        }
        target = keys.length ? slotAt(p, keys[0]) : null;
      }
      if (!target) return;
      for (const m of moving) {
        if (!m || m.slot === target) continue;
        m.slot.energy = m.slot.energy.filter((e) => e.uid !== m.card.uid);
        target.energy.push(m.card);
        log(state, seat, `${p.name} moved ${m.card.name} from ${topCard(m.slot).name} to ${topCard(target).name}.`);
      }
    },
  };
}

/** Put damage counters on 1 of the opponent's Pokémon (or only a Benched one). */
function counters(n: number | ((card: PCard) => number), benchOnly = false, then?: (state: PState, seat: Seat, card: PCard) => void, selfKo = false): Use {
  const count = (card: PCard) => (typeof n === "number" ? n : n(card));
  const options = (state: PState, seat: Seat) => {
    const opp = them(state, seat);
    return slotKeys(opp).filter((k) => (!benchOnly || k !== "active") && !abilityProof(state, seat, slotAt(opp, k)!));
  };
  return {
    selfKo,
    canPlay: (state, seat) => (options(state, seat).length ? null : "Your opponent has no Pokémon this can hit."),
    play(state, seat, card) {
      ask(state, {
        seat,
        title: `Choose 1 of ${them(state, seat).name}'s Pokémon to put ${plural(count(card), "damage counter")} on`,
        zone: benchOnly ? "oppBench" : "oppPokemon",
        options: options(state, seat),
        min: 1,
        max: 1,
        effect: card.name,
        data: { ...src(card), amount: count(card) * 10, n: count(card), rules: card.rules },
      });
    },
    resume(state, seat, picks, data) {
      const opp = them(state, seat);
      const slot = slotAt(opp, picks[0] as SlotKey);
      if (!slot) return;
      putCounters(state, seat, slot, Number(data.n));
      log(state, seat, `${data.card} put ${plural(Number(data.n), "damage counter")} on ${topCard(slot).name}.`);
      const self = selfOf(state, seat, data.src);
      if (then && self) then(state, seat, { ...topCard(self), name: String(data.card), rules: data.rules as string[] });
    },
  };
}

/** Move damage counters: from one Pokémon to another. */
function moveCounters(o: { max: number; fromOpp?: boolean; toOpp?: boolean; from: SelfTest; to: SelfTest; toActive?: boolean }): Use {
  const step: NonNullable<Use["resume"]> = (state, seat, picks, data) => use.resume!(state, seat, picks, data);
  const fromSide = (state: PState, seat: Seat) => (o.fromOpp ? them(state, seat) : me(state, seat));
  const toSide = (state: PState, seat: Seat) => (o.toOpp ? them(state, seat) : me(state, seat));
  const sources = (state: PState, seat: Seat, uid: unknown) => {
    const self = selfOf(state, seat, uid);
    const p = fromSide(state, seat);
    return slotKeys(p).filter((k) => slotAt(p, k)!.damage > 0 && o.from(state, seat, slotAt(p, k)!, self));
  };
  const use: Use = {
    canPlay: (state, seat, card) =>
      !countersMove(state)
        ? "Damage counters can't be moved right now."
        : sources(state, seat, card.uid).length
          ? null
          : "There are no damage counters to move.",
    play(state, seat, card) {
      ask(state, {
        seat,
        title: `${card.name}: choose a Pokémon to move damage counters from`,
        zone: o.fromOpp ? "oppPokemon" : "myPokemon",
        options: sources(state, seat, card.uid),
        min: 1,
        max: 1,
        effect: card.name,
        data: { ...src(card), step: "from" },
      });
    },
    resume(state, seat, picks, data) {
      const self = selfOf(state, seat, data.src);
      if (data.step === "from") {
        const p = toSide(state, seat);
        const from = String(picks[0]);
        const sameSide = !!o.fromOpp === !!o.toOpp;
        const keys = (o.toActive ? (["active"] as SlotKey[]) : slotKeys(p)).filter(
          (k) => slotAt(p, k) && !(sameSide && k === from) && o.to(state, seat, slotAt(p, k)!, self) && (!o.toOpp || !abilityProof(state, seat, slotAt(p, k)!)),
        );
        if (!keys.length) return;
        if (keys.length === 1) return step(state, seat, [keys[0]], { ...data, step: "to", from });
        ask(state, {
          seat,
          title: "Choose a Pokémon to move them to",
          zone: o.toOpp ? "oppPokemon" : "myPokemon",
          options: keys,
          min: 1,
          max: 1,
          effect: String(data.card),
          data: { ...data, step: "to", from },
        });
        return;
      }
      if (data.step === "to") {
        const fromSlot = slotAt(fromSide(state, seat), data.from as SlotKey);
        const most = Math.min(o.max, (fromSlot?.damage ?? 0) / 10);
        if (most > 1) {
          askChoice(
            state,
            seat,
            "How many damage counters?",
            Array.from({ length: most }, (_, i) => ({ id: String(most - i), label: String(most - i) })),
            String(data.card),
            { data: { ...data, step: "count", to: picks[0] } },
          );
          return;
        }
        return step(state, seat, ["1"], { ...data, step: "count", to: picks[0] });
      }
      const fromSlot = slotAt(fromSide(state, seat), data.from as SlotKey);
      const toSlot = slotAt(toSide(state, seat), data.to as SlotKey);
      if (!fromSlot || !toSlot) return;
      const n = Math.min(Number(picks[0]), fromSlot.damage / 10);
      fromSlot.damage -= n * 10;
      toSlot.damage += n * 10;
      log(state, seat, `${data.card} moved ${plural(n, "damage counter")} from ${topCard(fromSlot).name} to ${topCard(toSlot).name}.`);
    },
  };
  return use;
}

/** Special Conditions on the opponent's Active Pokémon (and on your own with `both`). */
function inflict(conditions: PSlot["conditions"], both = false): Use {
  return {
    canPlay: (state, seat) => (them(state, seat).active ? null : "Your opponent has no Active Pokémon."),
    play(state, seat, card) {
      const target = them(state, seat).active;
      if (target && !abilityProof(state, seat, target)) {
        for (const c of conditions) setCondition(state, target, c);
        log(state, seat, `${card.name}: ${topCard(target).name} is now ${conditions.join(" and ")}.`);
      }
      const mine = me(state, seat).active;
      if (both && mine) {
        for (const c of conditions) setCondition(state, mine, c);
        log(state, seat, `${topCard(mine).name} is now ${conditions.join(" and ")} too.`);
      }
    },
  };
}

/** Switch your Active Pokémon with 1 of your Benched Pokémon (`then` runs after). */
function switchMine(filter: (slot: PSlot) => boolean = () => true, then?: (state: PState, seat: Seat, incoming: PSlot) => void): Use {
  const options = (state: PState, seat: Seat) => benchSlots(me(state, seat)).filter((k) => filter(me(state, seat).bench[benchIndex(k)]));
  return {
    canPlay: (state, seat) => (options(state, seat).length ? null : "You have no Benched Pokémon to switch in."),
    play(state, seat, card) {
      ask(state, {
        seat,
        title: "Choose a Benched Pokémon to switch into the Active Spot",
        zone: "myBench",
        options: options(state, seat),
        min: 1,
        max: 1,
        effect: card.name,
        data: { ...src(card), step: "switch" },
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      const incoming = p.bench[benchIndex(picks[0])];
      if (!incoming) return;
      switchActive(p, benchIndex(picks[0]));
      log(state, seat, `${p.name} switched ${topCard(incoming).name} into the Active Spot with ${data.card}.`);
      then?.(state, seat, incoming);
    },
  };
}

/** This Benched Pokémon switches with your Active Pokémon. */
function comeIn(then?: (state: PState, seat: Seat, card: PCard) => void): Use {
  return {
    where: "bench",
    play(state, seat, card) {
      const p = me(state, seat);
      const self = selfOf(state, seat, card.uid);
      if (!self) return;
      switchActive(p, p.bench.indexOf(self));
      log(state, seat, `${topCard(self).name} switched into the Active Spot.`);
      then?.(state, seat, card);
    },
  };
}

/** Switch 1 of the opponent's Benched Pokémon into their Active Spot (you choose). */
function gustOpp(filter: (state: PState, slot: PSlot) => boolean = () => true, then?: (state: PState, seat: Seat, incoming: PSlot) => void): Use {
  const options = (state: PState, seat: Seat) => {
    const opp = them(state, seat);
    return benchSlots(opp).filter((k) => filter(state, opp.bench[benchIndex(k)]) && !abilityProof(state, seat, opp.bench[benchIndex(k)]));
  };
  return {
    canPlay: (state, seat) => (options(state, seat).length ? null : "Your opponent has no Benched Pokémon this can switch in."),
    play(state, seat, card) {
      ask(state, {
        seat,
        title: `Choose 1 of ${them(state, seat).name}'s Benched Pokémon to switch into the Active Spot`,
        zone: "oppBench",
        options: options(state, seat),
        min: 1,
        max: 1,
        effect: card.name,
        data: { ...src(card), step: "gust" },
      });
    },
    resume(state, seat, picks) {
      resumeGust(state, seat, picks);
      const incoming = them(state, seat).active;
      if (incoming) then?.(state, seat, incoming);
    },
  };
}

/** The opponent switches their Active Pokémon with a Benched one of their choice. */
function switchOutOpp(then?: (state: PState, seat: Seat, card: PCard) => void): Use {
  return {
    canPlay: (state, seat) => {
      const opp = them(state, seat);
      if (!opp.bench.length) return "Your opponent has no Benched Pokémon.";
      return opp.active && abilityProof(state, seat, opp.active) ? "Your opponent's Active Pokémon is protected from Abilities." : null;
    },
    play(state, seat, card) {
      const opp = them(state, seat);
      ask(state, {
        seat: otherSeat(seat),
        title: `${card.name} switches out your Active Pokémon. Choose a Benched Pokémon to send in`,
        zone: "myBench",
        options: benchSlots(opp),
        min: 1,
        max: 1,
        effect: "switchOut",
      });
      then?.(state, seat, card);
    },
  };
}

/** Shuffle this Pokémon and everything attached into your deck. */
function shuffleSelfIn(state: PState, seat: Seat, self: PSlot | null) {
  const p = me(state, seat);
  if (!self) return;
  p.deck.push(...self.pokemon, ...attachedTo(self));
  if (p.active === self) p.active = null;
  else p.bench.splice(p.bench.indexOf(self), 1);
  shuffle(p.deck);
  log(state, seat, `${p.name} shuffled ${topCard(self).name} and its attached cards into their deck.`);
}
/** Discard this Pokémon and everything attached (or put the Pokémon in the Lost Zone). */
function discardSelf(state: PState, seat: Seat, self: PSlot | null, lost = false) {
  const p = me(state, seat);
  if (!self) return;
  p.discard.push(...attachedTo(self));
  if (lost) (p.lost ??= []).push(...self.pokemon);
  else p.discard.push(...self.pokemon);
  if (p.active === self) p.active = null;
  else p.bench.splice(p.bench.indexOf(self), 1);
  log(state, seat, `${topCard(self).name} was ${lost ? "put in the Lost Zone" : "discarded"}.`);
}

/** Put a card from your hand or discard pile onto your Bench (Abilities that work from there). */
function toBenchFrom(from: "hand" | "discard", then?: (state: PState, seat: Seat, slot: PSlot, card: PCard) => void): Use {
  return {
    from,
    canPlay: (state, seat) => (me(state, seat).bench.length < benchLimit(state, seat) ? null : "Your Bench is full."),
    play(state, seat, card) {
      const p = me(state, seat);
      const zone = from === "hand" ? p.hand : p.discard;
      const [c] = pull(zone, [card.uid]);
      if (!c) return;
      const slot = benchPokemon(state, seat, c, false);
      log(state, seat, `${p.name} put ${c.name} onto their Bench from their ${from === "hand" ? "hand" : "discard pile"}.`);
      then?.(state, seat, slot, card);
    },
  };
}

/** Reveals cards to the player as a choice they just close (nothing to pick). */
function show(state: PState, seat: Seat, title: string, zone: "oppHand" | "oppDeck" | "deck", cards: PCard[]) {
  ask(state, { seat, title, zone, options: [], shown: cards.map((c) => c.uid), min: 0, max: 0, effect: "ab:seen" });
}

const drawAnd = (n: number, then: (state: PState, seat: Seat, card: PCard) => void): Use => ({
  canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
  play(state, seat, card) {
    const p = me(state, seat);
    const before = p.hand.length;
    draw(p, n);
    log(state, seat, `${p.name} drew ${plural(p.hand.length - before, "card")} with ${card.name}.`);
    if (p.hand.length > before) then(state, seat, card);
  },
});
const drawN = (n: number): Use => ({ ...drawCards(n), canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty.") });
const drawTo = (n: number): Use => ({
  ...drawUntil(() => n),
  canPlay: (state, seat) =>
    !me(state, seat).deck.length ? "Your deck is empty." : me(state, seat).hand.length >= n ? `You already have ${n} or more cards.` : null,
  worth: (state, seat) => n - me(state, seat).hand.length >= 1,
});
const find = (title: string, match: Match, max: number): Use => ({ ...searchToHand(title, match, max) });
const healAt = (amount: number, which: Match = () => true): Use => ({
  ...healOne(amount, which),
  canPlay: (state, seat) =>
    noHealing(state)
      ? "Pokémon can't be healed right now."
      : inPlay(me(state, seat)).some((s) => s.damage && which(topCard(s)))
        ? null
        : "None of your Pokémon have damage to heal.",
});
const healAll = (amount: number, which: (slot: PSlot) => boolean): Use => ({
  canPlay: (state, seat) =>
    noHealing(state) ? "Pokémon can't be healed right now." : inPlay(me(state, seat)).some((s) => s.damage && which(s)) ? null : "There's no damage to heal.",
  play(state, seat, card) {
    for (const s of inPlay(me(state, seat))) if (which(s)) heal(s, amount);
    log(state, seat, `${card.name} healed ${amount >= 999 ? "all" : amount} damage.`);
  },
});
/** Puts a Basic Pokémon from a discard pile onto that player's Bench. */
function reviveBasic(state: PState, seat: Seat, effect: string, match: Match) {
  const p = me(state, seat);
  const options = p.discard.filter((c) => isBasicPokemon(c) && match(c)).map((c) => c.uid);
  if (!options.length || p.bench.length >= benchLimit(state, seat)) return;
  ask(state, {
    seat,
    title: "Choose a Basic Pokémon from your discard pile to put onto your Bench",
    zone: "discard",
    options,
    min: 1,
    max: 1,
    effect,
    data: { step: "revive" },
  });
}

// ----- The Abilities -----

let built: Record<string, Use> | null = null;
/** Abilities used with a button. Built on first use (see the note in trainers-more.ts). */
export const abilityUses = () => (built ??= build());

const build = (): Record<string, Use> => ({
  // --- Attaching Energy ---
  "Excited Turbo": only(
    {
      ...attachOne({ from: "hand", energy: basic("Fire"), target: (s, p, slot) => onBench(s, p, slot, null) && ofType(topCard(slot), "Fire") }),
      limit: "free",
    },
    (state, seat) => inPlay(me(state, seat)).some((s) => isMegaEx(topCard(s)) && ofType(topCard(s), "Fire")),
    "You need a Fire Mega Evolution Pokémon ex in play.",
  ),
  "Inferno Fandango": { ...attachOne({ from: "hand", energy: basic("Fire"), target: any }), limit: "free" },
  "Electric Streamer": {
    ...attachOne({ from: "hand", energy: basic("Lightning"), target: (_s, _p, slot) => trainersPokemon(topCard(slot), "Iono") }),
    limit: "free",
  },
  "Psychic Embrace": {
    ...attachOne({
      from: "discard",
      energy: basic("Psychic"),
      target: (state, _p, slot) => ofType(topCard(slot), "Psychic") && hpLeft(state, slot) > 20,
      then: (state, seat, slot) => {
        slot.damage += 20;
        log(state, seat, `Psychic Embrace put 2 damage counters on ${topCard(slot).name}.`);
      },
    }),
    limit: "free",
    worth: (state, seat) => inPlay(me(state, seat)).some((s) => ofType(topCard(s), "Psychic") && hpLeft(state, s) > 60 && s.energy.length < 3),
  },
  "Super Cold": { ...attachOne({ from: "hand", energy: basic("Water"), target: any }), limit: "free" },
  "Oceanic Accompaniment": {
    ...attachOne({ from: "hand", energy: energyOf("Water"), target: (_s, _p, slot) => topCard(slot).attacks.some((a) => a.name === "Swim Freely") }),
    limit: "free",
  },
  "Seething Spirit": attachOne({ from: "discard", energy: isBasicEnergy, target: any }),
  "Charging Up": attachOne({ from: "discard", energy: isBasicEnergy, target: isSelf }),
  "Energy Carnival": attachOne({ from: "hand", energy: isBasicEnergy, target: any }),
  "Energizing Rock Salt": attachOne({
    from: "discard",
    energy: basic("Fighting"),
    target: any,
    then: (state, _seat, slot) => void heal(slot, noHealing(state) ? 0 : 30),
  }),
  "Pyro Dance": attachMany({ from: "hand", energy: either(basic("Fire"), basic("Fighting")), max: 2, target: any, pair: ["Fire", "Fighting"] }),
  "Ripening Charge": attachOne({ from: "hand", energy: basic("Grass"), target: any, then: (state, _seat, slot) => void heal(slot, noHealing(state) ? 0 : 30) }),
  "Teal Dance": attachOne({ from: "hand", energy: basic("Grass"), target: isSelf, then: (state, seat) => drawCards(1).play(state, seat, {} as PCard) }),
  Dynamotor: attachOne({ from: "discard", energy: basic("Lightning"), target: onBench }),
  "Clairvoyant Sense": attachOne({
    from: "hand",
    energy: basic("Psychic"),
    target: onBench,
    then: (state, seat) => drawCards(2).play(state, seat, {} as PCard),
  }),
  "Sun Energy": attachOne({ from: "discard", energy: energyOf("Psychic"), target: (_s, _p, slot) => baseName(topCard(slot).name) === "Lunatone" }),
  "Balloon Therapy": attachOne({ from: "hand", energy: (c) => baseName(c.name) === "Therapeutic Energy", target: any }),
  "Dino Cry": {
    ...attachMany({
      from: "discard",
      energy: basic("Fighting"),
      max: 2,
      target: (_s, _p, slot) => isBasicPokemon(topCard(slot)) && ofType(topCard(slot), "Fighting"),
      after: "endTurn",
    }),
    worth: (state) => state.turn > 2,
  },
  "Golden Flame": attachMany({
    from: "hand",
    energy: basic("Fire"),
    max: 2,
    target: (s, p, slot) => onBench(s, p, slot, null) && trainersPokemon(topCard(slot), "Ethan"),
    single: true,
  }),
  "Overvolt Discharge": {
    ...attachMany({
      from: "discard",
      energy: isBasicEnergy,
      max: 3,
      target: (_s, _p, slot, self) => slot !== self && ofType(topCard(slot), "Lightning"),
      koSelf: true,
    }),
    selfKo: true,
    worth: () => false,
  },
  "Glaciated World": {
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const p = me(state, seat);
      const [top] = p.deck.splice(0, 1);
      if (!top) return;
      log(state, seat, `${card.name}: the top card of ${p.name}'s deck was ${top.name}.`);
      if (energyOf("Water")(top) && isEnergy(top)) {
        p.discard.push(top);
        attachOne({ from: "discard", energy: (c) => c.uid === top.uid, target: any }).play(state, seat, card);
      } else p.discard.push(top);
    },
    resume: (state, seat, picks, data) => attachOne({ from: "discard", energy: isEnergy, target: any }).resume!(state, seat, picks, data),
  },
  "Buggy Turbo": {
    play(state, seat, card) {
      const self = selfOf(state, seat, card.uid);
      if (coin(state, seat, card.name)) return attachMany({ from: "discard", energy: isBasicEnergy, max: 4, target: isSelf }).play(state, seat, card);
      if (self?.energy.length) {
        const [e] = self.energy.splice(self.energy.length - 1, 1);
        me(state, seat).discard.push(e);
        log(state, seat, `${e.name} was discarded from ${topCard(self).name}.`);
      }
    },
    resume: (state, seat, picks, data) => attachMany({ from: "discard", energy: isBasicEnergy, max: 4, target: isSelf }).resume!(state, seat, picks, data),
    worth: (state, seat) => me(state, seat).discard.filter(isBasicEnergy).length >= 2,
  },
  Electrogenesis: attachOne({ from: "deck", energy: basic("Lightning"), target: isSelf }),
  "X-Boot": attachMany({
    from: "deck",
    energy: either(basic("Psychic"), basic("Metal")),
    max: 2,
    pair: ["Psychic", "Metal"],
    target: (_s, _p, slot) => ofType(topCard(slot), "Psychic") || ofType(topCard(slot), "Metal"),
  }),
  "Primal Turbo": attachMany({ from: "deck", energy: isSpecialEnergy, max: 2, target: any, single: true }),
  "Exploding Energy": {
    ...attachMany({ from: "deck", energy: basic("Grass"), max: 5, target: (_s, _p, slot, self) => slot !== self, koSelf: true }),
    selfKo: true,
    worth: () => false,
  },
  "Vitality Spring": {
    ...attachMany({ from: "deck", energy: isEnergy, max: 6, target: any, after: "endTurn" }),
    worth: (state, seat) => !me(state, seat).energyAttached && state.turn > 2,
  },
  "Sinister Surge": attachOne({
    from: "deck",
    energy: basic("Darkness"),
    target: (s, p, slot) => onBench(s, p, slot, null) && ofType(topCard(slot), "Darkness"),
    then: (state, seat, slot) => {
      slot.damage += 20;
      log(state, seat, `Sinister Surge put 2 damage counters on ${topCard(slot).name}.`);
    },
  }),
  "Mystery Charge": only(
    attachOne({ from: "discard", energy: energyOf("Fighting"), target: any }),
    (state, seat) => !me(state, seat).discard.some(isSupporter),
    "You can't have Supporter cards in your discard pile.",
  ),
  "Magnetic Absorption": only(
    attachOne({ from: "discard", energy: basic("Fighting"), target: isSelf }),
    (state, seat) => them(state, seat).prizes.length <= 4,
    "Your opponent needs 4 or fewer Prize cards left.",
  ),
  "Ancient Wisdom": only(
    attachMany({ from: "discard", energy: isEnergy, max: 3, target: any, single: true }),
    (state, seat) =>
      ["Regirock", "Regice", "Registeel", "Regieleki", "Regidrago"].every((n) => inPlay(me(state, seat)).some((s) => baseName(topCard(s).name) === n)),
    "You need Regirock, Regice, Registeel, Regieleki and Regidrago in play.",
  ),
  "Frilled Generator": only(
    attachMany({ from: "deck", energy: basic("Lightning"), max: 2, target: isSelf }),
    (state, seat) => (me(state, seat).used ?? []).includes("supporter:Canari"),
    "You need to have played Canari this turn.",
  ),
  "Moon-Watching Party": {
    where: "active",
    canPlay: (state, seat) => (me(state, seat).bench.some((s) => baseName(topCard(s).name) === "Clefairy") ? null : "You have no Benched Clefairy."),
    play(state, seat, card) {
      const p = me(state, seat);
      for (const s of p.bench) {
        if (baseName(topCard(s).name) !== "Clefairy") continue;
        const e = p.deck.find(energyOf("Psychic"));
        if (!e) break;
        s.energy.push(...pull(p.deck, [e.uid]));
        log(state, seat, `${card.name} attached ${e.name} to ${topCard(s).name}.`);
      }
      shuffle(p.deck);
    },
  },
  "Tri Howl": attachFromTop(3, isEnergy, "discard"),
  "Metal Maker": attachFromTop(4, basic("Metal"), "bottom"),
  "Giga Magnet": attachFromTop(6, energyOf("Metal"), "shuffle"),

  // --- Moving Energy ---
  "Irresistible Force": {
    ...moveEnergy({ which: energyOf("Fighting"), from: (_s, _p, slot, self) => slot !== self, to: isSelf }),
    limit: "free",
    worth: () => false,
  },
  "Fire Off": {
    ...moveEnergy({ which: energyOf("Fire"), from: onBench, to: (state, seat, slot) => me(state, seat).active === slot }),
    limit: "free",
    worth: () => false,
  },
  "Special Transfer": { ...moveEnergy({ which: isSpecialEnergy, from: any, to: any }), limit: "free", worth: () => false },
  "Solar Transfer": { ...moveEnergy({ which: basic("Grass"), from: any, to: any }), limit: "free", worth: () => false },
  "Happy Switch": { ...moveEnergy({ which: isBasicEnergy, from: any, to: any }), worth: () => false },

  // --- Damage counters ---
  "Rocket Brain": {
    ...moveCounters({ max: 1, from: (_s, _p, slot) => trainersPokemon(topCard(slot), "Team Rocket"), to: any }),
    limit: "free",
    worth: () => false,
  },
  "Strange Behavior": { ...moveCounters({ max: 1, from: (_s, _p, slot, self) => slot !== self, to: isSelf }), limit: "free", worth: () => false },
  "Adrena-Brain": only(
    { ...moveCounters({ max: 3, from: any, to: any, toOpp: true }), worth: (state, seat) => inPlay(me(state, seat)).some((s) => s.damage >= 30) },
    (_state, _seat, self) => !!self?.energy.some(energyOf("Darkness")),
    "This Pokémon needs Darkness Energy attached.",
  ),
  "Painful Spoons": { ...moveCounters({ max: 2, fromOpp: true, toOpp: true, from: any, to: any }), worth: () => false },
  "Witch's Domain": { ...moveCounters({ max: 2, from: any, to: any, toOpp: true, toActive: true }) },
  "Zooming Draw": {
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const self = selfOf(state, seat, card.uid);
      if (!self) return;
      self.damage += 10;
      log(state, seat, `${card.name} put 1 damage counter on ${topCard(self).name}.`);
      drawCards(1).play(state, seat, card);
    },
    worth: (state, seat, self) => !!self && hpLeft(state, self) > 40,
  },
  "Mysterious Comet": {
    ...counters(2, false, (state, seat, card) => discardSelf(state, seat, selfOf(state, seat, card.uid))),
    worth: () => false,
  },
  "Roaring Resolve": {
    ...attachOne({ from: "deck", energy: energyOf("Fighting"), target: isSelf }),
    play(state, seat, card) {
      const self = selfOf(state, seat, card.uid);
      if (!self) return;
      self.damage += 20;
      log(state, seat, `${card.name} put 2 damage counters on ${topCard(self).name}.`);
      attachOne({ from: "deck", energy: energyOf("Fighting"), target: isSelf }).play(state, seat, card);
    },
    worth: (state, seat, self) => !!self && hpLeft(state, self) > 50,
  },
  "Cursed Blast": {
    ...counters(
      (card) => num(card, /put (\d+) damage counters/i, 5),
      false,
      (state, seat, card) => koSelf(state, seat, selfOf(state, seat, card.uid), card.name),
      true,
    ),
    worth: (state, seat) => them(state, seat).prizes.length > 1 && inPlay(them(state, seat)).some((s) => hpLeft(state, s) <= 50),
  },
  "Torrential Heart": {
    play(state, seat, card) {
      const self = selfOf(state, seat, card.uid);
      if (!self) return;
      self.damage += 50;
      self.effects.boost = { turn: state.turn, amount: 120 };
      log(state, seat, `${card.name}: ${topCard(self).name} took 5 damage counters and its attacks do 120 more damage this turn.`);
    },
    worth: (state, seat, self) => !!self && me(state, seat).active === self && hpLeft(state, self) > 80,
  },
  "Moon Cleave Star": { ...counters(4), limit: "vstar" },
  "Mortal Shuriken": { ...paying(basic("Water"), 1, "a Basic Water Energy card", counters(6)), where: "active" },
  "Bouquet Magic": paying(basic("Grass"), 1, "a Basic Grass Energy card", counters(3, true)),
  "Pump Shot": paying(energyOf("Water"), 1, "a Water Energy card", counters(2, true)),

  // --- Special Conditions ---
  "Toxic Wetland": only(inflict(["poisoned"]), (state) => !!state.stadium, "There needs to be a Stadium in play."),
  "Toxic Powder": only(
    { ...inflict(["poisoned"], true), worth: () => false },
    (state, _seat, self) => !!self && hasTool(state, self, "Ancient Booster Energy Capsule"),
    "This Pokémon needs an Ancient Booster Energy Capsule attached.",
  ),
  "Calming Light": { ...inflict(["asleep"]), where: "active" },
  "Scalding Steam": { ...inflict(["burned"]), where: "active" },
  "Hazard Star": {
    ...inflict(["paralyzed", "poisoned"]),
    play(state, seat, card) {
      inflict(["paralyzed", "poisoned"]).play(state, seat, card);
      const target = them(state, seat).active;
      if (target && !abilityProof(state, seat, target)) target.effects.poisonDamage = 30;
    },
    limit: "vstar",
  },
  "Selective Slime": {
    play(state, seat, card) {
      if (!coin(state, seat, card.name)) return;
      askChoice(
        state,
        seat,
        "Choose a Special Condition for your opponent's Active Pokémon",
        [
          { id: "poisoned", label: "Poisoned" },
          { id: "burned", label: "Burned" },
          { id: "confused", label: "Confused" },
        ],
        card.name,
      );
    },
    resume: (state, seat, picks) => inflict([picks[0] as PSlot["conditions"][number]]).play(state, seat, { name: "Selective Slime" } as PCard),
  },
  "Torrid Scales": paying(basic("Fire"), 1, "a Basic Fire Energy card", inflict(["burned"])),
  "Supernatural Orb": paying(energyOf("Psychic"), 1, "a Psychic Energy card", inflict(["burned", "confused"])),
  "Busybody Nurse": {
    canPlay: (state, seat) => (me(state, seat).active?.conditions.length ? null : "Your Active Pokémon has no Special Conditions."),
    play(state, seat) {
      const a = me(state, seat).active;
      if (!a) return;
      a.conditions = [];
      log(state, seat, `${topCard(a).name} recovered from all Special Conditions.`);
    },
  },

  // --- Drawing ---
  "Squawk and Seize": { play: (state, seat) => discardHandDraw(state, seat, 6), limit: "firstName", worth: (state, seat) => me(state, seat).hand.length <= 4 },
  "Flip the Script": only(
    { ...drawN(3), limit: "name" },
    (state, seat) => me(state, seat).koTurn === state.turn - 1,
    "None of your Pokémon were Knocked Out during your opponent's last turn.",
  ),
  "Fleet-Footed": { ...drawN(1), where: "active" },
  "Dragon's Hoard": { ...drawTo(4), where: "active", limit: "name" },
  "Run Errand": { ...drawN(2), where: "active", limit: "name" },
  "Alluring Wings": { ...bothDraw(), where: "active" },
  "Alluring Light": bothDraw(),
  "Lunar Cycle": only(
    { ...paying(basic("Fighting"), 1, "a Basic Fighting Energy card", drawN(3)), limit: "name" },
    (state, seat) => inPlay(me(state, seat)).some((s) => baseName(topCard(s).name) === "Solrock"),
    "You need Solrock in play.",
  ),
  "Shadowy Envoy": only(
    drawTo(8),
    (state, seat) => (me(state, seat).used ?? []).includes("supporter:Janine's Secret Art"),
    "You need to have played Janine's Secret Art this turn.",
  ),
  "Flaring Magic": paying(basic("Fire"), 1, "a Basic Fire Energy card", drawTo(7)),
  "Regal Stance": {
    play(state, seat, card) {
      discardHandDraw(state, seat, 5);
      endTurnNow(state, seat, card.name);
    },
    worth: (state, seat) => me(state, seat).hand.length <= 2 && me(state, seat).energyAttached,
  },
  "Run Away Draw": {
    ...drawAnd(3, (state, seat, card) => shuffleSelfIn(state, seat, selfOf(state, seat, card.uid))),
    worth: (state, seat, self) => !!self && me(state, seat).active !== self && me(state, seat).hand.length <= 4,
  },
  "Instant Charge": {
    ...drawN(3),
    play(state, seat, card) {
      drawCards(3).play(state, seat, card);
      endTurnNow(state, seat, card.name);
    },
    worth: () => false,
  },
  "Hurried Gait": drawN(1),
  "Aerial Draw": drawN(1),
  "Coin Bonus": {
    ...drawN(1),
    play: (state, seat, card) => drawCards(me(state, seat).active?.pokemon.some((c) => c.uid === card.uid) ? 2 : 1).play(state, seat, card),
  },
  Restart: drawTo(3),
  "Industrious Incisors": drawTo(5),
  "Stoked Straw": drawTo(6),
  "Phantom Star": { play: (state, seat) => discardHandDraw(state, seat, 7), limit: "vstar", worth: (state, seat) => me(state, seat).hand.length <= 3 },
  "Star of Fortune": { ...drawTo(8), limit: "vstar", worth: (state, seat) => me(state, seat).hand.length <= 3 },
  "Conversion Star": {
    limit: "vstar",
    canPlay: (state, seat) => (me(state, seat).hand.length ? null : "You have no cards in your hand."),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose any cards to discard, then draw that many",
        zone: "hand",
        options: p.hand.map((c) => c.uid),
        min: 0,
        max: p.hand.length,
        effect: card.name,
        data: { step: "cost" },
      });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const gone = pull(p.hand, picks);
      p.discard.push(...gone);
      draw(p, gone.length);
      log(state, seat, `${p.name} discarded ${plural(gone.length, "card")} and drew ${plural(gone.length, "card")}.`);
    },
    worth: () => false,
  },
  "Nest Stash": {
    canPlay: (state, seat) => (me(state, seat).hand.length ? null : "You have no cards in your hand."),
    play(state, seat) {
      const p = me(state, seat);
      p.deck.push(...shuffle(p.hand.splice(0)));
      draw(p, 1);
      log(state, seat, `${p.name} put their hand on the bottom of their deck and drew a card.`);
    },
    worth: (state, seat) => me(state, seat).hand.length <= 1,
  },
  "Seething Currents": {
    play(state, seat, card) {
      askChoice(
        state,
        seat,
        `${card.name}: which player puts their hand on the bottom of their deck and draws 4?`,
        [
          { id: "me", label: `${me(state, seat).name} (you)` },
          { id: "them", label: them(state, seat).name },
        ],
        card.name,
        { data: { botPick: [me(state, seat).hand.length <= 3 ? "me" : "them"] } },
      );
    },
    resume(state, seat, picks) {
      const p = picks[0] === "me" ? me(state, seat) : them(state, seat);
      if (!p.hand.length) return log(state, seat, `${p.name} had no cards, so nothing happened.`);
      p.deck.push(...shuffle(p.hand.splice(0)));
      draw(p, 4);
      log(state, seat, `${p.name} put their hand on the bottom of their deck and drew 4 cards.`);
    },
  },
  "Distorted Future": {
    where: "active",
    play(state, seat) {
      const opp = them(state, seat);
      opp.deck.push(...opp.hand.splice(0));
      shuffle(opp.deck);
      draw(opp, 3);
      log(state, seat, `${opp.name} shuffled their hand into their deck and drew 3 cards.`);
    },
    worth: (state, seat) => them(state, seat).hand.length >= 5,
  },
  Trade: paying(() => true, 1, "a card", drawN(2)),
  Refinement: paying(() => true, 1, "a card", drawN(2)),
  "Gather Materials": paying(() => true, 1, "a card", drawN(3)),
  "Wily Stance": paying(() => true, 1, "a card", drawN(3)),
  "Concealed Cards": paying(isEnergy, 1, "an Energy card", drawN(2)),
  "Rumbling Engine": paying(isEnergy, 1, "an Energy card", drawTo(6)),
  Reconstitute: { ...paying(() => true, 2, "2 cards", drawN(1)), worth: () => false },
  "Up-Tempo": {
    ...drawTo(5),
    canPlay: (state, seat) => (me(state, seat).hand.length && me(state, seat).hand.length - 1 < 5 ? null : "You'd already have 5 or more cards."),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose a card to put on the bottom of your deck",
        zone: "hand",
        options: p.hand.map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
        data: { step: "cost" },
      });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      p.deck.push(...pull(p.hand, picks));
      drawUntil(() => 5).play(state, seat, {} as PCard);
    },
  },
  "Flashing Draw": {
    ...drawTo(6),
    canPlay: (state, seat, card) => {
      const self = selfOf(state, seat, card.uid);
      if (!self?.energy.some(basic("Lightning"))) return "This Pokémon needs a Basic Lightning Energy to discard.";
      return drawTo(6).canPlay!(state, seat, card);
    },
    play(state, seat, card) {
      const self = selfOf(state, seat, card.uid)!;
      const e = self.energy.find(basic("Lightning"))!;
      self.energy.splice(self.energy.indexOf(e), 1);
      me(state, seat).discard.push(e);
      log(state, seat, `${e.name} was discarded from ${topCard(self).name}.`);
      drawUntil(() => 6).play(state, seat, card);
    },
    worth: (state, seat) => me(state, seat).hand.length <= 3,
  },

  // --- Searching and looking at cards ---
  "Fan Call": {
    ...find("Choose up to 3 Colorless Pokémon with 100 HP or less", (c) => isPokemon(c) && ofType(c, "Colorless") && (c.hp ?? 0) <= 100, 3),
    limit: "firstName",
  },
  "Evolutionary Guidance": only(
    find("Choose an Evolution Pokémon", isEvolution, 1),
    (_s, _p, self) => !!self?.energy.length,
    "This Pokémon needs Energy attached.",
  ),
  "Shivery Chill": { ...find("Choose up to 2 Basic Water Energy cards", basic("Water"), 2), where: "active" },
  "Back Order": { ...find("Choose up to 2 Pokémon Tool cards", isTool, 2), where: "active" },
  "Call a Buddy": only(
    find("Choose a Supporter card", isSupporter, 1),
    (state, seat) => me(state, seat).hand.length === 0,
    "You need to have no cards in your hand.",
  ),
  "Boom Boom Groove": only(
    find("Choose any card", () => true, 1),
    (state, seat) => !!me(state, seat).active && topCard(me(state, seat).active!).abilities.some((a) => a.name === "Festival Lead"),
    "Your Active Pokémon needs the Festival Lead Ability.",
  ),
  "Champion's Call": find("Choose a Cynthia's Pokémon", (c) => trainersPokemon(c, "Cynthia"), 1),
  "Rocket Call": find("Choose Giovanni's Charisma", (c) => baseName(c.name) === "Giovanni's Charisma", 1),
  "Sun-Drenched Shell": find("Choose a Grass Pokémon", pokemonOf("Grass"), 1),
  "Mammoth Hauler": find("Choose a Pokémon", isPokemon, 1),
  "Changing Seasons": find("Choose a Stadium card", isStadium, 1),
  "Buddy Catch": find("Choose a Supporter card", isSupporter, 1),
  "Quick Search": { ...find("Choose any card", () => true, 1), limit: "name" },
  "Bonded by the Journey": find("Choose Ethan's Adventure", (c) => baseName(c.name) === "Ethan's Adventure", 1),
  "Metallic Signal": find("Choose up to 2 Evolution Metal Pokémon", (c) => isEvolution(c) && ofType(c, "Metal"), 2),
  Starbirth: { ...find("Choose up to 2 cards", () => true, 2), limit: "vstar", worth: (state, seat) => me(state, seat).hand.length <= 2 },
  "Star Perfume": { ...find("Choose up to 5 Grass Pokémon and Grass Energy cards", either(pokemonOf("Grass"), basic("Grass")), 5), limit: "vstar" },
  "Flower Selecting": { ...topCards(2, 1, "discard", () => true, true), where: "active", ...lostRest() },
  "Attract Customers": { ...topCards(6, 1, "shuffle", isSupporter), where: "active" },
  "Recon Directive": topCards(2, 1, "bottom", () => true, true),
  "Nighttime Maneuvers": {
    where: "active",
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose a card to put on top of your deck",
        zone: "deck",
        options: p.deck.map((c) => c.uid),
        shown: p.deck.map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const [c] = pull(p.deck, picks);
      shuffle(p.deck);
      if (c) p.deck.unshift(c);
      log(state, seat, `${p.name} shuffled their deck and put a card on top.`);
    },
    worth: () => false,
  },
  "Snack Seek": {
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const top = me(state, seat).deck[0];
      askChoice(
        state,
        seat,
        `The top card of your deck is ${top.name}. Discard it?`,
        [
          { id: "keep", label: "Leave it on top" },
          { id: "discard", label: "Discard it" },
        ],
        card.name,
      );
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      if (picks[0] !== "discard") return;
      p.discard.push(...p.deck.splice(0, 1));
      log(state, seat, `${p.name} discarded the top card of their deck.`);
    },
    worth: () => false,
  },
  "Psychic Insight": {
    play(state, seat) {
      const opp = them(state, seat);
      const p = me(state, seat);
      if (opp.deck[0]) show(state, seat, "The top card of your opponent's deck", "oppDeck", [opp.deck[0]]);
      if (p.deck[0]) show(state, seat, "The top card of your deck", "deck", [p.deck[0]]);
    },
    worth: () => false,
  },
  "Read the Stars": {
    canPlay: (state, seat) => (them(state, seat).deck.length ? null : "Your opponent's deck is empty."),
    play(state, seat, card) {
      const top = them(state, seat).deck.slice(0, 2);
      ask(state, {
        seat,
        title: "Choose the card to put back on top of your opponent's deck (the other goes on the bottom)",
        zone: "oppDeck",
        options: top.map((c) => c.uid),
        shown: top.map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
        data: { top: top.map((c) => c.uid) },
      });
    },
    resume(state, seat, picks, data) {
      const opp = them(state, seat);
      const others = (data.top as string[]).filter((u) => u !== picks[0]);
      opp.deck.push(...pull(opp.deck, others));
      log(state, seat, `${me(state, seat).name} looked at the top 2 cards of ${opp.name}'s deck and put 1 on the bottom.`);
    },
    worth: () => false,
  },
  "Revealing Echo": {
    where: "active",
    play(state, seat) {
      revealHand(state, seat);
      show(state, seat, "Your opponent's hand", "oppHand", them(state, seat).hand);
    },
    worth: () => false,
  },
  "Evidence Gathering": {
    canPlay: (state, seat) => (me(state, seat).hand.length && me(state, seat).deck.length ? null : "You need a card in your hand and one in your deck."),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose a card from your hand to swap with the top card of your deck",
        zone: "hand",
        options: p.hand.map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const [c] = pull(p.hand, picks);
      const [top] = p.deck.splice(0, 1, c);
      if (top) p.hand.push(top);
      log(state, seat, `${p.name} swapped a card in their hand with the top card of their deck.`);
    },
    worth: () => false,
  },
  "Legacy Star": {
    limit: "vstar",
    play(state, seat, card) {
      const p = me(state, seat);
      const gone = p.deck.splice(0, 7);
      p.discard.push(...gone);
      log(state, seat, `${p.name} discarded the top ${plural(gone.length, "card")} of their deck.`);
      if (p.discard.length)
        ask(state, {
          seat,
          title: "Choose up to 2 cards from your discard pile to put into your hand",
          zone: "discard",
          options: p.discard.map((c) => c.uid),
          min: 0,
          max: 2,
          effect: card.name,
        });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      const back = pull(p.discard, picks);
      p.hand.push(...back);
      log(state, seat, `${p.name} put ${names(back)} into their hand.`);
    },
    worth: (state, seat) => me(state, seat).deck.length > 15,
  },
  "Star Abyss": { ...recover("Choose up to 2 Item cards from your discard pile", isItem, 2, "hand"), limit: "vstar" },
  Voraciousness: recover("Choose up to 2 Leftovers cards from your discard pile", (c) => baseName(c.name) === "Leftovers", 2, "hand"),
  "Puppet Offering": {
    canPlay: (state, seat) => (me(state, seat).discard.some(isSupporter) ? null : "There's no Supporter in your discard pile."),
    play(state, seat, card) {
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose a Supporter card from your discard pile",
        zone: "discard",
        options: p.discard.filter(isSupporter).map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
        data: src(card),
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      const got = pull(p.discard, picks);
      p.hand.push(...got);
      log(state, seat, `${p.name} put ${names(got)} into their hand.`);
      if (got.length) discardSelf(state, seat, selfOf(state, seat, data.src), true);
    },
    worth: () => false,
  },

  // --- Putting Pokémon into play ---
  "Tandem Unit": {
    canPlay: (state, seat) => (me(state, seat).bench.length < benchLimit(state, seat) ? null : "Your Bench is full."),
    play: (state, seat, card) =>
      search(
        state,
        seat,
        card.name,
        "Choose up to 2 Basic Lightning Pokémon for your Bench",
        (c) => isBasicPokemon(c) && ofType(c, "Lightning"),
        Math.min(2, benchLimit(state, seat) - me(state, seat).bench.length),
      ),
    resume: (state, seat, picks) => toBench(state, seat, { name: "Tandem Unit" } as PCard, picks),
  },
  "Summoning Star": {
    limit: "vstar",
    canPlay: (state, seat) => (me(state, seat).bench.length < benchLimit(state, seat) ? null : "Your Bench is full."),
    play(state, seat, card) {
      const p = me(state, seat);
      const options = p.discard.filter((c) => isPokemon(c) && ofType(c, "Colorless") && !hasRuleBox(c) && isBasicPokemon(c)).map((c) => c.uid);
      if (!options.length) return log(state, seat, "There are no Pokémon in the discard pile for Summoning Star.");
      ask(state, {
        seat,
        title: "Choose up to 2 Colorless Pokémon from your discard pile for your Bench",
        zone: "discard",
        options,
        min: 0,
        max: Math.min(2, benchLimit(state, seat) - p.bench.length),
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const p = me(state, seat);
      for (const c of pull(p.discard, picks)) benchPokemon(state, seat, c);
      log(state, seat, `${p.name} put ${plural(picks.length, "Pokémon")} onto their Bench from the discard pile.`);
    },
  },
  "Gentle Fin": {
    where: "active",
    canPlay: (state, seat) =>
      me(state, seat).bench.length >= benchLimit(state, seat)
        ? "Your Bench is full."
        : me(state, seat).discard.some((c) => isBasicPokemon(c) && (c.hp ?? 0) <= 70)
          ? null
          : "There's no Basic Pokémon with 70 HP or less in your discard pile.",
    play: (state, seat, card) => reviveBasic(state, seat, card.name, (c) => (c.hp ?? 0) <= 70),
    resume: reviveResume,
  },
  "Emergency Surfacing": toBenchFrom("discard", (state, seat) => drawCards(3).play(state, seat, {} as PCard)),
  "Reviving Flame": {
    ...toBenchFrom("discard", (state, seat, slot, card) => revivingFlame().play(state, seat, { ...card, uid: topCard(slot).uid })),
    resume: (state, seat, picks, data) => revivingFlame().resume!(state, seat, picks, data),
  },
  "Netherworld Gate": toBenchFrom("discard", (state, seat, slot) => {
    slot.damage += 30;
    log(state, seat, `Netherworld Gate put 3 damage counters on ${topCard(slot).name}.`);
  }),
  "Swelling Flash": toBenchFrom("hand"),
  "Emergency Rotation": toBenchFrom("hand"),
  "Transformative Start": {
    where: "active",
    limit: "first",
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play: (state, seat, card) =>
      search(
        state,
        seat,
        card.name,
        "Choose a Basic Pokémon (not Ditto) to take Ditto's place",
        (c) => isBasicPokemon(c) && baseName(c.name) !== "Ditto",
        1,
        src(card),
      ),
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      const self = selfOf(state, seat, data.src);
      const [c] = pull(p.deck, picks);
      shuffle(p.deck);
      if (!c || !self) return;
      p.discard.push(...self.pokemon, ...attachedTo(self));
      self.pokemon = [c];
      self.energy = [];
      takeTools(self);
      self.damage = 0;
      self.conditions = [];
      self.effects = {};
      log(state, seat, `Ditto transformed into ${c.name}.`);
    },
  },
  "Emergency Evolution": {
    canPlay: (state, seat, card) => {
      const self = selfOf(state, seat, card.uid);
      if (!self || hpLeft(state, self) > 30) return "This Pokémon needs 30 HP or less left.";
      return me(state, seat).deck.length ? null : "Your deck is empty.";
    },
    play: (state, seat, card) =>
      search(
        state,
        seat,
        card.name,
        "Choose Unfezant or Unfezant ex to evolve into",
        (c) => ["Unfezant", "Unfezant ex"].includes(baseName(c.name)),
        1,
        src(card),
      ),
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      const self = selfOf(state, seat, data.src);
      const [c] = pull(p.deck, picks);
      shuffle(p.deck);
      if (c && self) {
        evolveSlot(state, self, c);
        log(state, seat, `Pidove evolved into ${c.name}.`);
      }
    },
  },
  "Spiteful Evolution": {
    canPlay: (state, seat, card) => {
      if (state.turn <= 2) return "You can't use this during your first turn.";
      const self = selfOf(state, seat, card.uid);
      return self && me(state, seat).hand.some((c) => c.evolvesFrom === topCard(self).name)
        ? null
        : "You have no card in your hand that evolves from this Pokémon.";
    },
    play(state, seat, card) {
      const self = selfOf(state, seat, card.uid)!;
      const p = me(state, seat);
      ask(state, {
        seat,
        title: "Choose a card to evolve into",
        zone: "hand",
        options: p.hand.filter((c) => c.evolvesFrom === topCard(self).name).map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
        data: src(card),
      });
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      const self = selfOf(state, seat, data.src);
      const [c] = pull(p.hand, picks);
      if (!c || !self) return;
      evolveSlot(state, self, c);
      self.damage += 20;
      log(state, seat, `${p.name} evolved into ${c.name} with Spiteful Evolution, which put 2 damage counters on it.`);
    },
  },

  // --- Switching ---
  "Excited Dash": only(comeIn(), (state, seat) => inPlay(me(state, seat)).some((s) => isMegaEx(topCard(s))), "You need a Mega Evolution Pokémon ex in play."),
  Showtime: { ...comeIn(), worth: () => false },
  "Flustered Leap": {
    where: "bench",
    canPlay: (state, seat) => (me(state, seat).deck.length ? null : "Your deck is empty."),
    play(state, seat, card) {
      const p = me(state, seat);
      const self = selfOf(state, seat, card.uid);
      if (!self) return;
      p.discard.push(...p.deck.splice(p.deck.length - 1, 1));
      p.discard.push(...attachedTo(self));
      p.bench.splice(p.bench.indexOf(self), 1);
      p.deck.unshift(...self.pokemon.reverse());
      log(state, seat, `${p.name} discarded the bottom card of their deck and put ${topCard(self).name} on top of it.`);
    },
    worth: () => false,
  },
  "Vanishing Wings": { where: "bench", play: (state, seat, card) => shuffleSelfIn(state, seat, selfOf(state, seat, card.uid)), worth: () => false },
  Teleporter: {
    where: "active",
    canPlay: (state, seat) => (me(state, seat).bench.length ? null : "You'd have no Pokémon left in play."),
    play: (state, seat, card) => shuffleSelfIn(state, seat, selfOf(state, seat, card.uid)),
    worth: () => false,
  },
  "Hyper Blower": { ...switchOutOpp((state, seat, card) => discardSelf(state, seat, selfOf(state, seat, card.uid))), where: "bench", worth: () => false },
  "Big Roar": { ...switchOutOpp(), where: "active" },
  "Intimidating Howl": switchOutOpp(),
  "Night Gate": { ...switchMine(), worth: () => false },
  "Sky Transport": { ...switchMine(), worth: () => false },
  "Torrential Whirlpool": {
    ...switchMine(undefined, (state, seat) => {
      if (them(state, seat).bench.length) switchOutOpp().play(state, seat, { name: "Torrential Whirlpool" } as PCard);
    }),
    worth: () => false,
  },
  "Total Freedom": {
    canPlay: (state, seat) => (me(state, seat).bench.length ? null : "You have no Benched Pokémon."),
    play(state, seat, card) {
      const p = me(state, seat);
      const self = selfOf(state, seat, card.uid);
      if (self && p.active !== self) return comeIn().play(state, seat, card);
      switchMine().play(state, seat, card);
    },
    resume: (state, seat, picks, data) => switchMine().resume!(state, seat, picks, data),
    worth: () => false,
  },
  "Subjugating Chains": {
    ...switchMine(
      (s) => ofType(topCard(s), "Darkness") && baseName(topCard(s).name) !== "Pecharunt ex",
      (state, seat, incoming) => {
        setCondition(state, incoming, "poisoned");
        log(state, seat, `${topCard(incoming).name} is now Poisoned.`);
      },
    ),
    limit: "name",
    worth: () => false,
  },
  "Star Rondo": {
    ...comeIn((state, seat) => {
      if (them(state, seat).bench.length) gustOpp().play(state, seat, { name: "Star Rondo" } as PCard);
    }),
    resume: (state, seat, picks) => resumeGust(state, seat, picks),
    limit: "vstar",
    worth: () => false,
  },
  "Ivy Star": { ...gustOpp(), limit: "vstar", worth: (state, seat) => them(state, seat).bench.some((s) => hpLeft(state, s) <= 100) },
  "Loopy Lasso": {
    ...gustOpp(undefined, (state, seat, incoming) => {
      setCondition(state, incoming, "asleep");
      setCondition(state, incoming, "poisoned");
      log(state, seat, `${topCard(incoming).name} is now Asleep and Poisoned.`);
    }),
    play(state, seat, card) {
      if (coin(state, seat, card.name)) gustOpp().play(state, seat, card);
    },
  },
  "Captivating Invitation": {
    ...gustOpp(undefined, (state, seat, incoming) => {
      setCondition(state, incoming, "confused");
      log(state, seat, `${topCard(incoming).name} is now Confused.`);
    }),
    play(state, seat, card) {
      if (coin(state, seat, card.name)) gustOpp().play(state, seat, card);
    },
  },
  "Beckoning Tail": { ...paying((c) => baseName(c.name) === "Chill Teaser Toy", 1, "a Chill Teaser Toy card", gustOpp()), worth: () => false },
  "Star Guardian": {
    ...gustOpp(),
    limit: "vstar",
    canPlay: (state, seat) =>
      them(state, seat).prizes.length !== 1
        ? "Your opponent needs exactly 1 Prize card left."
        : them(state, seat).bench.length
          ? null
          : "Your opponent has no Benched Pokémon.",
    play(state, seat, card) {
      const opp = them(state, seat);
      ask(state, {
        seat,
        title: `Choose 1 of ${opp.name}'s Benched Pokémon for them to discard`,
        zone: "oppBench",
        options: benchSlots(opp),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const opp = them(state, seat);
      const slot = opp.bench[benchIndex(picks[0])];
      if (!slot) return;
      opp.bench.splice(opp.bench.indexOf(slot), 1);
      opp.discard.push(...slot.pokemon, ...attachedTo(slot));
      log(state, seat, `${opp.name} discarded ${topCard(slot).name} and its attached cards.`);
    },
  },

  // --- Healing ---
  "Fermented Juice": only(healAt(30), (_s, _p, self) => !!self?.energy.some(energyOf("Grass")), "This Pokémon needs Grass Energy attached."),
  "Tranquil Flower": { ...healAt(60), where: "active" },
  "Excited Heal": only(
    healAt(60),
    (state, seat) => inPlay(me(state, seat)).some((s) => isMegaEx(topCard(s)) && ofType(topCard(s), "Grass")),
    "You need a Grass Mega Evolution Pokémon ex in play.",
  ),
  "Confectionary Gift": healAt(30),
  "Magma Gain": only(healSelf(50), (state) => !!state.stadium, "You need a Stadium in play."),
  "Humming Heal": healAll(20, () => true),
  "Elegant Heal": healAll(20, () => true),
  "Healing Leaves": healActiveBy(20),
  "Ardent Dancing": only(
    healActiveBy(20),
    (state, seat) => !!me(state, seat).active && isEvolution(topCard(me(state, seat).active!)),
    "Your Active Pokémon isn't an Evolution Pokémon.",
  ),
  "Star Bloom": { ...healAll(120, (s) => ofType(topCard(s), "Grass")), limit: "vstar" },
  "Moisture Star": { ...healSelf(999), limit: "vstar", worth: (_state, _seat, self) => !!self && self.damage >= 100 },

  // --- Other ---
  "Ancient Wing": {
    where: "active",
    canPlay: (state, seat) => (inPlay(them(state, seat)).some((s) => s.pokemon.length > 1) ? null : "Your opponent has no evolved Pokémon."),
    play(state, seat, card) {
      const opp = them(state, seat);
      ask(state, {
        seat,
        title: `Choose 1 of ${opp.name}'s evolved Pokémon to devolve`,
        zone: "oppPokemon",
        options: slotKeys(opp).filter((k) => slotAt(opp, k)!.pokemon.length > 1 && !abilityProof(state, seat, slotAt(opp, k)!)),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const slot = slotAt(them(state, seat), picks[0] as SlotKey);
      if (slot) devolve(state, otherSeat(seat), slot, 1);
    },
  },
  "Destructive Headbutting": {
    where: "active",
    play(state, seat, card) {
      const target = them(state, seat).active;
      if (!coin(state, seat, card.name) || !target?.energy.length || abilityProof(state, seat, target)) return;
      const [e] = target.energy.splice(target.energy.length - 1, 1);
      them(state, seat).discard.push(e);
      log(state, seat, `${e.name} was discarded from ${topCard(target).name}.`);
    },
  },
  "Boisterous Wind": {
    play(state, seat, card) {
      const target = them(state, seat).active;
      if (!coin(state, seat, card.name) || !target?.energy.length || abilityProof(state, seat, target)) return;
      const [e] = target.energy.splice(target.energy.length - 1, 1);
      them(state, seat).hand.push(e);
      log(state, seat, `${e.name} went from ${topCard(target).name} back to ${them(state, seat).name}'s hand.`);
    },
  },
  "Look for Prey": {
    canPlay: (state, seat) => (them(state, seat).bench.length < benchLimit(state, otherSeat(seat)) ? null : "Your opponent's Bench is full."),
    play(state, seat, card) {
      const opp = them(state, seat);
      revealHand(state, seat);
      const options = opp.hand.filter((c) => isBasicPokemon(c) && (c.hp ?? 0) <= 70).map((c) => c.uid);
      if (!options.length) return show(state, seat, "Your opponent's hand (no Basic Pokémon with 70 HP or less)", "oppHand", opp.hand);
      ask(state, {
        seat,
        title: "Choose a Basic Pokémon from your opponent's hand to put onto their Bench",
        zone: "oppHand",
        options,
        shown: opp.hand.map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const opp = them(state, seat);
      const [c] = pull(opp.hand, picks);
      if (c) benchPokemon(state, otherSeat(seat), c);
      if (c) log(state, seat, `${c.name} was put onto ${opp.name}'s Bench.`);
    },
  },
  "Incendiary Song": paying(basic("Fire"), 1, "a Basic Fire Energy card", {
    play(state, seat, card) {
      addEffect(state, { kind: "damageUp", seat, turn: state.turn, amount: 60, source: card.name });
      log(state, seat, `${card.name}: ${me(state, seat).name}'s attacks do 60 more damage this turn.`);
    },
    worth: (state, seat) => !!me(state, seat).active && me(state, seat).active!.energy.length > 0,
  }),
  "Heat Boost": paying(energyOf("Fire"), 1, "a Fire Energy card", {
    play(state, seat, card) {
      addEffect(state, { kind: "damageUp", seat, turn: state.turn, amount: 30, type: "Fire", source: card.name });
      log(state, seat, `${card.name}: ${me(state, seat).name}'s Fire Pokémon do 30 more damage this turn.`);
    },
    worth: () => false,
  }),
  "Shield Star": {
    limit: "vstar",
    play(state, seat, card) {
      addEffect(state, { kind: "damageDown", seat, turn: state.turn + 1, amount: 100, source: card.name });
      log(state, seat, `${card.name}: during ${them(state, seat).name}'s next turn, ${me(state, seat).name}'s Pokémon take 100 less damage.`);
    },
    worth: (state, seat) => them(state, seat).prizes.length <= 3,
  },
  "Star Portal": {
    ...attachMany({ from: "discard", energy: energyOf("Water"), max: 3, target: (_s, _p, slot) => ofType(topCard(slot), "Water") }),
    limit: "vstar",
    worth: (state, seat) => me(state, seat).discard.filter(energyOf("Water")).length >= 2,
  },
});

const revivingFlame = () => attachMany({ from: "discard", energy: isBasicEnergy, max: 4, target: isSelf, after: "endTurn" });

// Put here so the table above reads in order.
function discardHandDraw(state: PState, seat: Seat, n: number) {
  const p = me(state, seat);
  p.discard.push(...p.hand.splice(0));
  draw(p, n);
  log(state, seat, `${p.name} discarded their hand and drew ${plural(n, "card")}.`);
}
function bothDraw(): Use {
  return {
    play(state, seat) {
      for (const s of [seat, otherSeat(seat)]) draw(state.players[s], 1);
      log(state, seat, "Each player drew a card.");
    },
  };
}
/** Flower Selecting puts the card it doesn't take in the Lost Zone rather than the discard pile. */
function lostRest(): Partial<Use> {
  return {
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      const top = (data.top as string[]) ?? [];
      const taken = pull(p.deck, picks);
      p.hand.push(...taken);
      const rest = pull(
        p.deck,
        top.filter((u) => !picks.includes(u)),
      );
      (p.lost ??= []).push(...rest);
      log(state, seat, `${p.name} took ${names(taken)} and put ${names(rest)} in the Lost Zone.`);
    },
  };
}
function reviveResume(state: PState, seat: Seat, picks: string[]) {
  const p = me(state, seat);
  const [c] = pull(p.discard, picks);
  if (!c) return;
  benchPokemon(state, seat, c);
  log(state, seat, `${p.name} put ${c.name} onto their Bench from the discard pile.`);
}

// ----- Abilities that go off when something happens -----

export type Trigger = {
  /** evolve: played from the hand to evolve; bench: played from the hand onto the Bench; toActive / toBench: moved during your turn. */
  on: "evolve" | "bench" | "toActive" | "toBench";
  use: Use;
  /** "You must": no choice. */
  must?: boolean;
  /** Only once per turn ("Once during your turn, when..."). */
  once?: boolean;
};

let builtTriggers: Record<string, Trigger> | null = null;
export const abilityTriggers = () => (builtTriggers ??= buildTriggers());

const evolve = (use: Use, extra: Partial<Trigger> = {}): Trigger => ({ on: "evolve", use, ...extra });
const bench = (use: Use): Trigger => ({ on: "bench", use });
const toActive = (use: Use): Trigger => ({ on: "toActive", use, once: true });

const buildTriggers = (): Record<string, Trigger> => ({
  // Played from the hand to evolve.
  "Resonant Evolution": evolve(
    {
      canPlay: (state, seat) => (inPlay(me(state, seat)).some((s) => baseName(topCard(s).name) === "Eevee") ? null : "You have no Eevee."),
      play(state, seat, card) {
        const p = me(state, seat);
        const eevee = slotKeys(p).filter((k) => topCard(slotAt(p, k)!).name === "Eevee" && topCard(slotAt(p, k)!).uid !== card.uid);
        if (!eevee.length) return;
        search(state, seat, card.name, "Choose a card that evolves from Eevee", (c) => c.evolvesFrom === "Eevee", 1, { step: "find", key: eevee[0] });
      },
      resume(state, seat, picks, data) {
        const p = me(state, seat);
        const [c] = pull(p.deck, picks);
        shuffle(p.deck);
        const slot = slotAt(p, data.key as SlotKey);
        if (c && slot) {
          evolveSlot(state, slot, c);
          log(state, seat, `Eevee evolved into ${c.name}.`);
        }
      },
    },
    { once: true },
  ),
  "Jewel Seeker": evolve(
    only(
      find("Choose up to 2 Trainer cards", (c) => c.supertype === "Trainer", 2),
      (state, seat) => inPlay(me(state, seat)).some((s) => isTera(topCard(s))),
      "You need a Tera Pokémon in play.",
    ),
    { once: true },
  ),
  "Psychic Draw": evolve(drawN(2), { once: true }),
  Lifeboat: evolve(
    {
      play(state, seat, card) {
        reviveBasic(state, otherSeat(seat), card.name, () => true);
        if (state.prompt?.seat === otherSeat(seat)) state.prompt.data = { step: "revive" };
        reviveBasic(state, seat, card.name, () => true);
      },
      resume: reviveResume,
    },
    { once: true },
  ),
  "Haphazard Hammer": evolve(abilityUses()["Destructive Headbutting"], { once: true }),
  "Enriching Melody": evolve(healAt(999), { once: true }),
  "Energized Steps": evolve(attachFromTop(4, isBasicEnergy, "shuffle"), { once: true }),
  "Prison Panic": evolve(inflict(["confused"]), { once: true }),
  "Cast-Off Shell": evolve(
    {
      canPlay: (state, seat) => (me(state, seat).bench.length < benchLimit(state, seat) ? null : "Your Bench is full."),
      play: (state, seat, card) => search(state, seat, card.name, "Choose Shedinja for your Bench", (c) => baseName(c.name) === "Shedinja", 1),
      resume: (state, seat, picks) => toBench(state, seat, { name: "Cast-Off Shell" } as PCard, picks),
    },
    { once: true },
  ),
  "Multiplying Cocoon": evolve(
    {
      canPlay: (state, seat) => (me(state, seat).bench.length < benchLimit(state, seat) ? null : "Your Bench is full."),
      play: (state, seat, card) =>
        search(state, seat, card.name, "Choose Silcoon or Cascoon for your Bench", (c) => ["Silcoon", "Cascoon"].includes(baseName(c.name)), 1),
      resume: (state, seat, picks) => toBench(state, seat, { name: "Multiplying Cocoon" } as PCard, picks),
    },
    { once: true },
  ),
  "Heave-Ho Catcher": evolve(gustOpp(), { once: true }),
  "Sandy Flapping": evolve(millOpp(2), { once: true }),
  "Assemble Alloy": evolve(attachMany({ from: "discard", energy: basic("Metal"), max: 2, target: (_s, _p, slot) => ofType(topCard(slot), "Metal") })),
  "Spike-Clad": evolve(attachMany({ from: "discard", energy: (c) => baseName(c.name) === "Spiky Energy", max: 2, target: isSelf })),
  "Jamming Attachment": evolve({
    canPlay: (state, seat) => (them(state, seat).discard.some(isEnergy) ? null : "Your opponent has no Energy in their discard pile."),
    play(state, seat, card) {
      const opp = them(state, seat);
      ask(state, {
        seat,
        title: "Choose up to 3 Energy cards from your opponent's discard pile to attach to their Pokémon",
        zone: "oppDiscard",
        options: opp.discard.filter(isEnergy).map((c) => c.uid),
        min: 0,
        max: 3,
        effect: card.name,
        data: { step: "pick" },
      });
    },
    resume(state, seat, picks, data) {
      const opp = them(state, seat);
      const left = data.step === "pick" ? picks : (data.left as string[]);
      if (data.step === "place") {
        const slot = slotAt(opp, picks[0] as SlotKey);
        const [e] = pull(opp.discard, [left[0]]);
        if (slot && e) {
          slot.energy.push(e);
          log(state, seat, `${e.name} was attached to ${opp.name}'s ${topCard(slot).name}.`);
        }
        left.shift();
      }
      if (!left.length) return;
      const e = opp.discard.find((c) => c.uid === left[0]);
      ask(state, {
        seat,
        title: `Choose 1 of ${opp.name}'s Pokémon to attach ${e?.name ?? "the Energy"} to`,
        zone: "oppPokemon",
        options: slotKeys(opp),
        min: 1,
        max: 1,
        effect: "Jamming Attachment",
        data: { step: "place", left },
      });
    },
    worth: () => false,
  }),
  Hearsay: evolve({
    play(state, seat, card) {
      askChoice(
        state,
        seat,
        "Hearsay: choose 1",
        [
          { id: "discard", label: "A Supporter from your discard pile" },
          { id: "deck", label: "A Supporter from your deck" },
        ],
        card.name,
        { data: { step: "which" } },
      );
    },
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      if (data.step === "which") {
        if (picks[0] === "discard") {
          const options = p.discard.filter(isSupporter).map((c) => c.uid);
          if (options.length)
            ask(state, { seat, title: "Choose a Supporter card", zone: "discard", options, min: 1, max: 1, effect: "Hearsay", data: { step: "fromDiscard" } });
          return;
        }
        return search(state, seat, "Hearsay", "Choose a Supporter card", isSupporter, 1, { step: "fromDeck" });
      }
      const zone = data.step === "fromDiscard" ? p.discard : p.deck;
      const got = pull(zone, picks);
      p.hand.push(...got);
      if (data.step === "fromDeck") shuffle(p.deck);
      log(state, seat, `${p.name} put ${names(got)} into their hand.`);
    },
  }),
  "Biting Spree": evolve({
    play(state, seat, card) {
      const opp = them(state, seat);
      const options = slotKeys(opp).filter((k) => !abilityProof(state, seat, slotAt(opp, k)!));
      if (!options.length) return;
      ask(state, {
        seat,
        title: "Choose 2 of your opponent's Pokémon to put 2 damage counters on each",
        zone: "oppPokemon",
        options,
        min: Math.min(2, options.length),
        max: 2,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const opp = them(state, seat);
      for (const k of picks) {
        const slot = slotAt(opp, k as SlotKey);
        if (slot) putCounters(state, seat, slot, 2);
      }
      log(state, seat, `Biting Spree put 2 damage counters on ${plural(picks.length, "Pokémon")}.`);
    },
  }),
  "Bully of the Sands": evolve(discardRandomOpp(1)),
  "Mountain Roasting": evolve(millOpp(3)),
  "Suction Cup Draw": evolve(drawN(3)),
  "Wicked Tail": evolve({
    play(state, seat, card) {
      const opp = them(state, seat);
      let heads = 0;
      for (let i = 0; i < 2; i++) if (flip()) heads++;
      log(state, seat, `${card.name}: ${plural(heads, "heads")}.`, "coin");
      const back: PCard[] = [];
      for (let i = 0; i < heads && opp.hand.length; i++) back.push(...opp.hand.splice(Math.floor(Math.random() * opp.hand.length), 1));
      opp.deck.push(...back);
      shuffle(opp.deck);
      if (back.length) log(state, seat, `${opp.name} revealed ${names(back)} and shuffled them into their deck.`);
    },
  }),
  "Ad Hoc Shock": evolve({
    play(state, seat, card) {
      if (coin(state, seat, card.name)) inflict(["paralyzed"]).play(state, seat, card);
    },
  }),
  "Inviting Wink": evolve({
    play(state, seat, card) {
      const opp = them(state, seat);
      revealHand(state, seat);
      const room = benchLimit(state, otherSeat(seat)) - opp.bench.length;
      const options = opp.hand.filter(isBasicPokemon).map((c) => c.uid);
      if (!options.length || room <= 0) return show(state, seat, "Your opponent's hand", "oppHand", opp.hand);
      ask(state, {
        seat,
        title: "Choose any Basic Pokémon from your opponent's hand to put onto their Bench",
        zone: "oppHand",
        options,
        shown: opp.hand.map((c) => c.uid),
        min: 0,
        max: Math.min(room, options.length),
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const opp = them(state, seat);
      for (const c of pull(opp.hand, picks)) benchPokemon(state, otherSeat(seat), c);
      if (picks.length) log(state, seat, `${plural(picks.length, "Basic Pokémon")} went onto ${opp.name}'s Bench.`);
    },
  }),
  "Rob-'n'-Run": evolve({
    play(state, seat, card) {
      const opp = them(state, seat);
      revealHand(state, seat);
      const options = opp.hand.filter(isEnergy).map((c) => c.uid);
      if (!options.length) return show(state, seat, "Your opponent's hand", "oppHand", opp.hand);
      ask(state, {
        seat,
        title: "Choose 2 Energy cards to shuffle into your opponent's deck",
        zone: "oppHand",
        options,
        shown: opp.hand.map((c) => c.uid),
        min: Math.min(2, options.length),
        max: 2,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const opp = them(state, seat);
      opp.deck.push(...pull(opp.hand, picks));
      shuffle(opp.deck);
      log(state, seat, `${opp.name} shuffled ${plural(picks.length, "Energy card")} from their hand into their deck.`);
    },
  }),
  "Voice of Happiness": evolve(healActiveBy(30)),
  "Shine of Happiness": evolve(healActiveBy(90)),
  "Enriching Oil": evolve(healAt(999)),
  "Time to Chow Down": evolve({
    canPlay: (state) => (noHealing(state) ? "Pokémon can't be healed right now." : null),
    play(state, seat) {
      for (const s of inPlay(me(state, seat))) {
        if (!isEvolution(topCard(s)) || !s.damage) continue;
        heal(s, 999);
        me(state, seat).discard.push(...s.energy.splice(0));
        log(state, seat, `${topCard(s).name} was healed and discarded its Energy.`);
      }
    },
    worth: () => false,
  }),
  "Wafting Heal": evolve({
    canPlay: (state, seat) => {
      const a = me(state, seat).active;
      return a && a.damage && ofType(topCard(a), "Grass") && !noHealing(state) ? null : "Your Active Grass Pokémon has no damage.";
    },
    play(state, seat) {
      const a = me(state, seat).active!;
      heal(a, 999);
      me(state, seat).discard.push(...a.energy.splice(0));
      log(state, seat, `${topCard(a).name} was healed and discarded its Energy.`);
    },
    worth: (state, seat) => (me(state, seat).active?.damage ?? 0) >= 100,
  }),
  "Semi-Blooming Energy": evolve(attachFromTop(3, isBasicEnergy, "shuffle")),
  "Fully Blooming Energy": evolve(attachFromTop(8, isBasicEnergy, "shuffle")),
  "Lethargy Spores": evolve({ ...inflict(["asleep", "poisoned"], true), worth: () => false }),
  "Here for Hypnosis": evolve(inflict(["asleep"])),
  "Magical Flick": evolve({
    canPlay: (state, seat) => (them(state, seat).active?.energy.length && them(state, seat).bench.length ? null : "There's no Energy to move."),
    play(state, seat, card) {
      const opp = them(state, seat);
      if (opp.active && abilityProof(state, seat, opp.active)) return;
      ask(state, {
        seat,
        title: `Choose 1 of ${opp.name}'s Benched Pokémon to move an Energy to`,
        zone: "oppBench",
        options: benchSlots(opp),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const opp = them(state, seat);
      const to = opp.bench[benchIndex(picks[0])];
      const from = opp.active;
      if (!to || !from?.energy.length) return;
      const e = from.energy.pop()!;
      to.energy.push(e);
      log(state, seat, `${e.name} moved from ${topCard(from).name} to ${topCard(to).name}.`);
    },
  }),
  Stance: evolve(protectSelf()),
  "Sonic Slip": evolve(protectSelf()),
  "Sneaky Bite": evolve(counters(2)),
  "Spirit Return": evolve({
    canPlay: (state, seat) => (them(state, seat).discard.some(isSupporter) ? null : "Your opponent has no Supporter in their discard pile."),
    play(state, seat, card) {
      const opp = them(state, seat);
      ask(state, {
        seat,
        title: "Choose a Supporter card from your opponent's discard pile to put into their hand",
        zone: "oppDiscard",
        options: opp.discard.filter(isSupporter).map((c) => c.uid),
        min: 1,
        max: 1,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const opp = them(state, seat);
      const got = pull(opp.discard, picks);
      opp.hand.push(...got);
      log(state, seat, `${names(got)} went back into ${opp.name}'s hand.`);
    },
    worth: () => false,
  }),
  "Greedy Order": evolve(recover("Choose up to 2 Arven's Sandwich cards", (c) => baseName(c.name) === "Arven's Sandwich", 2, "hand")),
  "Inviting Ears": evolve(find("Choose up to 2 Supporter cards", isSupporter, 2)),
  "Infernal Reign": evolve(attachMany({ from: "deck", energy: basic("Fire"), max: 3, target: any })),
  "Suddenly Select": evolve(find("Choose up to 3 Pokémon Tool cards", isTool, 3)),
  "Triple Gears": evolve(attachMany({ from: "deck", energy: isBasicEnergy, max: 3, target: any })),
  "Punk Up": evolve(attachMany({ from: "deck", energy: basic("Darkness"), max: 5, target: (_s, _p, slot) => trainersPokemon(topCard(slot), "Marnie") })),
  "Glittering Star Pattern": evolve(gustOpp((state, slot) => hpLeft(state, slot) <= 90)),
  "Defiant Horn": evolve(gustOpp()),
  "Untamed One": evolve(millSelf(5), { must: true }),

  // Played from the hand onto the Bench.
  "Battle-Hardened": bench(attachMany({ from: "hand", energy: basic("Fighting"), max: 2, target: isSelf })),
  "Flying Entry": bench({
    canPlay: (state, seat) => (them(state, seat).bench.length ? null : "Your opponent has no Benched Pokémon."),
    play(state, seat, card) {
      const opp = them(state, seat);
      const options = benchSlots(opp).filter((k) => !abilityProof(state, seat, opp.bench[benchIndex(k)]));
      if (!options.length) return;
      ask(state, {
        seat,
        title: "Choose 2 of your opponent's Benched Pokémon to put 1 damage counter on each",
        zone: "oppBench",
        options,
        min: Math.min(2, options.length),
        max: 2,
        effect: card.name,
      });
    },
    resume(state, seat, picks) {
      const opp = them(state, seat);
      for (const k of picks) putCounters(state, seat, opp.bench[benchIndex(k)], 1);
      log(state, seat, `Flying Entry put 1 damage counter on ${plural(picks.length, "Pokémon")}.`);
    },
  }),
  "Special Eater": bench({
    canPlay: (state, seat) => (them(state, seat).active?.energy.some(isSpecialEnergy) ? null : "Your opponent's Active Pokémon has no Special Energy."),
    play(state, seat, card) {
      const target = them(state, seat).active!;
      if (abilityProof(state, seat, target)) return;
      const e = target.energy.find(isSpecialEnergy)!;
      target.energy.splice(target.energy.indexOf(e), 1);
      them(state, seat).discard.push(e);
      log(state, seat, `${card.name} discarded ${e.name} from ${topCard(target).name}.`);
    },
  }),
  "Snow Sink": bench({
    canPlay: (state) => (state.stadium ? null : "There's no Stadium in play."),
    play(state, seat, card) {
      if (!state.stadium) return;
      state.players[state.stadium.owner].discard.push(state.stadium.card);
      log(state, seat, `${card.name} discarded ${state.stadium.card.name}.`);
      state.stadium = null;
    },
    worth: (state, seat) => state.stadium?.owner !== seat,
  }),
  "Sudden Shearing": bench(millOpp(1)),
  "Touch of Happiness": bench(healActiveBy(10)),
  "Obliging Heal": bench({
    ...healActiveBy(30),
    canPlay: (state, seat) =>
      me(state, seat).active && (me(state, seat).active!.damage || me(state, seat).active!.conditions.length) ? null : "Your Active Pokémon is fine.",
    play(state, seat, card) {
      const a = me(state, seat).active!;
      if (!noHealing(state)) heal(a, 30);
      a.conditions = a.conditions.slice(1);
      log(state, seat, `${card.name} healed ${topCard(a).name}.`);
    },
  }),
  "Impromptu Carrier": bench({
    canPlay: (state, seat, card) => {
      const self = selfOf(state, seat, card.uid);
      return self && !toolRoom(state, self) ? "This Pokémon already has a Tool." : null;
    },
    play: (state, seat, card) => search(state, seat, card.name, "Choose a Pokémon Tool to attach", isTool, 1, src(card)),
    resume(state, seat, picks, data) {
      const p = me(state, seat);
      const self = selfOf(state, seat, data.src);
      const [t] = pull(p.deck, picks);
      shuffle(p.deck);
      if (!t) return;
      if (self && toolRoom(state, self)) {
        addTool(self, t);
        log(state, seat, `${p.name} attached ${t.name} to ${topCard(self).name}.`);
      } else p.hand.push(t);
    },
  }),
  "Luminous Sign": bench(find("Choose a Supporter card", isSupporter, 1)),
  "Climactic Gate": bench({
    canPlay: (state, seat) => (me(state, seat).bench.length < benchLimit(state, seat) ? null : "Your Bench is full."),
    play: (state, seat, card) =>
      search(
        state,
        seat,
        card.name,
        "Choose up to 2 Pokémon VMAX for your Bench",
        (c) => c.subtypes.includes("VMAX"),
        Math.min(2, benchLimit(state, seat) - me(state, seat).bench.length),
      ),
    resume(state, seat, picks) {
      const p = me(state, seat);
      for (const c of pull(p.deck, picks)) benchPokemon(state, seat, c);
      shuffle(p.deck);
      log(state, seat, `${p.name} put ${plural(picks.length, "Pokémon")} onto their Bench.`);
      endTurnNow(state, seat, "Climactic Gate");
    },
    worth: () => false,
  }),
  "Dig Dig Dig": bench({
    play: (state, seat, card) => search(state, seat, card.name, "Choose up to 3 Basic Fighting Energy cards to discard", basic("Fighting"), 3),
    resume(state, seat, picks) {
      const p = me(state, seat);
      p.discard.push(...pull(p.deck, picks));
      shuffle(p.deck);
      log(state, seat, `${p.name} discarded ${plural(picks.length, "Energy card")} from their deck.`);
    },
  }),
  "Insta-Flock": bench(find("Choose up to 3 Flamigo", (c) => baseName(c.name) === "Flamigo", 3)),
  "Rapid Vernier": bench({
    canPlay: (state, seat) => (me(state, seat).active ? null : "You have no Active Pokémon."),
    play(state, seat, card) {
      const p = me(state, seat);
      const self = selfOf(state, seat, card.uid);
      if (!self || !p.bench.includes(self)) return;
      switchActive(p, p.bench.indexOf(self));
      log(state, seat, `${topCard(self).name} switched into the Active Spot.`);
      const mover = moveEnergy({ which: () => true, from: (_s, _p, slot, me_) => slot !== me_, to: isSelf, many: true, toSelf: true });
      if (!mover.canPlay!(state, seat, card)) mover.play(state, seat, card);
    },
    resume: (state, seat, picks, data) =>
      moveEnergy({ which: () => true, from: (_s, _p, slot, me_) => slot !== me_, to: isSelf, many: true, toSelf: true }).resume!(state, seat, picks, data),
    worth: (state, seat) => !!me(state, seat).active && state.turn > 1,
  }),
  "Sudden Cyclone": { on: "bench", use: { ...switchOutOpp(), worth: () => true } },

  // Moved from the Bench to the Active Spot (or back) during your turn.
  "Frontier Road": toActive(moveEnergy({ which: () => true, from: (_s, _p, slot, self) => slot !== self, to: isSelf, many: true, toSelf: true })),
  "Thermal Reactor": toActive(moveEnergy({ which: energyOf("Fire"), from: (_s, _p, slot, self) => slot !== self, to: isSelf, many: true, toSelf: true })),
  "Metal Road": toActive(moveEnergy({ which: energyOf("Metal"), from: (_s, _p, slot, self) => slot !== self, to: isSelf, many: true, toSelf: true })),
  "Tachyon Bits": toActive(counters(2)),
  "Buzzing Boost": toActive(attachMany({ from: "deck", energy: basic("Grass"), max: 3, target: isSelf })),
  "Assaulting Hunt": toActive(gustOpp((_state, slot) => isBasicPokemon(topCard(slot)))),
  "Fall Back to Reload": { on: "toBench", use: attachMany({ from: "hand", energy: basic("Water"), max: 2, target: isSelf }), once: true },
  "Zero to Hero": {
    on: "toBench",
    once: true,
    use: {
      canPlay: (state, seat) => (me(state, seat).deck.some((c) => baseName(c.name) === "Palafin ex") ? null : "There's no Palafin ex in your deck."),
      play(state, seat, card) {
        const p = me(state, seat);
        const self = selfOf(state, seat, card.uid);
        const hero = p.deck.find((c) => baseName(c.name) === "Palafin ex");
        if (!self || !hero) return void shuffle(p.deck);
        pull(p.deck, [hero.uid]);
        const old = self.pokemon.pop()!;
        self.pokemon.push(hero);
        p.deck.push(old);
        shuffle(p.deck);
        log(state, seat, `Zero to Hero: ${old.name} became ${hero.name}!`);
      },
    },
  },
});

/** Lustrous Assist goes off when a different Pokémon (Mega Latias ex) moves up, so it's checked separately. */
export const lustrousAssist = (): Use =>
  moveEnergy({ which: () => true, from: onBench, to: (state, seat, slot) => me(state, seat).active === slot, many: true });

function millOpp(n: number): Use {
  return {
    play(state, seat, card) {
      const opp = them(state, seat);
      const gone = opp.deck.splice(0, n);
      opp.discard.push(...gone);
      log(state, seat, `${card.name} discarded the top ${plural(gone.length, "card")} of ${opp.name}'s deck.`);
      discardedByOpponent(state, otherSeat(seat), gone, "deck");
    },
  };
}
function millSelf(n: number): Use {
  return {
    play(state, seat, card) {
      const p = me(state, seat);
      const gone = p.deck.splice(0, n);
      p.discard.push(...gone);
      log(state, seat, `${card.name}: ${p.name} discarded the top ${plural(gone.length, "card")} of their deck.`);
    },
  };
}
function discardRandomOpp(n: number): Use {
  return {
    canPlay: (state, seat) => (them(state, seat).hand.length ? null : "Your opponent has no cards in their hand."),
    play(state, seat, card) {
      const opp = them(state, seat);
      for (let i = 0; i < n && opp.hand.length; i++) {
        const [c] = opp.hand.splice(Math.floor(Math.random() * opp.hand.length), 1);
        opp.discard.push(c);
        log(state, seat, `${card.name} discarded ${c.name} from ${opp.name}'s hand.`);
        discardedByOpponent(state, otherSeat(seat), [c], "hand");
      }
    },
  };
}
function healSelf(amount: number): Use {
  return {
    canPlay: (state, seat, card) => (selfOf(state, seat, card.uid)?.damage && !noHealing(state) ? null : "This Pokémon has no damage."),
    play(state, seat, card) {
      const self = selfOf(state, seat, card.uid)!;
      const healed = heal(self, amount);
      log(state, seat, `${card.name} healed ${healed} damage from ${topCard(self).name}.`);
    },
  };
}
function healActiveBy(amount: number): Use {
  return {
    canPlay: (state, seat) => (me(state, seat).active?.damage && !noHealing(state) ? null : "Your Active Pokémon has no damage."),
    play(state, seat, card) {
      const a = me(state, seat).active!;
      const healed = heal(a, amount);
      log(state, seat, `${card.name} healed ${healed} damage from ${topCard(a).name}.`);
    },
  };
}
function protectSelf(): Use {
  return {
    play(state, seat, card) {
      const self = selfOf(state, seat, card.uid);
      if (!self) return;
      self.effects.protect = { turn: state.turn + 1, effects: true };
      log(state, seat, `${card.name}: ${topCard(self).name} is protected from attacks during ${them(state, seat).name}'s next turn.`);
    },
  };
}

/** Shapes the knock-out and damage triggers in abilities.ts reuse. */
export { attachMany, discardSelf, find, inflict };
