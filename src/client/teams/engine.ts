// The Team Builder's game knowledge: Pokémon, moves, abilities, items, natures, format rules,
// stat maths and the Showdown text format. It all comes from @pkmn/sim, the browser build of
// Pokémon Showdown's own simulator (MIT licence), so our legality checks match Showdown's.
// This file is large, so pages load it on demand with `loadEngine()` rather than importing it.

import { Dex, TeamValidator, Teams, toID } from "@pkmn/sim";
import { STAT_IDS, type PokemonSet, type StatID, type StatsTable, type TeamPreview } from "../../shared/team-sets";
import formSprites from "./form-sprites.json";
import { DEFAULT_FORMAT, FORMATS, isWild, type FormatInfo } from "./formats";

export * from "./formats";

type SimSpecies = ReturnType<typeof Dex.species.get>;
type SimSet = Parameters<TeamValidator["validateTeam"]>[0] extends (infer T)[] | null ? T : never;

export const STAT_LABELS: Record<StatID, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };

export function formatInfo(id: string): FormatInfo {
  const known = FORMATS.find((f) => f.id === id);
  if (known) return known;
  const f = Dex.formats.get(id);
  return { id, label: f.exists ? f.name.replace(/^\[Gen 9\] /, "") : id, group: f.gameType === "doubles" ? "Doubles" : "Singles", blurb: "" };
}

/** Showdown's name for the format, e.g. "[Gen 9] Doubles OU", which is what to pick on Showdown. */
export const showdownFormatName = (formatId: string) => Dex.formats.get(formatId).name;

// ---------------------------------------------------------------------------------------------
// Rows for the search lists

export type SpeciesRow = {
  id: string;
  name: string;
  num: number;
  sprite: number;
  types: string[];
  abilities: string[];
  stats: StatsTable;
  bst: number;
  tier: string;
  tierRank: number;
};

export type MoveRow = {
  id: string;
  name: string;
  type: string;
  category: "Physical" | "Special" | "Status";
  power: number;
  accuracy: number | true;
  pp: number;
  desc: string;
};

export type NamedRow = { id: string; name: string; desc: string; hidden?: boolean };

const SINGLES_TIERS = ["Uber", "(Uber)", "OU", "(OU)", "UUBL", "UU", "RUBL", "RU", "NUBL", "NU", "(NU)", "PUBL", "PU", "(PU)", "ZUBL", "ZU", "NFE", "LC"];
const DOUBLES_TIERS = ["DUber", "(DUber)", "DOU", "(DOU)", "DBL", "DUU", "(DUU)", "NFE", "LC"];

/** The sprite number PokeAPI uses for this Pokémon (forms such as Alolan Raichu have their own). */
export function spriteFor(species: string): number {
  const s = Dex.species.get(species);
  if (!s.exists) return 0;
  return (formSprites as Record<string, number>)[s.id] ?? Math.max(0, s.num);
}

type Ctx = {
  id: string;
  validator: TeamValidator;
  doubles: boolean;
  wild: boolean;
  natDex: boolean;
  level: number;
  levelLocked: boolean;
  evLimit: number | null;
  species?: SpeciesRow[];
  items?: NamedRow[];
  allAbilities?: NamedRow[];
  moves: Map<string, MoveRow[]>;
};

const contexts = new Map<string, Ctx>();

function ctx(formatId: string): Ctx {
  let c = contexts.get(formatId);
  if (c) return c;
  const format = Dex.formats.get(formatId);
  const validator = new TeamValidator(format.exists ? format : Dex.formats.get(DEFAULT_FORMAT));
  const rt = validator.ruleTable;
  c = {
    id: formatId,
    validator,
    doubles: format.gameType === "doubles",
    wild: isWild(formatId),
    natDex: rt.has("natdexmod") || rt.has("standardnatdex"),
    level: Math.min(100, rt.adjustLevel ?? rt.defaultLevel ?? 100),
    levelLocked: !!rt.adjustLevel,
    evLimit: rt.evLimit ?? null,
    moves: new Map(),
  };
  contexts.set(formatId, c);
  return c;
}

