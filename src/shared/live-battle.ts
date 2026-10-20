// Battles between two trainers on the Battle tab. Both browsers run the same Pokémon Showdown
// battle from the same random seed; the server (a LiveBattleRoom Durable Object) only keeps the
// list of choices in order and shares it, so every player sees exactly the same battle.

export type LiveSeat = "p1" | "p2";
export const LIVE_SEATS: LiveSeat[] = ["p1", "p2"];

export type LivePlayer = { trainerName: string; avatarDex: number; teamName: string };

export type LiveBattleView = {
  id: string;
  format: string;
  status: "waiting" | "playing" | "finished";
  /** Your seat, or null when watching. */
  seat: LiveSeat | null;
  players: { p1: LivePlayer; p2: LivePlayer | null };
  /**
   * Showdown's input log: the start line, both players with their teams, then every choice in
   * order. Replaying it gives the battle so far. Empty until both players are in.
   */
  input: string[];
  online: Record<LiveSeat, boolean>;
  /** When each player lost connection (ms since 1970), or null while they're here. */
  offlineSince: Record<LiveSeat, number | null>;
  /** "p1", "p2", "" for a draw, or null while the battle goes on. */
  winner: LiveSeat | "" | null;
  endReason: "battle" | "forfeit" | "away" | null;
};

export type LiveServerMessage = { type: "state"; view: LiveBattleView } | { type: "error"; message: string };

export type LiveClientMessage =
  | { type: "ping" }
  /** A choice for the request with this id, like "move 1" or "switch 3". */
  | { type: "choose"; rqid: number; choice: string }
  | { type: "forfeit" }
  /** Win because the opponent has been away too long. */
  | { type: "claim" }
  /** The battle ended in this browser: who won and after how many turns. */
  | { type: "result"; winner: LiveSeat | ""; turns: number };

export type LiveBattleSummary = {
  id: string;
  format: string;
  status: "waiting" | "playing" | "finished";
  isOpen: boolean;
  host: LivePlayer;
  guest: LivePlayer | null;
  winner: string | null;
  turns: number;
  createdAt: string;
};

export type LiveBattleInfo = LiveBattleSummary & { role: "host" | "guest" | "viewer" };

/** How long a player can be away before their opponent can claim the win. */
export const LIVE_AWAY_LIMIT_MS = 3 * 60_000;
