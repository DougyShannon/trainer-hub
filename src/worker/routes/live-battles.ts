import { Hono } from "hono";
import type { AppEnv, User } from "../types";
import { requireUser } from "../lib/auth";
import { parseJson } from "../lib/json";
import { cleanSet, type PokemonSet } from "../../shared/team-sets";
import { battleFormat } from "../../shared/battle/opponents";
import type { LiveBattleSummary } from "../../shared/live-battle";
import type { LiveEntrant } from "../battle/room";

/** Battle tab battles between two trainers: the lobby, opening, joining and connecting. */
export const liveBattles = new Hono<AppEnv>();

const newId = () => {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => alphabet[b % alphabet.length]).join("");
};

const room = (env: AppEnv["Bindings"], id: string) => env.LIVE_BATTLE_ROOM.get(env.LIVE_BATTLE_ROOM.idFromName(id));

/** One of the trainer's own Team Builder teams, ready for the battle. */
async function entrant(db: D1Database, user: User, teamId: unknown): Promise<LiveEntrant | { error: string }> {
  if (typeof teamId !== "string") return { error: "Choose a team" };
  const row = await db.prepare(`SELECT name, sets FROM teams WHERE id = ? AND user_id = ?`).bind(teamId, user.id).first<Record<string, unknown>>();
  if (!row) return { error: "Team not found" };
  const sets = parseJson<unknown[]>(row.sets, [])
    .map(cleanSet)
    .filter((s): s is PokemonSet => !!s)
    .slice(0, 6);
  if (!sets.length) return { error: "That team has no Pokémon yet." };
  // Showdown's set shape: blank moves dropped, blank fields left out.
  const team = sets.map((s) => ({
    ...s,
    name: s.name || s.species,
    moves: s.moves.filter(Boolean),
    gender: s.gender || undefined,
    teraType: s.teraType || undefined,
  }));
  return { userId: user.id, trainerName: user.trainerName, avatarDex: user.avatarDex, teamName: row.name as string, team };
}

const COLUMNS = `
  b.id, b.format, b.status, b.is_open, b.host_team_name, b.guest_team_name, b.turns, b.created_at,
  h.trainer_name AS host_name, h.avatar_dex AS host_avatar,
  g.trainer_name AS guest_name, g.avatar_dex AS guest_avatar,
  w.trainer_name AS winner_name`;
const JOINS = `
  FROM live_battles b JOIN users h ON h.id = b.host_user_id
  LEFT JOIN users g ON g.id = b.guest_user_id
  LEFT JOIN users w ON w.id = b.winner_user_id`;

const summary = (r: Record<string, unknown>): LiveBattleSummary => ({
  id: r.id as string,
  format: r.format as string,
  status: r.status as LiveBattleSummary["status"],
  isOpen: !!r.is_open,
  host: { trainerName: r.host_name as string, avatarDex: r.host_avatar as number, teamName: r.host_team_name as string },
  guest: r.guest_name ? { trainerName: r.guest_name as string, avatarDex: r.guest_avatar as number, teamName: r.guest_team_name as string } : null,
  winner: (r.winner_name as string | null) ?? null,
  turns: r.turns as number,
  createdAt: r.created_at as string,
});

// Battles waiting for an opponent, newest first. Ones left waiting for over an hour drop off.
liveBattles.get("/api/live-battles/open", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${COLUMNS} ${JOINS}
     WHERE b.status = 'waiting' AND b.is_open = 1 AND b.created_at > datetime('now', '-1 hour')
     ORDER BY b.created_at DESC LIMIT 30`,
  ).all<Record<string, unknown>>();
  return c.json(results.map(summary));
});

// Battles going on right now, for anyone who wants to watch.
liveBattles.get("/api/live-battles/live", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${COLUMNS} ${JOINS}
     WHERE b.status = 'playing' AND b.started_at > datetime('now', '-6 hours')
     ORDER BY b.started_at DESC LIMIT 20`,
  ).all<Record<string, unknown>>();
  return c.json(results.map(summary));
});

