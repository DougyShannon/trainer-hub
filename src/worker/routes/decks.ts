import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireUser } from "../lib/auth";
import { CARD_SUMMARY, cardsById, parseJson, summarise, type CardSummary } from "../lib/json";
import { MAX_COPIES, checkDeck, isBasicEnergy, normaliseCardName, parseDeckList, type DeckFormat } from "../../shared/deck-rules";

export const decks = new Hono<AppEnv>();

const FORMATS: DeckFormat[] = ["standard", "expanded", "unlimited"];
type StoredEntry = { id: string; count: number };

export const deckSummary = (r: Record<string, unknown>) => ({
  id: r.id as string,
  name: r.name as string,
  format: r.format as DeckFormat,
  coverCardId: (r.cover_card_id as string | null) ?? null,
  cardCount: r.card_count as number,
  isValid: !!r.is_valid,
  isPublic: !!r.is_public,
  updatedAt: r.updated_at as string,
  createdAt: r.created_at as string,
});

export const newDeckId = () => {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(10))].map((b) => alphabet[b % alphabet.length]).join("");
};

/** Checks a deck sent by the browser and works out whether it's legal. */
export async function readDeckBody(db: D1Database, body: Record<string, unknown>) {
  const name = String(body.name ?? "").trim().slice(0, 60) || "Untitled deck";
  const format = FORMATS.includes(body.format as DeckFormat) ? (body.format as DeckFormat) : "standard";
  const raw = Array.isArray(body.cards) ? body.cards : [];

  const counts = new Map<string, number>();
  for (const e of raw.slice(0, 120)) {
    const id = typeof e?.id === "string" ? e.id : null;
    const count = Math.floor(Number(e?.count));
    if (id && count > 0) counts.set(id, Math.min(60, (counts.get(id) ?? 0) + count));
  }
  const found = await cardsById(db, [...counts.keys()]);
  const entries = [...counts].filter(([id]) => found.has(id)).map(([id, count]) => ({ card: found.get(id)!, count }));
  const cards: StoredEntry[] = entries.map((e) => ({ id: e.card.id, count: e.count }));
  const total = cards.reduce((n, e) => n + e.count, 0);
  if (total > 200) return { error: "That deck has too many cards to save." } as const;

  const cover = typeof body.coverCardId === "string" && counts.has(body.coverCardId) ? body.coverCardId : null;
  const fallbackCover = entries.find((e) => e.card.supertype === "Pokémon")?.card.id ?? null;

  return {
    name,
    format,
    cards,
    total,
    cover: cover ?? fallbackCover,
    isValid: checkDeck(entries, format).length === 0,
    isPublic: !!body.isPublic,
  } as const;
}

decks.get("/api/decks/mine", requireUser, async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM decks WHERE user_id = ? ORDER BY updated_at DESC`)
    .bind(c.get("user")!.id)
    .all<Record<string, unknown>>();
  const covers = await cardsById(c.env.DB, results.map((r) => r.cover_card_id as string).filter(Boolean));
  return c.json(
    results.map((r) => ({ ...deckSummary(r), coverImage: covers.get(r.cover_card_id as string)?.image ?? null })),
  );
});

decks.post("/api/decks", requireUser, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const deck = await readDeckBody(c.env.DB, body);
  if ("error" in deck) return c.json({ error: deck.error }, 400);

  const id = newDeckId();
  await c.env.DB.prepare(
    `INSERT INTO decks (id, user_id, name, format, cover_card_id, cards, card_count, is_valid, is_public)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, c.get("user")!.id, deck.name, deck.format, deck.cover, JSON.stringify(deck.cards), deck.total, deck.isValid ? 1 : 0, deck.isPublic ? 1 : 0)
    .run();
  return c.json({ id }, 201);
});

decks.get("/api/decks/:id", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT d.*, u.trainer_name, u.avatar_dex FROM decks d JOIN users u ON u.id = d.user_id WHERE d.id = ?`,
  )
    .bind(c.req.param("id"))
    .first<Record<string, unknown>>();
  const viewer = c.get("user");
  const isOwner = !!row && viewer?.id === row.user_id;
  if (!row || (!row.is_public && !isOwner)) return c.json({ error: "Deck not found" }, 404);

  const stored = parseJson<StoredEntry[]>(row.cards, []);
  const found = await cardsById(c.env.DB, stored.map((e) => e.id));
  return c.json({
    ...deckSummary(row),
    isOwner,
    owner: { trainerName: row.trainer_name, avatarDex: row.avatar_dex },
    cards: stored.filter((e) => found.has(e.id)).map((e) => ({ card: found.get(e.id)!, count: e.count })),
  });
});

decks.put("/api/decks/:id", requireUser, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const deck = await readDeckBody(c.env.DB, body);
  if ("error" in deck) return c.json({ error: deck.error }, 400);

  const result = await c.env.DB.prepare(
    `UPDATE decks SET name = ?, format = ?, cover_card_id = ?, cards = ?, card_count = ?, is_valid = ?, is_public = ?,
       updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(deck.name, deck.format, deck.cover, JSON.stringify(deck.cards), deck.total, deck.isValid ? 1 : 0, deck.isPublic ? 1 : 0, c.req.param("id"), c.get("user")!.id)
    .run();
  if (!result.meta.changes) return c.json({ error: "Deck not found" }, 404);
  return c.json({ ok: true });
});

