import { Hono } from "hono";
import type { Context } from "hono";

type Env = { Bindings: { DB: D1Database } };

const app = new Hono<Env>();

// Reference data only changes when a new set is imported, so let browsers and Cloudflare cache it.
const cached = (c: Context, body: unknown) => {
  c.header("Cache-Control", "public, max-age=300, s-maxage=3600");
  return c.json(body);
};

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const CARD_SUMMARY = `
  c.id, c.name, c.supertype, c.subtypes, c.hp, c.types, c.rarity, c.number, c.set_id,
  s.name AS set_name, s.release_date, c.image_small, c.legal_standard, c.legal_expanded`;

const summarise = (row: Record<string, unknown>) => ({
  id: row.id,
  name: row.name,
  supertype: row.supertype,
  subtypes: parseJson<string[]>(row.subtypes, []),
  hp: row.hp,
  types: parseJson<string[]>(row.types, []),
  rarity: row.rarity,
  number: row.number,
  setId: row.set_id,
  setName: row.set_name,
  releaseDate: row.release_date,
  image: row.image_small,
  legal: { standard: !!row.legal_standard, expanded: !!row.legal_expanded },
});

app.get("/api/sets", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM cards WHERE set_id = s.id) AS card_count
     FROM sets s ORDER BY release_date DESC, id DESC`,
  ).all();
  return cached(c, results);
});

app.get("/api/cards/filters", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT rarity, COUNT(*) AS n FROM cards WHERE rarity IS NOT NULL GROUP BY rarity ORDER BY n DESC`,
  ).all<{ rarity: string }>();
  return cached(c, { rarities: results.map((r) => r.rarity) });
});

const SORTS: Record<string, string> = {
  newest: "s.release_date DESC, c.set_id, c.number_sort",
  oldest: "s.release_date ASC, c.set_id, c.number_sort",
  name: "c.name COLLATE NOCASE, s.release_date DESC",
  hp: "c.hp DESC NULLS LAST, c.name",
  set: "c.number_sort, c.number",
};

app.get("/api/cards", async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const args: unknown[] = [];

  const search = (q.q ?? "").trim().toLowerCase();
  if (search) {
    if (q.text === "1") {
      where.push("c.search_text LIKE ?");
    } else {
      where.push("LOWER(c.name) LIKE ?");
    }
    args.push(`%${search}%`);
  }
  if (q.supertype) { where.push("c.supertype = ?"); args.push(q.supertype); }
  if (q.subtype) { where.push("c.subtypes LIKE ?"); args.push(`%"${q.subtype}"%`); }
  if (q.type) { where.push("c.types LIKE ?"); args.push(`%"${q.type}"%`); }
  if (q.set) { where.push("c.set_id = ?"); args.push(q.set); }
  if (q.rarity) { where.push("c.rarity = ?"); args.push(q.rarity); }
  if (q.format === "standard") where.push("c.legal_standard = 1");
  if (q.format === "expanded") where.push("c.legal_expanded = 1");
  if (q.hpMin) { where.push("c.hp >= ?"); args.push(Number(q.hpMin)); }

  const pageSize = 48;
  const page = Math.max(1, Number(q.page) || 1);
  const order = SORTS[q.sort ?? ""] ?? (q.set ? SORTS.set : SORTS.newest);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [count, rows] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM cards c ${whereSql}`).bind(...args),
    c.env.DB.prepare(
      `SELECT ${CARD_SUMMARY} FROM cards c JOIN sets s ON s.id = c.set_id
       ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ).bind(...args, pageSize, (page - 1) * pageSize),
  ]);

  return cached(c, {
    total: (count.results[0] as { total: number }).total,
    page,
    pageSize,
    cards: rows.results.map((r) => summarise(r as Record<string, unknown>)),
  });
});