// The trainer's own recent battles, so they can get back to one.
liveBattles.get("/api/live-battles/mine", requireUser, async (c) => {
  const id = c.get("user")!.id;
  const { results } = await c.env.DB.prepare(
    `SELECT ${COLUMNS} ${JOINS}
     WHERE (b.host_user_id = ? OR b.guest_user_id = ?) AND b.status != 'cancelled'
       AND (b.status != 'waiting' OR b.created_at > datetime('now', '-1 hour'))
     ORDER BY b.created_at DESC LIMIT 20`,
  )
    .bind(id, id)
    .all<Record<string, unknown>>();
  return c.json(results.map(summary));
});

liveBattles.post("/api/live-battles", requireUser, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const format = battleFormat(body.format);
  if (!format) return c.json({ error: "Pick a battle format" }, 400);
  const host = await entrant(c.env.DB, user, body.teamId);
  if ("error" in host) return c.json({ error: host.error }, 400);

  const waiting = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM live_battles WHERE host_user_id = ? AND status = 'waiting' AND created_at > datetime('now', '-1 hour')`,
  )
    .bind(user.id)
    .first<{ n: number }>();
  if ((waiting?.n ?? 0) >= 3) return c.json({ error: "You already have 3 battles waiting. Close one first." }, 400);

  const id = newId();
  await c.env.DB.prepare(`INSERT INTO live_battles (id, format, is_open, host_user_id, host_team_name) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, format.id, body.isOpen === false ? 0 : 1, user.id, host.teamName)
    .run();
  await room(c.env, id).create(id, format.id, host);
  return c.json({ id }, 201);
});

liveBattles.get("/api/live-battles/:id", async (c) => {
  const row = await c.env.DB.prepare(`SELECT ${COLUMNS}, b.host_user_id, b.guest_user_id ${JOINS} WHERE b.id = ?`)
    .bind(c.req.param("id"))
    .first<Record<string, unknown>>();
  if (!row || row.status === "cancelled") return c.json({ error: "Battle not found" }, 404);
  const viewer = c.get("user");
  const role = viewer?.id === row.host_user_id ? "host" : viewer && viewer.id === row.guest_user_id ? "guest" : "viewer";
  return c.json({ ...summary(row), role });
});

liveBattles.post("/api/live-battles/:id/join", requireUser, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const battle = await c.env.DB.prepare(`SELECT * FROM live_battles WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!battle || battle.status === "cancelled") return c.json({ error: "Battle not found" }, 404);
  if (battle.status !== "waiting") return c.json({ error: "Someone has already joined this battle." }, 409);
  if (battle.host_user_id === user.id) return c.json({ error: "You can't battle yourself." }, 400);

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const guest = await entrant(c.env.DB, user, body.teamId);
  if ("error" in guest) return c.json({ error: guest.error }, 400);

  // Only one person can take the empty seat, even if two click Join at the same moment.
  const claimed = await c.env.DB.prepare(
    `UPDATE live_battles SET guest_user_id = ?, guest_team_name = ?, status = 'playing', started_at = datetime('now') WHERE id = ? AND status = 'waiting'`,
  )
    .bind(user.id, guest.teamName, id)
    .run();
  if (!claimed.meta.changes) return c.json({ error: "Someone has already joined this battle." }, 409);

  await room(c.env, id).join(guest);
  return c.json({ id });
});

liveBattles.delete("/api/live-battles/:id", requireUser, async (c) => {
  const id = c.req.param("id");
  const res = await c.env.DB.prepare(`UPDATE live_battles SET status = 'cancelled' WHERE id = ? AND host_user_id = ? AND status = 'waiting'`)
    .bind(id, c.get("user")!.id)
    .run();
  if (!res.meta.changes) return c.json({ error: "Only a battle you opened that nobody has joined can be closed." }, 400);
  await room(c.env, id).cancel();
  return c.json({ ok: true });
});

// Players and watchers connect here. The trainer's identity comes from their login cookie, never
// from anything the browser sends, and connections from other websites are refused.
liveBattles.get("/api/live-battles/:id/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") return c.json({ error: "Expected a WebSocket" }, 426);
  const origin = c.req.header("Origin");
  if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: "Not allowed" }, 403);

  const headers = new Headers(c.req.raw.headers);
  headers.delete("X-Trainer-Id");
  const user = c.get("user");
  if (user) headers.set("X-Trainer-Id", String(user.id));
  return room(c.env, c.req.param("id")).fetch(new Request(c.req.raw.url, { headers }));
});