// Adds one copy of a card to one of the trainer's decks (the "Add to deck" buttons in the Pokédex).
decks.post("/api/decks/:id/add", requireUser, async (c) => {
  const body = await c.req.json<{ cardId?: unknown }>().catch(() => ({}) as { cardId?: unknown });
  const cardId = typeof body.cardId === "string" ? body.cardId : "";
  const row = await c.env.DB.prepare(`SELECT * FROM decks WHERE id = ? AND user_id = ?`)
    .bind(c.req.param("id"), c.get("user")!.id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Deck not found" }, 404);

  const stored = parseJson<StoredEntry[]>(row.cards, []);
  const found = await cardsById(c.env.DB, [...stored.map((e) => e.id), cardId]);
  const card = found.get(cardId);
  if (!card) return c.json({ error: "Card not found" }, 404);

  const total = stored.reduce((n, e) => n + e.count, 0);
  if (total >= 60) return c.json({ error: `${row.name} already has 60 cards.` }, 400);
  if (!isBasicEnergy(card)) {
    const copies = stored.filter((e) => found.get(e.id)?.name === card.name).reduce((n, e) => n + e.count, 0);
    const limit = card.subtypes.includes("Prism Star") ? 1 : MAX_COPIES;
    if (copies >= limit) return c.json({ error: `${row.name} already has ${copies} ${card.name}. The limit is ${limit}.` }, 400);
  }

  const existing = stored.find((e) => e.id === cardId);
  if (existing) existing.count++;
  else stored.push({ id: cardId, count: 1 });
  const deck = await readDeckBody(c.env.DB, {
    name: row.name,
    format: row.format,
    cards: stored,
    coverCardId: row.cover_card_id,
    isPublic: !!row.is_public,
  });
  if ("error" in deck) return c.json({ error: deck.error }, 400);
  await c.env.DB.prepare(
    `UPDATE decks SET cover_card_id = ?, cards = ?, card_count = ?, is_valid = ?, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(deck.cover, JSON.stringify(deck.cards), deck.total, deck.isValid ? 1 : 0, row.id)
    .run();
  return c.json({ ok: true, deckName: deck.name, cardCount: deck.total, copies: existing?.count ?? 1 });
});

decks.delete("/api/decks/:id", requireUser, async (c) => {
  const result = await c.env.DB.prepare(`DELETE FROM decks WHERE id = ? AND user_id = ?`)
    .bind(c.req.param("id"), c.get("user")!.id)
    .run();
  if (!result.meta.changes) return c.json({ error: "Deck not found" }, 404);
  return c.json({ ok: true });
});

decks.post("/api/decks/:id/copy", requireUser, async (c) => {
  const user = c.get("user")!;
  const row = await c.env.DB.prepare(`SELECT * FROM decks WHERE id = ? AND (is_public = 1 OR user_id = ?)`)
    .bind(c.req.param("id"), user.id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Deck not found" }, 404);

  const id = newDeckId();
  await c.env.DB.prepare(
    `INSERT INTO decks (id, user_id, name, format, cover_card_id, cards, card_count, is_valid, is_public)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  )
    .bind(id, user.id, `${row.name} (copy)`.slice(0, 60), row.format, row.cover_card_id, row.cards, row.card_count, row.is_valid)
    .run();
  return c.json({ id }, 201);
});

/**
 * Turns a pasted deck list (Pokémon TCG Live format) into cards.
 * Each line is matched by set code and number first, then by name (newest printing).
 */
decks.post("/api/decks/import", async (c) => {
  const body = await c.req.json<{ text?: unknown }>().catch(() => ({ text: "" }));
  const { lines, unreadable } = parseDeckList(String(body.text ?? "").slice(0, 20_000));
  const entries: { card: CardSummary; count: number }[] = [];
  const notFound = [...unreadable];

  for (const line of lines.slice(0, 100)) {
    const name = normaliseCardName(line.name);
    let row: Record<string, unknown> | null = null;
    if (line.setCode && line.number) {
      row = await c.env.DB.prepare(
        `SELECT ${CARD_SUMMARY} FROM cards c JOIN sets s ON s.id = c.set_id
         WHERE s.ptcgo_code = ? AND (c.number = ? OR c.number = ?) ORDER BY s.release_date DESC LIMIT 1`,
      )
        .bind(line.setCode, line.number, line.number.replace(/^0+/, ""))
        .first<Record<string, unknown>>();
    }
    if (!row) {
      // "Basic Fire Energy" is called "Fire Energy" in older sets, so try both.
      const alt = name.replace(/^Basic /, "");
      row = await c.env.DB.prepare(
        `SELECT ${CARD_SUMMARY} FROM cards c JOIN sets s ON s.id = c.set_id
         WHERE c.name = ? COLLATE NOCASE OR c.name = ? COLLATE NOCASE
         ORDER BY (c.name = ? COLLATE NOCASE) DESC, s.release_date DESC LIMIT 1`,
      )
        .bind(name, alt, name)
        .first<Record<string, unknown>>();
    }
    if (row) {
      const card = summarise(row);
      const existing = entries.find((e) => e.card.id === card.id);
      if (existing) existing.count += line.count;
      else entries.push({ card, count: line.count });
    } else {
      notFound.push(line.line);
    }
  }
  return c.json({ entries, notFound });
});
