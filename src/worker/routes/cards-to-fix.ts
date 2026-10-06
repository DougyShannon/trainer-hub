import { Hono } from "hono";
import type { AppEnv } from "../types";
import { isAdmin, requireUser } from "../lib/auth";

/** The shared "Cards to fix" list: players add cards the game can't play for them yet; a site owner removes them once fixed. */
export const cardsToFix = new Hono<AppEnv>();

cardsToFix.get("/api/cards-to-fix", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.name, f.card_id, f.created_at, u.trainer_name, c.supertype, c.subtypes, c.image_small, s.name AS set_name
     FROM cards_to_fix f
     LEFT JOIN users u ON u.id = f.user_id
     LEFT JOIN cards c ON c.id = f.card_id
     LEFT JOIN sets s ON s.id = c.set_id
     ORDER BY f.created_at DESC, f.id DESC`,
  ).all<Record<string, unknown>>();
  const viewer = c.get("user");
  return c.json({
    admin: isAdmin(c.env, viewer),
    signedIn: !!viewer,
    cards: results.map((r) => ({
      id: r.id as number,
      name: r.name as string,
      cardId: r.card_id as string,
      kind: [r.supertype, ...JSON.parse((r.subtypes as string | null) ?? "[]")].filter(Boolean).join(" · "),
      image: (r.image_small as string | null) ?? null,
      setName: (r.set_name as string | null) ?? null,
      by: (r.trainer_name as string | null) ?? "A trainer who has left",
      addedAt: r.created_at as string,
    })),
  });
});

cardsToFix.post("/api/cards-to-fix", requireUser, async (c) => {
  const body = await c.req.json<{ cardId?: unknown }>().catch(() => ({}) as { cardId?: unknown });
  const cardId = typeof body.cardId === "string" ? body.cardId.slice(0, 40) : "";
  const card = cardId ? await c.env.DB.prepare(`SELECT id, name FROM cards WHERE id = ?`).bind(cardId).first<{ id: string; name: string }>() : null;
  if (!card) return c.json({ error: "Pick a card from the search results first." }, 400);
  const taken = await c.env.DB.prepare(`SELECT f.created_at, u.trainer_name FROM cards_to_fix f LEFT JOIN users u ON u.id = f.user_id WHERE f.name = ?`)
    .bind(card.name)
    .first<{ created_at: string; trainer_name: string | null }>();
  if (taken) return c.json({ error: `${card.name} is already on the list${taken.trainer_name ? ` (added by ${taken.trainer_name})` : ""}.` }, 409);
  const user = c.get("user")!;
  // UNIQUE on the name also stops two people adding the same card at the same moment.
  const added = await c.env.DB.prepare(`INSERT OR IGNORE INTO cards_to_fix (name, card_id, user_id) VALUES (?, ?, ?)`).bind(card.name, card.id, user.id).run();
  if (!added.meta.changes) return c.json({ error: `${card.name} is already on the list.` }, 409);
  return c.json({ ok: true, name: card.name }, 201);
});

cardsToFix.delete("/api/cards-to-fix/:id", requireUser, async (c) => {
  if (!isAdmin(c.env, c.get("user"))) return c.json({ error: "Only a site owner can take cards off the list." }, 403);
  const gone = await c.env.DB.prepare(`DELETE FROM cards_to_fix WHERE id = ?`)
    .bind(Number(c.req.param("id")))
    .run();
  if (!gone.meta.changes) return c.json({ error: "That card isn't on the list any more." }, 404);
  return c.json({ ok: true });
});
