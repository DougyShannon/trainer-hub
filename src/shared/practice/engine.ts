// Rules engine for practice games against the computer. It enforces the core rules of the
// Pokémon TCG: setup and mulligans, one Energy and one Supporter per turn, evolving, retreating,
// attack costs, damage with Weakness and Resistance, Special Conditions, Knock Outs, prizes and
// the ways to win. Common Trainer cards are automated in trainers.ts and trainers-more.ts; anything else is
// played "by hand" with the moves in manual.ts.

import { otherSeat, type Condition, type Seat } from "../game-types";
import type { PAction, PCard, PPlayer, PSlot, PState, Prompt, SlotKey } from "./types";
import { ATTACK_RESUME, resolveAttack } from "./attacks";
import { AUTOMATED_TOOLS, trainerFor, toolHpBonus } from "./trainers";
import { FIRST_TURN_SUPPORTERS } from "./trainers-more";
import { applyManual, MANUAL_RESUME } from "./manual";

export class RuleError extends Error {}
export const fail = (message: string): never => {
  throw new RuleError(message);
};

export const BENCH_SIZE = 5;
export const PRIZES = 6;
const LOG_LIMIT = 300;

// ----- Small helpers -----

export const topCard = (slot: PSlot) => slot.pokemon[slot.pokemon.length - 1];
export const isPokemon = (c: PCard) => c.supertype === "Pokémon";
export const isBasicPokemon = (c: PCard) => isPokemon(c) && c.subtypes.includes("Basic");
export const isEnergy = (c: PCard) => c.supertype === "Energy";
export const isBasicEnergy = (c: PCard) => isEnergy(c) && c.subtypes.includes("Basic");
export const isTool = (c: PCard) => c.supertype === "Trainer" && c.subtypes.some((s) => s.startsWith("Pokémon Tool"));
export const isSupporter = (c: PCard) => c.supertype === "Trainer" && c.subtypes.includes("Supporter");
export const isStadium = (c: PCard) => c.supertype === "Trainer" && c.subtypes.includes("Stadium");
export const isItem = (c: PCard) => c.supertype === "Trainer" && c.subtypes.includes("Item");

