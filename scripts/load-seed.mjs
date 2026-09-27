// Loads the SQL files from data/seed into D1, in order.
// Usage: node scripts/load-seed.mjs --local | --remote

import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const target = process.argv[2];
if (target !== "--local" && target !== "--remote") {
  console.error("Usage: node scripts/load-seed.mjs --local | --remote");
  process.exit(1);
}

const files = (await readdir("data/seed")).filter((f) => f.endsWith(".sql")).sort();
if (!files.length) {
  console.error("No seed files found. Run `npm run data:build` first.");
  process.exit(1);
}

for (const file of files) {
  console.log(`Loading ${file}`);
  execFileSync("npx", ["wrangler", "d1", "execute", "trainer-hub", target, "--yes", "--file", `data/seed/${file}`], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}
console.log("Done.");