app.get("/api/cards/:id", async (c) => {
  const id = c.req.param("id");
  const card = await c.env.DB.prepare(
    `SELECT c.*, s.name AS set_name, s.series, s.release_date, s.printed_total, s.symbol_url, s.logo_url, s.ptcgo_code
     FROM cards c JOIN sets s ON s.id = c.set_id WHERE c.id = ?`,
  ).bind(id).first<Record<string, unknown>>();
  if (!card) return c.json({ error: "Card not found" }, 404);

  const [pokemon, printings] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT p.id, p.slug, p.name FROM card_pokemon cp JOIN pokemon p ON p.id = cp.dex WHERE cp.card_id = ? ORDER BY p.id`,
    ).bind(id),
    c.env.DB.prepare(
      `SELECT ${CARD_SUMMARY} FROM cards c JOIN sets s ON s.id = c.set_id
       WHERE c.name = ? AND c.id != ? ORDER BY s.release_date DESC LIMIT 24`,
    ).bind(card.name, id),
  ]);

  return cached(c, {
    ...summarise(card),
    evolvesFrom: card.evolves_from,
    artist: card.artist,
    regulationMark: card.regulation_mark,
    imageLarge: card.image_large,
    details: parseJson(card.details, {}),
    set: {
      id: card.set_id,
      name: card.set_name,
      series: card.series,
      releaseDate: card.release_date,
      printedTotal: card.printed_total,
      symbol: card.symbol_url,
      logo: card.logo_url,
      code: card.ptcgo_code,
    },
    pokemon: pokemon.results,
    otherPrintings: printings.results.map((r) => summarise(r as Record<string, unknown>)),
  });
});

// The whole Pokédex list is small (about 1,000 rows), so the page filters it in the browser.
app.get("/api/pokemon", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, slug, name, types, generation FROM pokemon ORDER BY id`,
  ).all<Record<string, unknown>>();
  return cached(c, results.map((p) => ({ ...p, types: parseJson<string[]>(p.types, []) })));
});

app.get("/api/pokemon/:slug", async (c) => {
  const key = c.req.param("slug");
  const p = await c.env.DB.prepare(`SELECT * FROM pokemon WHERE slug = ? OR id = ?`)
    .bind(key, Number(key) || -1)
    .first<Record<string, unknown>>();
  if (!p) return c.json({ error: "Pokémon not found" }, 404);

  const [chain, cards, neighbours] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT id, slug, name, types, evolves_from FROM pokemon WHERE evolution_chain_id = ? ORDER BY id`,
    ).bind(p.evolution_chain_id),
    c.env.DB.prepare(
      `SELECT ${CARD_SUMMARY} FROM card_pokemon cp
       JOIN cards c ON c.id = cp.card_id JOIN sets s ON s.id = c.set_id
       WHERE cp.dex = ? ORDER BY s.release_date DESC, c.number_sort`,
    ).bind(p.id),
    c.env.DB.prepare(`SELECT id, slug, name FROM pokemon WHERE id IN (?, ?) ORDER BY id`)
      .bind(Number(p.id) - 1, Number(p.id) + 1),
  ]);

  return cached(c, {
    id: p.id,
    slug: p.slug,
    name: p.name,
    genus: p.genus,
    generation: p.generation,
    types: parseJson<string[]>(p.types, []),
    height: p.height,
    weight: p.weight,
    stats: parseJson(p.stats, {}),
    abilities: parseJson(p.abilities, []),
    flavorText: p.flavor_text,
    evolvesFrom: p.evolves_from,
    isLegendary: !!p.is_legendary,
    isMythical: !!p.is_mythical,
    evolutionChain: chain.results.map((e) => {
      const r = e as Record<string, unknown>;
      return { id: r.id, slug: r.slug, name: r.name, evolvesFrom: r.evolves_from, types: parseJson<string[]>(r.types, []) };
    }),
    cards: cards.results.map((r) => summarise(r as Record<string, unknown>)),
    previous: neighbours.results.find((n) => (n as { id: number }).id < Number(p.id)) ?? null,
    next: neighbours.results.find((n) => (n as { id: number }).id > Number(p.id)) ?? null,
  });
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
