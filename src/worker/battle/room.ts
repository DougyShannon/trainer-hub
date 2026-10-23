import { DurableObject } from "cloudflare:workers";
import {
  LIVE_AWAY_LIMIT_MS,
  LIVE_SEATS,
  type LiveBattleView,
  type LiveClientMessage,
  type LivePlayer,
  type LiveSeat,
  type LiveServerMessage,
} from "../../shared/live-battle";

type Env = { DB: D1Database };
type Attachment = { userId: number | null; seat: LiveSeat | null };

/** A player as the room keeps them: who they are and their team in Showdown's set shape. */
export type LiveEntrant = LivePlayer & { userId: number; team: object[] };

type BattleState = {
  id: string;
  format: string;
  status: LiveBattleView["status"];
  seed: string;
  players: { p1: LiveEntrant; p2: LiveEntrant | null };
  /** Every choice so far, as Showdown input lines (">p1 move 1", ">forcewin p2"). */
  log: string[];
  /** The last request each player answered, so a choice sent twice only counts once. */
  lastRqid: Record<LiveSeat, number>;
  winner: LiveSeat | "" | null;
  endReason: LiveBattleView["endReason"];
  turns: number;
  offlineSince: Record<LiveSeat, number | null>;
};

const MAX_MESSAGE = 2000;
const MAX_LOG = 5000;
const other = (seat: LiveSeat): LiveSeat => (seat === "p1" ? "p2" : "p1");

/** The same kind of seed Showdown makes for itself: four numbers from 0 to 65535. */
const newSeed = () => [...crypto.getRandomValues(new Uint16Array(4))].join(",");

/**
 * One battle between two trainers. Both browsers run the battle themselves from the same seed and
 * teams, so the room never runs Pokémon Showdown: it keeps the choices in the order they arrive and
 * sends the whole list to everyone after each one. That keeps the server tiny and the two browsers
 * in step. Uses the WebSocket Hibernation API, so a quiet battle costs nothing between turns.
 */
export class LiveBattleRoom extends DurableObject<Env> {
  private state: BattleState | null | undefined;

  private async load() {
    if (this.state === undefined) this.state = (await this.ctx.storage.get<BattleState>("battle")) ?? null;
    return this.state;
  }

  private async save(state: BattleState) {
    this.state = state;
    await this.ctx.storage.put("battle", state);
  }

  /** Called by the API when a trainer opens the battle. */
  async create(id: string, format: string, host: LiveEntrant) {
    if (await this.load()) throw new Error("Battle already exists");
    await this.save({
      id,
      format,
      status: "waiting",
      seed: newSeed(),
      players: { p1: host, p2: null },
      log: [],
      lastRqid: { p1: 0, p2: 0 },
      winner: null,
      endReason: null,
      turns: 0,
      offlineSince: { p1: null, p2: null },
    });
  }

  /** Called by the API once it has claimed the empty seat for the second trainer. */
  async join(guest: LiveEntrant) {
    const state = await this.load();
    if (!state || state.status !== "waiting") throw new Error("This battle has already started");
    state.players.p2 = guest;
    state.status = "playing";
    await this.save(state);
    this.broadcast(state);
  }

  /** Called by the API when the host closes a battle nobody joined. */
  async cancel() {
    const state = await this.load();
    if (!state || state.status !== "waiting") return false;
    for (const ws of this.ctx.getWebSockets()) ws.close(4000, "Battle cancelled");
    await this.ctx.storage.deleteAll();
    this.state = null;
    return true;
  }

  async fetch(request: Request) {
    const state = await this.load();
    if (!state) return new Response("No such battle", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });

