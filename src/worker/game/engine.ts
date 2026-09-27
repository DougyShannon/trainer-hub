// The game table's rules. The table is manual, like playing on a real mat: players move their own
// cards and the engine only keeps each move sensible (hidden cards stay hidden, zones stay in bounds,
// turns alternate). Card text is not enforced.

import {
  AWAY_LIMIT_MS,
  BENCH_SIZE,
  HAND_SIZE,
  PRIZE_COUNT,
  ROTATION_CONDITIONS,
  SEATS,
  otherSeat,
  type CardRef,
  type GameAction,
  type GameState,
  type GameView,
  type LogEntry,
  type PlayerInit,
  type PlayerState,
  type PlayerView,
  type Seat,
  type Slot,
  type SlotRef,
  type SlotView,
  type Target,
} from "../../shared/game-types";

const LOG_LIMIT = 200;

export class GameError extends Error {}
const fail = (message: string): never => {
  throw new GameError(message);
};

// ----- Randomness -----

const randomInt = (max: number) => {
  // Rejection sampling keeps every result equally likely.
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % max;
};

export function shuffle<T>(list: T[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const coin = () => (randomInt(2) === 0 ? "heads" : "tails");

// ----- Card helpers -----

const isPokemon = (c: CardRef) => c.supertype === "Pokémon";
const isBasicPokemon = (c: CardRef) => isPokemon(c) && c.subtypes.includes("Basic");
const topOf = (slot: Slot) => slot.pokemon[slot.pokemon.length - 1];
const slotCards = (slot: Slot) => [...slot.pokemon, ...slot.attached];
const newSlot = (card: CardRef): Slot => ({ pokemon: [card], attached: [], damage: 0, conditions: [] });

// ----- Creating a game -----

export function newGame(id: string, format: string, host: PlayerInit): GameState {
  const state: GameState = {
    id,
    format,
    status: "waiting",
    players: { p1: newPlayer(host), p2: null },
    stadium: null,
    turn: 0,
    current: null,
    winner: null,
    endReason: null,
    log: [],
    logCount: 0,
    version: 0,
    cannotDraw: null,
    offlineSince: { p1: null, p2: null },
  };
  log(state, null, `${host.trainerName} opened the table with ${host.deckName}.`, "system");
  return state;
}

function newPlayer({ cards, ...info }: PlayerInit): PlayerState {
  return {
    ...info,
    deck: shuffle([...cards]),
    hand: [],
    prizes: [],
    discard: [],
    lostZone: [],
    active: null,
    bench: [],
    ready: false,
    mulligans: 0,
  };
}

/** The second player sits down: both players draw 7 and start setting up. */
export function joinGame(state: GameState, guest: PlayerInit) {
  if (state.status !== "waiting") fail("This game has already started.");
  state.players.p2 = newPlayer(guest);
  state.status = "setup";
  log(state, null, `${guest.trainerName} joined with ${guest.deckName}. Both players draw 7 cards.`, "system");
  for (const seat of SEATS) draw(state, seat, HAND_SIZE, true);
  for (const seat of SEATS) {
    if (!player(state, seat).hand.some(isBasicPokemon)) {
      log(state, seat, `${name(state, seat)} has no Basic Pokémon in their opening hand and needs to mulligan.`, "system");
    }
  }
}

// ----- Small helpers -----

export function log(state: GameState, seat: Seat | null, text: string, kind?: LogEntry["kind"]) {
  state.logCount += 1;
  state.log.push({ n: state.logCount, at: Date.now(), seat, text, kind });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

const player = (state: GameState, seat: Seat) => state.players[seat] ?? fail("That player isn't here yet.");
const name = (state: GameState, seat: Seat) => state.players[seat]?.trainerName ?? "Player";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function draw(state: GameState, seat: Seat, count: number, quiet = false) {
  const p = player(state, seat);
  const drawn = p.deck.splice(0, count);
  p.hand.push(...drawn);
  if (!quiet) log(state, seat, `${p.trainerName} drew ${plural(drawn.length, "card")}.`);
  return drawn.length;
}

function getSlot(p: PlayerState, ref: SlotRef): Slot {
  if (ref.zone === "active") return p.active ?? fail("There's no Active Pokémon there.");
  return p.bench[ref.index] ?? fail("There's no Benched Pokémon there.");
}

function removeSlot(p: PlayerState, ref: SlotRef) {
  if (ref.zone === "active") p.active = null;
  else p.bench.splice(ref.index, 1);
}

const slotName = (ref: SlotRef, slot: Slot) =>
  `${ref.zone === "active" ? "Active" : "Benched"} ${topOf(slot).name}`;

/** Finds one of the player's own cards wherever it is and takes it out of that zone. */
function takeCard(state: GameState, seat: Seat, uid: string) {
  const p = player(state, seat);
  for (const zone of ["hand", "deck", "discard", "lostZone"] as const) {
    const i = p[zone].findIndex((c) => c.uid === uid);
    if (i !== -1) return { card: p[zone].splice(i, 1)[0], from: zone as string };
  }
  if (state.stadium?.owner === seat && state.stadium.card.uid === uid) {
    const card = state.stadium.card;
    state.stadium = null;
    return { card, from: "stadium" };
  }
  const slots: [SlotRef, Slot][] = [];
  if (p.active) slots.push([{ zone: "active" }, p.active]);
  p.bench.forEach((s, index) => slots.push([{ zone: "bench", index }, s]));
  for (const [, slot] of slots) {
    const a = slot.attached.findIndex((c) => c.uid === uid);
    if (a !== -1) return { card: slot.attached.splice(a, 1)[0], from: "attached" };
    const k = slot.pokemon.findIndex((c) => c.uid === uid);
    if (k !== -1) {
      if (slot.pokemon.length === 1) fail("Move the whole Pokémon instead, from its own menu.");
      if (k !== slot.pokemon.length - 1) fail("Only the top card of an evolved Pokémon can be taken off.");
      slot.conditions = [];
      return { card: slot.pokemon.pop()!, from: "evolution" };
    }
  }
  return fail("That card isn't one of yours, or it has already moved.");
}

const FROM_LABEL: Record<string, string> = {
  hand: "their hand",
  deck: "their deck",
  discard: "their discard pile",
  lostZone: "the Lost Zone",
  stadium: "play",
  attached: "a Pokémon",
  evolution: "an evolved Pokémon",
};

// ----- Applying an action -----

/** Applies one player's action. Returns cards to show only to that player (a deck search), if any. */
export function applyAction(state: GameState, seat: Seat, action: GameAction): { privateDeck?: CardRef[] } {
  const p = player(state, seat);
  const opp = otherSeat(seat);
  const who = p.trainerName;

  if (state.status === "waiting") fail("Waiting for an opponent to join.");
  if (state.status === "finished" && action.type !== "chat") fail("This game is over.");

  const inSetup = state.status === "setup";
  const setupOnly = () => inSetup || fail("That's only allowed while setting up.");
  const playingOnly = () => state.status === "playing" || fail("Finish setting up first.");
  const notReady = () => !p.ready || fail("You're already ready. Wait for your opponent.");

  switch (action.type) {
    case "chat": {
      const text = String(action.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      if (text) log(state, seat, `${who}: ${text}`, "chat");
      return {};
    }

    case "mulligan": {
      setupOnly();
      notReady();
      if (p.hand.some(isBasicPokemon)) fail("You have a Basic Pokémon, so you can't mulligan.");
      if (p.active || p.bench.length) fail("Put your Pokémon back first.");
      log(state, seat, `${who} revealed a hand with no Basic Pokémon: ${p.hand.map((c) => c.name).join(", ")}.`);
      p.deck.push(...p.hand.splice(0));
      shuffle(p.deck);
      draw(state, seat, HAND_SIZE, true);
      p.mulligans += 1;
      log(state, seat, `${who} shuffled and drew a new hand (mulligan ${p.mulligans}).`);
      return {};
    }

    case "ready": {
      setupOnly();
      notReady();
      if (!p.active) fail("Choose an Active Pokémon first.");
      p.ready = true;
      log(state, seat, `${who} is ready.`);
      if (SEATS.every((s) => state.players[s]?.ready)) startPlay(state);
      return {};
    }

    case "draw": {
      playingOnly();
      const count = Math.max(1, Math.min(20, Math.floor(action.count ?? 1)));
      if (!p.deck.length) fail("Your deck is empty.");
      draw(state, seat, count);
      return {};
    }

    case "shuffle": {
      shuffle(p.deck);
      log(state, seat, `${who} shuffled their deck.`);
      return {};
    }

    case "mill": {
      playingOnly();
      const count = Math.max(1, Math.min(20, Math.floor(action.count ?? 1)));
      const cards = p.deck.splice(0, count);
      p.discard.push(...cards);
      log(state, seat, `${who} discarded ${cards.map((c) => c.name).join(", ") || "nothing"} from the top of their deck.`);
      return {};
    }

    case "searchDeck": {
      playingOnly();
      log(state, seat, `${who} is looking through their deck.`);
      return { privateDeck: p.deck };
    }

    case "move": {
      const target = action.to;
      if (inSetup) {
        notReady();
        const allowed =
          (target.zone === "active" || target.zone === "bench") && target.mode === "place"
            ? true
            : target.zone === "hand";
        if (!allowed) fail("While setting up you can only place Basic Pokémon.");
      }
      const { card, from } = takeCard(state, seat, action.uid);
      try {
        moveTo(state, seat, card, from, target);
      } catch (e) {
        // Put the card back where it came from if the move wasn't allowed.
        undoTake(state, seat, card, from);
        throw e;
      }
      return {};
    }

    case "slot": {
      if (inSetup) {
        notReady();
        if (action.op !== "hand") fail("While setting up you can only take Pokémon back to your hand.");
      }
      const slot = getSlot(p, action.slot);
      const label = slotName(action.slot, slot);
      removeSlot(p, action.slot);
      const cards = slotCards(slot);
      if (action.op === "discard") {
        p.discard.push(...cards);
        log(state, seat, `${who}'s ${label} was discarded with ${plural(cards.length - 1, "other card")}.`);
      } else if (action.op === "hand") {
        p.hand.push(...cards);
        if (!inSetup) log(state, seat, `${who} returned ${label} and its cards to their hand.`);
      } else if (action.op === "lostZone") {
        p.lostZone.push(...cards);
        log(state, seat, `${who} put ${label} and its cards in the Lost Zone.`);
      } else {
        p.deck.push(...cards);
        shuffle(p.deck);
        log(state, seat, `${who} shuffled ${label} and its cards into their deck.`);
      }
      return {};
    }

    case "damage": {
      playingOnly();
      const side = action.side === opp ? opp : seat;
      const target = player(state, side);
      const slot = getSlot(target, action.slot);
      const delta = Math.max(-990, Math.min(990, Math.round(action.delta / 10) * 10));
      if (!delta) return {};
      slot.damage = Math.max(0, Math.min(990, slot.damage + delta));
      const whose = side === seat ? "their" : `${target.trainerName}'s`;
      log(
        state,
        seat,
        `${who} ${delta > 0 ? "put" : "removed"} ${Math.abs(delta)} damage ${delta > 0 ? "on" : "from"} ${whose} ${slotName(action.slot, slot)} (now ${slot.damage}).`,
      );
      const hp = topOf(slot).hp;
      if (hp && slot.damage >= hp) log(state, null, `${target.trainerName}'s ${topOf(slot).name} has been Knocked Out.`, "system");
      return {};
    }

    case "condition": {
      playingOnly();
      if (action.slot.zone !== "active") fail("Only Active Pokémon can have Special Conditions.");
      const side = action.side === opp ? opp : seat;
      const target = player(state, side);
      const slot = getSlot(target, action.slot);
      const cond = action.condition;
      const whose = side === seat ? "their" : `${target.trainerName}'s`;
      if (slot.conditions.includes(cond)) {
        slot.conditions = slot.conditions.filter((c) => c !== cond);
        log(state, seat, `${who} removed ${cond} from ${whose} ${topOf(slot).name}.`);
      } else {
        if (ROTATION_CONDITIONS.includes(cond)) slot.conditions = slot.conditions.filter((c) => !ROTATION_CONDITIONS.includes(c));
        slot.conditions.push(cond);
        log(state, seat, `${whose === "their" ? `${who}'s` : whose} ${topOf(slot).name} is now ${cond}.`);
      }
      return {};
    }

    case "switch": {
      if (inSetup) fail("Finish setting up first.");
      const bench = p.bench[action.bench] ?? fail("There's no Benched Pokémon there.");
      if (p.active) {
        const old = p.active;
        old.conditions = [];
        p.active = bench;
        p.bench[action.bench] = old;
        log(state, seat, `${who} switched ${topOf(old).name} with ${topOf(bench).name}.`);
      } else {
        p.active = bench;
        p.bench.splice(action.bench, 1);
        log(state, seat, `${who} moved ${topOf(bench).name} up to the Active Spot.`);
      }
      return {};
    }

    case "takePrize": {
      playingOnly();
      const [card] = p.prizes.splice(Math.max(0, Math.min(p.prizes.length - 1, Math.floor(action.index))), 1);
      if (!card) fail("You have no Prize cards left.");
      p.hand.push(card);
      log(state, seat, `${who} took a Prize card. ${plural(p.prizes.length, "Prize card")} left.`);
      if (!p.prizes.length) finish(state, seat, `${who} took their last Prize card.`);
      return {};
    }

    case "shuffleHandIntoDeck": {
      playingOnly();
      const n = p.hand.length;
      p.deck.push(...p.hand.splice(0));
      shuffle(p.deck);
      log(state, seat, `${who} shuffled their hand of ${plural(n, "card")} into their deck.`);
      return {};
    }

    case "revealHand": {
      log(state, seat, `${who} revealed their hand: ${p.hand.map((c) => c.name).join(", ") || "no cards"}.`);
      return {};
    }

    case "coin": {
      log(state, seat, `${who} flipped a coin: ${coin()}.`, "coin");
      return {};
    }

    case "endTurn": {
      playingOnly();
      if (state.current !== seat) fail("It's not your turn.");
      state.turn += 1;
      state.current = opp;
      log(state, null, `Turn ${state.turn}: ${name(state, opp)}'s turn.`, "turn");
      startTurnDraw(state, opp);
      return {};
    }

    case "concede": {
      finish(state, opp, `${who} conceded.`);
      return {};
    }

    case "claimWin": {
      const reason = claimReason(state, seat);
      if (!reason) fail("You can only claim the win when your opponent has lost or has left the game.");
      finish(state, seat, reason!);
      return {};
    }
  }
  return fail("Unknown action.");
}

function moveTo(state: GameState, seat: Seat, card: CardRef, from: string, target: Target) {
  const p = player(state, seat);
  const who = p.trainerName;
  const fromLabel = FROM_LABEL[from] ?? from;
  const hiddenFrom = from === "hand" || from === "deck";

  switch (target.zone) {
    case "hand":
      p.hand.push(card);
      if (state.status === "playing") log(state, seat, `${who} put ${hiddenFrom ? "a card" : card.name} from ${fromLabel} into their hand.`);
      return;
    case "discard":
      p.discard.push(card);
      log(state, seat, `${who} discarded ${card.name} from ${fromLabel}.`);
      return;
    case "lostZone":
      p.lostZone.push(card);
      log(state, seat, `${who} put ${card.name} from ${fromLabel} in the Lost Zone.`);
      return;
    case "deckTop":
    case "deckBottom":
      if (target.zone === "deckTop") p.deck.unshift(card);
      else p.deck.push(card);
      log(state, seat, `${who} put ${hiddenFrom ? "a card" : card.name} on the ${target.zone === "deckTop" ? "top" : "bottom"} of their deck.`);
      return;
    case "deckShuffle":
      p.deck.push(card);
      shuffle(p.deck);
      log(state, seat, `${who} shuffled ${hiddenFrom ? "a card" : card.name} into their deck.`);
      return;
    case "stadium": {
      if (!card.subtypes.includes("Stadium")) fail("Only Stadium cards go in the Stadium spot.");
      if (state.stadium) {
        const old = state.stadium;
        player(state, old.owner).discard.push(old.card);
        log(state, seat, `${old.card.name} was discarded.`);
      }
      state.stadium = { card, owner: seat };
      log(state, seat, `${who} played the Stadium ${card.name}.`);
      return;
    }
    case "active":
    case "bench": {
      const ref: SlotRef | null =
        target.zone === "active" ? { zone: "active" } : target.index === null ? null : { zone: "bench", index: target.index };

      if (target.mode === "place") {
        if (!isPokemon(card)) fail("Only Pokémon can be put into play that way.");
        if (state.status === "setup" && !isBasicPokemon(card)) fail("Only Basic Pokémon can be put down while setting up.");
        if (target.zone === "active") {
          if (p.active) fail("You already have an Active Pokémon.");
          p.active = newSlot(card);
        } else {
          if (p.bench.length >= BENCH_SIZE) fail("Your Bench is full.");
          p.bench.push(newSlot(card));
        }
        if (state.status === "playing") {
          log(state, seat, `${who} put ${card.name} ${target.zone === "active" ? "into the Active Spot" : "on their Bench"}.`);
        }
        return;
      }

      if (!ref) fail("Choose a Pokémon.");
      const slot = getSlot(p, ref!);
      if (target.mode === "evolve") {
        if (!isPokemon(card)) fail("Only a Pokémon card can go on top of a Pokémon.");
        const before = topOf(slot).name;
        slot.pokemon.push(card);
        slot.conditions = [];
        log(state, seat, `${who} evolved ${before} into ${card.name}.`);
      } else {
        slot.attached.push(card);
        log(state, seat, `${who} attached ${card.name} to ${slotName(ref!, slot)}.`);
      }
      return;
    }
  }
}

/** Puts a card back where takeCard found it after a move that wasn't allowed. */
function undoTake(state: GameState, seat: Seat, card: CardRef, from: string) {
  const p = player(state, seat);
  if (from === "hand" || from === "deck" || from === "discard" || from === "lostZone") {
    if (from === "deck") p.deck.unshift(card);
    else p[from].push(card);
  } else if (from === "stadium") state.stadium = { card, owner: seat };
  else p.hand.push(card); // attached or evolution cards: safest in hand
}

function startPlay(state: GameState) {
  for (const seat of SEATS) {
    const p = player(state, seat);
    p.prizes = p.deck.splice(0, PRIZE_COUNT);
  }
  const flip = coin();
  const first: Seat = flip === "heads" ? "p1" : "p2";
  log(state, null, `Both players revealed their Pokémon and set out ${PRIZE_COUNT} Prize cards.`, "system");
  log(state, null, `Coin flip: ${flip}. ${name(state, first)} goes first.`, "coin");
  for (const seat of SEATS) {
    const extra = player(state, otherSeat(seat)).mulligans;
    if (extra) log(state, null, `${name(state, seat)} may draw up to ${plural(extra, "extra card")} for their opponent's mulligans.`, "system");
  }
  state.status = "playing";
  state.turn = 1;
  state.current = first;
  log(state, null, `Turn 1: ${name(state, first)}'s turn. The first player can't attack or play a Supporter this turn.`, "turn");
  startTurnDraw(state, first);
}

function startTurnDraw(state: GameState, seat: Seat) {
  const p = player(state, seat);
  if (!p.deck.length) {
    state.cannotDraw = seat;
    log(state, null, `${p.trainerName} can't draw a card at the start of their turn, so they lose.`, "system");
    return;
  }
  draw(state, seat, 1);
}

function claimReason(state: GameState, seat: Seat): string | null {
  if (state.status !== "playing") return null;
  const opp = otherSeat(seat);
  const o = player(state, opp);
  if (state.cannotDraw === opp) return `${o.trainerName} couldn't draw a card.`;
  if (!o.active && !o.bench.length) return `${o.trainerName} has no Pokémon left in play.`;
  const away = state.offlineSince[opp];
  if (away && Date.now() - away >= AWAY_LIMIT_MS) return `${o.trainerName} left the game.`;
  return null;
}

export function finish(state: GameState, winner: Seat, reason: string) {
  if (state.status === "finished") return;
  state.status = "finished";
  state.winner = winner;
  state.current = null;
  state.endReason = reason;
  log(state, null, `${reason} ${name(state, winner)} wins!`, "system");
}

// ----- What each person sees -----

export function viewFor(state: GameState, viewer: Seat | null, online: Record<Seat, boolean>): GameView {
  const reveal = state.status === "finished";
  const players = {} as Record<Seat, PlayerView | null>;
  for (const seat of SEATS) {
    const p = state.players[seat];
    if (!p) {
      players[seat] = null;
      continue;
    }
    const mine = viewer === seat;
    // While setting up, Pokémon are put down face down.
    const hideBoard = state.status === "setup" && !mine;
    const slotView = (s: Slot): SlotView => (hideBoard ? { hidden: true, count: 1 } : s);
    players[seat] = {
      userId: p.userId,
      trainerName: p.trainerName,
      avatarDex: p.avatarDex,
      deckName: p.deckName,
      deckCount: p.deck.length,
      hand: mine || reveal ? p.hand : null,
      handCount: p.hand.length,
      prizeCount: p.prizes.length,
      discard: p.discard,
      lostZone: p.lostZone,
      active: p.active ? slotView(p.active) : null,
      bench: p.bench.map(slotView),
      ready: p.ready,
      mulligans: p.mulligans,
      online: online[seat],
    };
  }
  return {
    id: state.id,
    format: state.format,
    status: state.status,
    you: viewer,
    players,
    stadium: state.stadium,
    turn: state.turn,
    current: state.current,
    winner: state.winner,
    endReason: state.endReason,
    log: state.log.slice(-120),
    version: state.version,
    canClaimWin: viewer ? claimReason(state, viewer) !== null : false,
  };
}