export function shuffle<T>(list: T[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
export const flip = () => Math.random() < 0.5;

export const ENERGY_TYPES = ["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Fairy", "Dragon"];

/** The Energy units a card provides, e.g. ["Fire"] or ["Colorless", "Colorless"]. */
export function energyProvides(c: PCard): string[] {
  if (isBasicEnergy(c)) {
    const type = ENERGY_TYPES.find((t) => c.name.includes(t));
    return [type ?? "Colorless"];
  }
  if (c.name === "Double Turbo Energy" || c.name === "Double Colorless Energy") return ["Colorless", "Colorless"];
  return ["Colorless"];
}

/** Whether these Energy cards can pay a cost like ["Fire", "Colorless"]. */
export function canPay(cost: string[], energy: PCard[]) {
  const units = energy.flatMap(energyProvides);
  const pool = [...units];
  for (const need of cost.filter((c) => c !== "Colorless" && c !== "Free")) {
    const i = pool.indexOf(need);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return pool.length >= cost.filter((c) => c === "Colorless").length;
}

export const maxHp = (slot: PSlot) => (topCard(slot).hp ?? 0) + toolHpBonus(slot);
export const hpLeft = (slot: PSlot) => maxHp(slot) - slot.damage;

/** How many Prize cards the opponent takes when this Pokémon is Knocked Out. */
export function prizeValue(c: PCard) {
  const words: Record<string, number> = { two: 2, three: 3, "2": 2, "3": 3 };
  for (const rule of c.rules) {
    const m = rule.match(/takes (\w+) (?:more )?Prize cards?/i);
    if (m) {
      const n = words[m[1].toLowerCase()];
      if (n) return rule.includes("more") ? 1 + n : n;
    }
  }
  if (c.subtypes.includes("VMAX")) return 3;
  if (c.subtypes.some((s) => ["ex", "EX", "GX", "V", "VSTAR"].includes(s))) return 2;
  return 1;
}

export function slotAt(p: PPlayer, key: SlotKey): PSlot | null {
  if (key === "active") return p.active;
  return p.bench[Number(key.split(":")[1])] ?? null;
}
export const slotKeys = (p: PPlayer): SlotKey[] => [...(p.active ? ["active" as SlotKey] : []), ...p.bench.map((_, i) => `bench:${i}` as SlotKey)];

export const newSlot = (card: PCard, turn: number): PSlot => ({
  pokemon: [card],
  energy: [],
  tool: null,
  damage: 0,
  conditions: [],
  playedTurn: turn,
  cantAttackTurn: null,
  effects: {},
});

export function log(state: PState, seat: Seat | null, text: string, kind?: "turn" | "attack" | "ko" | "coin" | "system") {
  const n = (state.log[state.log.length - 1]?.n ?? 0) + 1;
  state.log.push({ n, seat, text, kind });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Draws cards. Returns false if the deck ran out (which only loses at the start of a turn). */
export function draw(p: PPlayer, count: number) {
  for (let i = 0; i < count; i++) {
    const c = p.deck.shift();
    if (!c) return false;
    p.hand.push(c);
  }
  return true;
}

export function takeFromHand(p: PPlayer, uid: string) {
  const i = p.hand.findIndex((c) => c.uid === uid);
  if (i < 0) fail("That card isn't in your hand.");
  return p.hand.splice(i, 1)[0];
}

/** Moves a Pokémon in play and everything on it to the discard pile. */
export function discardSlot(p: PPlayer, slot: PSlot) {
  p.discard.push(...slot.pokemon, ...slot.energy, ...(slot.tool ? [slot.tool] : []));
}

// ----- Starting a game -----

export type Side = { name: string; cards: PCard[] };

export function newPracticeGame(p1: Side, p2: Side): PState {
  const player = (side: Side): PPlayer => ({
    name: side.name,
    deck: shuffle([...side.cards]),
    hand: [],
    prizes: [],
    discard: [],
    active: null,
    bench: [],
    mulligans: 0,
    energyAttached: false,
    supporterPlayed: false,
    retreated: false,
    stadiumPlayed: false,
  });
  const state: PState = {
    status: "setup",
    players: { p1: player(p1), p2: player(p2) },
    stadium: null,
    turn: 0,
    current: "p1",
    first: "p1",
    prompt: null,
    queue: [],
    winner: null,
    endReason: null,
    log: [],
    setupDone: { p1: false, p2: false },
    pendingEnd: false,
  };
  for (const seat of ["p1", "p2"] as Seat[]) {
    const p = state.players[seat];
    for (;;) {
      draw(p, 7);
      if (p.hand.some(isBasicPokemon)) break;
      if (![...p.deck, ...p.hand].some(isBasicPokemon)) fail(`${p.name}'s deck has no Basic Pokémon.`);
      p.mulligans++;
      p.deck.push(...p.hand.splice(0));
      shuffle(p.deck);
    }
    if (p.mulligans) log(state, seat, `${p.name} had no Basic Pokémon and took ${plural(p.mulligans, "mulligan")}.`);
  }
  // A player draws a card for each extra mulligan their opponent took.
  for (const seat of ["p1", "p2"] as Seat[]) {
    const extra = Math.max(0, state.players[otherSeat(seat)].mulligans - state.players[seat].mulligans);
    if (extra) {
      draw(state.players[seat], extra);
      log(state, seat, `${state.players[seat].name} drew ${plural(extra, "extra card")} for the mulligans.`);
    }
  }
  log(state, null, "Both players drew 7 cards. Choose your Active Pokémon and Bench.", "system");
  return state;
}

function finishSetup(state: PState) {
  for (const seat of ["p1", "p2"] as Seat[]) {
    const p = state.players[seat];
    p.prizes = p.deck.splice(0, PRIZES);
  }
  state.first = flip() ? "p1" : "p2";
  state.current = state.first;
  state.status = "playing";
  state.turn = 1;
  log(state, null, `Coin flip: ${state.players[state.first].name} goes first.`, "coin");
  startTurn(state);
}

function startTurn(state: PState) {
  const p = state.players[state.current];
  p.energyAttached = false;
  p.supporterPlayed = false;
  p.retreated = false;
  p.stadiumPlayed = false;
  log(state, state.current, `Turn ${state.turn}: ${p.name}'s turn.`, "turn");
  if (!draw(p, 1)) return win(state, otherSeat(state.current), `${p.name} couldn't draw a card at the start of their turn.`);
}

export function win(state: PState, seat: Seat, reason: string) {
  if (state.status === "finished") return;
  state.status = "finished";
  state.winner = seat;
  state.endReason = reason;
  state.prompt = null;
  log(state, seat, `${reason} ${state.players[seat].name} wins!`, "system");
}

// ----- What's allowed right now -----

export const canEvolveNow = (state: PState, slot: PSlot) => state.turn > 2 && slot.playedTurn !== state.turn;

export function evolveTargets(state: PState, seat: Seat, card: PCard): SlotKey[] {
  const p = state.players[seat];
  if (!isPokemon(card) || isBasicPokemon(card) || !card.evolvesFrom) return [];
  return slotKeys(p).filter((k) => {
    const s = slotAt(p, k)!;
    return topCard(s).name === card.evolvesFrom && canEvolveNow(state, s);
  });
}

/** Why the active Pokémon can't attack right now, or null if it can. */
export function cantAttackReason(state: PState, seat: Seat): string | null {
  const p = state.players[seat];
  if (state.turn === 1) return "The player who goes first can't attack on their first turn.";
  if (!p.active) return "You have no Active Pokémon.";
  if (p.active.conditions.includes("asleep")) return "Your Active Pokémon is Asleep.";
  if (p.active.conditions.includes("paralyzed")) return "Your Active Pokémon is Paralyzed.";
  if (p.active.cantAttackTurn === state.turn) return "This Pokémon can't attack this turn.";
  return null;
}

export function usableAttacks(state: PState, seat: Seat): number[] {
  const p = state.players[seat];
  if (cantAttackReason(state, seat) || !p.active) return [];
  return topCard(p.active)
    .attacks.map((a, i) => (canPay(attackCost(state, p.active!, a), p.active!.energy) ? i : -1))
    .filter((i) => i >= 0);
}

export function retreatCost(slot: PSlot, turn = 0) {
  return topCard(slot).retreat + (slot.effects.retreatTax === turn ? 1 : 0);
}

/** An attack's Energy cost, including any extra an opponent's attack added this turn. */
export const attackCost = (state: PState, slot: PSlot, attack: { cost: string[] }) =>
  slot.effects.attackTax === state.turn ? [...attack.cost, "Colorless"] : attack.cost;

export function cantRetreatReason(state: PState, seat: Seat): string | null {
  const p = state.players[seat];
  if (!p.active) return "You have no Active Pokémon.";
  if (!p.bench.length) return "You have no Benched Pokémon to switch in.";
  if (p.retreated) return "You've already retreated this turn.";
  if (p.active.conditions.some((c) => c === "asleep" || c === "paralyzed")) return "Asleep or Paralyzed Pokémon can't retreat.";
  if (p.active.effects.cantRetreat === state.turn) return "An attack stops this Pokémon retreating this turn.";
  const units = p.active.energy.flatMap(energyProvides).length;
  if (units < retreatCost(p.active, state.turn)) return `Retreating costs ${plural(retreatCost(p.active, state.turn), "Energy")}.`;
  return null;
}

/** Why a Trainer card can't be played now, or null if it can. */
export function cantPlayTrainerReason(state: PState, seat: Seat, card: PCard): string | null {
  const p = state.players[seat];
  if (isTool(card)) return slotKeys(p).some((k) => !slotAt(p, k)!.tool) ? null : "All your Pokémon already have a Tool.";
  if (isSupporter(card)) {
    if (p.supporterPlayed) return "You've already played a Supporter this turn.";
    if (state.turn === 1 && !FIRST_TURN_SUPPORTERS.includes(card.name)) return "The player who goes first can't play a Supporter on their first turn.";
  }
  if (isStadium(card)) {
    if (p.stadiumPlayed) return "You've already played a Stadium this turn.";
    if (state.stadium?.card.name === card.name) return "That Stadium is already in play.";
  }
  const effect = trainerFor(card.name);
  return effect?.canPlay?.(state, seat, card) ?? null;
}

/** Whether playing this card does what it says. Stadiums and most Tools don't do anything yet. */
export const isAutomated = (card: PCard) =>
  card.supertype !== "Trainer" || (isTool(card) ? AUTOMATED_TOOLS.includes(card.name) : !!trainerFor(card.name));

// ----- Doing things -----

function mustBeYourTurn(state: PState, seat: Seat) {
  if (state.status !== "playing") fail("The game isn't in progress.");
  if (state.prompt) fail("Finish the current choice first.");
  if (state.pendingEnd) fail("The turn is ending.");
  if (state.current !== seat) fail("It's not your turn.");
}

export function applyPractice(state: PState, seat: Seat, action: PAction) {
  const p = state.players[seat];
  const opp = state.players[otherSeat(seat)];

  switch (action.type) {
    case "concede": {
      if (state.status === "finished") return;
      return win(state, otherSeat(seat), `${p.name} conceded.`);
    }

    case "setup": {
      if (state.status !== "setup" || state.setupDone[seat]) fail("Setup is already done.");
      const active = p.hand.find((c) => c.uid === action.active);
      if (!active || !isBasicPokemon(active)) fail("Choose a Basic Pokémon for your Active Spot.");
      const bench = [...new Set(action.bench)].filter((u) => u !== action.active);
      if (bench.length > BENCH_SIZE) fail(`Your Bench holds ${BENCH_SIZE} Pokémon.`);
      p.active = newSlot(takeFromHand(p, active!.uid), 0);
      for (const uid of bench) {
        const c = p.hand.find((x) => x.uid === uid);
        if (!c || !isBasicPokemon(c)) fail("Only Basic Pokémon can go on your Bench.");
        p.bench.push(newSlot(takeFromHand(p, uid), 0));
      }
      state.setupDone[seat] = true;
      log(state, seat, `${p.name} is ready.`);
      if (state.setupDone.p1 && state.setupDone.p2) finishSetup(state);
      return;
    }

    case "choose":
      return resolvePrompt(state, seat, action.picks);

    case "playBasic": {
      mustBeYourTurn(state, seat);
      const card = p.hand.find((c) => c.uid === action.uid) ?? fail("That card isn't in your hand.");
      if (!isBasicPokemon(card)) fail("Only Basic Pokémon can be played onto the Bench.");
      if (p.bench.length >= BENCH_SIZE) fail("Your Bench is full.");
      p.bench.push(newSlot(takeFromHand(p, card.uid), state.turn));
      log(state, seat, `${p.name} put ${card.name} on the Bench.`);
      return;
    }

    case "evolve": {
      mustBeYourTurn(state, seat);
      const card = p.hand.find((c) => c.uid === action.uid) ?? fail("That card isn't in your hand.");
      if (!evolveTargets(state, seat, card).includes(action.slot)) {
        fail(state.turn <= 2 ? "Neither player can evolve on their first turn." : `${card.name} can't evolve that Pokémon right now.`);
      }
      const slot = slotAt(p, action.slot)!;
      const from = topCard(slot).name;
      evolveSlot(state, slot, takeFromHand(p, card.uid));
      log(state, seat, `${p.name} evolved ${from} into ${card.name}.`);
      return;
    }

    case "attachEnergy": {
      mustBeYourTurn(state, seat);
      if (p.energyAttached) fail("You've already attached an Energy this turn.");
      const card = p.hand.find((c) => c.uid === action.uid) ?? fail("That card isn't in your hand.");
      if (!isEnergy(card)) fail("That isn't an Energy card.");
      const slot = slotAt(p, action.slot) ?? fail("There's no Pokémon there.");
      slot.energy.push(takeFromHand(p, card.uid));
      p.energyAttached = true;
      log(state, seat, `${p.name} attached ${card.name} to ${topCard(slot).name}.`);
      return;
    }

    case "attachTool": {
      mustBeYourTurn(state, seat);
      const card = p.hand.find((c) => c.uid === action.uid) ?? fail("That card isn't in your hand.");
      if (!isTool(card)) fail("That isn't a Pokémon Tool.");
      const slot = slotAt(p, action.slot) ?? fail("There's no Pokémon there.");
      if (slot.tool) fail("That Pokémon already has a Tool.");
      slot.tool = takeFromHand(p, card.uid);
      log(state, seat, `${p.name} attached ${card.name} to ${topCard(slot).name}.`);
      return;
    }

    case "playTrainer": {
      mustBeYourTurn(state, seat);
      const card = p.hand.find((c) => c.uid === action.uid) ?? fail("That card isn't in your hand.");
      if (card.supertype !== "Trainer" || isTool(card)) fail("That isn't a card you can play this way.");
      const reason = cantPlayTrainerReason(state, seat, card);
      if (reason) fail(reason);
      takeFromHand(p, card.uid);
      if (isStadium(card)) {
        if (state.stadium) state.players[state.stadium.owner].discard.push(state.stadium.card);
        state.stadium = { card, owner: seat };
        p.stadiumPlayed = true;
        log(state, seat, `${p.name} played the Stadium ${card.name}.`);
        return;
      }
      if (isSupporter(card)) p.supporterPlayed = true;
      p.discard.push(card);
      const effect = trainerFor(card.name);
      log(state, seat, `${p.name} played ${card.name}.`);
      if (!effect) {
        log(state, seat, `Do what ${card.name} says with the "By hand" moves.`, "system");
        return;
      }
      effect.play(state, seat, card);
      return settle(state);
    }

    case "retreat": {
      mustBeYourTurn(state, seat);
      const reason = cantRetreatReason(state, seat);
      if (reason) fail(reason);
      const incoming = p.bench[action.bench] ?? fail("There's no Pokémon there.");
      const outgoing = p.active!;
      // Pay the cost with the Energy that's least useful to keep: special Energy first, then extras.
      let toPay = retreatCost(outgoing, state.turn);
      const order = [...outgoing.energy].sort((a, b) => Number(isBasicEnergy(a)) - Number(isBasicEnergy(b)));
      for (const e of order) {
        if (toPay <= 0) break;
        outgoing.energy.splice(outgoing.energy.indexOf(e), 1);
        p.discard.push(e);
        toPay -= energyProvides(e).length;
      }
      outgoing.conditions = [];
      outgoing.cantAttackTurn = null;
      outgoing.effects = {};
      p.bench.splice(action.bench, 1, outgoing);
      p.active = incoming;
      p.retreated = true;
      log(state, seat, `${p.name} retreated ${topCard(outgoing).name} and sent in ${topCard(incoming).name}.`);
      return;
    }

    case "attack": {
      mustBeYourTurn(state, seat);
      const reason = cantAttackReason(state, seat);
      if (reason) fail(reason);
      const attacker = p.active!;
      const attack = topCard(attacker).attacks[action.index] ?? fail("That attack doesn't exist.");
      if (!canPay(attackCost(state, attacker, attack), attacker.energy)) fail(`${attack.name} needs more Energy.`);
      if (!opp.active) fail("Your opponent has no Active Pokémon.");
      if (attacker.conditions.includes("confused")) {
        const heads = flip();
        log(state, seat, `${topCard(attacker).name} is Confused. Coin flip: ${heads ? "heads" : "tails"}.`, "coin");
        if (!heads) {
          attacker.damage += 30;
          log(state, seat, `${topCard(attacker).name} hurt itself in its confusion (30 damage).`, "attack");
          state.pendingEnd = true;
          return settle(state);
        }
      }
      resolveAttack(state, seat, attack);
      state.pendingEnd = true;
      return settle(state);
    }

    case "byHand": {
      mustBeYourTurn(state, seat);
      applyManual(state, seat, action.op, action.amount);
      return settle(state);
    }

    case "endTurn": {
      mustBeYourTurn(state, seat);
      state.pendingEnd = true;
      return settle(state);
    }
  }
}

export function evolveSlot(state: PState, slot: PSlot, card: PCard) {
  slot.pokemon.push(card);
  slot.playedTurn = state.turn;
  slot.conditions = [];
  slot.cantAttackTurn = null;
  slot.effects = {};
}

export function switchActive(p: PPlayer, benchIndex: number) {
  const incoming = p.bench[benchIndex];
  if (!incoming) return;
  const outgoing = p.active;
  if (outgoing) {
    outgoing.conditions = [];
    outgoing.cantAttackTurn = null;
    outgoing.effects = {};
    p.bench.splice(benchIndex, 1, outgoing);
  } else {
    p.bench.splice(benchIndex, 1);
  }
  p.active = incoming;
}

// ----- Choices -----

type Resume = (state: PState, seat: Seat, picks: string[], data: Record<string, unknown>) => void;

const RESUME: Record<string, Resume> = {
  promote(state, seat, picks, data) {
    const p = state.players[seat];
    const index = Number(picks[0].split(":")[1]);
    const incoming = p.bench.splice(index, 1)[0];
    p.active = incoming;
    log(state, seat, `${p.name} sent in ${topCard(incoming).name}.`);
    // After a Knock Out during Pokémon Checkup, the next turn starts once everyone has an Active.
    if (data.thenNextTurn) {
      checkKnockOuts(state);
      if (state.status !== "playing") return;
      if (state.prompt) state.prompt.data = { ...state.prompt.data, thenNextTurn: true };
      else nextTurn(state);
    }
  },
  benchDamage(state, seat, picks, data) {
    const opp = state.players[otherSeat(seat)];
    const slot = opp.bench[Number(picks[0].split(":")[1])];
    if (!slot) return;
    slot.damage += Number(data.amount);
    log(state, seat, `${data.amount} damage to ${topCard(slot).name} on the Bench.`);
  },
};

export function resolvePrompt(state: PState, seat: Seat, picks: string[]) {
  const prompt = state.prompt ?? fail("There's nothing to choose right now.");
  if (prompt.seat !== seat) fail("It's your opponent's choice.");
  const unique = [...new Set(picks)];
  if (unique.some((u) => !prompt.options.includes(u))) fail("You can't choose that.");
  if (unique.length < prompt.min || unique.length > prompt.max) {
    fail(prompt.min === prompt.max ? `Choose ${prompt.min}.` : `Choose between ${prompt.min} and ${prompt.max}.`);
  }
  state.prompt = null;
  const resume = RESUME[prompt.effect] ?? ATTACK_RESUME[prompt.effect] ?? MANUAL_RESUME[prompt.effect] ?? trainerFor(prompt.effect)?.resume;
  if (!resume) fail("Unknown choice.");
  resume!(state, seat, unique, prompt.data ?? {});
  if (!state.prompt && state.queue.length) state.prompt = state.queue.shift()!;
  settle(state);
}

/** Opens a choice for a player. Effects call this; the game waits until it's answered. */
export function ask(state: PState, prompt: Prompt) {
  if (state.prompt) state.queue.push(prompt);
  else state.prompt = prompt;
}

// ----- Knock Outs, the end of the turn and Pokémon Checkup -----

/** Handles Knock Outs, then (if nothing is waiting on a choice) finishes the turn. */
export function settle(state: PState) {
  if (state.status !== "playing") return;
  if (!state.prompt) checkKnockOuts(state);
  if (state.status !== "playing" || state.prompt) return;
  if (state.pendingEnd) {
    state.pendingEnd = false;
    endTurn(state);
  }
}

function checkKnockOuts(state: PState) {
  for (const seat of [otherSeat(state.current), state.current]) {
    const p = state.players[seat];
    const taker = otherSeat(seat);
    const slots = [...(p.active ? [p.active] : []), ...p.bench];
    for (const slot of slots) {
      if (slot.damage < maxHp(slot)) continue;
      const name = topCard(slot).name;
      const prizes = prizeValue(topCard(slot));
      discardSlot(p, slot);
      if (slot === p.active) p.active = null;
      else p.bench.splice(p.bench.indexOf(slot), 1);
      log(state, seat, `${p.name}'s ${name} was Knocked Out!`, "ko");
      const t = state.players[taker];
      const taken = t.prizes.splice(0, prizes);
      t.hand.push(...taken);
      log(state, taker, `${t.name} took ${plural(taken.length, "Prize card")}.`);
      if (!t.prizes.length) return win(state, taker, `${t.name} took their last Prize card.`);
    }
  }
  for (const seat of [otherSeat(state.current), state.current]) {
    const p = state.players[seat];
    if (p.active) continue;
    if (!p.bench.length) return win(state, otherSeat(seat), `${p.name} has no Pokémon left in play.`);
    ask(state, {
      seat,
      title: "Choose a Pokémon to move to your Active Spot",
      zone: "myBench",
      options: p.bench.map((_, i) => `bench:${i}`),
      min: 1,
      max: 1,
      effect: "promote",
    });
    return;
  }
}

function endTurn(state: PState) {
  const seat = state.current;
  // Paralysis wears off at the end of its owner's turn.
  const mine = state.players[seat].active;
  if (mine) mine.conditions = mine.conditions.filter((c) => c !== "paralyzed");
  checkup(state);
  if (state.status !== "playing") return;
  if (state.prompt) {
    // A Knock Out during Pokémon Checkup needs a new Active first; carry on once it's chosen.
    state.pendingEnd = false;
    state.prompt.data = { ...state.prompt.data, thenNextTurn: true };
    return;
  }
  nextTurn(state);
}

function nextTurn(state: PState) {
  state.turn++;
  state.current = otherSeat(state.current);
  startTurn(state);
}

function checkup(state: PState) {
  for (const seat of [state.current, otherSeat(state.current)]) {
    const p = state.players[seat];
    const slot = p.active;
    if (!slot) continue;
    const name = topCard(slot).name;
    if (slot.conditions.includes("poisoned")) {
      const amount = slot.effects.poisonDamage ?? 10;
      slot.damage += amount;
      log(state, seat, `${name} took ${amount} damage from Poison.`);
    }
    if (slot.conditions.includes("burned")) {
      slot.damage += 20;
      const heads = flip();
      log(state, seat, `${name} took 20 damage from its Burn. Coin flip: ${heads ? "heads, the Burn is healed" : "tails"}.`, "coin");
      if (heads) slot.conditions = slot.conditions.filter((c) => c !== "burned");
    }
    if (slot.conditions.includes("asleep")) {
      const heads = flip();
      log(state, seat, `${name} is Asleep. Coin flip: ${heads ? "heads, it woke up" : "tails, still Asleep"}.`, "coin");
      if (heads) slot.conditions = slot.conditions.filter((c) => c !== "asleep");
    }
  }
  checkKnockOuts(state);
}