const toSpeciesRow = (s: SimSpecies, c: Ctx): SpeciesRow => {
  const tier = c.doubles ? s.doublesTier : c.natDex ? s.natDexTier : s.tier;
  const order = c.doubles ? DOUBLES_TIERS : SINGLES_TIERS;
  const rank = order.indexOf(tier);
  const stats = { ...s.baseStats };
  return {
    id: s.id,
    name: s.name,
    num: s.num,
    sprite: spriteFor(s.name),
    types: [...s.types],
    abilities: Object.values(s.abilities).filter(Boolean) as string[],
    stats,
    bst: STAT_IDS.reduce((n, k) => n + stats[k], 0),
    tier: c.wild ? "" : tier,
    tierRank: rank < 0 ? 99 : rank,
  };
};

const fakeSet = (species: string): SimSet =>
  ({ name: species, species, item: "", ability: "", moves: [], nature: "", gender: "", evs: {}, ivs: {}, level: 100 }) as unknown as SimSet;

/** Every Pokémon allowed in the format, strongest tiers first. */
export function speciesFor(formatId: string): SpeciesRow[] {
  const c = ctx(formatId);
  if (c.species) return c.species;
  const lc = c.validator.ruleTable.has("littlecup");
  const out: SpeciesRow[] = [];
  for (const s of Dex.species.all()) {
    if (!s.exists || s.num <= 0) continue;
    if (c.wild) {
      if (s.isNonstandard === "CAP" || s.isNonstandard === "Custom") continue;
    } else {
      if (s.battleOnly && !c.natDex) continue;
      if (lc && s.tier !== "LC") continue;
      if (c.validator.checkSpecies(fakeSet(s.name), s, s, {})) continue;
    }
    out.push(toSpeciesRow(s, c));
  }
  out.sort((a, b) => a.tierRank - b.tierRank || a.num - b.num || a.name.localeCompare(b.name));
  c.species = out;
  return out;
}

export function speciesRow(formatId: string, name: string): SpeciesRow | null {
  const s = Dex.species.get(name);
  return s.exists ? toSpeciesRow(s, ctx(formatId)) : null;
}

const toMoveRow = (m: ReturnType<typeof Dex.moves.get>): MoveRow => ({
  id: toID(m.name), // Hidden Power variants share one id, so use the full name
  name: m.name,
  type: m.type,
  category: m.category,
  power: m.basePower,
  accuracy: m.accuracy,
  pp: m.pp,
  desc: m.shortDesc || m.desc,
});

let allMoveRows: MoveRow[] | null = null;
function allMoves() {
  allMoveRows ??= Dex.moves
    .all()
    .filter((m) => m.exists && !m.isZ && !m.isMax && m.isNonstandard !== "CAP" && m.isNonstandard !== "Custom" && m.id !== "struggle")
    .map(toMoveRow)
    .sort((a, b) => a.name.localeCompare(b.name));
  return allMoveRows;
}

/** The moves this Pokémon can use in the format. In the Wild formats that's every move. */
export function movesFor(formatId: string, species: string): MoveRow[] {
  const c = ctx(formatId);
  if (c.wild) return allMoves();
  const s = Dex.species.get(species);
  if (!s.exists) return [];
  const cached = c.moves.get(s.id);
  if (cached) return cached;
  const v = c.validator;
  const sources = v.allSources(s);
  const set = fakeSet(s.name);
  const out = allMoves().filter((row) => {
    const m = Dex.moves.get(row.id);
    return !v.checkCanLearn(m, s, sources, set);
  });
  c.moves.set(s.id, out);
  return out;
}

export function moveRow(name: string): MoveRow | null {
  const m = Dex.moves.get(name);
  return m.exists ? toMoveRow(m) : null;
}

