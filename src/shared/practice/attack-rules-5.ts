// Attack rules: see attack-rules.ts for how they work.
// Group 5: moving cards between zones (Energy to the hand or Lost Zone, the discard pile, deck
// searches, shuffling Pokémon away), "You may ..." choices and the opponent's revealed hand.

import { otherSeat, type Condition, type Seat } from "../game-types";
import type { AttackCtx, AttackRule, Resume } from "./attack-rules";
import {
  ENERGY_TYPES,
  ask,
  benchPokemon,
  draw,
  energyProvides,
  evolveSlot,
  isBasicEnergy,
  isBasicPokemon,
  isEnergy,
  isItem,
  isPokemon,
  isStadium,
  isSupporter,
  isTool,
  log,
  plural,
  shuffle,
  slotAt,
  slotKeys,
  topCard,
  win,
} from "./engine";
import { attachedTo, baseName, benchLimit, hitWithAttack, inPlay, setCondition } from "./effects";
import { ATTACK_RESUME, finalDamage, resolveAttack, toCount } from "./attacks";
import { discardedByOpponent, discardLocked, effectsProof, evolvedAbilities, pickUpLocked, prizesToLost, tookPrizes, trainersStayDiscarded } from "./abilities";
import { specialOnEvolve, unitIs } from "./special-energy";
import { names, pull, trainerFor, type TrainerEffect } from "./trainers";
import { askAttach, askOrder, chain, revealHand } from "./trainers-extra";
import { askChoice } from "./actions";
import { matchesFilter } from "./lasting";
import type { Attack, PCard, PPlayer, PSlot, PState, SlotKey } from "./types";

type Data = Record<string, unknown>;
type Match = (c: PCard) => boolean;
type Dest = "hand" | "lost" | "deck" | "discard";

const E = (name: string) => `atk:5:${name}`;
const benchKeys = (p: PPlayer) => p.bench.map((_, i) => `bench:${i}`);
const YES_NO = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
];
const typed = (type: string | undefined) => (type && ENERGY_TYPES.includes(type) ? type : null);
const provides = (c: PCard, type: string | null) => isEnergy(c) && (!type || energyProvides(c).some((u) => unitIs(u, type)));
const basicOf = (type: string | null) => (c: PCard) => isBasicEnergy(c) && (!type || c.name.includes(type));
/** "a Fire Energy card": a Basic Fire Energy, or a Special Energy that is a Fire Energy card. */
const energyCard = (type: string | null) => (c: PCard) => provides(c, type) && (!type || isBasicEnergy(c) || c.name.includes(type));
const upTo = (word: string) => toCount(word.replace(/^up to /i, ""));

/** Asks a Yes/No question. `yes` and `no` are actions for `run`. */
function may(state: PState, seat: Seat, title: string, yes: Data, no: Data = {}, botYes = true) {
  askChoice(state, seat, title, YES_NO, E("may"), { data: { yes, no, botPick: [botYes ? "yes" : "no"] } });
}

// ----- Energy leaving a Pokémon -----

function energyChoices(state: PState, owner: Seat, keys: string[], type: string | null) {
  const p = state.players[owner];
  const list: { id: string; label: string }[] = [];
  for (const key of keys) {
    const slot = slotAt(p, key as SlotKey);
    if (!slot) continue;
    for (const c of slot.energy) if (provides(c, type)) list.push({ id: `${owner}|${key}|${c.uid}`, label: `${c.name} on ${topCard(slot).name}` });
  }
  return list;
}

const destText: Record<Dest, string> = { hand: "into the hand", lost: "in the Lost Zone", deck: "into the deck", discard: "into the discard pile" };

