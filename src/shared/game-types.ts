// Types shared by the game room (server) and the game table (browser).
// The server holds the full GameState; each player receives a GameView with hidden cards removed.

import type { PAction, PCard, PState } from "./practice/types";

export type Seat = "p1" | "p2";
export const SEATS: Seat[] = ["p1", "p2"];
export const otherSeat = (s: Seat): Seat => (s === "p1" ? "p2" : "p1");

export type CardRef = {
  uid: string; // unique per physical card in this game
  cardId: string;
  name: string;
  supertype: string;
  subtypes: string[];
  hp: number | null;
  image: string | null;
  imageLarge: string | null;
};

export const CONDITIONS = ["asleep", "confused", "paralyzed", "poisoned", "burned"] as const;
export type Condition = (typeof CONDITIONS)[number];
// Asleep, Confused and Paralyzed replace each other; Poisoned and Burned can stack with them.
export const ROTATION_CONDITIONS: Condition[] = ["asleep", "confused", "paralyzed"];

/** A Pokémon in play: its evolution stack (last is the current Pokémon) plus attached Energy and Tools. */
export type Slot = { pokemon: CardRef[]; attached: CardRef[]; damage: number; conditions: Condition[] };

export type PlayerInit = {
  userId: number;
  trainerName: string;
  avatarDex: number;
  deckName: string;
  cards: CardRef[];
  /** The same deck with everything the rules engine needs. Games with it are played on the rules engine. */
  full?: PCard[];
};

export type PlayerState = Omit<PlayerInit, "cards"> & {
  deck: CardRef[]; // index 0 is the top of the deck
  hand: CardRef[];
  prizes: CardRef[];
  discard: CardRef[];
  lostZone: CardRef[];
  active: Slot | null;
  bench: Slot[];
  ready: boolean;
  mulligans: number;
  /** The play mat this player picked for the "Two half mats" board (a mat id), if any. */
  mat?: string;
};

export type GameStatus = "waiting" | "setup" | "playing" | "finished";

export type LogEntry = { n: number; at: number; seat: Seat | null; text: string; kind?: "chat" | "coin" | "turn" | "system" };

export type GameState = {
  id: string;
  format: string;
  status: GameStatus;
  players: Record<Seat, PlayerState | null>;
  stadium: { card: CardRef; owner: Seat } | null;
  turn: number;
  current: Seat | null;
  winner: Seat | null;
  endReason: string | null;
  log: LogEntry[];
  logCount: number;
  version: number;
  cannotDraw: Seat | null; // a player who had to draw from an empty deck, which loses the game
  offlineSince: Record<Seat, number | null>;
  /**
   * The game on the rules engine (the same one as practice games), which carries out every card.
   * Games started before it existed don't have it and stay a manual table.
   */
  rules?: PState;
};

// ----- What each browser receives -----

export type SlotView = Slot | { hidden: true; count: number };

export type PlayerView = {
  userId: number;
  trainerName: string;
  avatarDex: number;
  deckName: string;
  deckCount: number;
  hand: CardRef[] | null; // null when hidden from this viewer
  handCount: number;
  prizeCount: number;
  discard: CardRef[];
  lostZone: CardRef[];
  active: SlotView | null;
  bench: SlotView[];
  ready: boolean;
  mulligans: number;
  online: boolean;
  mat?: string;
};

export type GameView = {
  id: string;
  format: string;
  status: GameStatus;
  you: Seat | null; // null for spectators
  players: Record<Seat, PlayerView | null>;
  stadium: { card: CardRef; owner: Seat } | null;
  turn: number;
  current: Seat | null;
  winner: Seat | null;
  endReason: string | null;
  log: LogEntry[];
  version: number;
  canClaimWin: boolean; // true when the viewer's opponent has lost but hasn't conceded
  /** The rules engine's game as this viewer may see it (hidden cards replaced), for rules games. */
  rules?: PState;
};

// ----- Actions a player can send -----

export type SlotRef = { zone: "active" } | { zone: "bench"; index: number };

export type Target =
  | { zone: "hand" | "discard" | "lostZone" | "deckTop" | "deckBottom" | "deckShuffle" | "stadium" }
  | { zone: "active"; mode: "place" | "attach" | "evolve" }
  | { zone: "bench"; index: number | null; mode: "place" | "attach" | "evolve" }; // index null = next empty bench spot

export type GameAction =
  | { type: "mulligan" }
  | { type: "ready" }
  | { type: "draw"; count?: number }
  | { type: "shuffle" }
  | { type: "mill"; count?: number }
  | { type: "searchDeck" }
  | { type: "move"; uid: string; to: Target }
  | { type: "slot"; slot: SlotRef; op: "discard" | "hand" | "lostZone" | "deckShuffle" }
  | { type: "damage"; side: Seat; slot: SlotRef; delta: number }
  | { type: "condition"; side: Seat; slot: SlotRef; condition: Condition }
  | { type: "switch"; bench: number }
  | { type: "takePrize"; index: number }
  | { type: "shuffleHandIntoDeck" }
  | { type: "revealHand" }
  | { type: "coin" }
  | { type: "endTurn" }
  | { type: "concede" }
  | { type: "claimWin" }
  | { type: "chat"; text: string }
  | { type: "mat"; id: string }
  /** A move on the rules engine (rules games only). */
  | { type: "rules"; action: PAction };

// ----- Messages over the WebSocket -----

export type ServerMessage =
  | { type: "state"; view: GameView }
  | { type: "deck"; cards: CardRef[] } // result of searchDeck, sent only to that player
  | { type: "error"; message: string };

export type ClientMessage = { type: "action"; action: GameAction } | { type: "ping" };

/** How long an opponent can be away before the other player can claim the win. */
export const AWAY_LIMIT_MS = 3 * 60_000;

export const BENCH_SIZE = 5;
export const PRIZE_COUNT = 6;
export const HAND_SIZE = 7;