    const userId = Number(request.headers.get("X-Trainer-Id")) || null;
    const seat = LIVE_SEATS.find((s) => userId !== null && state.players[s]?.userId === userId) ?? null;

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
    let msg: LiveClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.send(ws, { type: "error", message: "Couldn't read that message." });
    }
    if (!msg || typeof msg !== "object" || msg.type === "ping") return;
    if (!seat) return this.send(ws, { type: "error", message: "Watchers can't make choices." });

    const state = await this.load();
    if (!state || state.status !== "playing") return;

    if (msg.type === "choose") {
      const rqid = Number(msg.rqid);
      const choice = typeof msg.choice === "string" ? msg.choice.replace(/[\r\n|]/g, " ").trim().slice(0, 200) : "";
      // Already answered (a double click, or a resend after reconnecting): nothing to do.
      if (!choice || !Number.isInteger(rqid) || rqid <= state.lastRqid[seat]) return;
      if (state.log.length >= MAX_LOG) return this.finish(state, "", "battle");
      state.lastRqid[seat] = rqid;
      state.log.push(`>${seat} ${choice}`);
      await this.save(state);
      this.broadcast(state);
    } else if (msg.type === "forfeit") {
      await this.finish(state, other(seat), "forfeit");
    } else if (msg.type === "claim") {
      const away = state.offlineSince[other(seat)];
      if (!away || Date.now() - away < LIVE_AWAY_LIMIT_MS || this.online()[other(seat)]) {
        return this.send(ws, { type: "error", message: "Your opponent hasn't been away long enough yet." });
      }
      await this.finish(state, seat, "away");
    } else if (msg.type === "result") {
      // The battle ended in this player's browser. Both browsers run the same battle, so the
      // first report settles it.
      const winner = msg.winner === "p1" || msg.winner === "p2" ? msg.winner : "";
      state.turns = Math.max(0, Math.min(10_000, Math.floor(Number(msg.turns)) || 0));
      await this.finish(state, winner, "battle");
    }
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

  /** Ends the battle. Forfeits and wins by absence go in the log so both browsers show them. */
  private async finish(state: BattleState, winner: LiveSeat | "", reason: NonNullable<LiveBattleView["endReason"]>) {
    if (state.status !== "playing") return;
    if (reason !== "battle" && winner) state.log.push(`>forcewin ${winner}`);
    state.status = "finished";
    state.winner = winner;
    state.endReason = reason;
    await this.save(state);
    const winnerId = winner ? (state.players[winner]?.userId ?? null) : null;
    await this.env.DB.prepare(
      `UPDATE live_battles SET status = 'finished', winner_user_id = ?, end_reason = ?, turns = ?, finished_at = datetime('now') WHERE id = ?`,
    )
      .bind(winnerId, reason, state.turns, state.id)
      .run();
    this.broadcast(state);
  }

  private async leave(ws: WebSocket) {
    const { seat } = ws.deserializeAttachment() as Attachment;
    const state = await this.load();
    if (!state || !seat) return;
    if (!this.online(ws)[seat] && state.status === "playing" && !state.offlineSince[seat]) {
      state.offlineSince[seat] = Date.now();
      await this.save(state);
      await this.ctx.storage.setAlarm(Date.now() + LIVE_AWAY_LIMIT_MS + 1000);
    }
    this.broadcast(state, ws);
  }

  private online(skip?: WebSocket): Record<LiveSeat, boolean> {
    const is = (seat: LiveSeat) => this.ctx.getWebSockets(seat).some((ws) => ws !== skip && ws.readyState === WebSocket.OPEN);
    return { p1: is("p1"), p2: is("p2") };
  }

  private viewFor(state: BattleState, seat: LiveSeat | null, online: Record<LiveSeat, boolean>): LiveBattleView {
    const { p1, p2 } = state.players;
    const show = (p: LiveEntrant): LivePlayer => ({ trainerName: p.trainerName, avatarDex: p.avatarDex, teamName: p.teamName });
    const input = p2
      ? [
          `>start ${JSON.stringify({ formatid: state.format, seed: state.seed })}`,
          `>player p1 ${JSON.stringify({ name: p1.trainerName, team: p1.team })}`,
          `>player p2 ${JSON.stringify({ name: p2.trainerName, team: p2.team })}`,
          ...state.log,
        ]
      : [];
    return {
      id: state.id,
      format: state.format,
      status: state.status,
      seat,
      players: { p1: show(p1), p2: p2 ? show(p2) : null },
      input,
      online,
      offlineSince: state.offlineSince,
      winner: state.winner,
      endReason: state.endReason,
    };
  }

  private broadcast(state: BattleState, skip?: WebSocket) {
    const online = this.online(skip);
    const views = new Map<LiveSeat | null, string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === skip) continue;
      const { seat } = ws.deserializeAttachment() as Attachment;
      if (!views.has(seat)) views.set(seat, JSON.stringify({ type: "state", view: this.viewFor(state, seat, online) } satisfies LiveServerMessage));
      try {
        ws.send(views.get(seat)!);
      } catch {
        // The socket closed while we were sending; webSocketClose will tidy up.
      }
    }
  }

  private send(ws: WebSocket, msg: LiveServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // ignore closed sockets
    }
  }
}
