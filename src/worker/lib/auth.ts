import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, User } from "../types";

const COOKIE = "th_session";
const SESSION_DAYS = 30;
// 100,000 is the most PBKDF2 iterations Cloudflare Workers allows.
const PBKDF2_ITERATIONS = 100_000;

const encoder = new TextEncoder();
const toBase64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

export async function hashPassword(password: string, saltB64?: string) {
  const salt = saltB64 ? fromBase64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return { hash: toBase64(bits), salt: toBase64(salt) };
}

export async function verifyPassword(password: string, hash: string, salt: string) {
  const attempt = await hashPassword(password, salt);
  const a = fromBase64(attempt.hash);
  const b = fromBase64(hash);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function startSession(c: Context<AppEnv>, userId: number) {
  const token = toBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (ch) => ({ "+": "-", "/": "_", "=": "" })[ch]!);
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await c.env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(await sha256(token), userId, expires.toISOString())
    .run();
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", expires });
}

export async function endSession(c: Context<AppEnv>) {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256(token)).run();
  deleteCookie(c, COOKIE, { path: "/", secure: true });
}

export const USER_COLUMNS = `u.id, u.email, u.trainer_name, u.avatar_dex, u.favourite_dex, u.bio, u.country, u.created_at`;

export const toUser = (r: Record<string, unknown>): User => ({
  id: r.id as number,
  email: r.email as string,
  trainerName: r.trainer_name as string,
  avatarDex: r.avatar_dex as number,
  favouriteDex: (r.favourite_dex as number | null) ?? null,
  bio: r.bio as string,
  country: r.country as string,
  createdAt: r.created_at as string,
});

/** Loads the logged-in trainer (if any) into c.var.user. */
export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", null);
  const token = getCookie(c, COOKIE);
  if (token) {
    const row = await c.env.DB.prepare(
      `SELECT ${USER_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
      .bind(await sha256(token), new Date().toISOString())
      .first<Record<string, unknown>>();
    if (row) c.set("user", toUser(row));
  }
  await next();
};

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) return c.json({ error: "Please log in first" }, 401);
  await next();
};

/**
 * Blocks cross-site form posts: every change to data must be sent as JSON,
 * which a browser won't send to another site without that site's permission.
 */
export const jsonOnlyWrites: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !c.req.header("content-type")?.startsWith("application/json")) {
    return c.json({ error: "Requests must be sent as JSON" }, 415);
  }
  await next();
};
