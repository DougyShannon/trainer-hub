import { Hono } from "hono";
import type { AppEnv, User } from "../types";
import { requireUser } from "../lib/auth";
import { parseJson } from "../lib/json";
import type { CardRef, PlayerInit } from "../../shared/game-types";

export const games = new Hono<AppEnv>();

type StoredEntry = { id: string; count: number };

const newGameId = () => {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => alphabet[b % alphabet.length]).join("");
};

const room = (env: AppEnv["Bindings"], id: string) => env.GAME_ROOM.get(env.GAME_ROOM.idFromName(id));

/** Loads one of the trainer's own saved decks and turns it into 60 physical cards for the table. */
async function deckForTable(db: D1Database, user: User, deckId: unknown) {
  if (typeof deckId !== "string") return { error: "Choose a deck" } as const;
  const deck = await db
    .prepare(`SELECT id, name, format, cards, is_valid FROM decks WHERE id = ? AND user_id = ?`)
    .bind(deckId, user.id)
    .first<Record<string, unknown>>();
  if (!deck) return { error: "Deck not found" } as const;
  if (!deck.is_valid) return { error: "That deck isn't legal yet. Fix it in the deck builder first." } as const;

  const stored = parseJson<StoredEntry[]>(deck.cards, []);
  const ids = stored.map((e) => e.id);
  const rows = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT id, name, supertype, subtypes, hp, image_small, image_large FROM cards WHERE id IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<Record<string, unknown>>();
    for (const r of results) rows.set(r.id as string, r);
  }

  const cards: CardRef[] = [];
  for (const { id, count } of stored) {
    const r = rows.get(id);
    if (!r) continue;
    for (let n = 0; n < count; n++) {
      cards.push({
        uid: crypto.randomUUID().slice(0, 13),
        cardId: id,
        name: r.name as string,
        supertype: r.supertype as string,
        subtypes: parseJson<string[]>(r.subtypes, []),
        hp: (r.hp as number | null) ?? null,
        image: (r.image_small as string | null) ?? null,
        imageLarge: (r.image_large as string | null) ?? null,
      });
    }
  }
  if (cards.length !== 60) return { error: "That deck doesn't have 60 cards." } as const;

  const player: PlayerInit = {
    userId: user.id,
    trainerName: user.trainerName,
    avatarDex: user.avatarDex,
    deckName: deck.name as string,
    cards,
  };
  return { player, format: deck.format as string } as const;
}

const GAME_COLUMNS = `
  g.id, g.format, g.status, g.is_open, g.host_deck_name, g.guest_deck_name, g.end_reason, g.turns,
  g.created_at, g.started_at, g.finished_at,
  h.trainer_name AS host_name, h.avatar_dex AS host_avatar,
  gu.trainer_name AS guest_name, gu.avatar_dex AS guest_avatar,
  w.trainer_name AS winner_name`;
const GAME_JOINS = `
  FROM games g JOIN users h ON h.id = g.host_user_id
  LEFT JOIN users gu ON gu.id = g.guest_user_id
  LEFT JOIN users w ON w.id = g.winner_user_id`;

export const gameSummary = (r: Record<string, unknown>) => ({
  id: r.id as string,
  format: r.format as string,
  status: r.status as string,
  isOpen: !!r.is_open,
  host: { trainerName: r.host_name as string, avatarDex: r.host_avatar as number, deckName: r.host_deck_name as string },
  guest: r.guest_name
    ? { trainerName: r.guest_name as string, avatarDex: r.guest_avatar as number, deckName: r.guest_deck_name as string }
    : null,
  winner: (r.winner_name as string | null) ?? null,
  endReason: (r.end_reason as string | null) ?? null,
  turns: r.turns as number,
  createdAt: r.created_at as string,
  finishedAt: (r.finished_at as string | null) ?? null,
});

// Open tables waiting for an opponent, newest first. Tables left waiting for over an hour drop off.
games.get("/api/games/open", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${GAME_COLUMNS} ${GAME_JOINS}
     WHERE g.status = 'waiting' AND g.is_open = 1 AND g.created_at > datetime('now', '-1 hour')
     ORDER BY g.created_at DESC LIMIT 30`,
  ).all<Record<string, unknown>>();
  return c.json(results.map(gameSummary));
});

// Games being played right now, for anyone who wants to watch.
games.get("/api/games/live", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${GAME_COLUMNS} ${GAME_JOINS}
     WHERE g.status IN ('setup', 'playing') AND g.started_at > datetime('now', '-6 hours')
     ORDER BY g.started_at DESC LIMIT 20`,
  ).all<Record<string, unknown>>();
  return c.json(results.map(gameSummary));
});

