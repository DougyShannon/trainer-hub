// Builds src/client/battle/champions/showdown-sim.js: Pokémon Showdown's own battle simulator with
// its Pokémon Champions rules (Regulation M-C), packed to run in the browser.
//
// The rest of the site runs on @pkmn/sim, which hasn't caught up with Champions yet (new Megas,
// Stat Points instead of EVs, changed moves and items). When it does, this can go.
//
// Run from the repo root:  node scripts/champions-engine/build.mjs [showdown-commit]
// It clones Showdown into scripts/champions-engine/ps (ignored by git) at the pinned commit.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
// --teams also builds a Node copy with Showdown's Champions random-team maker, used by make-teams.mjs.
const TEAMS = process.argv.includes("--teams");
const COMMIT = process.argv.slice(2).find((a) => !a.startsWith("--")) || "7244fe8e28fa8bc4d0809ae30d183c608b62bb2b";
const ps = join(here, "ps");
const out = join(here, "../../src/client/battle/champions/showdown-sim.js");

const git = (...args) => execFileSync("git", args, { cwd: ps, stdio: "inherit" });
if (!existsSync(ps)) {
  mkdirSync(ps);
  git("init", "-q");
  git("remote", "add", "origin", "https://github.com/smogon/pokemon-showdown.git");
}
git("fetch", "-q", "--depth", "1", "origin", COMMIT);
git("checkout", "-q", "--force", COMMIT);
if (!existsSync(join(ps, "node_modules/ts-chacha20"))) {
  execFileSync("npm", ["install", "--no-save", "--no-package-lock", "--ignore-scripts", "ts-chacha20"], { cwd: ps, stdio: "inherit" });
}

// Every data file the simulator might ask for, as static imports. The base learnsets are left out
// (3.6 MB): Champions has its own complete learnsets, which is all the team checker needs.
const files = [];
const add = (dir, key) => {
  for (const f of readdirSync(join(ps, dir))) {
    if (!f.endsWith(".ts") || f === "learnsets.ts" && dir === "data" || f.startsWith("random-")) continue;
    files.push({ key: `/ps/${key}/${f.slice(0, -3)}`, path: `./ps/${dir}/${f}` });
  }
};
add("data", "data");
add("data/mods/champions", "data/mods/champions");
const dataModule =
  files.map((f, i) => `import * as d${i} from ${JSON.stringify(f.path)};`).join("\n") +
  `\nconst files = {\n${files.map((f, i) => `  ${JSON.stringify(f.key)}: d${i},`).join("\n")}\n};\n` +
  `export function psData(path) {\n  const f = files[path];\n  if (!f) { const e = new Error("Not found: " + path); e.code = "MODULE_NOT_FOUND"; throw e; }\n  return f;\n}\n`;
writeFileSync(join(here, "ps-data.ts"), dataModule);

const replace = (file, pairs) => {
  let src = readFileSync(file, "utf8");
  for (const [from, to] of pairs) {
    if (!src.includes(from)) throw new Error(`${file}: couldn't find ${from}`);
    src = src.split(from).join(to);
  }
  return src;
};

const patches = {
  "sim/dex.ts": [
    ["const dataObject = require(filePath);", "const dataObject = psData(filePath);"],
    ["require(path.resolve(DATA_DIR, 'aliases'))", "psData(path.resolve(DATA_DIR, 'aliases'))"],
    ["import * as fs from 'fs';", "import * as fs from 'fs';\nimport { psData } from '../../ps-data';"],
  ],
  "sim/dex-formats.ts": [
    ["customFormats = require(`${__dirname}/../config/custom-formats`).Formats;", "throw Object.assign(new Error('no custom formats'), { code: 'MODULE_NOT_FOUND' });"],
    ["require(`${__dirname}/../config/formats`).Formats", "TrainerHubFormats"],
    ["import { Utils } from '../lib/utils';", "import { Utils } from '../lib/utils';\nimport { Formats as TrainerHubFormats } from '../../formats';"],
  ],
  "sim/dex-text.ts": [
    ["return require(filePath)[exportName];", "return {} as any;"],
    ["require.resolve(filePath);", "return {};"],
  ],
};

const makePlugin = (teams) => ({
  name: "showdown-browser",
  setup(build) {
    build.onResolve({ filter: /^fs$/ }, () => ({ path: join(here, "fs-shim.js") }));
    build.onResolve({ filter: /^path$/ }, () => ({ path: join(here, "path-shim.js") }));
    build.onResolve({ filter: /^node:util$/ }, () => ({ path: join(here, "util-shim.js") }));
    // The random-team maker only needs Utils, not the whole server library.
    build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/lib$/ }, () => ({ path: join(ps, "lib/utils.ts") }));
    build.onLoad({ filter: /\/ps\/sim\/(dex|dex-formats|dex-text|teams)\.ts$/ }, (args) => {
      const rel = args.path.slice(args.path.indexOf("/ps/") + 4);
      if (rel === "sim/teams.ts") {
        // Random teams aren't used here; don't pull in every random-battle generator.
        const src = readFileSync(args.path, "utf8").replace(/require\(`[^`]*`\)\.default/g, teams ? "ChampionsTeams" : "undefined as any")
          .replace("import { Dex, toID } from './dex';", teams ? "import { Dex, toID } from './dex';\nimport ChampionsTeams from '../data/random-battles/champions/teams';" : "import { Dex, toID } from './dex';");
        return { contents: src, loader: "ts" };
      }
      return { contents: replace(args.path, patches[rel]), loader: "ts" };
    });
  },
});

mkdirSync(dirname(out), { recursive: true });
await esbuild.build({
  entryPoints: [join(here, "entry.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: out,
  define: { __dirname: '"/ps/sim"' },
  external: ["node:crypto"],
  legalComments: "none",
  keepNames: true,
  banner: {
    js: `// Generated by scripts/champions-engine/build.mjs from Pokémon Showdown (MIT licence),\n// https://github.com/smogon/pokemon-showdown commit ${COMMIT}. Don't edit by hand.\n/* eslint-disable */\n// @ts-nocheck`,
  },
  plugins: [makePlugin(false)],
  logLevel: "warning",
});
console.log("Wrote", out);

if (TEAMS) {
  const teamsOut = join(here, "ps-teams.mjs");
  await esbuild.build({
    entryPoints: [join(here, "entry.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    outfile: teamsOut,
    define: { __dirname: '"/ps/sim"' },
    external: ["mysql2", "pg", "nodemailer", "better-sqlite3"],
    plugins: [makePlugin(true)],
    logLevel: "warning",
  });
  console.log("Wrote", teamsOut);
}
