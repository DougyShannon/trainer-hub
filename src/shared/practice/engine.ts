// Rules engine for practice games against the computer. It enforces the core rules of the
// Pokémon TCG: setup and mulligans, one Energy and one Supporter per turn, evolving, retreating,
// attack costs, damage with Weakness and Resistance, Special Conditions, Knock Outs, prizes and
// the ways to win. Trainer cards are automated in trainers.ts, trainers-more.ts and trainers-extra.ts;
// what Tools and Stadiums change while in play is in effects.ts, and Stadium uses and other card
// actions in actions.ts.

import { otherSeat, type Condition, type Seat } from "../game-types";
import type { Attack, PAction, PCard, PPlayer, PSlot, PState, Prompt, SlotKey } from "./types";
import { ATTACK_RESUME, resolveAttack } from "./attacks";
import { attackRuleCanUse, attackRuleResume } from "./attack-rules";
import { cardLocked, locked, locksOn, marked, marksOn, turnLog } from "./lasting";
import { ANY, boomerangsAfter, boomerangsBefore, energyAttachBlock, specialOnEvolve, specialProvides, unitIs } from "./special-energy";
import { trainerFor } from "./trainers";
import { FIRST_TURN_SUPPORTERS } from "./trainers-more";
import { FIRST_TURN_EXTRA } from "./trainers-extra";
import {
  addTool,
  attachedTo,
  attackBlock,
  attackCost,
  baseName,
  beforeKnockOut,
  benchLimit,
  burnExtra,
  cleanse,
  EFFECT_RESUME,
  endOfTurn,
  evolvesSameTurn,
  ignoresSleep,
  isAutomatedTool,
  isFossil,
  keepsConfusion,
  knockOutTo,
  maxHp,
  onBenched,
  onEnergyFromHand,
  poisonExtra,
  retreatBlock,
  retreatCost,
  setPlaying,
  flipping,
  specialEnergyOff,
  toolNames,
  toolOf,
  toolRoom,
  toolsOn,
  trimBenches,
} from "./effects";
import { AUTOMATED_STADIUMS, actionEffect, runCardAction } from "./actions";
import {
  ABILITY_RESUME,
  abilityAttacks,
  abilityEffect,
  attacksFirstTurn,
  attacksTwice,
  checkupAbilities,
  doubledEnergy,
  drewAtTurnStart,
  evolvedAbilities,
  evolvesEarly,
  evolvesFirstTurn,
  has,
  heavySleeper,
  keepsPoison,
  onlyByAbility,
  playLock,
  prizesToLost,
  rainbowDna,
  startsActive,
  tookPrizes,
  trackMoves,
} from "./abilities";

export { attackCost, hpLeft, maxHp, retreatCost } from "./effects";

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
export const flip = () => {
  const s = flipping();
  if (s && locked(s, s.current, "tails")) return false;
  return Math.random() < 0.5;
};

export const ENERGY_TYPES = ["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Fairy", "Dragon"];

/** The Energy units a card provides, e.g. ["Fire"] or ["Colorless", "Colorless"]. */
export function energyProvides(c: PCard, state: PState | undefined = flipping() ?? undefined): string[] {
  if (isBasicEnergy(c)) {
    const type = ENERGY_TYPES.find((t) => c.name.includes(t));
    if (state && type && doubledEnergy(state, c)) return [type, type];
    return [type ?? "Colorless"];
  }
  if (specialEnergyOff(state)) return ["Colorless"];
  return specialProvides(c, state) ?? ["Colorless"];
}

