import { Hono } from "hono";
import type { AppEnv } from "../types";
import { endSession, hashPassword, requireUser, startSession, toUser, USER_COLUMNS, verifyPassword } from "../lib/auth";
import { deckSummary } from "./decks";
import { cardsById } from "../lib/json";

export const accounts = new Hono<AppEnv>();

const TRAINER_NAME = /^[A-Za-z0-9_-]{3,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_DEX = 1025;

const trainerNameProblem = (name: string) =>
  TRAINER_NAME.test(name) ? null : "Trainer names are 3 to 20 characters: letters, numbers, - and _ only.";
const passwordProblem = (pw: string) =>
  pw.length >= 8 && pw.length <= 200 ? null : "Passwords need at least 8 characters.";

const publicUser = (u: ReturnType<typeof toUser>) => ({
  trainerName: u.trainerName,
  avatarDex: u.avatarDex,
  favouriteDex: u.favouriteDex,
  bio: u.bio,
  country: u.country,
  createdAt: u.createdAt,
});

accounts.get("/api/auth/me", (c) => {
  const user = c.get("user");
  return c.json({ user: user ? { ...publicUser(user), email: user.email } : null });
});

accounts.post("/api/auth/signup", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const email = String(body.email ?? "").trim().toLowerCase();
  const trainerName = String(body.trainerName ?? "").trim();
  const password = String(body.password ?? "");

  const problem =
    (!EMAIL.test(email) && "Enter a valid email address.") || trainerNameProblem(trainerName) || passwordProblem(password);
  if (problem) return c.json({ error: problem }, 400);

  const taken = await c.env.DB.prepare(`SELECT email, trainer_name FROM users WHERE email = ? OR trainer_name = ?`)
    .bind(email, trainerName)
    .first<{ email: string; trainer_name: string }>();
  if (taken) {
    return c.json(
      {
        error:
          taken.email.toLowerCase() === email
            ? "There's already an account with that email. Try logging in."
            : "That trainer name is taken. Try another.",
      },
      409,
    );
  }

  const { hash, salt } = await hashPassword(password);
  const avatar = Number(body.avatarDex);
  const row = await c.env.DB.prepare(
    `INSERT INTO users (email, trainer_name, password_hash, password_salt, avatar_dex) VALUES (?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(email, trainerName, hash, salt, avatar >= 1 && avatar <= MAX_DEX ? avatar : 25)
    .first<{ id: number }>();
  await startSession(c, row!.id);
  return c.json({ ok: true }, 201);
});

accounts.post("/api/auth/login", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const login = String(body.login ?? "").trim();
  const password = String(body.password ?? "");
  const row = await c.env.DB.prepare(`SELECT id, password_hash, password_salt FROM users WHERE email = ? OR trainer_name = ?`)
    .bind(login.toLowerCase(), login)
    .first<{ id: number; password_hash: string; password_salt: string }>();

  // Hash even when the account doesn't exist, so response time doesn't reveal which emails are registered.
  const ok = row
    ? await verifyPassword(password, row.password_hash, row.password_salt)
    : (await hashPassword(password), false);
  if (!row || !ok) return c.json({ error: "That email or trainer name and password don't match." }, 401);

  await startSession(c, row.id);
  return c.json({ ok: true });
});

accounts.post("/api/auth/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

accounts.put("/api/me", requireUser, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const trainerName = body.trainerName === undefined ? user.trainerName : String(body.trainerName).trim();
  const problem = trainerNameProblem(trainerName);
  if (problem) return c.json({ error: problem }, 400);

  if (trainerName.toLowerCase() !== user.trainerName.toLowerCase()) {
    const taken = await c.env.DB.prepare(`SELECT 1 FROM users WHERE trainer_name = ? AND id != ?`).bind(trainerName, user.id).first();
    if (taken) return c.json({ error: "That trainer name is taken. Try another." }, 409);
  }

  const dex = (v: unknown, fallback: number | null) => {
    if (v === null) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= MAX_DEX ? n : fallback;
  };

  await c.env.DB.prepare(`UPDATE users SET trainer_name = ?, avatar_dex = ?, favourite_dex = ?, bio = ?, country = ? WHERE id = ?`)
    .bind(
      trainerName,
      dex(body.avatarDex, user.avatarDex) ?? user.avatarDex,
      body.favouriteDex === undefined ? user.favouriteDex : dex(body.favouriteDex, user.favouriteDex),
      body.bio === undefined ? user.bio : String(body.bio).slice(0, 300),
      body.country === undefined ? user.country : String(body.country).slice(0, 60),
      user.id,
    )
    .run();
  return c.json({ ok: true });
});

accounts.put("/api/me/password", requireUser, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const current = String(body.currentPassword ?? "");
  const next = String(body.newPassword ?? "");
  const problem = passwordProblem(next);
  if (problem) return c.json({ error: problem }, 400);

  const row = await c.env.DB.prepare(`SELECT password_hash, password_salt FROM users WHERE id = ?`)
    .bind(user.id)
    .first<{ password_hash: string; password_salt: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash, row.password_salt))) {
    return c.json({ error: "Your current password isn't right." }, 400);
  }
  const { hash, salt } = await hashPassword(next);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?`).bind(hash, salt, user.id),
    // Log out every other device.
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(user.id),
  ]);
  await startSession(c, user.id);
  return c.json({ ok: true });
});

