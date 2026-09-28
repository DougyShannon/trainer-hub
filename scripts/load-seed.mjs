// Loads card and Pokémon data from data/seed into D1.
//
// Usage: node scripts/load-seed.mjs --local | --remote [--full]
//
// By default it only loads what's missing: sets that aren't in the database yet, sets whose card
// count has changed, and the Pokémon list if its size has changed. That keeps a reload after a new
// set comes out to a few thousand row writes, well inside Cloudflare's free daily allowance of
// 100,000. Every row written also updates the table's indexes, which Cloudflare counts too, so a
// --full reload of all ~20,000 cards uses more than a day's free allowance.

import { readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const target = process.argv.find((a) => a === "--local" || a === "--remote");
const full = process.argv.includes("--full");
if (!target) {
  console.error("Usage: node scripts/load-seed.mjs --local | --remote [--full]");
  process.exit(1);
}
if (!existsSync("data/seed/manifest.json")) {
  console.error("No seed files found. Run `npm run data:build` first.");
  process.exit(1);
}

const manifest = JSON.parse(await readFile("data/seed/manifest.json", "utf8"));
const wrangler = (args, capture = false) =>
  execFileSync("npx", ["wrangler", "d1", "execute", "trainer-hub", target, "--yes", ...args], {
    stdio: ["ignore", capture ? "pipe" : "ignore", "inherit"],
    encoding: "utf8",
  });
const query = (sql) => JSON.parse(wrangler(["--json", "--command", sql], true))[0].results;

let setsToLoad;
let loadPokemon;
const before = [];

if (full) {
  console.log("Full reload: replacing every set and Pokémon.");
  before.push("DELETE FROM card_pokemon;", "DELETE FROM cards;", "DELETE FROM sets;", "DELETE FROM pokemon;");
  setsToLoad = Object.keys(manifest.sets);
  loadPokemon = true;
} else {
  const counts = Object.fromEntries(query("SELECT set_id, COUNT(*) AS n FROM cards GROUP BY set_id").map((r) => [r.set_id, r.n]));
  const known = new Set(query("SELECT id FROM sets").map((r) => r.id));
  setsToLoad = Object.entries(manifest.sets)
    .filter(([id, n]) => !known.has(id) || counts[id] !== n)
    .map(([id]) => id);
  for (const id of setsToLoad.filter((id) => known.has(id))) {
    const q = `'${id.replaceAll("'", "''")}'`;
    before.push(
      `DELETE FROM card_pokemon WHERE card_id IN (SELECT id FROM cards WHERE set_id = ${q});`,
      `DELETE FROM cards WHERE set_id = ${q};`,
      `DELETE FROM sets WHERE id = ${q};`,
    );
  }
  loadPokemon = query("SELECT COUNT(*) AS n FROM pokemon")[0].n !== manifest.pokemon;
  if (loadPokemon) before.push("DELETE FROM pokemon;");
}

if (!setsToLoad.length && !loadPokemon) {
  console.log("Already up to date. Nothing to load.");
  process.exit(0);
}
console.log(`Loading ${setsToLoad.length} set(s)${setsToLoad.length ? `: ${setsToLoad.join(", ")}` : ""}${loadPokemon ? " and the Pokémon list" : ""}.`);

// Batch everything into files small enough for `wrangler d1 execute --file`.
const lines = [...before];
if (loadPokemon) lines.push(...(await readFile("data/seed/pokemon.sql", "utf8")).trim().split("\n"));
for (const id of setsToLoad) lines.push(...(await readFile(`data/seed/sets/${id}.sql`, "utf8")).trim().split("\n"));

const PER_FILE = 4000;
const batch = "data/seed/batch.sql";
for (let i = 0; i < lines.length; i += PER_FILE) {
  console.log(`Loading rows ${i + 1} to ${Math.min(i + PER_FILE, lines.length)} of ${lines.length}`);
  await writeFile(batch, lines.slice(i, i + PER_FILE).join("\n") + "\n");
  wrangler(["--file", batch]);
}
await rm(batch);
console.log("Done.");
