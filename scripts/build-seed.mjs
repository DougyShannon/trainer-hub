// Downloads the card and Pokédex data and turns it into SQL files for the D1 database.
//
// Sources (both free, open data on GitHub):
//   Cards: https://github.com/PokemonTCG/pokemon-tcg-data (the data behind pokemontcg.io)
//   Pokémon: https://github.com/PokeAPI/pokeapi (the CSV files behind PokeAPI)
//
// Output: data/seed/*.sql, loaded by scripts/load-seed.mjs. Downloads are cached in data/raw.

import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const RAW = "data/raw";
const OUT = "data/seed";
const TCG = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master";
const POKEAPI = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
const ENGLISH = 9;

async function download(url, file) {
  const dest = path.join(RAW, file);
  if (existsSync(dest)) return readFile(dest, "utf8");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const text = await res.text();
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, text);
  return text;
}

// Minimal CSV parser that handles quoted fields containing commas and newlines.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const sql = (v) => {
  if (v === null || v === undefined || v === "") return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replaceAll("'", "''")}'`;
};
const insert = (table, row) =>
  `INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).map(sql).join(", ")});`;

const isLegal = (legalities, format) => legalities?.[format] === "Legal";
const toInt = (v) => (v === undefined || v === null || v === "" || Number.isNaN(parseInt(v, 10)) ? null : parseInt(v, 10));

async function buildCards() {
  const sets = JSON.parse(await download(`${TCG}/sets/en.json`, "tcg/sets.json"));
  // One SQL file per set, so a reload can add just the sets that are new or changed.
  const bySet = {};
  let cardCount = 0;

  for (const s of sets) {
    const lines = [insert("sets", {
      id: s.id,
      name: s.name,
      series: s.series,
      printed_total: s.printedTotal,
      total: s.total,
      release_date: s.releaseDate.replaceAll("/", "-"),
      ptcgo_code: s.ptcgoCode,
      symbol_url: s.images?.symbol,
      logo_url: s.images?.logo,
      legal_standard: isLegal(s.legalities, "standard"),
      legal_expanded: isLegal(s.legalities, "expanded"),
    })];

    const cards = JSON.parse(await download(`${TCG}/cards/en/${s.id}.json`, `tcg/cards/${s.id}.json`));
    for (const c of cards) {
      const details = {
        abilities: c.abilities, attacks: c.attacks, weaknesses: c.weaknesses, resistances: c.resistances,
        retreatCost: c.retreatCost, rules: c.rules, flavorText: c.flavorText, evolvesTo: c.evolvesTo,
        ancientTrait: c.ancientTrait,
      };
      const searchText = [
        c.name,
        ...(c.abilities ?? []).flatMap((a) => [a.name, a.text]),
        ...(c.attacks ?? []).flatMap((a) => [a.name, a.text]),
        ...(c.rules ?? []),
      ].filter(Boolean).join(" ").toLowerCase();

      lines.push(insert("cards", {
        id: c.id,
        set_id: s.id,
        number: c.number,
        number_sort: toInt(c.number.replace(/\D+/g, "")) ?? 0,
        name: c.name,
        supertype: c.supertype,
        subtypes: JSON.stringify(c.subtypes ?? []),
        hp: toInt(c.hp),
        types: JSON.stringify(c.types ?? []),
        evolves_from: c.evolvesFrom,
        rarity: c.rarity,
        artist: c.artist,
        regulation_mark: c.regulationMark,
        legal_standard: isLegal(c.legalities, "standard"),
        legal_expanded: isLegal(c.legalities, "expanded"),
        image_small: c.images?.small,
        image_large: c.images?.large,
        search_text: searchText,
        details: JSON.stringify(details),
      }));
      for (const dex of new Set(c.nationalPokedexNumbers ?? [])) {
        lines.push(insert("card_pokemon", { card_id: c.id, dex }));
      }
      cardCount++;
    }
    bySet[s.id] = { cards: cards.length, lines };
  }
  console.log(`Cards: ${sets.length} sets, ${cardCount} cards`);
  return bySet;
}

