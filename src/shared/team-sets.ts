// A Pokémon on a Team Builder team, in the same shape Pokémon Showdown uses for its sets.
// Shared by the browser (which fills it in) and the server (which checks its shape before saving).

export type StatID = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
export type StatsTable = Record<StatID, number>;

export type PokemonSet = {
  name: string; // nickname; blank means "use the species name"
  species: string;
  item: string;
  ability: string;
  moves: string[];
  nature: string;
  gender: string; // "M", "F" or "" for random/genderless
  evs: StatsTable;
  ivs: StatsTable;
  level: number;
  shiny: boolean;
  happiness?: number;
  teraType: string;
};

export type TeamPreview = { species: string; sprite: number };

export const STAT_IDS: StatID[] = ["hp", "atk", "def", "spa", "spd", "spe"];
export const MAX_TEAM_SIZE = 6;

const text = (v: unknown, max = 40) => (typeof v === "string" ? v.slice(0, max) : "");
const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const stats = (v: unknown, lo: number, hi: number, fallback: number): StatsTable => {
  const src = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(STAT_IDS.map((s) => [s, clamp(src[s], lo, hi, fallback)])) as StatsTable;
};

/** Cleans up one set sent by a browser, keeping only the fields we know about, at sensible sizes. */
export function cleanSet(raw: unknown): PokemonSet | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const species = text(r.species);
  if (!species.trim()) return null;
  const set: PokemonSet = {
    name: text(r.name, 18),
    species,
    item: text(r.item),
    ability: text(r.ability),
    moves: (Array.isArray(r.moves) ? r.moves : []).slice(0, 4).map((m) => text(m)),
    nature: text(r.nature, 12),
    gender: r.gender === "M" || r.gender === "F" ? r.gender : "",
    evs: stats(r.evs, 0, 252, 0),
    ivs: stats(r.ivs, 0, 31, 31),
    level: clamp(r.level, 1, 100, 100),
    shiny: !!r.shiny,
    teraType: text(r.teraType, 12),
  };
  if (r.happiness !== undefined) set.happiness = clamp(r.happiness, 0, 255, 255);
  return set;
}