/** Moves attached Energy (ids "seat|slotKey|uid") to its owner's hand, Lost Zone, deck or discard pile. */
function moveEnergy(state: PState, ids: string[], dest: Dest) {
  const moved: PCard[] = [];
  let owner: PPlayer | null = null;
  for (const id of ids) {
    const [s, key, uid] = id.split("|");
    const p = state.players[s as Seat];
    const slot = slotAt(p, key as SlotKey);
    const card = slot?.energy.find((e) => e.uid === uid);
    if (!slot || !card) continue;
    slot.energy = slot.energy.filter((e) => e !== card);
    if (dest === "hand") p.hand.push(card);
    else if (dest === "lost") (p.lost ??= []).push(card);
    else if (dest === "deck") p.deck.push(card);
    else p.discard.push(card);
    moved.push(card);
    owner = p;
  }
  if (!owner) return 0;
  if (dest === "deck") shuffle(owner.deck);
  log(state, null, `${names(moved)} went ${destText[dest].replace("the", `${owner.name}'s`)}.`);
  return moved.length;
}

/** Takes `n` (or all) Energy from these Pokémon, letting the player choose when there's a choice, then runs `next`. */
function takeEnergy(state: PState, seat: Seat, o: { owner: Seat; keys: string[]; type: string | null; n: number | "all"; dest: Dest; next?: Data }) {
  const list = energyChoices(state, o.owner, o.keys, o.type);
  if (o.n === "all" || list.length <= o.n) {
    moveEnergy(
      state,
      list.map((c) => c.id),
      o.dest,
    );
    return run(state, seat, o.next);
  }
  const whose = o.owner === seat ? "" : `${state.players[o.owner].name}'s `;
  askChoice(state, seat, `Choose ${plural(o.n, "Energy")} on ${whose}Pokémon to put ${destText[o.dest]}`, list, E("energy"), {
    min: o.n,
    max: o.n,
    data: { dest: o.dest, next: o.next },
  });
}

// ----- Damage done after a choice -----

/** Attack damage to the opponent's Active Pokémon once a choice about it has been made. */
function hitActive(state: PState, seat: Seat, base: number, text: string, name: string) {
  const attacker = state.players[seat].active;
  const defender = state.players[otherSeat(seat)].active;
  if (!attacker || !defender) return;
  let damage = finalDamage(state, seat, attacker, defender, base, text);
  if (defender.effects.protect?.turn === state.turn && damage > 0) {
    log(state, seat, `${topCard(defender).name} is protected, so ${name} did no damage.`, "attack");
    return;
  }
  const guard = defender.effects.guard?.turn === state.turn ? defender.effects.guard.amount : 0;
  damage = Math.max(0, damage - guard);
  if (damage > 0) log(state, seat, `${name} did ${damage} damage to ${topCard(defender).name}.`, "attack");
  else log(state, seat, `${name} did no damage.`, "attack");
  hitWithAttack(state, seat, attacker, defender, damage);
}

/** The damage an attack would do to the Active Pokémon, for rules that hold it back until a choice is made. */
function heldDamage(ctx: AttackCtx) {
  const boost = ctx.attacker.effects.boost;
  const extra = boost && boost.turn === ctx.state.turn && ctx.attack.damage.trim() !== "" ? boost.amount : 0;
  const text = ctx.noWeakness ? `${ctx.text} This attack's damage isn't affected by Weakness or Resistance.` : ctx.text;
  return { base: ctx.base + extra, text, name: ctx.attack.name };
}

// ----- Pokémon leaving play -----

/** Puts the Active Pokémon and its cards into the deck, hand or Lost Zone. The empty Active Spot is filled when the game settles. */
function activeTo(state: PState, owner: Seat, dest: "deck" | "hand" | "lost", attached: "same" | "discard" = "same") {
  const p = state.players[owner];
  const slot = p.active;
  if (!slot) return;
  const mons = [...slot.pokemon];
  const rest = attachedTo(slot);
  p.active = null;
  const zone = dest === "deck" ? p.deck : dest === "hand" ? p.hand : (p.lost ??= []);
  zone.push(...mons);
  if (attached === "same") zone.push(...rest);
  else p.discard.push(...rest);
  if (dest === "deck") shuffle(p.deck);
  const where = dest === "deck" ? "shuffled into their deck" : dest === "hand" ? "put into their hand" : "put in the Lost Zone";
  log(state, owner, `${p.name}'s ${topCard(slot).name}${attached === "same" ? " and all attached cards were" : " was"} ${where}.`);
}

// ----- Follow-up actions (plain data, so a choice can carry them) -----

function run(state: PState, seat: Seat, a: Data | undefined): void {
  if (!a || !a.do) return;
  const p = state.players[seat];
  const opp = state.players[otherSeat(seat)];
  switch (a.do) {
    case "energy":
      return takeEnergy(state, seat, a as unknown as Parameters<typeof takeEnergy>[2]);
    case "dmg":
      hitActive(state, seat, Number(a.amount), String(a.text ?? ""), String(a.name ?? "The attack"));
      break;
    case "cant":
      if (p.active) p.active.cantAttackTurn = state.turn + 2;
      break;
    case "selfDmg":
      if (p.active) {
        p.active.damage += Number(a.amount);
        log(state, seat, `${topCard(p.active).name} did ${a.amount} damage to itself.`);
      }
      break;
    case "self":
      activeTo(state, seat, a.dest as "deck" | "hand", (a.attached as "same" | "discard") ?? "same");
      break;
    case "cond":
      if (!a.shielded && opp.active)
        for (const c of a.conditions as string[]) {
          setCondition(state, opp.active, c.toLowerCase() as Condition);
          log(state, seat, `${topCard(opp.active).name} is now ${c}.`);
        }
      break;
    case "benchDmg":
      if (opp.bench.length)
        ask(state, {
          seat,
          title: `Choose 1 of ${opp.name}'s Benched Pokémon to take ${a.amount} damage`,
          zone: "oppBench",
          options: benchKeys(opp),
          min: 1,
          max: 1,
          effect: "benchDamage",
          data: { amount: a.amount },
        });
      break;
    case "draw": {
      const before = p.hand.length;
      draw(p, Number(a.n));
      log(state, seat, `${p.name} drew ${plural(p.hand.length - before, "card")}.`);
      break;
    }
    case "drawTo": {
      const before = p.hand.length;
      draw(p, Math.max(0, Number(a.n) - p.hand.length));
      log(state, seat, `${p.name} drew ${plural(p.hand.length - before, "card")}.`);
      break;
    }
    case "switchOut":
      if (opp.bench.length && !a.shielded)
        ask(state, {
          seat: otherSeat(seat),
          title: `${p.name}'s attack switches out your Active Pokémon. Choose a Benched Pokémon to send in`,
          zone: "myBench",
          options: benchKeys(opp),
          min: 1,
          max: 1,
          effect: "switchOut",
        });
      break;
  }
  run(state, seat, a.next as Data | undefined);
}

// ----- Searching the deck -----

function searchDeck(state: PState, seat: Seat, title: string, match: Match, max: number, effect: string, data: Data = {}, min = 0) {
  const p = state.players[seat];
  const options = p.deck.filter(match).map((c) => c.uid);
  if (!options.length || max <= 0) {
    shuffle(p.deck);
    log(state, seat, `${p.name} searched their deck but found nothing to take.`);
    return;
  }
  ask(state, { seat, title, zone: "deck", options, shown: p.deck.map((c) => c.uid), min: Math.min(min, options.length), max, effect, data });
}

/** Keeps at most one card of each type ("of different types"), in the order chosen. */
function differentTypes(cards: PCard[], typesOfCard: (c: PCard) => string[]) {
  const used = new Set<string>();
  return cards.filter((c) => {
    const t = typesOfCard(c).find((x) => !used.has(x));
    if (!t) return false;
    used.add(t);
    return true;
  });
}
const energyType = (c: PCard) => energyProvides(c).filter((u) => u !== "Colorless");

/** What "Search your deck for ... into your hand" is looking for. */
function handKind(ctx: AttackCtx, kind: string): { match: Match; trim?: (cards: PCard[]) => PCard[] } {
  const me = topCard(ctx.attacker).name;
  let m: RegExpMatchArray | null;
  if (/^Pokémon Tool cards?$/i.test(kind)) return { match: isTool };
  if (/^Stadium cards?$/i.test(kind)) return { match: isStadium };
  if (/^Trainer cards?$/i.test(kind)) return { match: (c) => c.supertype === "Trainer" };
  if (/^Special Energy cards?$/i.test(kind)) return { match: (c) => isEnergy(c) && !isBasicEnergy(c) };
  if (/^Energy cards?$/i.test(kind)) return { match: isEnergy };
  if (/^Basic Energy cards of different types$/i.test(kind)) return { match: isBasicEnergy, trim: (cs) => differentTypes(cs, energyType) };
  if (/^Pokémon of different types$/i.test(kind)) return { match: isPokemon, trim: (cs) => differentTypes(cs, (c) => c.types) };
  if (/^Pokémon that are the same type as any Basic Energy attached to this Pokémon$/i.test(kind)) {
    const types = new Set(ctx.attacker.energy.filter(isBasicEnergy).flatMap(energyType));
    return { match: (c) => isPokemon(c) && c.types.some((t) => types.has(t)) };
  }
  if ((m = kind.match(/^in any combination of (\w+) Pokémon and (?:Basic (\w+) Energy|Stadium) cards$/i))) {
    const [, pt, et] = m;
    return { match: (c) => (isPokemon(c) && c.types.includes(pt)) || (et ? basicOf(et)(c) : isStadium(c)) };
  }
  if ((m = kind.match(/^([A-Z][\w.]*'s) Pokémon$/))) return { match: (c) => isPokemon(c) && c.name.startsWith(`${m![1]} `) };
  if ((m = kind.match(/^(\w+) Pokémon$/))) {
    const word = m[1];
    return { match: (c) => isPokemon(c) && ([...ENERGY_TYPES, "Colorless"].includes(word) ? c.types.includes(word) : c.subtypes.includes(word)) };
  }
  if (/^this Pokémon/.test(kind)) {
    const list = kind
      .split(/,? and |, /)
      .map((n) => n.trim())
      .map((n) => (n === "this Pokémon" ? me : n));
    return { match: (c) => list.includes(baseName(c.name)) };
  }
  const named = kind.replace(/ cards?$/, "");
  return { match: (c) => baseName(c.name) === named };
}

// ----- Evolving from the deck -----

function evolveFromDeck(state: PState, seat: Seat, slot: PSlot, uid: string) {
  const p = state.players[seat];
  const [card] = pull(p.deck, [uid]);
  if (card) {
    const before = topCard(slot);
    evolveSlot(state, slot, card);
    specialOnEvolve(state, seat, slot, before);
    log(state, seat, `${p.name} evolved ${before.name} into ${card.name}.`);
    evolvedAbilities(state, seat, slot);
  }
  shuffle(p.deck);
}

// ----- Opponent's hand -----

function oppHandPick(ctx: AttackCtx, title: string, match: Match, n: number, then: "bottom" | "discard" | "shuffle" | "bench", min = 1) {
  const { state, seat, opp } = ctx;
  revealHand(state, seat);
  const options = opp.hand.filter(match).map((c) => c.uid);
  if (!options.length) return log(state, seat, `There was nothing in ${opp.name}'s hand to choose.`);
  ask(state, {
    seat,
    title,
    zone: "oppHand",
    options,
    shown: opp.hand.map((c) => c.uid),
    min: Math.min(min, options.length),
    max: Math.min(n, options.length),
    effect: E("oppHand"),
    data: { then },
  });
}

/** The attacks a Pokémon card has, as labelled choices ("uid|index"). */
const attackChoices = (cards: PCard[], skip: string) =>
  cards.flatMap((c) =>
    c.attacks
      .map((a, i) => ({ id: `${c.uid}|${i}`, label: `${c.name}: ${a.name}${a.damage ? ` (${a.damage})` : ""}`, a }))
      .filter((x) => x.a.text !== skip)
      .map(({ id, label }) => ({ id, label })),
  );
const dmgOf = (a: Attack) => parseInt(a.damage, 10) || 0;

// ----- The rules -----

export const rules5 = (): AttackRule[] => [
  // Looking at the top of a deck.
  {
    re: /Look at the top card of your deck\. You may put that card on the bottom of your deck\./,
    post(ctx) {
      const top = ctx.p.deck[0];
      if (!top) return;
      ask(ctx.state, {
        seat: ctx.seat,
        title: "The top card of your deck: choose it to put it on the bottom of your deck",
        zone: "deck",
        options: [top.uid],
        shown: [top.uid],
        min: 0,
        max: 1,
        effect: E("bottom"),
      });
    },
  },
  {
    re: /Look at the top card of your opponent's deck\. You may have your opponent shuffle their deck\./,
    post(ctx) {
      const top = ctx.opp.deck[0];
      if (!top) return;
      ask(ctx.state, {
        seat: ctx.seat,
        title: `The top card of ${ctx.opp.name}'s deck: choose it to have them shuffle their deck`,
        zone: "oppDeck",
        options: [top.uid],
        shown: [top.uid],
        min: 0,
        max: 1,
        effect: E("oppShuffle"),
      });
    },
  },

  // Energy moving between the opponent's Pokémon.
  {
    re: /Move an Energy from 1 of your opponent's Pokémon to another of their Pokémon\./,
    post(ctx) {
      const { state, seat, opp, oppSeat } = ctx;
      const keys = slotKeys(opp).filter((k) => {
        const slot = slotAt(opp, k)!;
        return slot === ctx.defender ? !ctx.shielded : !effectsProof(state, seat, ctx.attacker, slot);
      });
      if (keys.length < 2) return;
      const list = energyChoices(state, oppSeat, keys, null);
      if (list.length) askChoice(state, seat, `Choose an Energy on ${opp.name}'s Pokémon to move`, list, E("moveOpp"), { data: { keys } });
    },
  },

  // Optional costs for more damage: the damage waits for the choice.
  {
    re: /You may (discard|put|shuffle) (all|an?|\d+) (?:(\w+) )?Energy (?:from|attached to) this Pokémon(?: into your (?:hand|deck))?(?: (?:and|to) (?:have )?this attack do (\d+) more damage\.|\. If you do, this attack does (\d+) more damage\.)/,
    pre: (ctx) => void (ctx.skipDamage = true),
    post(ctx, m) {
      const held = heldDamage(ctx);
      const bonus = Number(m[4] ?? m[5]);
      const type = typed(m[3]);
      const n = m[2].toLowerCase() === "all" ? "all" : toCount(m[2]);
      const have = energyChoices(ctx.state, ctx.seat, ["active"], type).length;
      const dmg = { do: "dmg", amount: held.base, text: held.text, name: held.name };
      if (!have || (n !== "all" && have < n)) return run(ctx.state, ctx.seat, dmg);
      const dest: Dest = m[1].toLowerCase() === "discard" ? "discard" : m[1].toLowerCase() === "put" ? "hand" : "deck";
      const what = n === "all" ? "all Energy" : `${plural(n, `${type ? `${type} ` : ""}Energy`)}`;
      may(
        ctx.state,
        ctx.seat,
        `${ctx.attack.name}: put ${what} from ${topCard(ctx.attacker).name} ${destText[dest]} for ${bonus} more damage?`,
        {
          do: "energy",
          owner: ctx.seat,
          keys: ["active"],
          type,
          n,
          dest,
          next: { ...dmg, amount: held.base + bonus },
        },
        dmg,
      );
    },
  },
  {
    re: /You may do (\d+) more damage\. If you do, (during your next turn, this Pokémon can't attack|this Pokémon also does (\d+) damage to itself|shuffle this Pokémon and all attached cards into your deck)\./,
    pre: (ctx) => void (ctx.skipDamage = true),
    post(ctx, m) {
      const held = heldDamage(ctx);
      const dmg = { do: "dmg", amount: held.base, text: held.text, name: held.name };
      const after = m[3] ? { do: "selfDmg", amount: Number(m[3]) } : /can't attack/i.test(m[2]) ? { do: "cant" } : { do: "self", dest: "deck" };
      const selfKo = m[3] && ctx.attacker.damage + Number(m[3]) >= (topCard(ctx.attacker).hp ?? 0);
      may(
        ctx.state,
        ctx.seat,
        `${ctx.attack.name}: do ${m[1]} more damage? (If you do, ${m[2]}.)`,
        { ...dmg, amount: held.base + Number(m[1]), next: after },
        dmg,
        !selfKo,
      );
    },
  },
  {
    re: /You may discard (\d+) (\w+) Energy from this Pokémon (?:and|to) make your opponent's Active Pokémon (Asleep|Burned|Confused|Paralyzed|Poisoned)\./,
    post(ctx, m) {
      const type = typed(m[2]);
      const n = Number(m[1]);
      if (energyChoices(ctx.state, ctx.seat, ["active"], type).length < n || ctx.shielded) return;
      may(ctx.state, ctx.seat, `${ctx.attack.name}: discard ${plural(n, `${m[2]} Energy`)} to make ${topCard(ctx.defender).name} ${m[3]}?`, {
        do: "energy",
        owner: ctx.seat,
        keys: ["active"],
        type,
        n,
        dest: "discard",
        next: { do: "cond", conditions: [m[3]] },
      });
    },
  },
  {
    re: /You may have this Pokémon also do (\d+) damage to itself and make your opponent's Active Pokémon (Asleep|Burned|Confused|Paralyzed|Poisoned)\./,
    post(ctx, m) {
      const selfKo = ctx.attacker.damage + Number(m[1]) >= (topCard(ctx.attacker).hp ?? 0);
      may(
        ctx.state,
        ctx.seat,
        `${ctx.attack.name}: do ${m[1]} damage to ${topCard(ctx.attacker).name} to make ${topCard(ctx.defender).name} ${m[2]}?`,
        { do: "selfDmg", amount: Number(m[1]), next: { do: "cond", conditions: [m[2]], shielded: ctx.shielded } },
        {},
        !selfKo && !ctx.shielded,
      );
    },
  },
  {
    re: /You may shuffle (\d+) Energy attached to this Pokémon into your deck\. If you do, this attack also does (\d+) damage to 1 of your opponent's Benched Pokémon\./,
    post(ctx, m) {
      const n = Number(m[1]);
      if (energyChoices(ctx.state, ctx.seat, ["active"], null).length < n) return;
      may(
        ctx.state,
        ctx.seat,
        `${ctx.attack.name}: shuffle ${plural(n, "Energy")} into your deck to do ${m[2]} damage to 1 of ${ctx.opp.name}'s Benched Pokémon?`,
        { do: "energy", owner: ctx.seat, keys: ["active"], type: null, n, dest: "deck", next: { do: "benchDmg", amount: Number(m[2]) } },
        {},
        ctx.opp.bench.length > 0,
      );
    },
  },

  // Energy put into the hand or the Lost Zone.
  {
    re: /(You may p|P)ut (all|an|a|\d+) (?:(\w+) )?Energy attached to (this Pokémon|your Pokémon|your opponent's Active (Stage \d )?Pokémon) (in the Lost Zone|into your hand|into their hand)\.(?! If you do)/,
    post(ctx, m) {
      const { state, seat } = ctx;
      const theirs = /opponent/i.test(m[4]);
      if (theirs && (ctx.shielded || (m[5] && !topCard(ctx.defender).subtypes.includes(m[5].trim())))) return;
      const owner = theirs ? ctx.oppSeat : seat;
      const keys = /this Pokémon|Active/i.test(m[4]) ? ["active"] : slotKeys(ctx.p);
      const type = typed(m[3]);
      const n = m[2].toLowerCase() === "all" ? "all" : toCount(m[2]);
      const action = { do: "energy", owner, keys, type, n, dest: /Lost Zone/i.test(m[6]) ? "lost" : "hand" };
      if (!energyChoices(state, owner, keys, type).length) return;
      if (m[1] !== "P")
        may(state, seat, `${ctx.attack.name}: put ${n === "all" ? "all" : n} Energy from ${topCard(ctx.defender).name} into ${ctx.opp.name}'s hand?`, action);
      else run(state, seat, action);
    },
  },

  // Cards from the discard pile.
  {
    re: /Put (?!up to \w+ (?:Basic \w+ Energy|Pokémon) )(a|an|up to \w+) (Basic (?:\w+ )?Energy cards?|basic Energy cards|Pokémon|Supporter card|Trainer card|Item cards?|cards?|in any combination of Item cards and Pokémon Tool cards) from your discard pile into your hand\./,
    post(ctx, m) {
      const { state, seat, p } = ctx;
      if (discardLocked(state, seat)) return log(state, seat, "Slime Mold Colony stops cards leaving the discard pile for the hand.");
      const kind = m[2].toLowerCase();
      const type = typed(kind.match(/^basic (\w+) energy/)?.[1].replace(/^\w/, (c) => c.toUpperCase()));
      const match: Match = kind.startsWith("basic")
        ? basicOf(type)
        : kind === "pokémon"
          ? isPokemon
          : kind.startsWith("supporter")
            ? isSupporter
            : kind.startsWith("trainer")
              ? (c) => c.supertype === "Trainer"
              : kind.startsWith("item")
                ? isItem
                : kind.startsWith("in any")
                  ? (c) => isItem(c) || isTool(c)
                  : () => true;
      const options = p.discard.filter(match).map((c) => c.uid);
      if (!options.length) return;
      const n = /^up to/i.test(m[1]) ? upTo(m[1]) : 1;
      ask(state, {
        seat,
        title: `Choose ${n === 1 && !/^up to/i.test(m[1]) ? "a card" : `up to ${n} cards`} from your discard pile to put into your hand`,
        zone: "discard",
        options,
        min: /^up to/i.test(m[1]) ? 0 : 1,
        max: Math.min(n, options.length),
        effect: E("discardToHand"),
      });
    },
  },
  {
    re: /Put a Basic Pokémon from either player's discard pile onto that player's Bench\./,
    post(ctx) {
      const { state, seat } = ctx;
      const list: { id: string; label: string }[] = [];
      for (const s of [seat, ctx.oppSeat]) {
        const p = state.players[s];
        if (p.bench.length >= benchLimit(state, s)) continue;
        for (const c of p.discard.filter(isBasicPokemon)) list.push({ id: `${s}|${c.uid}`, label: `${c.name} (${p.name}'s discard pile)` });
      }
      if (!list.length) return;
      const mine = list.find((c) => c.id.startsWith(`${seat}|`));
      askChoice(state, seat, "Choose a Basic Pokémon to put onto its owner's Bench", list, E("eitherBench"), { data: { botPick: [(mine ?? list[0]).id] } });
    },
  },
  {
    re: /Put (a|up to \w+) (Basic Pokémon|this Pokémon|Pokémon|\w+ Pokémon) from your discard pile onto your Bench\./,
    post(ctx, m) {
      const { state, seat, p } = ctx;
      const kind = m[2];
      const me = topCard(ctx.attacker).name;
      const match: Match = /^Basic Pokémon$/i.test(kind)
        ? isBasicPokemon
        : /^this Pokémon$/i.test(kind)
          ? (c) => c.name === me
          : /^Pokémon$/i.test(kind)
            ? isPokemon
            : (c) => isPokemon(c) && c.types.includes(kind.split(" ")[0]);
      const room = benchLimit(state, seat) - p.bench.length;
      const options = p.discard.filter(match).map((c) => c.uid);
      if (room <= 0 || !options.length) return;
      const n = Math.min(room, /^up to/i.test(m[1]) ? upTo(m[1]) : 1, options.length);
      ask(state, {
        seat,
        title: `Choose ${/^up to/i.test(m[1]) ? `up to ${n}` : "a"} Pokémon from your discard pile to put onto your Bench`,
        zone: "discard",
        options,
        min: /^up to/i.test(m[1]) ? 0 : 1,
        max: n,
        effect: E("discardToBench"),
      });
    },
  },
  {
    re: /Shuffle up to (\w+) (?:in any combination of ([^.]+?) and ([^.]+?) cards|(Basic )?(?:(\w+) )?Energy cards) from your discard pile into your deck\./,
    post(ctx, m) {
      const { state, seat, p } = ctx;
      const match: Match = m[2]
        ? (c) => [m[2], m[3]].includes(baseName(c.name)) && !(c.supertype === "Trainer" && trainersStayDiscarded(state, seat))
        : m[4]
          ? basicOf(typed(m[5]))
          : energyCard(typed(m[5]));
      const options = p.discard.filter(match).map((c) => c.uid);
      if (!options.length) return;
      ask(state, {
        seat,
        title: `Choose up to ${m[1]} cards from your discard pile to shuffle into your deck`,
        zone: "discard",
        options,
        min: 0,
        max: Math.min(toCount(m[1]), options.length),
        effect: E("discardToDeck"),
      });
    },
  },

  // The Lost Zone.
  {
    re: /Put a random card from your opponent's hand in the Lost Zone\./,
    post(ctx) {
      const { opp } = ctx;
      if (!opp.hand.length) return;
      const [card] = opp.hand.splice(Math.floor(Math.random() * opp.hand.length), 1);
      (opp.lost ??= []).push(card);
      log(ctx.state, ctx.seat, `${card.name} from ${opp.name}'s hand was put in the Lost Zone.`);
    },
  },
  {
    re: /Put the top (?:(\w+) )?cards? of (your|your opponent's) deck in the Lost Zone\./,
    post(ctx, m) {
      const who = m[2].toLowerCase() === "your" ? ctx.p : ctx.opp;
      const gone = who.deck.splice(0, toCount(m[1] ?? "1"));
      (who.lost ??= []).push(...gone);
      log(ctx.state, ctx.seat, `${names(gone)} from the top of ${who.name}'s deck ${gone.length === 1 ? "was" : "were"} put in the Lost Zone.`);
    },
  },
  { re: /Put this Pokémon and all attached cards in the Lost Zone\./, post: (ctx) => activeTo(ctx.state, ctx.seat, "lost") },

  // This Pokémon leaving play.
  {
    re: /Put this Pokémon and all attached cards into your deck\. If you do, search your deck for up to (\w+) cards and put them into your hand\. Then, shuffle your deck\./,
    post(ctx, m) {
      activeTo(ctx.state, ctx.seat, "deck");
      searchDeck(ctx.state, ctx.seat, `Choose up to ${m[1]} cards to put into your hand`, () => true, toCount(m[1]), "handFromDeck");
    },
  },
  {
    re: /(You may p|P)ut this Pokémon (and all attached cards )?into your hand\./,
    post(ctx, m) {
      const { state, seat, p } = ctx;
      if (pickUpLocked(state, seat)) return log(state, seat, "Mentally Calm stops Pokémon going back into the hand.");
      const action = { do: "self", dest: "hand", attached: m[2] ? "same" : "discard" };
      if (m[1] === "P") return run(state, seat, action);
      if (!p.bench.length) return;
      may(state, seat, `${ctx.attack.name}: put ${topCard(ctx.attacker).name} into your hand?`, action, {}, ctx.attacker.damage > 0);
    },
  },
  {
    re: /(You may s|S)huffle this Pokémon and all attached cards into your deck\./,
    post(ctx, m) {
      const action = { do: "self", dest: "deck" };
      if (m[1] === "S") return run(ctx.state, ctx.seat, action);
      if (ctx.p.bench.length)
        may(ctx.state, ctx.seat, `${ctx.attack.name}: shuffle ${topCard(ctx.attacker).name} into your deck?`, action, {}, ctx.attacker.damage > 0);
    },
  },
  {
    re: /Shuffle each player's Active Pokémon and all attached cards into their deck\./,
    post(ctx) {
      const { state, seat } = ctx;
      activeTo(state, seat, "deck");
      if (!ctx.shielded) activeTo(state, ctx.oppSeat, "deck");
      // You choose your new Active Pokémon first.
      if (ctx.p.bench.length)
        ask(state, {
          seat,
          title: "Choose a Pokémon to move to your Active Spot",
          zone: "myBench",
          options: benchKeys(ctx.p),
          min: 1,
          max: 1,
          effect: "promote",
        });
    },
  },
  {
    re: /Your opponent shuffles their Active Pokémon and all attached cards into their deck\./,
    post: (ctx) => void (!ctx.shielded && activeTo(ctx.state, ctx.oppSeat, "deck")),
  },

  // Revealing cards for damage.
  {
    re: /Reveal the bottom (\w+) cards of your deck, and this attack does (\d+) damage for each Pokémon you find there that has the ([^.]+?) attack\. Then, shuffle any revealed Pokémon back into your deck\. Discard the other cards\./,
    pre(ctx, m) {
      const { p } = ctx;
      const shown = p.deck.slice(-toCount(m[1]));
      log(ctx.state, ctx.seat, `${p.name} revealed ${names(shown)} from the bottom of their deck.`);
      ctx.base = Number(m[2]) * shown.filter((c) => isPokemon(c) && c.attacks.some((a) => a.name === m[3])).length;
      const others = shown.filter((c) => !isPokemon(c));
      p.discard.push(
        ...pull(
          p.deck,
          others.map((c) => c.uid),
        ),
      );
      shuffle(p.deck);
    },
  },
  {
    re: /Reveal the top (\w+) cards of your deck\. This attack does (\d+) damage for each (Energy|Future) card you find there\. Then, discard those \3 cards and shuffle the other cards back into your deck\./,
    pre(ctx, m) {
      const { p } = ctx;
      const shown = p.deck.slice(0, toCount(m[1]));
      log(ctx.state, ctx.seat, `${p.name} revealed ${names(shown)} from the top of their deck.`);
      const hits = shown.filter((c) => (m[3].toLowerCase() === "energy" ? isEnergy(c) : c.subtypes.includes("Future")));
      ctx.base = Number(m[2]) * hits.length;
      p.discard.push(
        ...pull(
          p.deck,
          hits.map((c) => c.uid),
        ),
      );
      shuffle(p.deck);
    },
  },

  // Using another Pokémon's attack.
  {
    re: /Reveal the top (\w+) cards of your opponent's deck\. You may choose an attack from a Pokémon you find there and use it as this attack\. Shuffle the revealed cards into your opponent's deck\./,
    post(ctx, m) {
      const { state, seat, opp } = ctx;
      const shown = opp.deck.slice(0, toCount(m[1]));
      log(state, seat, `${opp.name} revealed ${names(shown)} from the top of their deck.`);
      const list = attackChoices(shown.filter(isPokemon), ctx.attack.text);
      if (!list.length) return void shuffle(opp.deck);
      const best = [...list].sort((a, b) => dmgOf(pickAttack(opp.deck, b.id)!) - dmgOf(pickAttack(opp.deck, a.id)!))[0];
      askChoice(state, seat, "Choose an attack to use as this attack", list, E("copyTop"), { min: 0, max: 1, data: { botPick: [best.id] } });
    },
  },
  {
    re: /Your opponent chooses an attack from 1 of their Pokémon in play\. Use the chosen attack as this attack\./,
    post(ctx) {
      const { state, seat, opp } = ctx;
      const list = attackChoices(inPlay(opp).map(topCard), ctx.attack.text);
      if (!list.length) return;
      const cards = inPlay(opp).map(topCard);
      const weakest = [...list].sort((a, b) => dmgOf(pickAttack(cards, a.id)!) - dmgOf(pickAttack(cards, b.id)!))[0];
      askChoice(state, ctx.oppSeat, `${ctx.p.name}'s ${ctx.attack.name}: choose an attack from your Pokémon for it to use`, list, E("copyOpp"), {
        data: { by: seat, botPick: [weakest.id] },
      });
    },
  },

  // Deck searches that put cards on top.
  {
    re: /Search your deck for (\w+) cards, shuffle your deck, then put those cards on top of it in any order\./,
    post(ctx, m) {
      const n = toCount(m[1]);
      searchDeck(ctx.state, ctx.seat, `Choose ${n} cards to put on top of your deck`, () => true, n, E("toTop"), {}, n);
    },
  },
  {
    re: /Search your deck for a card\. Shuffle your deck, then put that card on top of it\./,
    post: (ctx) => searchDeck(ctx.state, ctx.seat, "Choose a card to put on top of your deck", () => true, 1, E("toTop"), {}, 1),
  },

  // Deck searches for Energy to attach.
  {
    re: /Search your deck for (?!(?:up to )?\w+ Basic \w+ Energy cards? and attach (?:it|them) to this Pokémon)(a|an|up to \w+) ([Bb]asic )?(?:(\w+) )?Energy cards?( of different types)?(?: and up to (\w+) Basic (\w+) Energy cards)? and attach (?:it|them) to (this Pokémon|1 of your (Basic )?Pokémon|your (?!Benched)(?:(\w+) )?Pokémon( V)? in any way you like)\. Then, shuffle your deck\./,
    post(ctx, m) {
      const { state, seat, p } = ctx;
      const type = typed(m[3]);
      const second = typed(m[6]);
      const n = /^up to/i.test(m[1]) ? upTo(m[1]) : 1;
      const match: Match = second ? (c) => basicOf(type)(c) || basicOf(second)(c) : m[2] ? basicOf(type) : energyCard(type);
      const filter = m[7] === "this Pokémon" ? null : [m[8] ? "basic" : "", m[9] ?? "", m[10] ? "V" : ""].filter(Boolean).join("&");
      const targets = filter === null ? ["active"] : slotKeys(p).filter((k) => matchesFilter(state, slotAt(p, k)!, filter));
      if (!targets.length) return log(state, seat, `${p.name} has no Pokémon to attach the Energy to.`);
      const max = n + (m[5] ? toCount(m[5]) : 0);
      const limits = second ? { [type!]: n, [second]: toCount(m[5]) } : null;
      searchDeck(state, seat, `Choose up to ${plural(max, "Energy card")} to attach`, match, max, E("deckEnergy"), {
        targets,
        single: /^1 of/.test(m[7]),
        different: !!m[4],
        limits,
      });
    },
  },

  // Deck searches for cards to put into the hand.
  {
    re: /(You may s|S)earch your deck for (an?|up to \w+|any number of) ((?:\w+|[A-Z][\w.]*'s) Pokémon|Pokémon Tool cards?|Stadium cards?|(?:Special )?Energy cards?|Trainer cards?|Basic Energy cards of different types|Pokémon of different types|in any combination of \w+ Pokémon and (?:Basic \w+ Energy|Stadium) cards|Pokémon that are the same type as any Basic Energy attached to this Pokémon|this Pokémon(?:, [\w' -]+?)*(?:,? and [\w' -]+?)?|(?!Supporter |Item |Basic )[A-Z][\w'-]*(?: [A-Z][\w'-]*)* cards), reveal (?:it|them), and put (?:it|them) into your hand\. Then, shuffle your deck\./,
    post(ctx, m) {
      const kind = handKind(ctx, m[3]);
      const n = m[2].startsWith("any") ? ctx.p.deck.length : /^up to/i.test(m[2]) ? upTo(m[2]) : 1;
      searchDeck(
        ctx.state,
        ctx.seat,
        `Choose up to ${n >= ctx.p.deck.length ? "any number of" : n} cards to put into your hand`,
        kind.match,
        n,
        E("deckToHand"),
        {
          kind: m[3],
        },
      );
    },
  },
  {
    re: /Search your deck for a number of cards up to the number of different types of Pokémon you have in play and put them into your hand\. Then, shuffle your deck\./,
    post(ctx) {
      const n = new Set(inPlay(ctx.p).flatMap((s) => topCard(s).types)).size;
      searchDeck(ctx.state, ctx.seat, `Choose up to ${n} cards to put into your hand`, () => true, n, "handFromDeck");
    },
  },
  {
    re: /You may search your deck for (a card|up to (\w+) cards) and put (?:it|them) into your hand\. Then, shuffle your deck\./,
    post(ctx, m) {
      const n = m[2] ? toCount(m[2]) : 1;
      const p = ctx.p;
      if (!p.deck.length) return;
      ask(ctx.state, {
        seat: ctx.seat,
        title: `You may choose up to ${plural(n, "card")} to put into your hand (choose none to skip the search)`,
        zone: "deck",
        options: p.deck.map((c) => c.uid),
        shown: p.deck.map((c) => c.uid),
        min: 0,
        max: n,
        effect: E("maySearch"),
      });
    },
  },

  // Deck searches for the Bench.
  {
    re: /(You may s|S)earch your deck for (up to \w+|any number of) (in any combination of this Pokémon and this Pokémon ex|this Pokémon|Basic [A-Z][\w.]*'s Pokémon|Pokémon that have "this Pokémon" in their name) and put them onto your Bench\. Then, shuffle your deck\./,
    post(ctx, m) {
      const { state, seat, p } = ctx;
      const me = topCard(ctx.attacker).name;
      const kind = m[3];
      const match: Match = kind.startsWith("in any")
        ? (c) => isPokemon(c) && [me, `${me} ex`].includes(c.name)
        : kind === "this Pokémon"
          ? (c) => isPokemon(c) && c.name === me
          : kind.startsWith("Basic")
            ? (c) => isBasicPokemon(c) && c.name.startsWith(`${kind.slice(6, -8)} `)
            : (c) => isPokemon(c) && c.name.includes(me);
      const room = benchLimit(state, seat) - p.bench.length;
      const n = Math.min(room, m[2].startsWith("any") ? room : upTo(m[2]));
      searchDeck(state, seat, `Choose up to ${n} Pokémon to put onto your Bench`, match, n, "benchFromDeck");
    },
  },

  // Evolving from the deck.
  {
    re: /Search your deck for a card that evolves from (this Pokémon|1 of your Pokémon) and put it onto that Pokémon to evolve it\. Then, shuffle your deck\.|Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it\. Then, shuffle your deck\./,
    post(ctx, m) {
      const own = inPlay(ctx.p).map((s) => topCard(s).name);
      const from = m[1] && /^1 of/i.test(m[1]) ? own : [topCard(ctx.attacker).name];
      searchDeck(
        ctx.state,
        ctx.seat,
        "Choose a card to evolve your Pokémon into",
        (c) => isPokemon(c) && !!c.evolvesFrom && from.includes(c.evolvesFrom),
        1,
        E("evolve"),
        {
          self: !(m[1] && /^1 of/i.test(m[1])),
        },
      );
    },
  },

  // Attaching Energy from the hand.
  {
    re: /You may attach (a|up to \w+|any number of) ([Bb]asic )?(?:(\w+) )?Energy cards? from your hand to (this Pokémon|your Pokémon in any way you like)\./,
    post(ctx, m) {
      const { state, seat, p } = ctx;
      const type = typed(m[3]);
      const match = m[2] ? basicOf(type) : energyCard(type);
      const options = p.hand.filter(match).map((c) => c.uid);
      if (!options.length) return;
      const n = m[1] === "a" ? 1 : m[1].startsWith("any") ? options.length : upTo(m[1]);
      ask(state, {
        seat,
        title: `You may choose up to ${plural(Math.min(n, options.length), "Energy card")} from your hand to attach`,
        zone: "hand",
        options,
        min: 0,
        max: Math.min(n, options.length),
        effect: E("handEnergy"),
        data: { targets: m[4] === "this Pokémon" ? ["active"] : slotKeys(p) },
      });
    },
  },

  // Moving your own Energy around.
  {
    re: /You may move any amount of (?:(\w+) )?Energy from your Pokémon to your other Pokémon in any way you like\./,
    post: (ctx, m) => askMove(ctx.state, ctx.seat, typed(m[1])),
  },

  // The hand.
  {
    re: /You may discard any number of cards from your hand(?: until you have (\d+) or fewer)?\.(?: Draw cards until you have (\d+) cards in your hand\.)?/,
    post(ctx, m) {
      const { state, seat, p } = ctx;
      if (!p.hand.length) return run(state, seat, m[2] ? { do: "drawTo", n: Number(m[2]) } : undefined);
      ask(state, {
        seat,
        title: "You may discard any number of cards from your hand",
        zone: "hand",
        options: p.hand.map((c) => c.uid),
        min: 0,
        max: p.hand.length,
        effect: E("discardMine"),
        data: { next: m[2] ? { do: "drawTo", n: Number(m[2]) } : undefined, botPick: [] },
      });
    },
  },
  {
    re: /Shuffle your hand into your deck\. Then, draw (\w+ cards?|a card for each card in your opponent's hand)\./,
    post(ctx, m) {
      const { state, seat, p } = ctx;
      const n = /for each/i.test(m[1]) ? ctx.opp.hand.length : toCount(m[1].split(" ")[0]);
      p.deck.push(...p.hand.splice(0));
      shuffle(p.deck);
      draw(p, n);
      log(state, seat, `${p.name} shuffled their hand into their deck and drew ${plural(Math.min(n, p.hand.length), "card")}.`);
    },
  },
  {
    re: /You may draw cards until you have (\d+) cards in your hand\./,
    post: (ctx, m) =>
      void (
        ctx.p.hand.length < Number(m[1]) && may(ctx.state, ctx.seat, `Draw cards until you have ${m[1]} cards in your hand?`, { do: "drawTo", n: Number(m[1]) })
      ),
  },
  {
    re: /You may draw (\w+) cards?\.(?! If you do)/,
    post: (ctx, m) => may(ctx.state, ctx.seat, `Draw ${plural(toCount(m[1]), "card")}?`, { do: "draw", n: toCount(m[1]) }),
  },

  // Switching.
  {
    re: /You may switch this Pokémon with 1 of your Benched Pokémon\./,
    post(ctx) {
      if (!ctx.p.bench.length) return;
      ask(ctx.state, {
        seat: ctx.seat,
        title: "You may choose a Benched Pokémon to switch with (choose none to stay)",
        zone: "myBench",
        options: benchKeys(ctx.p),
        min: 0,
        max: 1,
        effect: E("maySwitch"),
      });
    },
  },
  {
    re: /You may switch out your opponent's Active Pokémon to the Bench\./,
    post(ctx) {
      if (!ctx.opp.bench.length || ctx.shielded) return;
      may(ctx.state, ctx.seat, `Switch out ${topCard(ctx.defender).name}?`, { do: "switchOut" });
    },
  },

  // Prize cards.
  {
    re: /Take (\w+) Prize cards?\./,
    post(ctx, m) {
      const { state, seat, p } = ctx;
      const taken = p.prizes.splice(0, toCount(m[1]));
      if (prizesToLost(state, seat)) {
        (p.lost ??= []).push(...taken);
        log(state, seat, `Lost Block: ${p.name}'s ${plural(taken.length, "Prize card")} went to the Lost Zone.`);
      } else {
        p.hand.push(...taken);
        log(state, seat, `${p.name} took ${plural(taken.length, "Prize card")}.`);
        tookPrizes(state, seat, taken);
      }
      if (!p.prizes.length) win(state, seat, `${p.name} took their last Prize card.`);
    },
  },

  // This Pokémon.
  {
    re: /This Pokémon can't use ([^.]+?) again until it leaves the Active Spot\./,
    post(ctx, m) {
      const e = ctx.attacker.effects as { usedUp?: string[] };
      (e.usedUp ??= []).push(m[1]);
    },
    canUse(state, seat, attack, m) {
      const e = state.players[seat].active?.effects as { usedUp?: string[] } | undefined;
      return attack.name === m[1] && e?.usedUp?.includes(m[1]) ? `This Pokémon can't use ${m[1]} again until it leaves the Active Spot.` : null;
    },
  },
  {
    re: /This Pokémon recovers from all Special Conditions\./,
    post(ctx) {
      ctx.attacker.conditions = [];
      log(ctx.state, ctx.seat, `${topCard(ctx.attacker).name} recovered from all Special Conditions.`);
    },
  },
  {
    re: /This attack also does (\d+) damage to 1 of your Pokémon\./,
    post(ctx, m) {
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Choose 1 of your Pokémon to take ${m[1]} damage`,
        zone: "myPokemon",
        options: slotKeys(ctx.p),
        min: 1,
        max: 1,
        effect: E("hitMine"),
        data: { amount: Number(m[1]), botPick: [ctx.p.bench.length ? "bench:0" : "active"] },
      });
    },
  },
  {
    re: /This attack does (\d+) more damage for each extra (\w+) Energy attached to this Pokémon\. You can't add more than (\d+) damage in this way\./,
    pre(ctx, m) {
      const type = m[2];
      const units = ctx.attacker.energy.flatMap((e) => energyProvides(e));
      const ofType = units.filter((u) => unitIs(u, type)).length;
      const need = ctx.attack.cost.filter((c) => c === type).length;
      const colorless = ctx.attack.cost.filter((c) => c === "Colorless").length;
      const spare = Math.max(0, colorless - (units.length - ofType));
      const extra = Math.max(0, ofType - need - spare);
      ctx.base += Math.min(Number(m[3]), Number(m[1]) * extra);
    },
  },

  // Rock-Paper-Scissors.
  {
    re: /You and your opponent play Rock-Paper-Scissors until someone wins\. If you win, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon\./,
    post: (ctx) => askRps(ctx.state, ctx.seat, ctx.seat, {}),
  },

  // The opponent's hand and deck.
  {
    re: /Your opponent chooses (\w+) cards? from their hand and shuffles (?:those cards|it) into their deck\./,
    post(ctx, m) {
      const n = Math.min(toCount(m[1]), ctx.opp.hand.length);
      if (!n) return;
      ask(ctx.state, {
        seat: ctx.oppSeat,
        title: `Choose ${plural(n, "card")} from your hand to shuffle into your deck`,
        zone: "hand",
        options: ctx.opp.hand.map((c) => c.uid),
        min: n,
        max: n,
        effect: E("handToDeck"),
        data: { step: "cost" },
      });
    },
  },
  {
    re: /Your opponent shuffles their hand into their deck and draws (\w+) cards?\./,
    post(ctx, m) {
      const { opp } = ctx;
      opp.deck.push(...opp.hand.splice(0));
      shuffle(opp.deck);
      draw(opp, toCount(m[1]));
      log(ctx.state, ctx.seat, `${opp.name} shuffled their hand into their deck and drew ${plural(opp.hand.length, "card")}.`);
    },
  },
  {
    re: /Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck\./,
    post: (ctx) => oppHandPick(ctx, `Choose a card from ${ctx.opp.name}'s hand to put on the bottom of their deck`, () => true, 1, "bottom"),
  },
  {
    re: /Your opponent reveals their hand, and you discard a card you find there\./,
    post: (ctx) => oppHandPick(ctx, `Choose a card from ${ctx.opp.name}'s hand to discard`, () => true, 1, "discard"),
  },
  {
    re: /Your opponent reveals their hand\. Choose an? (Supporter|Trainer|Item|Pokémon|Energy) card you find there and put it on the bottom of their deck\./,
    post: (ctx, m) => oppHandPick(ctx, `Choose a ${m[1]} card from ${ctx.opp.name}'s hand to put on the bottom of their deck`, cardKind(m[1]), 1, "bottom"),
  },
  {
    re: /Your opponent reveals their hand\. Discard an? (?:(Supporter|Trainer|Item|Pokémon|Energy) )?card you find there\./,
    post: (ctx, m) =>
      oppHandPick(ctx, `Choose a ${m[1] ? `${m[1]} ` : ""}card from ${ctx.opp.name}'s hand to discard`, m[1] ? cardKind(m[1]) : () => true, 1, "discard"),
  },
  {
    re: /Your opponent reveals their hand\. Discard all Item cards and Pokémon Tool cards you find there\./,
    post(ctx) {
      const { state, seat, opp } = ctx;
      revealHand(state, seat);
      const gone = opp.hand.filter((c) => isItem(c) || isTool(c));
      opp.hand = opp.hand.filter((c) => !gone.includes(c));
      opp.discard.push(...gone);
      log(
        state,
        seat,
        gone.length ? `${names(gone)} ${gone.length === 1 ? "was" : "were"} discarded from ${opp.name}'s hand.` : "There was nothing to discard.",
      );
      discardedByOpponent(state, ctx.oppSeat, gone, "hand");
    },
  },
  {
    re: /Your opponent reveals their hand\. If they have (\d+) or more cards in their hand, choose all but (\d+), and your opponent shuffles the chosen cards into their deck\./,
    post(ctx, m) {
      const { state, seat, opp } = ctx;
      revealHand(state, seat);
      if (opp.hand.length < Number(m[1])) return;
      const n = opp.hand.length - Number(m[2]);
      ask(state, {
        seat,
        title: `Choose ${plural(n, "card")} from ${opp.name}'s hand for them to shuffle into their deck`,
        zone: "oppHand",
        options: opp.hand.map((c) => c.uid),
        shown: opp.hand.map((c) => c.uid),
        min: n,
        max: n,
        effect: E("oppHand"),
        data: { then: "shuffle" },
      });
    },
  },
  {
    re: /Your opponent reveals their hand\. Put up to (\w+) Basic Pokémon you find there onto your opponent's Bench\./,
    post(ctx, m) {
      const room = benchLimit(ctx.state, ctx.oppSeat) - ctx.opp.bench.length;
      if (room <= 0) return revealHand(ctx.state, ctx.seat);
      oppHandPick(ctx, `Choose up to ${m[1]} Basic Pokémon to put onto ${ctx.opp.name}'s Bench`, isBasicPokemon, Math.min(room, toCount(m[1])), "bench", 0);
    },
  },
  {
    re: /Your opponent reveals their hand\. You may use the effect of a Supporter card you find there as the effect of this attack\./,
    post(ctx) {
      const { state, seat, opp } = ctx;
      revealHand(state, seat);
      const list = opp.hand
        .filter((c) => isSupporter(c) && trainerFor(c.name) && !trainerFor(c.name)!.canPlay?.(state, seat, c))
        .map((c) => ({ id: c.uid, label: c.name }));
      if (!list.length) return log(state, seat, `There was no Supporter in ${opp.name}'s hand that could be used.`);
      askChoice(state, seat, "You may choose a Supporter to use its effect", list, E("borrow"), { min: 0, max: 1, data: { botPick: [list[0].id] } });
    },
  },
  { re: /^\s*Your opponent reveals their hand\.\s*$/, post: (ctx) => revealHand(ctx.state, ctx.seat) },

  // Special Conditions.
  {
    re: /(?:The Defending Pokémon|Your opponent's Active Pokémon) is now (Asleep|Burned|Confused|Paralyzed|Poisoned), (Asleep|Burned|Confused|Paralyzed|Poisoned), and (Asleep|Burned|Confused|Paralyzed|Poisoned)\./,
    post: (ctx, m) => run(ctx.state, ctx.seat, { do: "cond", conditions: [m[1], m[2], m[3]], shielded: ctx.shielded }),
  },
];

const cardKind = (kind: string): Match =>
  kind === "Supporter"
    ? isSupporter
    : kind === "Item"
      ? isItem
      : kind === "Trainer"
        ? (c) => c.supertype === "Trainer"
        : kind === "Energy"
          ? isEnergy
          : isPokemon;

function pickAttack(cards: PCard[], id: string): Attack | null {
  const [uid, i] = id.split("|");
  return cards.find((c) => c.uid === uid)?.attacks[Number(i)] ?? null;
}

/** "You may move any amount of Energy from your Pokémon to your other Pokémon": one Energy at a time until the player stops. */
function askMove(state: PState, seat: Seat, type: string | null) {
  const p = state.players[seat];
  if (inPlay(p).length < 2) return;
  const list = energyChoices(state, seat, slotKeys(p), type);
  if (!list.length) return;
  askChoice(state, seat, `You may choose ${type ? `a ${type}` : "an"} Energy to move (choose none to stop)`, list, E("move"), {
    min: 0,
    max: 1,
    data: { type, botPick: [] },
  });
}

const RPS = [
  { id: "rock", label: "Rock" },
  { id: "paper", label: "Paper" },
  { id: "scissors", label: "Scissors" },
];
const beats: Record<string, string> = { rock: "scissors", paper: "rock", scissors: "paper" };
function askRps(state: PState, seat: Seat, attacker: Seat, data: Data) {
  const random = RPS[Math.floor(Math.random() * 3)].id;
  const title = seat === attacker ? "Rock-Paper-Scissors: choose your move" : `Rock-Paper-Scissors against ${state.players[attacker].name}: choose your move`;
  askChoice(state, seat, title, RPS, E("rps"), { data: { ...data, attacker, botPick: [random] } });
}

export const resumes5 = (): Record<string, Resume> => {
  const chained = chain({ play: () => {} } as TrainerEffect).resume!;
  return {
    [E("may")]: (state, seat, picks, data) => run(state, seat, (picks[0] === "yes" ? data.yes : data.no) as Data),
    [E("energy")](state, seat, picks, data) {
      moveEnergy(state, picks, data.dest as Dest);
      run(state, seat, data.next as Data);
    },
    [E("attach")]: chained,
    [E("order")]: chained,
    [E("bottom")](state, seat, picks) {
      const p = state.players[seat];
      if (!picks.length) return log(state, seat, `${p.name} left the top card of their deck where it was.`);
      p.deck.push(...pull(p.deck, picks));
      log(state, seat, `${p.name} put the top card of their deck on the bottom.`);
    },
    [E("oppShuffle")](state, seat, picks) {
      const opp = state.players[otherSeat(seat)];
      if (!picks.length) return log(state, seat, `${state.players[seat].name} left ${opp.name}'s deck as it was.`);
      shuffle(opp.deck);
      log(state, seat, `${opp.name} shuffled their deck.`);
    },
    [E("moveOpp")](state, seat, picks, data) {
      const opp = state.players[otherSeat(seat)];
      if (data.step === "to") {
        const [s, key, uid] = String(data.energy).split("|");
        const from = slotAt(state.players[s as Seat], key as SlotKey);
        const to = slotAt(opp, picks[0] as SlotKey);
        const card = from?.energy.find((e) => e.uid === uid);
        if (!from || !to || !card) return;
        from.energy = from.energy.filter((e) => e !== card);
        to.energy.push(card);
        return log(state, seat, `${card.name} was moved from ${topCard(from).name} to ${topCard(to).name}.`);
      }
      const key = picks[0].split("|")[1];
      ask(state, {
        seat,
        title: "Choose the Pokémon to move the Energy to",
        zone: "oppPokemon",
        options: (data.keys as string[]).filter((k) => k !== key),
        min: 1,
        max: 1,
        effect: E("moveOpp"),
        data: { step: "to", energy: picks[0] },
      });
    },
    [E("discardToHand")](state, seat, picks) {
      const p = state.players[seat];
      const back = pull(p.discard, picks);
      p.hand.push(...back);
      log(state, seat, `${p.name} put ${names(back)} from their discard pile into their hand.`);
    },
    [E("discardToBench")](state, seat, picks) {
      const p = state.players[seat];
      const back = pull(p.discard, picks.slice(0, Math.max(0, benchLimit(state, seat) - p.bench.length)));
      for (const c of back) benchPokemon(state, seat, c);
      log(
        state,
        seat,
        back.length ? `${p.name} put ${names(back)} from their discard pile onto their Bench.` : `${p.name} didn't put any Pokémon onto their Bench.`,
      );
    },
    [E("discardToDeck")](state, seat, picks) {
      const p = state.players[seat];
      const back = pull(p.discard, picks);
      p.deck.push(...back);
      shuffle(p.deck);
      log(state, seat, `${p.name} shuffled ${names(back)} from their discard pile into their deck.`);
    },
    [E("eitherBench")](state, seat, picks) {
      const [s, uid] = picks[0].split("|");
      const owner = state.players[s as Seat];
      const [card] = pull(owner.discard, [uid]);
      if (!card) return;
      benchPokemon(state, s as Seat, card);
      log(state, seat, `${card.name} was put onto ${owner.name}'s Bench from their discard pile.`);
    },
    [E("copyTop")](state, seat, picks) {
      const opp = state.players[otherSeat(seat)];
      const attack = picks.length ? pickAttack(opp.deck, picks[0]) : null;
      shuffle(opp.deck);
      log(state, seat, `${opp.name} shuffled the revealed cards into their deck.`);
      if (attack && state.players[seat].active && opp.active) resolveAttack(state, seat, attack);
    },
    [E("copyOpp")](state, seat, picks, data) {
      const by = data.by as Seat;
      const cards = inPlay(state.players[seat]).map(topCard);
      const attack = pickAttack(cards, picks[0]);
      if (attack && state.players[by].active && state.players[seat].active) resolveAttack(state, by, attack);
    },
    [E("toTop")](state, seat, picks) {
      const p = state.players[seat];
      const cards = pull(p.deck, picks);
      shuffle(p.deck);
      p.deck.unshift(...cards);
      log(state, seat, `${p.name} shuffled their deck and put ${plural(cards.length, "card")} on top of it.`);
      if (cards.length > 1)
        askOrder(
          state,
          seat,
          E("order"),
          cards.map((c) => c.uid),
        );
    },
    [E("deckEnergy")](state, seat, picks, data) {
      const p = state.players[seat];
      let cards = picks.map((u) => p.deck.find((c) => c.uid === u)!).filter(Boolean);
      if (data.different) cards = differentTypes(cards, energyType);
      const limits = data.limits as Record<string, number> | null;
      if (limits) {
        const used: Record<string, number> = {};
        cards = cards.filter((c) => {
          const t = Object.keys(limits).find((x) => c.name.includes(x))!;
          used[t] = (used[t] ?? 0) + 1;
          return used[t] <= limits[t];
        });
      }
      const targets = (data.targets as SlotKey[]).filter((k) => slotAt(p, k));
      if (!cards.length || !targets.length) {
        shuffle(p.deck);
        return log(state, seat, `${p.name} didn't attach any Energy.`);
      }
      if (data.single && targets.length > 1)
        return ask(state, {
          seat,
          title: `Choose 1 Pokémon to attach ${names(cards)} to`,
          zone: "myPokemon",
          options: targets,
          min: 1,
          max: 1,
          effect: E("deckEnergyOne"),
          data: { energy: cards.map((c) => c.uid), step: "target" },
        });
      if (data.single) return resumes5()[E("deckEnergyOne")](state, seat, [targets[0]], { energy: cards.map((c) => c.uid) });
      askAttach(
        state,
        seat,
        E("attach"),
        "deck",
        cards.map((c) => c.uid),
        targets,
        "shuffle",
      );
    },
    [E("deckEnergyOne")](state, seat, picks, data) {
      const p = state.players[seat];
      const slot = slotAt(p, picks[0] as SlotKey);
      const cards = pull(p.deck, data.energy as string[]);
      if (slot) slot.energy.push(...cards);
      else p.deck.push(...cards);
      shuffle(p.deck);
      if (slot) log(state, seat, `${p.name} attached ${names(cards)} to ${topCard(slot).name}.`);
    },
    [E("deckToHand")](state, seat, picks, data) {
      const p = state.players[seat];
      let cards = picks.map((u) => p.deck.find((c) => c.uid === u)!).filter(Boolean);
      const kind = String(data.kind);
      if (/different types/i.test(kind)) cards = differentTypes(cards, /Energy/.test(kind) ? energyType : (c) => c.types);
      ATTACK_RESUME.handFromDeck(
        state,
        seat,
        cards.map((c) => c.uid),
        {},
      );
    },
    [E("maySearch")](state, seat, picks) {
      if (!picks.length) return log(state, seat, `${state.players[seat].name} chose not to search their deck.`);
      ATTACK_RESUME.handFromDeck(state, seat, picks, {});
    },
    [E("evolve")](state, seat, picks, data) {
      const p = state.players[seat];
      const card = p.deck.find((c) => c.uid === picks[0]);
      if (!card) return void shuffle(p.deck);
      const keys = slotKeys(p).filter((k) => topCard(slotAt(p, k)!).name === card.evolvesFrom && (!data.self || k === "active"));
      if (keys.length > 1)
        return ask(state, {
          seat,
          title: `Choose the Pokémon to evolve into ${card.name}`,
          zone: "myPokemon",
          options: keys,
          min: 1,
          max: 1,
          effect: E("evolveOnto"),
          data: { card: card.uid, step: "target" },
        });
      if (keys.length) evolveFromDeck(state, seat, slotAt(p, keys[0])!, card.uid);
      else shuffle(p.deck);
    },
    [E("evolveOnto")](state, seat, picks, data) {
      const slot = slotAt(state.players[seat], picks[0] as SlotKey);
      if (slot) evolveFromDeck(state, seat, slot, String(data.card));
    },
    [E("handEnergy")](state, seat, picks, data) {
      const p = state.players[seat];
      const targets = (data.targets as SlotKey[]).filter((k) => slotAt(p, k));
      if (!picks.length || !targets.length) return;
      askAttach(state, seat, E("attach"), "hand", picks, targets);
    },
    [E("move")](state, seat, picks, data) {
      const p = state.players[seat];
      if (data.step === "to") {
        const [, key, uid] = String(data.energy).split("|");
        const from = slotAt(p, key as SlotKey);
        const to = slotAt(p, picks[0] as SlotKey);
        const card = from?.energy.find((e) => e.uid === uid);
        if (from && to && card) {
          from.energy = from.energy.filter((e) => e !== card);
          to.energy.push(card);
          log(state, seat, `${p.name} moved ${card.name} from ${topCard(from).name} to ${topCard(to).name}.`);
        }
        return askMove(state, seat, (data.type as string) ?? null);
      }
      if (!picks.length) return;
      const key = picks[0].split("|")[1];
      ask(state, {
        seat,
        title: "Choose the Pokémon to move the Energy to",
        zone: "myPokemon",
        options: slotKeys(p).filter((k) => k !== key),
        min: 1,
        max: 1,
        effect: E("move"),
        data: { step: "to", energy: picks[0], type: data.type },
      });
    },
    [E("discardMine")](state, seat, picks, data) {
      const p = state.players[seat];
      const gone = pull(p.hand, picks);
      p.discard.push(...gone);
      if (gone.length) log(state, seat, `${p.name} discarded ${names(gone)}.`);
      run(state, seat, data.next as Data | undefined);
    },
    [E("maySwitch")](state, seat, picks) {
      if (picks.length) ATTACK_RESUME.selfSwitch(state, seat, picks, {});
    },
    [E("hitMine")](state, seat, picks, data) {
      const slot = slotAt(state.players[seat], picks[0] as SlotKey);
      if (!slot) return;
      slot.damage += Number(data.amount);
      log(state, seat, `${data.amount} damage to ${topCard(slot).name}.`);
    },
    [E("rps")](state, seat, picks, data) {
      const attacker = data.attacker as Seat;
      if (seat === attacker) return askRps(state, otherSeat(attacker), attacker, { mine: picks[0] });
      const mine = String(data.mine);
      const theirs = picks[0];
      const me = state.players[attacker];
      log(state, attacker, `Rock-Paper-Scissors: ${me.name} chose ${mine}, ${state.players[seat].name} chose ${theirs}.`);
      if (mine === theirs) return askRps(state, attacker, attacker, {});
      if (beats[mine] !== theirs) return log(state, attacker, `${me.name} lost at Rock-Paper-Scissors.`);
      if (!me.active) return;
      me.active.effects.protect = { turn: state.turn + 1, effects: true };
      log(state, attacker, `${me.name} won, so ${topCard(me.active).name} will be protected from attacks during ${state.players[seat].name}'s next turn.`);
    },
    [E("handToDeck")](state, seat, picks) {
      const p = state.players[seat];
      const back = pull(p.hand, picks);
      p.deck.push(...back);
      shuffle(p.deck);
      log(state, seat, `${p.name} shuffled ${plural(back.length, "card")} from their hand into their deck.`);
    },
    [E("oppHand")](state, seat, picks, data) {
      const oppSeat = otherSeat(seat);
      const opp = state.players[oppSeat];
      const cards = pull(opp.hand, picks);
      if (!cards.length) return;
      switch (data.then) {
        case "bottom":
          opp.deck.push(...cards);
          return log(state, seat, `${names(cards)} went to the bottom of ${opp.name}'s deck.`);
        case "discard":
          opp.discard.push(...cards);
          log(state, seat, `${names(cards)} ${cards.length === 1 ? "was" : "were"} discarded from ${opp.name}'s hand.`);
          return discardedByOpponent(state, oppSeat, cards, "hand");
        case "shuffle":
          opp.deck.push(...cards);
          shuffle(opp.deck);
          return log(state, seat, `${opp.name} shuffled ${plural(cards.length, "card")} from their hand into their deck.`);
        case "bench": {
          const fit = cards.slice(0, Math.max(0, benchLimit(state, oppSeat) - opp.bench.length));
          opp.hand.push(...cards.slice(fit.length));
          for (const c of fit) benchPokemon(state, oppSeat, c);
          return log(state, seat, `${names(fit)} ${fit.length === 1 ? "was" : "were"} put onto ${opp.name}'s Bench.`);
        }
      }
    },
    [E("borrow")](state, seat, picks) {
      const opp = state.players[otherSeat(seat)];
      const card = opp.hand.find((c) => c.uid === picks[0]);
      const effect = card && trainerFor(card.name);
      if (!card || !effect) return;
      log(state, seat, `${state.players[seat].name} used the effect of ${card.name}.`);
      effect.play(state, seat, card);
    },
  };
};
