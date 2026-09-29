// Attack rules: see attack-rules.ts for how they work.

import { otherSeat, type Seat } from "../game-types";
import type { AttackCtx, AttackRule, Resume } from "./attack-rules";
import { ask, draw, evolveSlot, isBasicEnergy, isSupporter, log, plural, shuffle, topCard } from "./engine";
import { attachedTo, baseName, deckGuarded, maxHp, putCounters, setCondition } from "./effects";
import { discardedByOpponent } from "./abilities";
import { askChoice } from "./actions";
import { lock, mark, movedUpThisTurn, myNextTurn, oppNextTurn, turnLog, wasHealed, type LockKind, type MarkKind } from "./lasting";
import type { PCard, PPlayer, PSlot, PState } from "./types";

type Used = { turn: number; attack: string; pokemon: string };
/** Attack effects kept on a Pokémon by these rules (wiped with the rest when it moves to the Bench or evolves). */
type Extra = { used?: Used; baseSet?: { turn: number; attack: string; amount: number } };
const extra = (slot: PSlot) => slot.effects as PSlot["effects"] & Extra;
/** The attacks each player used, newest last (a few turns' worth). */
const usedLog = (p: PPlayer) => ((p as PPlayer & { attacksUsed?: Used[] }).attacksUsed ??= []);

const lastTurnUsed = (state: PState, seat: Seat, pokemon: string | null, attack: string) =>
  usedLog(state.players[seat]).some((u) => u.turn === state.turn - 2 && u.attack === attack && (!pokemon || baseName(u.pokemon) === pokemon));
const thisUsedLastTurn = (state: PState, slot: PSlot, attack: string) => {
  const u = extra(slot).used;
  return !!u && u.turn === state.turn - 2 && u.attack === attack;
};

/** "If this Pokémon evolved from X during this turn". */
const evolvedFrom = (state: PState, slot: PSlot, name: string) =>
  slot.pokemon.length > 1 && slot.playedTurn === state.turn && baseName(slot.pokemon[slot.pokemon.length - 2].name) === name;

const firstTurnSecond = (state: PState, seat: Seat) => state.first !== seat && state.turn === 2;

