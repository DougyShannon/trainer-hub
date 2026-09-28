export const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

/** Columns for a card summary; the query must join `cards c` and `sets s`. */
export const CARD_SUMMARY = `
  c.id, c.name, c.supertype, c.subtypes, c.hp, c.types, c.rarity, c.number, c.set_id,
  s.name AS set_name, s.release_date, s.ptcgo_code, c.image_small, c.legal_standard, c.legal_expanded`;

export type CardSummary = ReturnType<typeof summarise>;

export const summarise = (row: Record<string, unknown>) => ({
  id: row.id as string,
  name: row.name as string,
  supertype: row.supertype as string,
  subtypes: parseJson<string[]>(row.subtypes, []),
  hp: row.hp as number | null,
  types: parseJson<string[]>(row.types, []),
  rarity: row.rarity as string | null,
  number: row.number as string,
  setId: row.set_id as string,
  setName: row.set_name as string,
  setCode: (row.ptcgo_code as string | null) ?? null,
  releaseDate: row.release_date as string,
  image: row.image_small as string | null,
  legal: { standard: !!row.legal_standard, expanded: !!row.legal_expanded },
});

/** Looks up card summaries by id, in batches small enough for D1's bound-parameter limit. */
export async function cardsById(db: D1Database, ids: string[]): Promise<Map<string, CardSummary>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, CardSummary>();
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT ${CARD_SUMMARY} FROM cards c JOIN sets s ON s.id = c.set_id WHERE c.id IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<Record<string, unknown>>();
    for (const r of results) out.set(r.id as string, summarise(r));
  }
  return out;
}