// The logged-in trainer's own recent games, so they can get back to one in progress.
games.get("/api/games/mine", requireUser, async (c) => {
  const id = c.get("user")!.id;
  const { results } = await c.env.DB.prepare(
    `SELECT ${GAME_COLUMNS} ${GAME_JOINS}
     WHERE (g.host_user_id = ? OR g.guest_user_id = ?) AND g.status != 'cancelled'
       AND (g.status != 'waiting' OR g.created_at > datetime('now', '-1 hour'))
     ORDER BY g.created_at DESC LIMIT 20`,
  )
    .bind(id, id)
    .all<Record<string, unknown>>();
  return c.json(results.map(gameSummary));
});

games.post("/api/games", requireUser, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const deck = await deckForTable(c.env.DB, user, body.deckId);
  if ("error" in deck) return c.json({ error: deck.error }, 400);

  const waiting = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM games WHERE host_user_id = ? AND status = 'waiting' AND created_at > datetime('now', '-1 hour')`,
  )
    .bind(user.id)
    .first<{ n: number }>();
  if ((waiting?.n ?? 0) >= 3) return c.json({ error: "You already have 3 tables waiting. Close one first." }, 400);

  const id = newGameId();
  await c.env.DB.prepare(`INSERT INTO games (id, format, is_open, host_user_id, host_deck_name) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, deck.format, body.isOpen === false ? 0 : 1, user.id, deck.player.deckName)
    .run();
  await room(c.env, id).create(id, deck.format, deck.player);
  return c.json({ id }, 201);
});

games.get("/api/games/:id", async (c) => {
  const row = await c.env.DB.prepare(`SELECT ${GAME_COLUMNS}, g.host_user_id, g.guest_user_id ${GAME_JOINS} WHERE g.id = ?`)
    .bind(c.req.param("id"))
    .first<Record<string, unknown>>();
  if (!row || row.status === "cancelled") return c.json({ error: "Game not found" }, 404);
  const viewer = c.get("user");
  const role = viewer?.id === row.host_user_id ? "host" : viewer && viewer.id === row.guest_user_id ? "guest" : "viewer";
  return c.json({ ...gameSummary(row), role });
});

games.post("/api/games/:id/join", requireUser, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const game = await c.env.DB.prepare(`SELECT * FROM games WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!game || game.status === "cancelled") return c.json({ error: "Game not found" }, 404);
  if (game.status !== "waiting") return c.json({ error: "Someone has already joined this game." }, 409);
  if (game.host_user_id === user.id) return c.json({ error: "You can't play against yourself." }, 400);

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const deck = await deckForTable(c.env.DB, user, body.deckId);
  if ("error" in deck) return c.json({ error: deck.error }, 400);
  if (deck.format !== game.format) return c.json({ error: `This game is for ${game.format} decks. Pick a ${game.format} deck.` }, 400);

  // Only one person can take the empty seat, even if two click Join at the same moment.
  const claimed = await c.env.DB.prepare(
    `UPDATE games SET guest_user_id = ?, guest_deck_name = ?, status = 'setup' WHERE id = ? AND status = 'waiting'`,
  )
    .bind(user.id, deck.player.deckName, id)
    .run();
  if (!claimed.meta.changes) return c.json({ error: "Someone has already joined this game." }, 409);

  await room(c.env, id).join(deck.player);
  return c.json({ id });
});

games.delete("/api/games/:id", requireUser, async (c) => {
  const id = c.req.param("id");
  const res = await c.env.DB.prepare(`UPDATE games SET status = 'cancelled' WHERE id = ? AND host_user_id = ? AND status = 'waiting'`)
    .bind(id, c.get("user")!.id)
    .run();
  if (!res.meta.changes) return c.json({ error: "Only an unstarted table you opened can be closed." }, 400);
  await room(c.env, id).cancel();
  return c.json({ ok: true });
});

// Players and spectators connect here. The trainer's identity comes from their login cookie,
// never from anything the browser sends, and connections from other websites are refused.
games.get("/api/games/:id/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") return c.json({ error: "Expected a WebSocket" }, 426);
  const origin = c.req.header("Origin");
  if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: "Not allowed" }, 403);

  const headers = new Headers(c.req.raw.headers);
  headers.delete("X-Trainer-Id");
  const user = c.get("user");
  if (user) headers.set("X-Trainer-Id", String(user.id));
  return room(c.env, c.req.param("id")).fetch(new Request(c.req.raw.url, { headers }));
});