/** Whether a card the player played from their hand this turn matches the wording (a card name, or "a Supporter card ..."). */
function playedCard(state: PState, seat: Seat, phrase: string) {
  const p = state.players[seat];
  const cardNamed = (name: string): PCard | undefined =>
    [...p.discard, ...p.hand, ...p.deck, ...(p.lost ?? [])].find((c) => c.name === name) ??
    [p.active, ...p.bench].flatMap((s) => (s ? attachedTo(s) : [])).find((c) => c.name === name);
  const supporter = (name: string, test: (c: PCard) => boolean) => {
    const c = cardNamed(name);
    return !!c && isSupporter(c) && test(c);
  };
  let m: RegExpMatchArray | null;
  const played = turnLog(state, seat).played;
  if (/^a Supporter card$/i.test(phrase)) return played.some((n) => supporter(n, () => true));
  if ((m = phrase.match(/^a Supporter card that has "([^"]+)" in its name$/i))) return played.some((n) => n.includes(m![1]) && supporter(n, () => true));
  if ((m = phrase.match(/^an? (\w+) Supporter card$/i))) return played.some((n) => supporter(n, (c) => c.subtypes.includes(m![1])));
  return played.some((n) => baseName(n) === phrase);
}

const LOCK_WORDS: Record<string, LockKind> = {
  Item: "Item",
  Supporter: "Supporter",
  "Pokémon Tool": "Tool",
  Stadium: "Stadium",
  "Special Energy": "Special Energy",
};
function lockCards(ctx: AttackCtx, words: string[]) {
  const kinds = words.map((w) => LOCK_WORDS[w.trim()]).filter(Boolean);
  for (const kind of kinds) lock(ctx.state, { kind, seat: ctx.oppSeat, turn: oppNextTurn(ctx.state), source: ctx.attack.name });
  if (kinds.length)
    log(ctx.state, ctx.seat, `${ctx.opp.name} can't play ${words.map((w) => w.trim()).join(" or ")} cards from their hand during their next turn.`);
}

/** Marks the opponent's Active Pokémon for their next turn, unless the attack's effects can't touch it. */
function markDefender(ctx: AttackCtx, kind: MarkKind, text: string, extraData: { amount?: number; data?: string; turn?: number } = {}) {
  if (ctx.shielded) return;
  mark(ctx.defender, { kind, turn: extraData.turn ?? oppNextTurn(ctx.state), amount: extraData.amount, data: extraData.data, source: ctx.attack.name });
  log(ctx.state, ctx.seat, `${topCard(ctx.defender).name}${text.startsWith("'") ? "" : " "}${text}.`);
}
function markSelf(ctx: AttackCtx, kind: MarkKind, text: string, extraData: { amount?: number; data?: string; turn?: number } = {}) {
  mark(ctx.attacker, { kind, turn: extraData.turn ?? oppNextTurn(ctx.state), amount: extraData.amount, data: extraData.data, source: ctx.attack.name });
  log(ctx.state, ctx.seat, `${topCard(ctx.attacker).name}${text.startsWith("'") ? "" : " "}${text}.`);
}

const PREVENT_FROM: Record<string, string> = {
  Basic: "basic",
  "Basic non-Colorless": "basicNonColorless",
  Evolution: "evolution",
  Burned: "burned",
  Ancient: "Ancient",
};

/** Asks where the next damage counters of "Put N damage counters on your opponent's Pokémon in any way you like" go. */
function askCounters(state: PState, seat: Seat, left: number) {
  const opp = state.players[otherSeat(seat)];
  const options = [...(opp.active ? ["active"] : []), ...opp.bench.map((_, i) => `bench:${i}`)];
  if (left <= 0 || !options.length) return;
  ask(state, {
    seat,
    title: `Choose 1 of ${opp.name}'s Pokémon to put damage counters on (${plural(left, "counter")} left)`,
    zone: "oppPokemon",
    options,
    min: 1,
    max: 1,
    effect: "atk:6:countersWhere",
    data: { left },
  });
}
const slotOf = (p: PPlayer, key: string) => (key === "active" ? p.active : p.bench[Number(key.split(":")[1])]);

export const rules6 = (): AttackRule[] => [
  // Every attack: remember what was used (for "if this Pokémon used X during your last turn"), and apply a changed base damage.
  {
    re: /^/,
    pre(ctx) {
      const used: Used = { turn: ctx.state.turn, attack: ctx.attack.name, pokemon: topCard(ctx.attacker).name };
      const list = usedLog(ctx.p);
      list.push(used);
      list.splice(0, Math.max(0, list.length - 4));
      const base = extra(ctx.attacker).baseSet;
      if (base && base.turn === ctx.state.turn && base.attack === ctx.attack.name) {
        ctx.base = base.amount;
        log(ctx.state, ctx.seat, `${ctx.attack.name}'s base damage is ${base.amount} this turn.`);
      }
      extra(ctx.attacker).used = used;
    },
  },

  // ----- When the attack can be used -----
  {
    re: /You can use this attack only if you go second, and only during your first turn\./i,
    canUse: (state, seat) => (firstTurnSecond(state, seat) ? null : "You can use this attack only if you go second, and only during your first turn."),
  },
  {
    re: /If you go second, you can't use this attack during your first turn\./i,
    canUse: (state, seat) => (firstTurnSecond(state, seat) ? "You can't use this attack during your first turn when you go second." : null),
  },
  // The first-turn permission is checked before the attack (see the report); there's nothing to do once it's used.
  { re: /If you go first, you can use this attack during your first turn\./i },
  {
    re: /You can use this attack only if this Pokémon used ([^.]+?) during your last turn\./i,
    canUse: (state, seat, _a, m) =>
      thisUsedLastTurn(state, state.players[seat].active!, m[1]) ? null : `This Pokémon needs to have used ${m[1]} during your last turn.`,
  },
  {
    re: /You can use this attack only if 1 of your ([^.]+?) used ([^.]+?) during your last turn\./i,
    canUse: (state, seat, _a, m) => (lastTurnUsed(state, seat, m[1], m[2]) ? null : `1 of your ${m[1]} needs to have used ${m[2]} during your last turn.`),
  },
  {
    re: /If 1 of your Pokémon used ([^.]+?) during your last turn, this attack can't be used\./i,
    canUse: (state, seat, _a, m) => (lastTurnUsed(state, seat, null, m[1]) ? `1 of your Pokémon used ${m[1]} during your last turn.` : null),
  },
  {
    re: /You can use this attack only if you have (\d+) or more cards in the Lost Zone\./i,
    canUse(state, seat, attack, m) {
      const p = state.players[seat];
      if (/VSTAR Power/.test(attack.text) && p.vstarUsed) return "You've already used a VSTAR Power this game.";
      return (p.lost ?? []).length >= Number(m[1]) ? null : `You need ${m[1]} or more cards in your Lost Zone.`;
    },
    pre(ctx) {
      if (/VSTAR Power/.test(ctx.attack.text)) ctx.p.vstarUsed = true;
    },
  },
  {
    re: /You can use this attack only if you have no Supporter cards in your discard pile\./i,
    canUse: (state, seat) => (state.players[seat].discard.some(isSupporter) ? "You can't use this attack with a Supporter card in your discard pile." : null),
  },

  // ----- Damage that depends on this turn -----
  {
    re: /If this Pokémon evolved from ([^.,]+?) during this turn, this attack does (\d+) more damage\./i,
    pre(ctx, m) {
      if (evolvedFrom(ctx.state, ctx.attacker, m[1])) ctx.base += Number(m[2]);
    },
  },
  {
    re: /If this Pokémon was healed during this turn, this attack does (\d+) more damage\./i,
    pre(ctx, m) {
      if (wasHealed(ctx.state, ctx.seat, ctx.attacker)) ctx.base += Number(m[1]);
    },
  },
  {
    re: /If this Pokémon moved from your Bench to the Active Spot this turn, this attack does (\d+) more damage\./i,
    pre(ctx, m) {
      if (movedUpThisTurn(ctx.state, ctx.seat, ctx.attacker)) ctx.base += Number(m[1]);
    },
  },
  {
    re: /If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing\./i,
    pre(ctx) {
      if (!movedUpThisTurn(ctx.state, ctx.seat, ctx.attacker)) ctx.nothing = true;
    },
  },
  {
    re: /If you attached a Pokémon Tool card from your hand to this Pokémon during this turn, this attack does (\d+) more damage\./i,
    pre(ctx, m) {
      if (turnLog(ctx.state, ctx.seat).tools.includes(topCard(ctx.attacker).uid)) ctx.base += Number(m[1]);
    },
  },
  {
    re: /If you played ([^,]+?) from your hand during this turn, this attack does (\d+) more damage(?:, and your opponent's Active Pokémon is now (Asleep|Burned|Confused|Paralyzed|Poisoned))?\./i,
    pre(ctx, m) {
      ctx.memo.played6 = playedCard(ctx.state, ctx.seat, m[1]);
      if (ctx.memo.played6) ctx.base += Number(m[2]);
    },
    post(ctx, m) {
      if (!m[3] || !ctx.memo.played6 || ctx.shielded || ctx.opp.active !== ctx.defender) return;
      setCondition(ctx.state, ctx.defender, m[3].toLowerCase() as PSlot["conditions"][number]);
      log(ctx.state, ctx.seat, `${topCard(ctx.defender).name} is now ${m[3]}.`);
    },
  },
  {
    re: /Discard the top card of your opponent's deck\. If you played (an? \w+ Supporter card) from your hand during this turn, discard (\d+) more cards in this way\./i,
    post(ctx, m) {
      const { state, seat, oppSeat, opp } = ctx;
      if (deckGuarded(state, oppSeat)) return void log(state, seat, `Patrol Cap stops ${opp.name}'s deck being discarded.`);
      const gone = opp.deck.splice(0, 1 + (playedCard(state, seat, m[1]) ? Number(m[2]) : 0));
      opp.discard.push(...gone);
      log(state, seat, `${opp.name} discarded the top ${plural(gone.length, "card")} of their deck.`);
      discardedByOpponent(state, oppSeat, gone, "deck");
    },
  },
  {
    re: /Your opponent discards a card from their hand\. If this Pokémon evolved from ([^.,]+?) during this turn, your opponent discards (\d+) more cards\./i,
    post(ctx, m) {
      const n = Math.min(ctx.opp.hand.length, 1 + (evolvedFrom(ctx.state, ctx.attacker, m[1]) ? Number(m[2]) : 0));
      if (!n) return;
      ask(ctx.state, {
        seat: ctx.oppSeat,
        title: `Discard ${plural(n, "card")} from your hand`,
        zone: "hand",
        options: ctx.opp.hand.map((c) => c.uid),
        min: n,
        max: n,
        effect: "discardHand",
      });
    },
  },
  {
    re: /Discard your opponent's Active Pokémon and all attached cards\. If this Pokémon didn't evolve from ([^.,]+?) during this turn, this attack does nothing\./i,
    pre(ctx, m) {
      if (!evolvedFrom(ctx.state, ctx.attacker, m[1])) ctx.nothing = true;
    },
    post(ctx) {
      const { state, seat, opp, defender } = ctx;
      if (ctx.shielded || opp.active !== defender) return;
      opp.discard.push(...defender.pokemon, ...attachedTo(defender));
      opp.active = null;
      log(state, seat, `${topCard(defender).name} and all attached cards were discarded.`);
    },
  },
  {
    re: /If this Pokémon evolved from ([^.,]+?) during this turn, put (\d+) damage counters on that Pokémon instead of 1 during Pokémon Checkup\./i,
    post(ctx, m) {
      if (ctx.shielded || !evolvedFrom(ctx.state, ctx.attacker, m[1])) return;
      ctx.defender.effects.poisonDamage = Number(m[2]) * 10;
      log(ctx.state, ctx.seat, `${topCard(ctx.defender).name} will take ${m[2]} damage counters from Poison.`);
    },
  },
  {
    re: /If you go second and it's your first turn, your opponent's Active Pokémon is now (Asleep|Burned|Confused|Paralyzed|Poisoned)\./i,
    post(ctx, m) {
      if (!firstTurnSecond(ctx.state, ctx.seat) || ctx.shielded || ctx.opp.active !== ctx.defender) return;
      setCondition(ctx.state, ctx.defender, m[1].toLowerCase() as PSlot["conditions"][number]);
      log(ctx.state, ctx.seat, `${topCard(ctx.defender).name} is now ${m[1]}.`);
    },
  },

  // ----- Protection for this Pokémon -----
  {
    re: /During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Pokémon that have an Ability(, except any this Pokémon)?\./i,
    post(ctx, m) {
      const data = m[1] ? `ability&not:${topCard(ctx.attacker).name}` : "ability";
      markSelf(ctx, "prevent", "will be protected from attacks from Pokémon with an Ability next turn", { data });
    },
  },
  {
    re: /During your opponent's next turn, prevent all damage done to this Pokémon by attacks from (Basic non-Colorless|Basic|Evolution|Burned|Ancient) Pokémon\./i,
    post(ctx, m) {
      markSelf(ctx, "prevent", `will be protected from attacks from ${m[1]} Pokémon next turn`, { data: PREVENT_FROM[m[1]] });
    },
  },
  {
    re: /During your opponent's next turn, prevent all damage done to this Pokémon by attacks if that damage is (\d+) or less\./i,
    post(ctx, m) {
      markSelf(ctx, "prevent", `will be protected from attack damage of ${m[1]} or less next turn`, { amount: Number(m[1]) });
    },
  },
  {
    re: /During your opponent's next turn, prevent all damage from attacks done to this Pokémon\./i,
    post(ctx) {
      ctx.attacker.effects.protect = { turn: oppNextTurn(ctx.state), effects: false };
      log(ctx.state, ctx.seat, `${topCard(ctx.attacker).name} will be protected from attacks during ${ctx.opp.name}'s next turn.`);
    },
  },
  {
    re: /During your opponent's next turn, prevent all damage done to each of your (\w+) Pokémon by attacks from Pokémon ex\. If this Pokémon is no longer your Active Pokémon, this effect ends\./i,
    post(ctx, m) {
      const turn = oppNextTurn(ctx.state);
      for (const s of [ctx.p.active, ...ctx.p.bench]) {
        if (s && topCard(s).subtypes.includes(m[1])) mark(s, { kind: "prevent", turn, data: "ex", source: ctx.attack.name });
      }
      log(ctx.state, ctx.seat, `${ctx.p.name}'s ${m[1]} Pokémon will be protected from attacks from Pokémon ex next turn.`);
    },
  },
  {
    re: /During your opponent's next turn, this Pokémon takes (\d+) less damage from attacks from Evolution Pokémon\./i,
    post(ctx, m) {
      markSelf(ctx, "takesLess", `will take ${m[1]} less damage from Evolution Pokémon next turn`, { amount: Number(m[1]), data: "evolution" });
    },
  },
  {
    re: /During your opponent's next turn, this Pokémon takes (\d+) more damage from attacks\./i,
    post(ctx, m) {
      markSelf(ctx, "takesMore", `will take ${m[1]} more damage from attacks next turn`, { amount: Number(m[1]) });
    },
  },
  {
    re: /During your opponent's next turn, if this Pokémon is damaged by an attack, (?:put|place) (\d+) damage counters on the Attacking Pokémon\./i,
    post(ctx, m) {
      markSelf(ctx, "counter", `will put ${m[1]} damage counters on an attacker next turn`, { amount: Number(m[1]) });
    },
  },
  {
    re: /During your opponent's next turn, if this Pokémon is damaged by an attack, put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon\./i,
    post(ctx) {
      markSelf(ctx, "counter", "will hit back at an attacker next turn");
    },
  },
  {
    re: /During your opponent's next turn, if this Pokémon has full HP and would be Knocked Out by damage from an attack, it is not Knocked Out, and its remaining HP becomes (\d+)\./i,
    post(ctx, m) {
      markSelf(ctx, "endure", `will hold on with ${m[1]} HP if Knocked Out from full HP next turn`, { amount: Number(m[1]) });
    },
  },
  {
    re: /During your opponent's next turn, this Pokémon has no Weakness\./i,
    post(ctx) {
      markSelf(ctx, "noWeakness", "has no Weakness during the opponent's next turn");
    },
  },
  {
    re: /Flip a coin\. If heads, during your opponent's next turn, if this Pokémon is Knocked Out, your opponent can't take any Prize cards for it\./i,
    post(ctx) {
      if (ctx.coin()) markSelf(ctx, "prizes", "gives up no Prize cards if Knocked Out next turn", { amount: -99 });
    },
  },

  // ----- This Pokémon during your next turn -----
  {
    re: /During your next turn, this Pokémon can't retreat\./i,
    post(ctx) {
      markSelf(ctx, "noRetreat", "can't retreat during your next turn", { turn: myNextTurn(ctx.state) });
    },
  },
  {
    re: /During your next turn, this Pokémon's attacks do (\d+) more damage to your opponent's Active Pokémon\./i,
    post(ctx, m) {
      markSelf(ctx, "dmgUp", `'s attacks will do ${m[1]} more damage next turn`, { amount: Number(m[1]), turn: myNextTurn(ctx.state) });
    },
  },
  {
    re: /During your next turn, this Pokémon's (.+?) attack's base damage is (\d+)\./i,
    post(ctx, m) {
      extra(ctx.attacker).baseSet = { turn: myNextTurn(ctx.state), attack: m[1], amount: Number(m[2]) };
      log(ctx.state, ctx.seat, `${topCard(ctx.attacker).name}'s ${m[1]} will do ${m[2]} base damage next turn.`);
    },
  },
  {
    re: /During your next turn, your Pokémon can't attack\./i,
    post(ctx) {
      lock(ctx.state, { kind: "attack", seat: ctx.seat, turn: myNextTurn(ctx.state), source: ctx.attack.name });
      log(ctx.state, ctx.seat, `${ctx.p.name}'s Pokémon can't attack during their next turn.`);
    },
  },

  // ----- The Defending Pokémon -----
  {
    re: /During your opponent's next turn, (?:attacks used by the Defending Pokémon do|the Defending Pokémon's attacks do) (\d+) less damage\./i,
    post(ctx, m) {
      markDefender(ctx, "dmgDown", `'s attacks will do ${m[1]} less damage next turn`, { amount: Number(m[1]) });
    },
  },
  {
    re: /During your opponent's next turn, if the Defending Pokémon tries to (?:use an attack|attack), your opponent flips (a coin|(\d+) coins)\. If (?:tails|either of them is tails), that attack doesn't happen\./i,
    post(ctx, m) {
      const n = m[2] ? Number(m[2]) : 1;
      markDefender(ctx, "attackCoin", `will need ${n === 1 ? "heads" : `${n} heads`} to attack next turn`, { amount: n });
    },
  },
  {
    re: /During your opponent's next turn, (?:attacks that the Defending Pokémon uses|attacks used by the Defending Pokémon) cost ((?:Colorless)+) more\./i,
    post(ctx, m) {
      const n = m[1].length / "Colorless".length;
      markDefender(ctx, "costMore", `'s attacks will cost ${plural(n, "Colorless Energy")} more next turn`, { amount: n });
    },
  },
  {
    re: /During your opponent's next turn, the Defending Pokémon can't use attacks\./i,
    post(ctx) {
      markDefender(ctx, "noAttack", "can't attack during its next turn");
    },
  },
  {
    re: /If the Defending Pokémon is (a Basic Pokémon|an Evolution Pokémon|a Pokémon V), it can't attack during your opponent's next turn\./i,
    post(ctx, m) {
      const d = topCard(ctx.defender);
      const basic = d.subtypes.includes("Basic");
      const hit = m[1].includes("Basic") ? basic : m[1].includes("Evolution") ? !basic : d.subtypes.some((s) => ["V", "VSTAR", "VMAX", "V-UNION"].includes(s));
      if (hit) markDefender(ctx, "noAttack", "can't attack during its next turn");
    },
  },
  {
    re: /During your opponent's next turn, that Pokémon can't retreat\./i,
    post(ctx) {
      markDefender(ctx, "noRetreat", "can't retreat during its next turn");
    },
  },
  {
    re: /During your next turn, the Defending Pokémon takes (\d+) more damage from attacks\./i,
    post(ctx, m) {
      markDefender(ctx, "takesMore", `will take ${m[1]} more damage from attacks during ${ctx.p.name}'s next turn`, {
        amount: Number(m[1]),
        turn: myNextTurn(ctx.state),
      });
    },
  },
  {
    re: /During your next turn, if the Defending Pokémon is Knocked Out, take (\d+) more Prize cards\./i,
    post(ctx, m) {
      markDefender(ctx, "prizes", `gives up ${m[1]} more Prize cards if Knocked Out during ${ctx.p.name}'s next turn`, {
        amount: Number(m[1]),
        turn: myNextTurn(ctx.state),
      });
    },
  },
  {
    re: /Until the end of your next turn, the Defending Pokémon's Weakness is now (\w+)\./i,
    post(ctx, m) {
      if (ctx.shielded) return;
      for (const turn of [oppNextTurn(ctx.state), myNextTurn(ctx.state)]) mark(ctx.defender, { kind: "weakness", turn, data: m[1], source: ctx.attack.name });
      log(ctx.state, ctx.seat, `${topCard(ctx.defender).name}'s Weakness is ${m[1]} until the end of ${ctx.p.name}'s next turn.`);
    },
  },
  {
    re: /During your opponent's next turn, (?:Energy can't be attached from your opponent's hand to the Defending Pokémon|Energy cards can't be attached from your opponent's hand to that Pokémon)\./i,
    post(ctx) {
      markDefender(ctx, "noEnergy", "can't have Energy attached from the hand next turn");
    },
  },
  {
    re: /During your opponent's next turn, whenever they attach an Energy card from their hand to the Defending Pokémon, place (\d+) damage counters on that Pokémon\./i,
    post(ctx, m) {
      markDefender(ctx, "onEnergy", `will take ${m[1]} damage counters for each Energy attached from the hand next turn`, {
        amount: Number(m[1]),
        data: "counters",
      });
    },
  },
  {
    re: /During your opponent's next turn, if they attach an Energy card from their hand to the Defending Pokémon, their turn ends\./i,
    post(ctx) {
      markDefender(ctx, "onEnergy", "ends its owner's turn if Energy is attached to it from the hand next turn", { data: "endTurn" });
    },
  },
  {
    re: /During your opponent's next turn, if an Energy card is attached to the Defending Pokémon from your opponent's hand, that Pokémon will be Asleep\./i,
    post(ctx) {
      markDefender(ctx, "onEnergy", "will fall Asleep if Energy is attached to it from the hand next turn", { data: "sleep" });
    },
  },
  {
    re: /During your opponent's next turn, Pokémon can't be played from your opponent's hand to evolve the Defending Pokémon\./i,
    post(ctx) {
      markDefender(ctx, "noEvolve", "can't evolve during its next turn");
    },
  },
  {
    re: /Choose 1 of your opponent's Active Pokémon's attacks\. During your opponent's next turn, that Pokémon can't use that attack\./i,
    post(ctx) {
      const attacks = topCard(ctx.defender).attacks;
      if (ctx.shielded || !attacks.length) return;
      askChoice(
        ctx.state,
        ctx.seat,
        `Choose 1 of ${topCard(ctx.defender).name}'s attacks it can't use next turn`,
        attacks.map((a, i) => ({ id: String(i), label: a.name })),
        "atk:6:torment",
        { data: { botPick: [String(attacks.length - 1)], source: ctx.attack.name } },
      );
    },
  },

  // ----- What the opponent can play -----
  {
    re: /Flip a coin\. If heads, during your opponent's next turn, they can't play any (\w+) cards from their hand\. If tails, during your opponent's next turn, they can't play any (\w+) cards from their hand\./i,
    post(ctx, m) {
      lockCards(ctx, [ctx.coin() ? m[1] : m[2]]);
    },
  },
  {
    re: /(Flip a coin\. If heads, d|D)uring your opponent's next turn, they can't play any ((?:Item|Supporter|Pokémon Tool|Stadium|Special Energy)(?: or (?:Item|Supporter|Pokémon Tool|Stadium|Special Energy))*) cards from their hand\./i,
    post(ctx, m) {
      if (m[1].startsWith("Flip") && !ctx.coin()) return;
      lockCards(ctx, m[2].split(" or "));
    },
  },
  {
    re: /Your opponent can't play any (\w+) cards from their hand during their next turn\./i,
    post(ctx, m) {
      lockCards(ctx, [m[1]]);
    },
  },
  {
    re: /Choose Item cards or Supporter cards\. During your opponent's next turn, they can't play any of the chosen cards from their hand\./i,
    post(ctx) {
      askChoice(
        ctx.state,
        ctx.seat,
        `Choose which cards ${ctx.opp.name} can't play during their next turn`,
        [
          { id: "Item", label: "Item cards" },
          { id: "Supporter", label: "Supporter cards" },
        ],
        "atk:6:lockChoice",
        { data: { botPick: [ctx.opp.hand.filter(isSupporter).length ? "Supporter" : "Item"], source: ctx.attack.name } },
      );
    },
  },
  {
    re: /During your opponent's next turn, they can't play any Pokémon from their hand to evolve their Pokémon\./i,
    post(ctx) {
      lock(ctx.state, { kind: "evolve", seat: ctx.oppSeat, turn: oppNextTurn(ctx.state), source: ctx.attack.name });
      log(ctx.state, ctx.seat, `${ctx.opp.name} can't evolve Pokémon from their hand during their next turn.`);
    },
  },
  {
    re: /During your opponent's next turn, Pokémon that have (\d+) or less Energy attached can't attack\./i,
    post(ctx, m) {
      lock(ctx.state, { kind: "lowEnergy", seat: ctx.oppSeat, turn: oppNextTurn(ctx.state), amount: Number(m[1]), source: ctx.attack.name });
      log(ctx.state, ctx.seat, `${ctx.opp.name}'s Pokémon with ${m[1]} or less Energy can't attack during their next turn.`);
    },
  },
  {
    re: /During your opponent's next turn, whenever they flip a coin, treat it as tails\./i,
    post(ctx) {
      lock(ctx.state, { kind: "tails", seat: ctx.oppSeat, turn: oppNextTurn(ctx.state), source: ctx.attack.name });
      log(ctx.state, ctx.seat, `Every coin ${ctx.opp.name} flips during their next turn will be tails.`);
    },
  },

  // ----- Other effects -----
  {
    re: /Discard your hand and draw (\d+) cards\./i,
    post(ctx, m) {
      const { state, seat, p } = ctx;
      p.discard.push(...p.hand.splice(0));
      draw(p, Number(m[1]));
      log(state, seat, `${p.name} discarded their hand and drew ${plural(Number(m[1]), "card")}.`);
    },
  },
  {
    re: /Your opponent's Active Pokémon is Knocked Out\./i,
    post(ctx) {
      if (ctx.shielded || ctx.opp.active !== ctx.defender) return;
      ctx.defender.damage = Math.max(ctx.defender.damage, maxHp(ctx.state, ctx.defender));
      log(ctx.state, ctx.seat, `${ctx.attack.name} Knocks Out ${topCard(ctx.defender).name}.`);
    },
  },
  {
    re: /Put (\d+) damage counters on your opponent's Pokémon in any way you like\./i,
    post(ctx, m) {
      askCounters(ctx.state, ctx.seat, Number(m[1]));
    },
  },
  {
    re: /Shuffle 1 of your opponent's Benched Pokémon and all attached cards into their deck\./i,
    post(ctx) {
      if (!ctx.opp.bench.length) return;
      ask(ctx.state, {
        seat: ctx.seat,
        title: `Choose 1 of ${ctx.opp.name}'s Benched Pokémon to shuffle into their deck`,
        zone: "oppBench",
        options: ctx.opp.bench.map((_, i) => `bench:${i}`),
        min: 1,
        max: 1,
        effect: "atk:6:benchToDeck",
      });
    },
  },
  {
    re: /Search your deck for an? (\w+) Energy card and attach it to this Pokémon\. Then, shuffle your deck\./i,
    post(ctx, m) {
      const { state, seat, p } = ctx;
      const options = p.deck.filter((c) => isBasicEnergy(c) && c.name.includes(m[1])).map((c) => c.uid);
      if (!options.length) return void shuffle(p.deck);
      ask(state, {
        seat,
        title: `Choose a ${m[1]} Energy card to attach to ${topCard(ctx.attacker).name}`,
        zone: "deck",
        options,
        shown: p.deck.map((c) => c.uid),
        min: 0,
        max: 1,
        effect: "atk:6:energyToSelf",
      });
    },
  },
  {
    re: /Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it\. Then, shuffle your deck\./i,
    post(ctx) {
      const { state, seat, p } = ctx;
      const name = topCard(ctx.attacker).name;
      const options = p.deck.filter((c) => c.evolvesFrom === name).map((c) => c.uid);
      if (!options.length) return void shuffle(p.deck);
      ask(state, {
        seat,
        title: `Choose a card to evolve ${name} into`,
        zone: "deck",
        options,
        shown: p.deck.map((c) => c.uid),
        min: 0,
        max: 1,
        effect: "atk:6:evolveSelf",
      });
    },
  },
  {
    re: /Choose up to (\d+) of your Benched Pokémon\. For each of those Pokémon, search your deck for a basic Energy card and attach it to that Pokémon\. Then, shuffle your deck\./i,
    post(ctx, m) {
      const { state, seat, p } = ctx;
      if (!p.bench.length || !p.deck.some(isBasicEnergy)) return void shuffle(p.deck);
      ask(state, {
        seat,
        title: `Choose up to ${m[1]} Benched Pokémon to attach a basic Energy card to`,
        zone: "myBench",
        options: p.bench.map((_, i) => `bench:${i}`),
        min: 0,
        max: Math.min(Number(m[1]), p.bench.length),
        effect: "atk:6:energyEach",
      });
    },
  },
  // ----- Hooks in the engine and effects.ts -----
  // Other costs are worked out in attackCost (effects.ts), and attacking from the Bench in engine.ts; nothing to do once the attack is used.
  { re: /If [^.]+?, this attack can be used for (?:[A-Z][a-z]+)+(?: Energy)?\./ },
  { re: /If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost\./i },
  { re: /This attack can be used even if this Pokémon is on the Bench\./i },
  {
    re: /If this Pokémon was damaged by an attack during your opponent's last turn, this attack does that much more damage\./i,
    pre: (ctx) => {
      const hit = ctx.attacker.lastHit;
      if (hit && hit.turn === ctx.state.turn - 1) ctx.base += hit.amount;
    },
  },
  {
    re: /At the end of your opponent's next turn, the Defending Pokémon will be Knocked Out\./i,
    post: (ctx) => markDefender(ctx, "koAtEnd", `will be Knocked Out at the end of ${ctx.opp.name}'s next turn`),
  },
  {
    re: /At the end of your opponent's next turn, discard the Defending Pokémon and all attached cards\./i,
    post: (ctx) => markDefender(ctx, "discardAtEnd", `will be discarded at the end of ${ctx.opp.name}'s next turn`),
  },
  {
    re: /Take another turn after this one\./i,
    post: (ctx) => {
      ctx.state.extraTurn = ctx.seat;
      log(ctx.state, ctx.seat, `${ctx.p.name} will take another turn after this one.`);
    },
  },
  {
    re: /Until this Pokémon leaves play, it gains an Ability that has the effect "[^"]+"/i,
    post: (ctx) => {
      (ctx.attacker.gained ??= []).push(ctx.attack.name);
      log(ctx.state, ctx.seat, `${topCard(ctx.attacker).name} gained an Ability from ${ctx.attack.name}.`);
    },
  },
  {
    re: /During Pokémon Checkup, (your opponent flips|flip) 2 coins instead of 1\. If either of them is tails, (that|this) Pokémon is still Asleep\./i,
    post: (ctx, m) => {
      const slot = m[2].toLowerCase() === "this" ? ctx.attacker : ctx.defender;
      if (slot === ctx.defender && ctx.shielded) return;
      // Lasts while it stays Asleep (see Pokémon Checkup in engine.ts).
      mark(slot, { kind: "deepSleep", turn: ctx.state.turn, source: ctx.attack.name });
    },
  },
  {
    re: /Put (\d+) damage counters instead of 3 on that Pokémon for this Special Condition\./i,
    post: (ctx, m) => {
      if (ctx.shielded || ctx.opp.active !== ctx.defender) return;
      ctx.defender.effects.confuseDamage = Number(m[1]) * 10;
    },
  },
  {
    re: /At the end of your opponent's next turn, put (\d+) damage counters on the Defending Pokémon\./i,
    post: (ctx, m) => markDefender(ctx, "endCounters", `will get ${m[1]} damage counters at the end of ${ctx.opp.name}'s next turn`, { amount: Number(m[1]) }),
  },
  {
    re: /During your opponent's next turn, prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon\./i,
    post: (ctx) => markSelf(ctx, "effectsProof", "is protected from the effects of attacks during the opponent's next turn"),
  },
];