/** Whether these Energy cards can pay a cost like ["Fire", "Colorless"]. */
export function canPay(cost: string[], energy: PCard[], state?: PState) {
  const units = energy.flatMap((e) => energyProvides(e, state));
  const pool = [...units];
  // Exact types first, then units that can be one of a few types, then ones that are every type.
  for (const need of cost.filter((c) => c !== "Colorless" && c !== "Free")) {
    let i = pool.indexOf(need);
    if (i < 0) i = pool.findIndex((u) => u.includes("|") && unitIs(u, need));
    if (i < 0) i = pool.indexOf(ANY);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return pool.length >= cost.filter((c) => c === "Colorless").length;
}

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

/** Puts a Pokémon (or a card played as one, like an Antique Fossil) onto a player's Bench. */
export function benchPokemon(state: PState, seat: Seat, card: PCard, fromHand = false) {
  if (isFossil(card) && !card.types.length) card.types = ["Colorless"];
  const slot = newSlot(card, state.turn);
  state.players[seat].bench.push(slot);
  onBenched(state, seat, slot, fromHand);
  return slot;
}

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
  p.discard.push(...slot.pokemon, ...attachedTo(slot));
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
    lost: [],
    koTurn: -1,
    koNames: [],
    used: [],
    vstarUsed: false,
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
    effects: [],
    attacking: null,
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

/** Fills in anything a game saved before newer rules were added is missing. */
export function normalize(state: PState) {
  state.effects ??= [];
  state.attacking ??= null;
  for (const p of [state.players.p1, state.players.p2]) {
    p.lost ??= [];
    p.koTurn ??= -1;
    p.koNames ??= [];
    p.used ??= [];
    p.vstarUsed ??= false;
  }
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
  p.used = [];
  log(state, state.current, `Turn ${state.turn}: ${p.name}'s turn.`, "turn");
  if (!draw(p, 1)) return win(state, otherSeat(state.current), `${p.name} couldn't draw a card at the start of their turn.`);
  drewAtTurnStart(state, state.current, p.hand[p.hand.length - 1]);
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

export function canEvolveNow(state: PState, slot: PSlot, card?: PCard) {
  const seat = state.players.p1.active === slot || state.players.p1.bench.includes(slot) ? "p1" : "p2";
  if (evolvesEarly(state, seat, slot)) return state.turn > 0;
  const fresh = slot.playedTurn !== state.turn || (!!card && slot.pokemon.length === 1 && evolvesSameTurn(state, slot, card));
  if (evolvesFirstTurn(state, seat, slot)) return fresh;
  return state.turn > 2 && fresh;
}

export function evolveTargets(state: PState, seat: Seat, card: PCard): SlotKey[] {
  const p = state.players[seat];
  if (!isPokemon(card) || isBasicPokemon(card) || !card.evolvesFrom || onlyByAbility(card) || playLock(state, seat, card)) return [];
  if (locked(state, seat, "evolve") || cardLocked(state, seat, card)) return [];
  return slotKeys(p).filter((k) => {
    const s = slotAt(p, k)!;
    if (marked(state, s, "noEvolve")) return false;
    return (topCard(s).name === card.evolvesFrom || rainbowDna(state, s, card)) && canEvolveNow(state, s, card);
  });
}

/** Why the active Pokémon can't attack right now, or null if it can. */
export function cantAttackReason(state: PState, seat: Seat): string | null {
  const p = state.players[seat];
  if (!p.active) return "You have no Active Pokémon.";
  if (state.turn === 1 && !attacksFirstTurn(state, seat) && !attacksOf(state, p.active).some(usableFirstTurn))
    return "The player who goes first can't attack on their first turn.";
  const windup = ignoresSleep(state, p.active);
  if (p.active.conditions.includes("asleep") && !windup) return "Your Active Pokémon is Asleep.";
  if (p.active.conditions.includes("paralyzed") && !windup) return "Your Active Pokémon is Paralyzed.";
  if (p.active.cantAttackTurn === state.turn) return "This Pokémon can't attack this turn.";
  const noAttack = marksOn(state, p.active, "noAttack").find((m) => !m.data);
  if (noAttack) return `${noAttack.source ?? "An attack"} stops this Pokémon attacking this turn.`;
  const all = locksOn(state, seat, "attack")[0];
  if (all) return `${all.source} stops your Pokémon attacking this turn.`;
  const low = locksOn(state, seat, "lowEnergy")[0];
  if (low && p.active.energy.length <= (low.amount ?? 0)) return `${low.source} stops Pokémon with ${low.amount} or less Energy attacking this turn.`;
  return attackBlock(state, seat);
}

/**
 * The attacks a Pokémon has: its own, then any from its Tool (a Technical Machine, or the VSTAR
 * Power on Earthen Seal Stone).
 */
export function attacksOf(state: PState, slot: PSlot): Attack[] {
  const own = abilityAttacks(state, slot, topCard(slot).attacks);
  if (!toolNames(state, slot).length) return own;
  const list = [...own];
  for (const card of toolsOn(slot)) {
    const tool = baseName(card.name);
    if (tool.startsWith("Technical Machine")) list.push(...card.attacks);
    if (tool === "Earthen Seal Stone" && topCard(slot).subtypes.some((s) => s === "V" || s === "VSTAR" || s === "VMAX")) {
      const owner = state.players.p1.active === slot || state.players.p1.bench.includes(slot) ? "p1" : "p2";
      if (!state.players[owner].vstarUsed) list.push(...card.attacks);
    }
  }
  return list;
}

/** Why an attack's own text stops it being used right now, or null. */
/** "If you go first, you can use this attack during your first turn." */
const usableFirstTurn = (attack: Attack) => /If you go first, you can use this attack during your first turn/i.test(attack.text ?? "");

export function attackRuleBlock(state: PState, seat: Seat, attack: Attack): string | null {
  if (state.turn === 1 && !attacksFirstTurn(state, seat) && !usableFirstTurn(attack)) return "The player who goes first can't attack on their first turn.";
  const active = state.players[seat].active;
  const named = marksOn(state, active, "noAttack").find((m) => m.data === attack.name);
  if (named) return `${named.source ?? "An attack"} stops ${attack.name} being used this turn.`;
  const rule = attackRuleCanUse(state, seat, attack);
  if (rule) return rule;
  const m = attack.text?.match(/You can use this attack only (?:when|if) your opponent has exactly (\d+) Prize cards? remaining/i);
  if (m && state.players[otherSeat(seat)].prizes.length !== Number(m[1]))
    return `${attack.name} needs your opponent to have exactly ${m[1]} Prize card${m[1] === "1" ? "" : "s"} left.`;
  return null;
}

export function usableAttacks(state: PState, seat: Seat): number[] {
  const p = state.players[seat];
  if (cantAttackReason(state, seat) || !p.active) return [];
  return attacksOf(state, p.active)
    .map((a, i) => (canPay(attackCost(state, p.active!, a), p.active!.energy, state) && !attackRuleBlock(state, seat, a) ? i : -1))
    .filter((i) => i >= 0);
}

export function cantRetreatReason(state: PState, seat: Seat): string | null {
  const p = state.players[seat];
  if (!p.active) return "You have no Active Pokémon.";
  if (!p.bench.length) return "You have no Benched Pokémon to switch in.";
  if (p.retreated) return "You've already retreated this turn.";
  if (p.active.conditions.some((c) => c === "asleep" || c === "paralyzed")) return "Asleep or Paralyzed Pokémon can't retreat.";
  if (p.active.effects.cantRetreat === state.turn || marked(state, p.active, "noRetreat")) return "An attack stops this Pokémon retreating this turn.";
  const block = retreatBlock(state, seat, p.active);
  if (block) return block;
  const units = p.active.energy.flatMap((e) => energyProvides(e, state)).length;
  if (units < retreatCost(state, p.active)) return `Retreating costs ${plural(retreatCost(state, p.active), "Energy")}.`;
  return null;
}

/** Why this Energy card can't be attached from the hand to this Pokémon, or null. */
export function cantAttachEnergyReason(state: PState, seat: Seat, card: PCard, slot: PSlot): string | null {
  const lockedBy = cardLocked(state, seat, card);
  if (lockedBy) return lockedBy;
  const no = marksOn(state, slot, "noEnergy")[0];
  if (no) return `${no.source ?? "An attack"} stops Energy being attached to ${topCard(slot).name} this turn.`;
  return energyAttachBlock(state, card, slot);
}

/** Why a Trainer card can't be played now, or null if it can. */
export function cantPlayTrainerReason(state: PState, seat: Seat, card: PCard): string | null {
  const p = state.players[seat];
  const locked = playLock(state, seat, card) ?? cardLocked(state, seat, card);
  if (locked) return locked;
  if (isTool(card)) return slotKeys(p).some((k) => toolRoom(state, slotAt(p, k)!)) ? null : "All your Pokémon already have a Tool.";
  if (isSupporter(card)) {
    if (p.supporterPlayed) return "You've already played a Supporter this turn.";
    if (state.turn === 1 && ![...FIRST_TURN_SUPPORTERS, ...FIRST_TURN_EXTRA].includes(baseName(card.name)))
      return "The player who goes first can't play a Supporter on their first turn.";
  }
  if (isFossil(card) && baseName(card.name) !== "Snorlax Doll") return p.bench.length >= benchLimit(state, seat) ? "Your Bench is full." : null;
  if (isStadium(card)) {
    if (p.stadiumPlayed) return "You've already played a Stadium this turn.";
    if (state.stadium?.card.name === card.name) return "That Stadium is already in play.";
  }
  const effect = trainerFor(card.name);
  return effect?.canPlay?.(state, seat, card) ?? null;
}

/** Whether the game does what this card says for you. */
export const isAutomated = (card: PCard) => {
  if (card.supertype !== "Trainer") return true;
  const name = baseName(card.name);
  if (isTool(card)) return isAutomatedTool(name);
  if (isStadium(card)) return AUTOMATED_STADIUMS.includes(name);
  return isFossil(card) || !!trainerFor(card.name);
};

/** Cards that can start the game in play as Basic Pokémon (Snorlax Doll can too). */
export const isSetupBasic = (c: PCard) => isBasicPokemon(c) || (c.supertype === "Trainer" && baseName(c.name) === "Snorlax Doll");
/** Cards that can start the game in the Active Spot (Cinderace's Explosiveness too). */
export const isSetupActive = (c: PCard) => isSetupBasic(c) || startsActive(c);

// ----- Doing things -----

function mustBeYourTurn(state: PState, seat: Seat) {
  if (state.status !== "playing") fail("The game isn't in progress.");
  if (state.prompt) fail("Finish the current choice first.");
  if (state.pendingEnd) fail("The turn is ending.");
  if (state.current !== seat) fail("It's not your turn.");
}

export function applyPractice(state: PState, seat: Seat, action: PAction) {
  normalize(state);
  setPlaying(state);
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
      if (!active || !isSetupActive(active)) fail("Choose a Basic Pokémon for your Active Spot.");
      const bench = [...new Set(action.bench)].filter((u) => u !== action.active);
      if (bench.length > BENCH_SIZE) fail(`Your Bench holds ${BENCH_SIZE} Pokémon.`);
      const place = (uid: string) => {
        const c = takeFromHand(p, uid);
        if (isFossil(c)) c.types = ["Colorless"];
        return newSlot(c, 0);
      };
      p.active = place(active!.uid);
      for (const uid of bench) {
        const c = p.hand.find((x) => x.uid === uid);
        if (!c || !isSetupBasic(c)) fail("Only Basic Pokémon can go on your Bench.");
        p.bench.push(place(uid));
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
      const locked = playLock(state, seat, card) ?? cardLocked(state, seat, card);
      if (locked) fail(locked);
      turnLog(state, seat).played.push(card.name);
      if (p.bench.length >= benchLimit(state, seat)) fail("Your Bench is full.");
      log(state, seat, `${p.name} put ${card.name} on the Bench.`);
      benchPokemon(state, seat, takeFromHand(p, card.uid), true);
      return settle(state);
    }

    case "evolve": {
      mustBeYourTurn(state, seat);
      const card = p.hand.find((c) => c.uid === action.uid) ?? fail("That card isn't in your hand.");
      if (!evolveTargets(state, seat, card).includes(action.slot)) {
        fail(state.turn <= 2 ? "Neither player can evolve on their first turn." : `${card.name} can't evolve that Pokémon right now.`);
      }
      const slot = slotAt(p, action.slot)!;
      const from = topCard(slot).name;
      turnLog(state, seat).played.push(card.name);
      const before = topCard(slot);
      evolveSlot(state, slot, takeFromHand(p, card.uid));
      specialOnEvolve(state, seat, slot, before);
      log(state, seat, `${p.name} evolved ${from} into ${card.name}.`);
      evolvedAbilities(state, seat, slot);
      return settle(state);
    }

    case "attachEnergy": {
      mustBeYourTurn(state, seat);
      if (p.energyAttached) fail("You've already attached an Energy this turn.");
      const card = p.hand.find((c) => c.uid === action.uid) ?? fail("That card isn't in your hand.");
      if (!isEnergy(card)) fail("That isn't an Energy card.");
      const slot = slotAt(p, action.slot) ?? fail("There's no Pokémon there.");
      const blocked = cantAttachEnergyReason(state, seat, card, slot);
      if (blocked) fail(blocked);
      slot.energy.push(takeFromHand(p, card.uid));
      p.energyAttached = true;
      turnLog(state, seat).played.push(card.name);
      log(state, seat, `${p.name} attached ${card.name} to ${topCard(slot).name}.`);
      onEnergyFromHand(state, seat, slot, card);
      return settle(state);
    }

    case "attachTool": {
      mustBeYourTurn(state, seat);
      const card = p.hand.find((c) => c.uid === action.uid) ?? fail("That card isn't in your hand.");
      if (!isTool(card)) fail("That isn't a Pokémon Tool.");
      const locked = playLock(state, seat, card);
      if (locked) fail(locked);
      const slot = slotAt(p, action.slot) ?? fail("There's no Pokémon there.");
      if (!toolRoom(state, slot)) fail("That Pokémon already has a Tool.");
      addTool(slot, takeFromHand(p, card.uid));
      turnLog(state, seat).played.push(card.name);
      turnLog(state, seat).tools.push(topCard(slot).uid);
      log(state, seat, `${p.name} attached ${card.name} to ${topCard(slot).name}.`);
      return settle(state);
    }

    case "playTrainer": {
      mustBeYourTurn(state, seat);
      const card = p.hand.find((c) => c.uid === action.uid) ?? fail("That card isn't in your hand.");
      if (card.supertype !== "Trainer" || isTool(card)) fail("That isn't a card you can play this way.");
      const reason = cantPlayTrainerReason(state, seat, card);
      if (reason) fail(reason);
      takeFromHand(p, card.uid);
      turnLog(state, seat).played.push(card.name);
      if (isStadium(card)) {
        if (state.stadium) state.players[state.stadium.owner].discard.push(state.stadium.card);
        state.stadium = { card, owner: seat };
        p.stadiumPlayed = true;
        log(state, seat, `${p.name} played the Stadium ${card.name}.`);
        return settle(state);
      }
      if (isFossil(card)) {
        log(state, seat, `${p.name} put ${card.name} onto the Bench as a Pokémon.`);
        benchPokemon(state, seat, card, true);
        return settle(state);
      }
      if (isSupporter(card)) {
        p.supporterPlayed = true;
        p.used.push(`supporter:${baseName(card.name)}`);
      }
      p.discard.push(card);
      const effect = trainerFor(card.name);
      log(state, seat, `${p.name} played ${card.name}.`);
      if (!effect) {
        log(state, seat, `The game doesn't know what ${card.name} does yet.`, "system");
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
      if (opp.active && has(state, opp.active, "Slimy Sliding")) {
        const heads = flip();
        log(state, seat, `Slimy Sliding: ${p.name} flipped ${heads ? "heads" : "tails"}.`, "coin");
        if (!heads) {
          p.retreated = true;
          log(state, seat, `${topCard(outgoing).name} couldn't retreat.`);
          return;
        }
      }
      // Pay the cost with the Energy that's least useful to keep: special Energy first, then extras.
      let toPay = retreatCost(state, outgoing);
      const order = [...outgoing.energy].sort((a, b) => Number(isBasicEnergy(a)) - Number(isBasicEnergy(b)));
      for (const e of order) {
        if (toPay <= 0) break;
        outgoing.energy.splice(outgoing.energy.indexOf(e), 1);
        p.discard.push(e);
        toPay -= energyProvides(e, state).length;
      }
      outgoing.conditions = [];
      outgoing.cantAttackTurn = null;
      outgoing.effects = {};
      p.bench.splice(action.bench, 1, outgoing);
      p.active = incoming;
      p.retreated = true;
      log(state, seat, `${p.name} retreated ${topCard(outgoing).name} and sent in ${topCard(incoming).name}.`);
      return settle(state);
    }

    case "attack": {
      mustBeYourTurn(state, seat);
      const reason = cantAttackReason(state, seat);
      if (reason) fail(reason);
      const attacker = p.active!;
      const attack = attacksOf(state, attacker)[action.index] ?? fail("That attack doesn't exist.");
      if (!canPay(attackCost(state, attacker, attack), attacker.energy, state)) fail(`${attack.name} needs more Energy.`);
      const ruleBlock = attackRuleBlock(state, seat, attack);
      if (ruleBlock) fail(ruleBlock);
      if (!opp.active) fail("Your opponent has no Active Pokémon.");
      state.attacking = seat;
      if (toolsOn(attacker).some((t) => baseName(t.name) === "Earthen Seal Stone" && t.attacks.includes(attack))) p.vstarUsed = true;
      for (const m of marksOn(state, attacker, "attackCoin")) {
        const n = m.amount ?? 1;
        let tails = false;
        for (let i = 0; i < n; i++) if (!flip()) tails = true;
        log(
          state,
          seat,
          `${m.source ?? "An attack's effect"}: ${p.name} flipped ${n === 1 ? "a coin" : `${n} coins`} and got ${tails ? "tails" : "all heads"}.`,
          "coin",
        );
        if (tails) {
          log(state, seat, `${attack.name} didn't happen.`, "attack");
          state.pendingEnd = true;
          return settle(state);
        }
      }
      if (attacker.conditions.includes("confused")) {
        const heads = flip();
        log(state, seat, `${topCard(attacker).name} is Confused. Coin flip: ${heads ? "heads" : "tails"}.`, "coin");
        if (!heads) {
          const hurt = attacker.effects.confuseDamage ?? 30;
          attacker.damage += hurt;
          log(state, seat, `${topCard(attacker).name} hurt itself in its confusion (${hurt} damage).`, "attack");
          state.pendingEnd = true;
          return settle(state);
        }
      }
      const boomerangs = boomerangsBefore(attacker);
      resolveAttack(state, seat, attack);
      if (boomerangs.length) (state as PState & { boomerangs?: string[] }).boomerangs = boomerangs;
      state.pendingEnd = true;
      // Festival Lead: a first attack that Knocks Out lets it attack again.
      if (attacksTwice(state, attacker) && !p.used.includes("festival")) p.used.push("festival", "festival-check");
      return settle(state);
    }

    case "special": {
      mustBeYourTurn(state, seat);
      runCardAction(state, seat, action.id);
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
  const poisoned = keepsPoison(state, slot);
  slot.pokemon.push(card);
  slot.playedTurn = state.turn;
  slot.conditions = keepsConfusion(state) ? slot.conditions.filter((c) => c === "confused") : [];
  if (poisoned && !slot.conditions.includes("poisoned")) slot.conditions.push("poisoned");
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
  const resume =
    RESUME[prompt.effect] ??
    ATTACK_RESUME[prompt.effect] ??
    attackRuleResume(prompt.effect) ??
    EFFECT_RESUME[prompt.effect] ??
    ABILITY_RESUME[prompt.effect] ??
    abilityEffect(prompt.effect)?.resume ??
    trainerFor(prompt.effect)?.resume ??
    actionEffect(prompt.effect)?.resume;
  // A saved game can hold a choice from a version that worked differently: just move on.
  if (resume) resume(state, seat, unique, prompt.data ?? {});
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
  trackMoves(state);
  cleanse(state);
  if (!state.prompt) checkKnockOuts(state);
  if (state.status === "playing" && !state.prompt) trimBenches(state);
  if (state.status !== "playing" || state.prompt) return;
  if (state.pendingEnd) {
    state.pendingEnd = false;
    const p = state.players[state.current];
    const opp = state.players[otherSeat(state.current)];
    const withBoom = state as PState & { boomerangs?: string[] };
    if (withBoom.boomerangs) {
      boomerangsAfter(state, state.current, p.active, withBoom.boomerangs);
      delete withBoom.boomerangs;
    }
    if (p.used.includes("festival-check")) {
      p.used = p.used.filter((u) => u !== "festival-check");
      if (opp.koTurn === state.turn && opp.active && p.active && attacksTwice(state, p.active)) {
        log(state, state.current, "Festival Lead: it Knocked Out the Active Pokémon, so it can attack again.");
        return;
      }
    }
    endTurn(state);
  }
}

function checkKnockOuts(state: PState) {
  for (const seat of [otherSeat(state.current), state.current]) {
    const p = state.players[seat];
    const taker = otherSeat(seat);
    const slots = [...(p.active ? [p.active] : []), ...p.bench];
    for (const slot of slots) {
      if (slot.damage < maxHp(state, slot)) continue;
      const name = topCard(slot).name;
      log(state, seat, `${p.name}'s ${name} was Knocked Out!`, "ko");
      const prizes = beforeKnockOut(state, seat, slot, prizeValue(topCard(slot)));
      knockOutTo(state, p, slot);
      if (slot === p.active) p.active = null;
      else p.bench.splice(p.bench.indexOf(slot), 1);
      const t = state.players[taker];
      const taken = t.prizes.splice(0, prizes);
      if (prizesToLost(state, taker)) {
        (t.lost ??= []).push(...taken);
        if (taken.length) log(state, taker, `Lost Block: ${t.name}'s ${plural(taken.length, "Prize card")} went to the Lost Zone.`);
      } else {
        t.hand.push(...taken);
        if (taken.length) log(state, taker, `${t.name} took ${plural(taken.length, "Prize card")}.`);
        tookPrizes(state, taker, taken);
      }
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
  state.attacking = null;
  endOfTurn(state);
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
      const amount = (slot.effects.poisonDamage ?? 10) + poisonExtra(state, slot);
      slot.damage += amount;
      log(state, seat, `${name} took ${amount} damage from Poison.`);
    }
    if (slot.conditions.includes("burned")) {
      const burn = 20 + burnExtra(state, slot);
      slot.damage += burn;
      const heads = flip();
      log(state, seat, `${name} took ${burn} damage from its Burn. Coin flip: ${heads ? "heads, the Burn is healed" : "tails"}.`, "coin");
      if (heads) slot.conditions = slot.conditions.filter((c) => c !== "burned");
    }
    if (slot.conditions.includes("asleep")) {
      const heads = heavySleeper(state, slot) || marked(state, slot, "deepSleep") ? flip() && flip() : flip();
      log(state, seat, `${name} is Asleep. Coin flip: ${heads ? "heads, it woke up" : "tails, still Asleep"}.`, "coin");
      if (heads) slot.conditions = slot.conditions.filter((c) => c !== "asleep");
    }
  }
  checkupAbilities(state);
  checkKnockOuts(state);
}
