import { Hono, type Context } from "hono";
import type { AppEnv } from "../types";
import { isAdmin, requireUser } from "../lib/auth";
import { parseJson } from "../lib/json";
import { newDeckId } from "./decks";

/** Play mats players upload on the "Add a board" page. Everyone can use them; the uploader or a site owner can remove one. */
export const boards = new Hono<AppEnv>();

const MAX_IMAGE = 1_500_000;
const MAX_THUMB = 200_000;
const MAX_PER_PLAYER = 20;

type Spot = [number, number];
const pct = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;
const spot = (s: unknown): s is Spot => Array.isArray(s) && s.length === 2 && pct(s[0]) && pct(s[1]);

/** Checks a card spot layout sent by the browser (every number a % of the picture). */
function readLayout(l: unknown) {
  const x = l as Record<string, unknown> | null;
  if (!x || typeof x !== "object") return null;
  const singles = ["active", "stadium", "deck", "discard", "lostZone", "tag"] as const;
  if (!pct(x.card) || (x.card as number) < 2 || !singles.every((k) => spot(x[k]))) return null;
  const bench = x.bench as unknown[];
  const prizes = x.prizes as unknown[];
  if (!Array.isArray(bench) || bench.length !== 5 || !bench.every(spot)) return null;
  if (!Array.isArray(prizes) || prizes.length !== 6 || !prizes.every(spot)) return null;
  const round = (s: Spot): Spot => [Math.round(s[0] * 10) / 10, Math.round(s[1] * 10) / 10];
  return {
    card: Math.round((x.card as number) * 10) / 10,
    ...Object.fromEntries(singles.map((k) => [k, round(x[k] as Spot)])),
    bench: bench.map((s) => round(s as Spot)),
    prizes: prizes.map((s) => round(s as Spot)),
  };
}

/** A "data:image/webp;base64,..." picture from the browser, as bytes. */
function readPicture(value: unknown, max: number) {
  const m = typeof value === "string" ? value.match(/^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/) : null;
  if (!m) return null;
  const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
  return bytes.length > 0 && bytes.length <= max ? { type: m[1], bytes } : null;
}

const summary = (r: Record<string, unknown>) => ({
  id: r.id as string,
  name: r.name as string,
  aspect: r.aspect as number,
  layout: parseJson<unknown>(r.layout, null),
  image: `/api/boards/${r.id}/image`,
  thumb: `/api/boards/${r.id}/thumb`,
  by: r.trainer_name as string,
  mine: false,
});

boards.get("/api/boards", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.name, b.aspect, b.layout, b.user_id, u.trainer_name FROM boards b JOIN users u ON u.id = b.user_id ORDER BY b.created_at`,
  ).all<Record<string, unknown>>();
  const viewer = c.get("user");
  const admin = isAdmin(c.env, viewer);
  return c.json(results.map((r) => ({ ...summary(r), mine: admin || viewer?.id === r.user_id })));
});

boards.post("/api/boards", requireUser, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const user = c.get("user")!;
  const name = String(body.name ?? "")
    .trim()
    .slice(0, 30);
  const aspect = Number(body.aspect);
  const layout = readLayout(body.layout);
  const image = readPicture(body.image, MAX_IMAGE);
  const thumb = readPicture(body.thumb, MAX_THUMB);
  if (!name) return c.json({ error: "Give your board a name first." }, 400);
  if (!(aspect > 0.3 && aspect < 5)) return c.json({ error: "That picture's shape doesn't look right." }, 400);
  if (!layout) return c.json({ error: "Some card spots are off the picture." }, 400);
  if (!image || !thumb) return c.json({ error: "That picture is too big or isn't a picture. Try a smaller one." }, 400);
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM boards WHERE user_id = ?`).bind(user.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_PER_PLAYER) return c.json({ error: `You've uploaded ${MAX_PER_PLAYER} boards already. Remove one to make room.` }, 400);

  const id = `u-${newDeckId()}`;
  await c.env.DB.prepare(`INSERT INTO boards (id, user_id, name, aspect, layout, image, image_type, thumb) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, user.id, name, aspect, JSON.stringify(layout), image.bytes, image.type, thumb.bytes)
    .run();
  return c.json({ id }, 201);
});

async function picture(c: Context<AppEnv>, id: string, column: "image" | "thumb") {
  const row = await c.env.DB.prepare(`SELECT ${column} AS pic, image_type FROM boards WHERE id = ?`)
    .bind(id)
    .first<{ pic: ArrayBuffer | number[]; image_type: string }>();
  if (!row) return c.json({ error: "Board not found" }, 404);
  const bytes = row.pic instanceof ArrayBuffer ? new Uint8Array(row.pic) : new Uint8Array(row.pic);
  // A board's picture never changes (a new upload gets a new id), so browsers can keep it.
  return new Response(bytes, { headers: { "content-type": row.image_type, "cache-control": "public, max-age=31536000, immutable" } });
}
boards.get("/api/boards/:id/image", (c) => picture(c, c.req.param("id"), "image"));
boards.get("/api/boards/:id/thumb", (c) => picture(c, c.req.param("id"), "thumb"));

boards.delete("/api/boards/:id", requireUser, async (c) => {
  const user = c.get("user")!;
  const row = await c.env.DB.prepare(`SELECT user_id FROM boards WHERE id = ?`).bind(c.req.param("id")).first<{ user_id: number }>();
  if (!row) return c.json({ error: "Board not found" }, 404);
  if (row.user_id !== user.id && !isAdmin(c.env, user)) return c.json({ error: "Only the trainer who uploaded it can remove it." }, 403);
  await c.env.DB.prepare(`DELETE FROM boards WHERE id = ?`).bind(c.req.param("id")).run();
  return c.json({ ok: true });
});
