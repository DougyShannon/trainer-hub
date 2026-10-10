// Checks every computer opponent's team is legal in each battle format it plays.
// Run: npx esbuild scripts/check-battle-teams.ts --bundle --platform=node --format=esm --outfile=/tmp/check.mjs && node /tmp/check.mjs
import { TeamValidator, Teams } from "@pkmn/sim";
import { BATTLE_FORMATS, BATTLE_OPPONENTS, opponentTeam } from "../src/shared/battle/opponents";

let bad = 0;
for (const f of BATTLE_FORMATS) {
  const validator = TeamValidator.get(f.id);
  for (const o of BATTLE_OPPONENTS) {
    const team = Teams.import(opponentTeam(o, f.id));
    if (!team || team.length !== 6) {
      console.log(`${f.label} ${o.id}: team didn't import (${team?.length})`);
      bad++;
      continue;
    }
    const problems = validator.validateTeam(team);
    if (problems?.length) {
      bad++;
      console.log(`${f.label} ${o.id}:\n  ${problems.join("\n  ")}`);
    }
  }
}
console.log(bad ? `${bad} problem teams` : "All opponent teams are legal");
process.exit(bad ? 1 : 0);