accounts.delete("/api/me", requireUser, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const row = await c.env.DB.prepare(`SELECT password_hash, password_salt FROM users WHERE id = ?`)
    .bind(user.id)
    .first<{ password_hash: string; password_salt: string }>();
  if (!row || !(await verifyPassword(String(body.password ?? ""), row.password_hash, row.password_salt))) {
    return c.json({ error: "That password isn't right." }, 400);
  }
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM decks WHERE user_id = ?`).bind(user.id),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(user.id),
    c.env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(user.id),
  ]);
  await endSession(c);
  return c.json({ ok: true });
});

accounts.get("/api/trainers/:name", async (c) => {
  const row = await c.env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users u WHERE u.trainer_name = ?`)
    .bind(c.req.param("name"))
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Trainer not found" }, 404);
  const user = toUser(row);
  const viewer = c.get("user");
  const isMe = viewer?.id === user.id;

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM decks WHERE user_id = ? ${isMe ? "" : "AND is_public = 1"} ORDER BY updated_at DESC LIMIT 50`,
  )
    .bind(user.id)
    .all<Record<string, unknown>>();

  const covers = await cardsById(c.env.DB, results.map((r) => r.cover_card_id as string).filter(Boolean));

  const record = await c.env.DB.prepare(
    `SELECT COUNT(*) AS played, COALESCE(SUM(winner_user_id = ?), 0) AS wins
     FROM games WHERE status = 'finished' AND (host_user_id = ? OR guest_user_id = ?)`,
  )
    .bind(user.id, user.id, user.id)
    .first<{ played: number; wins: number }>();
  const recent = await c.env.DB.prepare(
    `SELECT g.id, g.finished_at, g.turns, g.end_reason, g.winner_user_id,
       CASE WHEN g.host_user_id = ?1 THEN g.host_deck_name ELSE g.guest_deck_name END AS deck_name,
       o.trainer_name AS opponent, o.avatar_dex AS opponent_avatar
     FROM games g LEFT JOIN users o ON o.id = CASE WHEN g.host_user_id = ?1 THEN g.guest_user_id ELSE g.host_user_id END
     WHERE g.status = 'finished' AND (g.host_user_id = ?1 OR g.guest_user_id = ?1)
     ORDER BY g.finished_at DESC LIMIT 10`,
  )
    .bind(user.id)
    .all<Record<string, unknown>>();

  const played = record?.played ?? 0;
  const wins = record?.wins ?? 0;
  return c.json({
    trainer: publicUser(user),
    isMe,
    decks: results.map((r) => ({ ...deckSummary(r), coverImage: covers.get(r.cover_card_id as string)?.image ?? null })),
    record: { played, wins, losses: played - wins },
    recentGames: recent.results.map((r) => ({
      id: r.id as string,
      won: r.winner_user_id === user.id,
      opponent: (r.opponent as string | null) ?? "A former trainer",
      opponentAvatar: (r.opponent_avatar as number | null) ?? null,
      deckName: r.deck_name as string,
      turns: r.turns as number,
      endReason: r.end_reason as string | null,
      finishedAt: r.finished_at as string,
    })),
  });
});
