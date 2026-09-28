import { DurableObject } from "cloudflare:workers";
import { SEATS, AWAY_LIMIT_MS, type ClientMessage, type GameState, type PlayerInit, type Seat, type ServerMessage } from "../../shared/game-types";
import { GameError, applyAction, joinGame, newGame, viewFor, log } from "./engine";

type Env = { DB: D1Database };
type Attachment = { userId: number | null; seat: Seat | null };

const MAX_MESSAGE = 4000;

/**
 * One live game. Every player and spectator keeps a WebSocket open to the room; the room holds the
 * full game, applies each move, and sends everyone their own view of the table.
 * Uses the WebSocket Hibernation API, so an idle table costs nothing between moves.
 */
export class GameRoom extends DurableObject<Env> {
  private state: GameState | null | undefined;

  private async load() {
    if (this.state === undefined) this.state = (await this.ctx.storage.get<GameState>("game")) ?? null;
    return this.state;
  }

  private async save(state: GameState) {
    state.version += 1;
    this.state = state;
    await this.ctx.storage.put("game", state);
  }

  /** Called by the API when a trainer creates the game. */
  async create(id: string, format: string, host: PlayerInit) {
    if (await this.load()) throw new Error("Game already exists");
    await this.save(newGame(id, format, host));
  }

  /** Called by the API once it has checked the second trainer's deck. */
  async join(guest: PlayerInit) {
    const state = (await this.load()) ?? fail();
    joinGame(state, guest);
    await this.save(state);
    await this.recordStatus(state);
    this.broadcast(state);
  }

  /** Called by the API when the host closes a table nobody joined. */
  async cancel() {
    const state = await this.load();
    if (!state || state.status !== "waiting") return false;
    for (const ws of this.ctx.getWebSockets()) ws.close(4000, "Game cancelled");
    await this.ctx.storage.deleteAll();
    this.state = null;
    return true;
  }

  async fetch(request: Request) {
    const state = await this.load();
    if (!state) return new Response("No such game", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });

    const userId = Number(request.headers.get("X-Trainer-Id")) || null;
    const seat = SEATS.find((s) => userId !== null && state.players[s]?.userId === userId) ?? null;

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, seat ? [seat] : ["spectator"]);
    server.serializeAttachment({ userId, seat } satisfies Attachment);

    if (seat && state.offlineSince[seat]) {
      state.offlineSince[seat] = null;
      await this.save(state);
    }
    this.broadcast(state);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const { seat } = ws.deserializeAttachment() as Attachment;
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return this.send(ws, { type: "error", message: "Message too large." });

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.send(ws, { type: "error", message: "Couldn't read that message." });
    }
    if (msg.type === "ping") return;
    if (msg.type !== "action" || !msg.action || typeof msg.action !== "object") return;
    if (!seat) return this.send(ws, { type: "error", message: "Spectators can't make moves." });

    const state = await this.load();
    if (!state) return;
    const wasFinished = state.status === "finished";
    const before = state.status;
    try {
      const result = applyAction(state, seat, msg.action);
      await this.save(state);
      if (result.privateDeck) this.send(ws, { type: "deck", cards: result.privateDeck });
    } catch (e) {
      if (e instanceof GameError) {
        // The state may have been partly changed before the error; reload the saved copy.
        this.state = undefined;
        return this.send(ws, { type: "error", message: e.message });
      }
      throw e;
    }
    if (state.status !== before && !wasFinished) await this.recordStatus(state);
    this.broadcast(state);
  }

  async webSocketClose(ws: WebSocket) {
    await this.leave(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.leave(ws);
  }

  /** Runs when an absent player has been away long enough for their opponent to claim the win. */
  async alarm() {
    const state = await this.load();
    if (state) this.broadcast(state);
  }

  private async leave(ws: WebSocket) {
    const { seat } = ws.deserializeAttachment() as Attachment;
    const state = await this.load();
    if (!state || !seat) return;
    const stillHere = this.ctx.getWebSockets(seat).some((other) => other !== ws && other.readyState === WebSocket.OPEN);
    if (!stillHere && state.status === "playing" && !state.offlineSince[seat]) {
      state.offlineSince[seat] = Date.now();
      log(state, seat, `${state.players[seat]?.trainerName} lost connection.`, "system");
      await this.save(state);
      await this.ctx.storage.setAlarm(Date.now() + AWAY_LIMIT_MS + 1000);
    }
    this.broadcast(state, ws);
  }

  private online(skip?: WebSocket): Record<Seat, boolean> {
    const is = (seat: Seat) => this.ctx.getWebSockets(seat).some((ws) => ws !== skip && ws.readyState === WebSocket.OPEN);
    return { p1: is("p1"), p2: is("p2") };
  }

  private broadcast(state: GameState, skip?: WebSocket) {
    const online = this.online(skip);
    const views = new Map<Seat | null, string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === skip) continue;
      const { seat } = ws.deserializeAttachment() as Attachment;
      if (!views.has(seat)) views.set(seat, JSON.stringify({ type: "state", view: viewFor(state, seat, online) } satisfies ServerMessage));
      try {
        ws.send(views.get(seat)!);
      } catch {
        // The socket closed while we were sending; webSocketClose will tidy up.
      }
    }
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // ignore closed sockets
    }
  }

  /** Keeps the games table in D1 in step, so the lobby and trainer profiles can list games. */
  private async recordStatus(state: GameState) {
    const winnerId = state.winner ? state.players[state.winner]?.userId ?? null : null;
    await this.env.DB.prepare(
      `UPDATE games SET status = ?, winner_user_id = ?, end_reason = ?, turns = ?,
         started_at = CASE WHEN ? = 'setup' THEN datetime('now') ELSE started_at END,
         finished_at = CASE WHEN ? = 'finished' THEN datetime('now') ELSE finished_at END
       WHERE id = ?`,
    )
      .bind(state.status, winnerId, state.endReason, state.turn, state.status, state.status, state.id)
      .run();
  }
}

function fail(): never {
  throw new Error("No such game");
}