// PokeAPI prose uses markup like "[paralyze]{mechanic:paralysis}" or "[]{move:thunder}".
const cleanProse = (text) =>
  text
    .replace(/\[([^\]]*)\]\{[^}:]*:([^}]*)\}/g, (_, label, id) => label || id.replaceAll("-", " "))
    .replace(/[\f\n\r­]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function buildPokemon() {
  const csv = async (name) => parseCsv(await download(`${POKEAPI}/${name}.csv`, `pokeapi/${name}.csv`));
  const [pokemon, species, speciesNames, pokemonTypes, types, pokemonStats, pokemonAbilities, abilityNames, abilityProse, flavor, efficacy] =
    await Promise.all([
      csv("pokemon"), csv("pokemon_species"), csv("pokemon_species_names"), csv("pokemon_types"), csv("types"),
      csv("pokemon_stats"), csv("pokemon_abilities"), csv("ability_names"), csv("ability_prose"),
      csv("pokemon_species_flavor_text"), csv("type_efficacy"),
    ]);

  const english = (rows, key) => new Map(rows.filter((r) => +r.local_language_id === ENGLISH).map((r) => [r[key], r]));
  const names = english(speciesNames, "pokemon_species_id");
  const abilityName = english(abilityNames, "ability_id");
  const abilityEffect = english(abilityProse, "ability_id");
  const typeName = new Map(types.map((t) => [t.id, t.identifier]));

  // Latest English Pokédex entry per species.
  const latestFlavor = new Map();
  for (const f of flavor) {
    if (+f.language_id !== ENGLISH) continue;
    const prev = latestFlavor.get(f.species_id);
    if (!prev || +f.version_id > +prev.version_id) latestFlavor.set(f.species_id, f);
  }

  const group = (rows, key) => {
    const m = new Map();
    for (const r of rows) (m.get(r[key]) ?? m.set(r[key], []).get(r[key])).push(r);
    return m;
  };
  const typesBy = group(pokemonTypes, "pokemon_id");
  const statsBy = group(pokemonStats, "pokemon_id");
  const abilitiesBy = group(pokemonAbilities, "pokemon_id");
  const defaultForm = new Map(pokemon.filter((p) => p.is_default === "1").map((p) => [p.species_id, p]));
  const statKeys = { 1: "hp", 2: "attack", 3: "defense", 4: "spAttack", 5: "spDefense", 6: "speed" };

  const lines = [];
  for (const s of species) {
    const form = defaultForm.get(s.id);
    if (!form) continue;
    const stats = {};
    for (const st of statsBy.get(form.id) ?? []) if (statKeys[st.stat_id]) stats[statKeys[st.stat_id]] = +st.base_stat;
    const abilities = (abilitiesBy.get(form.id) ?? [])
      .sort((a, b) => a.slot - b.slot)
      .map((a) => ({
        name: abilityName.get(a.ability_id)?.name ?? a.ability_id,
        hidden: a.is_hidden === "1",
        effect: abilityEffect.get(a.ability_id) ? cleanProse(abilityEffect.get(a.ability_id).short_effect) : null,
      }));
    lines.push(insert("pokemon", {
      id: +s.id,
      slug: s.identifier,
      name: names.get(s.id)?.name ?? s.identifier,
      genus: names.get(s.id)?.genus,
      generation: +s.generation_id,
      types: JSON.stringify((typesBy.get(form.id) ?? []).sort((a, b) => a.slot - b.slot).map((t) => typeName.get(t.type_id))),
      height: toInt(form.height),
      weight: toInt(form.weight),
      stats: JSON.stringify(stats),
      abilities: JSON.stringify(abilities),
      flavor_text: latestFlavor.get(s.id) ? cleanProse(latestFlavor.get(s.id).flavor_text) : null,
      evolution_chain_id: toInt(s.evolution_chain_id),
      evolves_from: toInt(s.evolves_from_species_id),
      is_legendary: s.is_legendary === "1",
      is_mythical: s.is_mythical === "1",
    }));
  }
  console.log(`Pokémon: ${lines.length} species`);

  // Video-game type chart (attacking type -> defending type -> multiplier), used on Pokémon pages.
  const chart = {};
  for (const e of efficacy) {
    if (+e.damage_type_id > 18 || +e.target_type_id > 18) continue;
    const atk = typeName.get(e.damage_type_id);
    (chart[atk] ??= {})[typeName.get(e.target_type_id)] = +e.damage_factor / 100;
  }
  await writeFile("src/shared/type-chart.json", JSON.stringify(chart, null, 1) + "\n");

  return lines;
}

await mkdir(RAW, { recursive: true });
if (existsSync(OUT)) await rm(OUT, { recursive: true });
await mkdir(path.join(OUT, "sets"), { recursive: true });
await mkdir("src/shared", { recursive: true });

const bySet = await buildCards();
const pokemonLines = await buildPokemon();

// scripts/load-seed.mjs compares manifest.json with the database to work out what needs loading.
for (const [id, { lines }] of Object.entries(bySet)) {
  await writeFile(path.join(OUT, "sets", `${id}.sql`), lines.join("\n") + "\n");
}
await writeFile(path.join(OUT, "pokemon.sql"), pokemonLines.join("\n") + "\n");
const manifest = { pokemon: pokemonLines.length, sets: Object.fromEntries(Object.entries(bySet).map(([id, s]) => [id, s.cards])) };
await writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(`Wrote ${Object.keys(bySet).length} set files and the Pokémon file to ${OUT}`);
