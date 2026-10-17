// Makes the computer opponents' Pokémon Champions teams (Regulation M-C) and writes them to
// src/shared/battle/champions-teams.ts.
//
// Sets come from Showdown's own Champions random-battle sets, so every move, ability and item is
// one real players use. Each opponent keeps their type speciality (Katy's Bug types, Grusha's Ice
// types...), early opponents get weaker Pokémon and no Mega Stones, and every team is checked
// against the real M-C rules before it is written.
//
// Run from the repo root after `node scripts/champions-engine/build.mjs --teams`:
//   node scripts/champions-engine/make-teams.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Dex, Teams, TeamValidator, PRNG } from "./ps-teams.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dex = Dex.mod("champions");
const SINGLES = "gen9championsbssregmc";
const DOUBLES = "gen9championsvgc2026regmc";

// Gather sets: many random teams from a fixed seed, so running this again gives the same teams.
function gather(format, runs) {
  const pool = new Map();
  const prng = new PRNG([1, 2, 3, 4]);
  for (let i = 0; i < runs; i++) {
    const team = Teams.generate(format, { seed: prng.getSeed() });
    prng.random();
    for (const set of team) {
      const id = dex.species.get(set.species).id;
      const list = pool.get(id) ?? [];
      if (list.length < 6 && !list.some((s) => s.item === set.item && s.moves.join() === set.moves.join())) list.push(set);
      pool.set(id, list);
    }
  }
  return pool;
}

const OPPONENTS = [
  { id: "katy", level: 1, types: ["Bug"] },
  { id: "brassius", level: 2, types: ["Grass"] },
  { id: "iono", level: 3, types: ["Electric"] },
  { id: "kofu", level: 4, types: ["Water"] },
  { id: "larry", level: 5, types: ["Normal"] },
  { id: "ryme", level: 6, types: ["Ghost"] },
  { id: "tulip", level: 7, types: ["Psychic"] },
  { id: "grusha", level: 8, types: ["Ice"] },
  { id: "rika", level: 9, types: ["Ground"] },
  { id: "poppy", level: 10, types: ["Steel"] },
  { id: "larry-e4", level: 11, types: ["Flying"] },
  { id: "hassel", level: 12, types: ["Dragon"] },
  { id: "geeta", level: 13, picks: ["Kingambit", "Glimmora", "Gogoat", "Avalugg", "Espathra", "Gardevoir"] },
  { id: "nemona", level: 14, picks: ["Pawmot", "Lycanroc", "Goodra", "Orthworm", "Meowscarada", "Garchomp"] },
  { id: "pro", level: 15, picks: ["Incineroar", "Garchomp", "Kingambit", "Sinistcha", "Dragonite", "Gholdengo", "Rotom-Wash", "Volcarona", "Corviknight", "Metagross"] },
];

const bst = (s) => Object.values(s.baseStats).reduce((a, b) => a + b, 0);
const isMegaStone = (item) => !!dex.items.get(item).megaStone;

// Showdown's random sets spread 11 Stat Points into every stat. Give the computer focused spreads
// like real players use: 32 in its two most useful stats and 2 in HP (66 in total).
function competitive(set) {
  const species = dex.species.get(set.species);
  const moves = set.moves.map((m) => dex.moves.get(m));
  const phys = moves.filter((m) => m.category === "Physical").length;
  const spec = moves.filter((m) => m.category === "Special").length;
  const attack = phys >= spec ? "atk" : "spa";
  const fast = species.baseStats.spe >= 80 && !moves.some((m) => m.id === "trickroom");
  const bulky = phys + spec <= 1;
  const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  let nature;
  if (bulky) {
    const def = species.baseStats.def >= species.baseStats.spd ? "def" : "spd";
    evs.hp = 32;
    evs[def] = 32;
    evs[def === "def" ? "spd" : "def"] = 2;
    nature = def === "def" ? (attack === "atk" ? "Impish" : "Bold") : attack === "atk" ? "Careful" : "Calm";
  } else if (fast) {
    evs[attack] = 32;
    evs.spe = 32;
    evs.hp = 2;
    nature = attack === "atk" ? "Jolly" : "Timid";
  } else {
    evs[attack] = 32;
    evs.hp = 32;
    evs.def = 2;
    nature = attack === "atk" ? "Adamant" : "Modest";
  }
  if (moves.some((m) => m.id === "trickroom")) nature = attack === "atk" ? "Brave" : "Quiet";
  return {
    name: "",
    species: set.species,
    item: set.item,
    ability: set.ability,
    gender: set.gender || "",
    nature,
    evs,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
    moves: moves.map((m) => m.name),
  };
}

