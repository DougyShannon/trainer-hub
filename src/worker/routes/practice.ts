import { Hono } from "hono";
import type { AppEnv } from "../types";
import { isAdmin, requireUser } from "../lib/auth";
import { parseJson } from "../lib/json";
import { STARTER_DECKS, opponentByLevel, type DeckEntry } from "../../shared/practice/opponents";
import type { Attack, PCard } from "../../shared/practice/types";

export const practice = new Hono<AppEnv>();

type Details = {
  attacks?: Attack[];
  abilities?: { name: string; text: string; type: string }[];
  weaknesses?: { type: string; value: string }[];
  resistances?: { type: string; value: string }[];
  retreatCost?: string[];
  rules?: string[];
};

/** A practice card without its per-copy uid (the browser adds those when it deals the deck). */
export type PracticeCard = Omit<PCard, "uid">;

/** Loads everything the practice rules need for a deck list, as [card, count] pairs. */
async function loadDeck(db: D1Database, entries: DeckEntry[]) {
  const ids = [...new Set(entries.map(([id]) => id))];
  const rows = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await db
      .prepare(
        `SELECT id, name, supertype, subtypes, hp, types, evolves_from, image_small, image_large, details
         FROM cards WHERE id IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(...chunk)
      .all<Record<string, unknown>>();
    for (const r of results) rows.set(r.id as string, r);
  }

  // Rare Candy needs to know which Basic a Stage 2 ultimately evolves from.
  const stage1Names = [
    ...new Set(
      [...rows.values()]
        .filter((r) => parseJson<string[]>(r.subtypes, []).includes("Stage 2") && r.evolves_from)
        .map((r) => r.evolves_from as string),
    ),
  ];
  const basicOf = new Map<string, string>();
  if (stage1Names.length) {
    const { results } = await db
      .prepare(
        `SELECT name, MIN(evolves_from) AS evolves_from FROM cards
         WHERE name IN (${stage1Names.map(() => "?").join(",")}) AND evolves_from IS NOT NULL GROUP BY name`,
      )
      .bind(...stage1Names)
      .all<{ name: string; evolves_from: string }>();
    for (const r of results) basicOf.set(r.name, r.evolves_from);
  }

  const cards: { card: PracticeCard; count: number }[] = [];
  for (const [id, count] of entries) {
    const r = rows.get(id);
    if (!r) continue;
    const d = parseJson<Details>(r.details, {});
    const subtypes = parseJson<string[]>(r.subtypes, []);
    const evolvesFrom = (r.evolves_from as string | null) ?? null;
    cards.push({
      count,
      card: {
        id,
        name: r.name as string,
        supertype: r.supertype as PCard["supertype"],
        subtypes,
        hp: (r.hp as number | null) ?? null,
        types: parseJson<string[]>(r.types, []),
        evolvesFrom,
        image: (r.image_small as string | null) ?? null,
        imageLarge: (r.image_large as string | null) ?? null,
        attacks: (d.attacks ?? []).map((a) => ({ name: a.name, cost: a.cost ?? [], damage: a.damage ?? "", text: a.text ?? "" })),
        abilities: d.abilities ?? [],
        weaknesses: d.weaknesses ?? [],
        resistances: d.resistances ?? [],
        retreat: d.retreatCost?.length ?? 0,
        rules: d.rules ?? [],
        candyFrom: subtypes.includes("Stage 2") && evolvesFrom ? (basicOf.get(evolvesFrom) ?? null) : null,
      },
    });
  }
  const total = cards.reduce((n, e) => n + e.count, 0);
  return { cards, total };
}

/** The trainer's record on the ladder. */
practice.get("/api/practice", requireUser, async (c) => {
  const user = c.get("user")!;
  const { results } = await c.env.DB.prepare(`SELECT level, wins, losses, first_win_at FROM practice_results WHERE user_id = ?`)
    .bind(user.id)
    .all<Record<string, unknown>>();
  return c.json({
    progress: results.map((r) => ({
      level: r.level as number,
      wins: r.wins as number,
      losses: r.losses as number,
      firstWinAt: (r.first_win_at as string | null) ?? null,
    })),
    starters: STARTER_DECKS.map((s) => ({ id: s.id, name: s.name, type: s.type })),
    // The site owner can open any level, to try them out.
    allUnlocked: isAdmin(c.env, user),
  });
});

/** Card data for one side of a practice game: the trainer's own deck, a starter deck, or an opponent's. */
practice.post("/api/practice/deck", requireUser, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);

  let name: string;
  let entries: DeckEntry[];
  if (typeof body.level !== "undefined") {
    const opponent = opponentByLevel(body.level);
    if (!opponent) return c.json({ error: "Opponent not found" }, 404);
    name = opponent.deckName;
    entries = opponent.deck;
  } else if (typeof body.starter === "string") {
    const starter = STARTER_DECKS.find((s) => s.id === body.starter);
    if (!starter) return c.json({ error: "Deck not found" }, 404);
    name = starter.name;
    entries = starter.deck;
  } else if (typeof body.deckId === "string") {
    const deck = await c.env.DB.prepare(`SELECT name, cards FROM decks WHERE id = ? AND user_id = ?`)
      .bind(body.deckId, user.id)
      .first<Record<string, unknown>>();
    if (!deck) return c.json({ error: "Deck not found" }, 404);
    name = deck.name as string;
    entries = parseJson<{ id: string; count: number }[]>(deck.cards, []).map((e) => [e.id, e.count]);
  } else {
    return c.json({ error: "Choose a deck" }, 400);
  }

  const { cards, total } = await loadDeck(c.env.DB, entries);
  if (total !== 60) return c.json({ error: `A practice deck needs exactly 60 cards (this one has ${total}).` }, 400);
  if (!cards.some((e) => e.card.supertype === "Pokémon" && e.card.subtypes.includes("Basic"))) {
    return c.json({ error: "That deck has no Basic Pokémon to start with." }, 400);
  }
  return c.json({ name, cards });
});

/** Records a finished practice game. One row per trainer per opponent, so it stays small. */
practice.post("/api/practice/result", requireUser, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const opponent = opponentByLevel(body.level);
  if (!opponent) return c.json({ error: "Opponent not found" }, 404);
  const won = body.won === true;
  await c.env.DB.prepare(
    `INSERT INTO practice_results (user_id, level, wins, losses, first_win_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, level) DO UPDATE SET
       wins = wins + excluded.wins,
       losses = losses + excluded.losses,
       first_win_at = COALESCE(first_win_at, excluded.first_win_at),
       updated_at = datetime('now')`,
  )
    .bind(user.id, opponent.level, won ? 1 : 0, won ? 0 : 1, won ? new Date().toISOString() : null)
    .run();
  return c.json({ ok: true });
});

