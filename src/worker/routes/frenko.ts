import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireUser } from "../lib/auth";

export const frenko = new Hono<AppEnv>();

/** Each trainer gets this many Frenko save slots. */
const SLOTS = 5;
/** A save is a small JSON object; this keeps a broken or tampered one from filling the database. */
const MAX_SAVE_BYTES = 64 * 1024;

const slotNumber = (value: string) => {
  const slot = Number(value);
  return Number.isInteger(slot) && slot >= 1 && slot <= SLOTS ? slot : null;
};

/** The trainer's Frenko saves, one entry per used slot. */
frenko.get("/api/frenko/saves", requireUser, async (c) => {
  const user = c.get("user")!;
  const { results } = await c.env.DB.prepare(`SELECT slot, data, updated_at FROM frenko_saves WHERE user_id = ? ORDER BY slot`)
    .bind(user.id)
    .all<{ slot: number; data: string; updated_at: string }>();
  const saves = results.flatMap((r) => {
    try {
      return [{ slot: r.slot, data: JSON.parse(r.data) as unknown, updatedAt: r.updated_at }];
    } catch {
      return [];
    }
  });
  return c.json({ saves });
});

/** Saves the game into a slot, replacing what was there. */
frenko.put("/api/frenko/saves/:slot", requireUser, async (c) => {
  const user = c.get("user")!;
  const slot = slotNumber(c.req.param("slot"));
  if (!slot) return c.json({ error: "Save slots are numbered 1 to 5" }, 400);
  const body = await c.req.json<{ data?: unknown }>().catch(() => ({}) as { data?: unknown });
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) return c.json({ error: "Nothing to save" }, 400);
  const json = JSON.stringify(body.data);
  if (json.length > MAX_SAVE_BYTES) return c.json({ error: "That save is too big" }, 413);
  await c.env.DB.prepare(
    `INSERT INTO frenko_saves (user_id, slot, data) VALUES (?, ?, ?)
     ON CONFLICT (user_id, slot) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
  )
    .bind(user.id, slot, json)
    .run();
  return c.json({ ok: true });
});