// Items no one else on the team holds, for when two sets want the same one (Item Clause).
const SPARE_ITEMS = ["Leftovers", "Sitrus Berry", "Focus Sash", "Life Orb", "Choice Scarf", "Lum Berry", "Shuca Berry", "Rocky Helmet", "Mental Herb", "Expert Belt", "Muscle Band", "Wise Glasses", "Quick Claw"];

function buildTeam(opp, pool, validatorFormat) {
  const v = new TeamValidator(validatorFormat);
  const early = opp.level <= 3;
  let candidates;
  if (opp.picks) {
    candidates = opp.picks.map((n) => dex.species.get(n).id).filter((id) => pool.has(id));
  } else {
    candidates = [...pool.keys()]
      .map((id) => dex.species.get(id))
      .filter((s) => opp.types.some((t) => s.types.includes(t)) && !s.isMega)
      .sort((a, b) => bst(a) - bst(b))
      // One form each (Vivillon has twenty).
      .filter((s, i, all) => all.findIndex((o) => o.baseSpecies === s.baseSpecies) === i)
      .map((s) => s.id);
    // Early leaders take from the weaker end of their type; later ones from the strongest.
    if (early) candidates = candidates.slice(0, Math.max(8, Math.ceil(candidates.length * 0.6)));
    else if (opp.level >= 9) candidates = candidates.reverse();
    else candidates = candidates.slice(Math.floor(candidates.length * 0.25)).reverse();
  }
  const team = [];
  const bases = new Set();
  const items = new Set();
  let megas = 0;
  for (const id of candidates) {
    if (team.length >= 6) break;
    const base = dex.species.get(id).baseSpecies;
    if (bases.has(base)) continue;
    for (const raw of pool.get(id)) {
      const set = competitive(raw);
      // Early opponents don't Mega Evolve; later ones carry one Mega Stone (two for the Champions).
      if (isMegaStone(set.item) && (early || megas >= (opp.level >= 13 ? 2 : 1))) set.item = SPARE_ITEMS.find((i) => !items.has(i));
      if (items.has(set.item)) set.item = SPARE_ITEMS.find((i) => !items.has(i));
      const bad = v.validateSet(set, {});
      if (bad) { if (process.env.DEBUG) console.log(opp.id, set.species, bad); continue; }
      if (isMegaStone(set.item)) megas++;
      team.push(set);
      bases.add(base);
      items.add(set.item);
      break;
    }
  }
  if (team.length < 6) throw new Error(`${opp.id}: only ${team.length} legal Pokémon for ${validatorFormat}`);
  const problems = v.validateTeam(team);
  if (problems) throw new Error(`${opp.id} (${validatorFormat}): ${problems.join("; ")}`);
  return Teams.export(team).trim().replace(/ +\n/g, "\n");
}

const singlesPool = gather("gen9championsrandombattle", 1500);
const doublesPool = gather("gen9championsrandomdoublesbattle", 1500);
const teams = {};
for (const opp of OPPONENTS) {
  teams[opp.id] = { singles: buildTeam(opp, singlesPool, SINGLES), doubles: buildTeam(opp, doublesPool, DOUBLES) };
}

const out = join(here, "../../src/shared/battle/champions-teams.ts");
const body = Object.entries(teams)
  .map(([id, t]) => `  ${JSON.stringify(id)}: {\n    singles: \`${t.singles}\`,\n    doubles: \`${t.doubles}\`,\n  },`)
  .join("\n");
writeFileSync(
  out,
  `// The computer opponents' Pokémon Champions (Regulation M-C) teams. Generated by
// scripts/champions-engine/make-teams.mjs from Showdown's Champions sets; checked against the
// real M-C rules. Run that script again rather than editing by hand.

export const CHAMPIONS_TEAMS: Record<string, { singles: string; doubles: string }> = {
${body}
};
`,
);
console.log("Wrote", out);