export const resumes6 = (): Record<string, Resume> => ({
  "atk:6:torment"(state, seat, picks, data) {
    const d = state.players[otherSeat(seat)].active;
    const attack = d && topCard(d).attacks[Number(picks[0])];
    if (!d || !attack) return;
    mark(d, { kind: "noAttack", turn: oppNextTurn(state), data: attack.name, source: String(data.source ?? "") || undefined });
    log(state, seat, `${topCard(d).name} can't use ${attack.name} during its next turn.`);
  },
  "atk:6:lockChoice"(state, seat, picks, data) {
    const kind = picks[0] === "Supporter" ? "Supporter" : "Item";
    lock(state, { kind, seat: otherSeat(seat), turn: oppNextTurn(state), source: String(data.source ?? "An attack") });
    log(state, seat, `${state.players[otherSeat(seat)].name} can't play ${kind} cards from their hand during their next turn.`);
  },
  "atk:6:countersWhere"(state, seat, picks, data) {
    const left = Number(data.left);
    const slot = slotOf(state.players[otherSeat(seat)], picks[0]);
    if (!slot) return;
    const counts = Array.from({ length: left }, (_, i) => String(i + 1));
    ask(state, {
      seat,
      title: `How many damage counters on ${topCard(slot).name}?`,
      zone: "choice",
      options: counts,
      labels: Object.fromEntries(counts.map((n) => [n, n])),
      min: 1,
      max: 1,
      effect: "atk:6:countersHowMany",
      data: { left, key: picks[0], botPick: [String(left)] },
    });
  },
  "atk:6:countersHowMany"(state, seat, picks, data) {
    const slot = slotOf(state.players[otherSeat(seat)], String(data.key));
    const n = Math.min(Number(picks[0]) || 1, Number(data.left));
    if (slot) {
      putCounters(state, seat, slot, n);
      log(state, seat, `${plural(n, "damage counter")} on ${topCard(slot).name}.`);
    }
    askCounters(state, seat, Number(data.left) - n);
  },
  "atk:6:benchToDeck"(state, seat, picks) {
    const opp = state.players[otherSeat(seat)];
    const slot = opp.bench[Number(picks[0]?.split(":")[1])];
    if (!slot) return;
    opp.bench.splice(opp.bench.indexOf(slot), 1);
    opp.deck.push(...slot.pokemon, ...attachedTo(slot));
    shuffle(opp.deck);
    log(state, seat, `${topCard(slot).name} and all attached cards were shuffled into ${opp.name}'s deck.`);
  },
  "atk:6:energyToSelf"(state, seat, picks) {
    const p = state.players[seat];
    const card = p.deck.find((c) => c.uid === picks[0]);
    if (card && p.active) {
      p.deck.splice(p.deck.indexOf(card), 1);
      p.active.energy.push(card);
      log(state, seat, `${p.name} attached ${card.name} to ${topCard(p.active).name}.`);
    }
    shuffle(p.deck);
  },
  "atk:6:evolveSelf"(state, seat, picks) {
    const p = state.players[seat];
    const card = p.deck.find((c) => c.uid === picks[0]);
    if (card && p.active) {
      p.deck.splice(p.deck.indexOf(card), 1);
      const from = topCard(p.active).name;
      evolveSlot(state, p.active, card);
      log(state, seat, `${p.name} evolved ${from} into ${card.name}.`);
    }
    shuffle(p.deck);
  },
  "atk:6:energyEach"(state, seat, picks, data) {
    const p = state.players[seat];
    // Benched Pokémon are remembered by their first card, so the order can't get mixed up.
    const queue = (data.queue as string[] | undefined) ?? picks.map((k) => p.bench[Number(k.split(":")[1])]?.pokemon[0].uid).filter(Boolean);
    if (data.current && picks.length) {
      const slot = p.bench.find((s) => s.pokemon[0].uid === data.current);
      const card = p.deck.find((c) => c.uid === picks[0]);
      if (slot && card) {
        p.deck.splice(p.deck.indexOf(card), 1);
        slot.energy.push(card);
        log(state, seat, `${p.name} attached ${card.name} to ${topCard(slot).name}.`);
      }
    }
    const next = queue[0];
    const slot = next ? p.bench.find((s) => s.pokemon[0].uid === next) : undefined;
    const options = p.deck.filter(isBasicEnergy).map((c) => c.uid);
    if (!slot || !options.length) return void shuffle(p.deck);
    ask(state, {
      seat,
      title: `Choose a basic Energy card to attach to ${topCard(slot).name}`,
      zone: "deck",
      options,
      shown: p.deck.map((c) => c.uid),
      min: 1,
      max: 1,
      effect: "atk:6:energyEach",
      data: { queue: queue.slice(1), current: next },
    });
  },
});