/** The abilities to offer: the Pokémon's own (hidden ability marked), or every ability in Wild. */
export function abilitiesFor(formatId: string, species: string): NamedRow[] {
  const c = ctx(formatId);
  if (c.wild) {
    c.allAbilities ??= Dex.abilities
      .all()
      .filter((a) => a.exists && a.id !== "noability" && a.isNonstandard !== "CAP" && a.isNonstandard !== "Custom")
      .map((a) => ({ id: a.id, name: a.name, desc: a.shortDesc || a.desc }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return c.allAbilities;
  }
  const s = Dex.species.get(species);
  if (!s.exists) return [];
  return Object.entries(s.abilities)
    .filter(([, name]) => !!name)
    .map(([slot, name]) => {
      const a = Dex.abilities.get(name as string);
      return { id: a.id, name: a.name, desc: a.shortDesc || a.desc, hidden: slot === "H" };
    });
}

export function abilityDesc(name: string) {
  const a = Dex.abilities.get(name);
  return a.exists ? a.shortDesc || a.desc : "";
}

/** Held items allowed in the format, with what each one does. */
export function itemsFor(formatId: string): NamedRow[] {
  const c = ctx(formatId);
  if (c.items) return c.items;
  const rt = c.validator.ruleTable;
  c.items = Dex.items
    .all()
    .filter((i) => {
      if (!i.exists || i.isNonstandard === "CAP" || i.isNonstandard === "Custom") return false;
      if (c.wild) return true;
      if (i.isNonstandard && !(c.natDex && i.isNonstandard === "Past")) return false;
      return !rt.isBanned(`item:${i.id}`);
    })
    .map((i) => ({ id: i.id, name: i.name, desc: i.shortDesc || i.desc }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return c.items;
}

export function itemDesc(name: string) {
  const i = Dex.items.get(name);
  return i.exists ? i.shortDesc || i.desc : "";
}

export type NatureRow = { name: string; plus: StatID | null; minus: StatID | null };
export const NATURES: NatureRow[] = Dex.natures
  .all()
  .map((n) => ({ name: n.name, plus: (n.plus as StatID) ?? null, minus: (n.minus as StatID) ?? null }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const TYPES = Dex.types.names().filter((t) => t !== "Stellar");
export const TERA_TYPES = Dex.types.names();

// ---------------------------------------------------------------------------------------------
// Format facts the editor needs

export function formatRules(formatId: string) {
  const c = ctx(formatId);
  const rt = c.validator.ruleTable;
  return {
    doubles: c.doubles,
    wild: c.wild,
    level: c.level,
    levelLocked: c.levelLocked,
    maxLevel: Math.min(100, rt.maxLevel),
    evLimit: c.evLimit,
    minTeamSize: rt.minTeamSize,
    pickedTeamSize: rt.pickedTeamSize ?? null,
  };
}

/** The Pokémon's first ability that the format allows (Garchomp's Sand Veil is banned in OU, so Rough Skin). */
function defaultAbility(formatId: string, s: SimSpecies): string {
  const rt = ctx(formatId).validator.ruleTable;
  const names = Object.values(s.abilities).filter(Boolean) as string[];
  return names.find((n) => !rt.isBanned(`ability:${toID(n)}`)) ?? names[0] ?? "";
}

/** A brand-new Pokémon for a team, with the format's level and its first ability filled in. */
export function newSet(formatId: string, species: string): PokemonSet {
  const s = Dex.species.get(species);
  const rules = formatRules(formatId);
  return {
    name: "",
    species: s.exists ? s.name : species,
    item: "",
    ability: s.exists ? defaultAbility(formatId, s) : "",
    moves: [],
    nature: "",
    gender: "",
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: rules.level,
    shiny: false,
    teraType: s.exists ? s.types[0] : "Normal",
  };
}

/** Fills in anything missing on a set (for example one added from the Pokédex, or an import). */
export function completeSet(formatId: string, set: Partial<PokemonSet> & { species: string }): PokemonSet {
  const s = Dex.species.get(set.species);
  const base = newSet(formatId, s.exists ? s.name : set.species);
  return {
    ...base,
    ...set,
    species: s.exists ? s.name : set.species,
    moves: (set.moves ?? []).filter(Boolean).slice(0, 4),
    ability: set.ability || base.ability,
    teraType: set.teraType || base.teraType,
    level: set.level && set.level > 0 ? set.level : base.level,
    evs: { ...base.evs, ...(set.evs ?? {}) },
    ivs: { ...base.ivs, ...(set.ivs ?? {}) },
  };
}

// ---------------------------------------------------------------------------------------------
// Stats

export function natureOf(name: string): NatureRow | null {
  return NATURES.find((n) => n.name === name) ?? null;
}

/** The final stats the Pokémon will have in battle, using the game's own formula. */
export function calcStats(set: PokemonSet, formatId: string): StatsTable | null {
  const s = Dex.species.get(set.species);
  if (!s.exists) return null;
  const rules = formatRules(formatId);
  const level = rules.levelLocked ? rules.level : set.level;
  const nature = natureOf(set.nature);
  const out = {} as StatsTable;
  for (const stat of STAT_IDS) {
    const base = s.baseStats[stat];
    const core = Math.floor(((2 * base + set.ivs[stat] + Math.floor(set.evs[stat] / 4)) * level) / 100);
    if (stat === "hp") {
      out.hp = base === 1 ? 1 : core + level + 10;
    } else {
      const mod = nature?.plus === stat && nature.minus !== stat ? 1.1 : nature?.minus === stat && nature.plus !== stat ? 0.9 : 1;
      out[stat] = Math.floor((core + 5) * mod);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Import, export and legality

const toSim = (set: PokemonSet): SimSet =>
  ({
    name: set.name || Dex.species.get(set.species).baseSpecies || set.species,
    species: set.species,
    item: set.item,
    ability: set.ability,
    moves: set.moves.filter(Boolean),
    nature: set.nature,
    gender: set.gender,
    evs: set.evs,
    ivs: set.ivs,
    level: set.level,
    shiny: set.shiny || undefined,
    happiness: set.happiness,
    teraType: set.teraType,
  }) as unknown as SimSet;

/** The team as Showdown text, ready to paste into Showdown's teambuilder ("Import from text"). */
export function exportTeam(sets: PokemonSet[]): string {
  return Teams.export(
    sets.map((s) => {
      const sim = toSim(s) as unknown as Record<string, unknown>;
      if (!s.name) sim.name = "";
      return sim;
    }) as unknown as SimSet[],
  ).trim();
}

export type ImportResult = { sets: PokemonSet[]; problems: string[] };

/** Reads Showdown text (one Pokémon or a whole team). Unknown Pokémon are skipped and reported. */
export function importTeam(text: string, formatId: string): ImportResult {
  const parsed = Teams.import(text.trim()) ?? [];
  const sets: PokemonSet[] = [];
  const problems: string[] = [];
  for (const p of parsed) {
    const s = Dex.species.get(p.species || p.name);
    if (!s.exists) {
      problems.push(`We don't know a Pokémon called “${p.species || p.name}”, so it was left out.`);
      continue;
    }
    const nick = p.name && toID(p.name) !== toID(s.name) && p.name !== s.baseSpecies ? p.name : "";
    sets.push(
      completeSet(formatId, {
        name: nick,
        species: s.name,
        item: p.item ? Dex.items.get(p.item).name || p.item : "",
        ability: p.ability ? Dex.abilities.get(p.ability).name || p.ability : "",
        moves: (p.moves ?? []).map((m) => Dex.moves.get(m).name || m),
        nature: p.nature ? Dex.natures.get(p.nature).name || "" : "",
        gender: p.gender === "M" || p.gender === "F" ? p.gender : "",
        evs: p.evs as StatsTable | undefined,
        ivs: p.ivs as StatsTable | undefined,
        level: p.level || 0,
        shiny: !!p.shiny,
        happiness: typeof p.happiness === "number" && p.happiness !== 255 ? p.happiness : undefined,
        teraType: p.teraType || "",
      }),
    );
  }
  if (sets.length > 6) {
    problems.push(`Teams hold 6 Pokémon, so only the first 6 of the ${sets.length} were kept.`);
    sets.length = 6;
  }
  return { sets, problems };
}

/** Showdown's own legality check for the format. An empty list means the team is legal. */
export function validateTeam(sets: PokemonSet[], formatId: string): string[] {
  if (!sets.length) return [];
  const c = ctx(formatId);
  try {
    return c.validator.validateTeam(sets.map(toSim)) ?? [];
  } catch (err) {
    return [`The rules check hit a problem: ${(err as Error).message}`];
  }
}

export function previewOf(sets: PokemonSet[]): TeamPreview[] {
  return sets.map((s) => ({ species: s.species, sprite: spriteFor(s.species) }));
}

// ---------------------------------------------------------------------------------------------
// Team type coverage

// Abilities that make a Pokémon immune to a type, or take half damage from it.
const ABILITY_IMMUNE: Record<string, string[]> = {
  levitate: ["Ground"],
  earthereater: ["Ground"],
  flashfire: ["Fire"],
  wellbakedbody: ["Fire"],
  waterabsorb: ["Water"],
  stormdrain: ["Water"],
  dryskin: ["Water"],
  voltabsorb: ["Electric"],
  lightningrod: ["Electric"],
  motordrive: ["Electric"],
  sapsipper: ["Grass"],
};
const ABILITY_HALVES: Record<string, string[]> = {
  thickfat: ["Fire", "Ice"],
  heatproof: ["Fire"],
  waterbubble: ["Fire"],
  purifyingsalt: ["Ghost"],
};

export type Matchup = "immune" | "resist" | "neutral" | "weak";

/** How one Pokémon takes a hit of this type, counting abilities such as Levitate. */
export function matchup(attackType: string, set: PokemonSet): { result: Matchup; multiplier: number } {
  const s = Dex.species.get(set.species);
  if (!s.exists) return { result: "neutral", multiplier: 1 };
  const ability = toID(set.ability);
  if (!Dex.getImmunity(attackType, s.types) || ABILITY_IMMUNE[ability]?.includes(attackType)) return { result: "immune", multiplier: 0 };
  let mult = 2 ** Dex.getEffectiveness(attackType, s.types);
  if (ABILITY_HALVES[ability]?.includes(attackType)) mult /= 2;
  if (ability === "wonderguard" && mult <= 1) return { result: "immune", multiplier: 0 };
  return { result: mult > 1 ? "weak" : mult < 1 ? "resist" : "neutral", multiplier: mult };
}

export type CoverageRow = { type: string; weak: number; resist: number; immune: number };

/** For each attacking type, how many of the team are weak to it and how many resist it. */
export function defensiveCoverage(sets: PokemonSet[]): CoverageRow[] {
  return TYPES.map((type) => {
    const row: CoverageRow = { type, weak: 0, resist: 0, immune: 0 };
    for (const set of sets) {
      const m = matchup(type, set).result;
      if (m === "weak") row.weak++;
      else if (m === "resist") row.resist++;
      else if (m === "immune") row.immune++;
    }
    return row;
  });
}

export type Engine = typeof import("./engine");

/** Whether this Pokémon can learn this move in the format (for the "learns a move" filter). */
export function canLearn(formatId: string, species: string, move: string): boolean {
  const c = ctx(formatId);
  const m = Dex.moves.get(move);
  if (!m.exists) return false;
  if (c.wild) return true;
  const s = Dex.species.get(species);
  return !c.validator.checkCanLearn(m, s, c.validator.allSources(s), fakeSet(s.name));
}

/** "M", "F" or "N" when the Pokémon's gender is fixed, or null when the trainer can choose. */
export function fixedGender(species: string): "M" | "F" | "N" | null {
  const s = Dex.species.get(species);
  return s.exists && s.gender ? (s.gender as "M" | "F" | "N") : null;
}

/** Finds a Pokémon by name, falling back to its National Dex number (for names from the Pokédex pages). */
export function resolveSpecies(name: string, num = 0): string | null {
  const s = Dex.species.get(name);
  if (s.exists) return s.name;
  const byNum = num > 0 ? Dex.species.all().find((x) => x.num === num && !x.forme) : undefined;
  return byNum?.name ?? null;
}
