// The formats this engine runs. Copied from Showdown's config/formats.ts (Champions section).
export const Formats: import("./ps/sim/dex-formats").FormatList = [
  { section: "Champions" },
  {
    name: "[Gen 9 Champions] BSS Reg M-C",
    mod: "champions",
    ruleset: ["Flat Rules"],
  },
  {
    name: "[Gen 9 Champions] VGC 2026 Reg M-C",
    mod: "champions",
    gameType: "doubles",
    ruleset: ["Flat Rules"],
  },
  // Used by make-teams.mjs to make the computer's teams.
  {
    name: "[Gen 9 Champions] Random Battle",
    mod: "champions",
    team: "random",
    ruleset: ["Obtainable", "Species Clause", "Cancel Mod", "Sleep Clause Mod", "Illusion Level Mod", "Level Clause Mod"],
  },
  {
    name: "[Gen 9 Champions] Random Doubles Battle",
    mod: "champions",
    gameType: "doubles",
    team: "random",
    ruleset: ["Obtainable", "Species Clause", "Cancel Mod", "Sleep Clause Mod", "Illusion Level Mod", "Level Clause Mod"],
  },
  {
    name: "[Gen 9 Champions] Custom Game",
    mod: "champions",
    debug: true,
    battle: { trunc: Math.trunc },
    ruleset: ["Team Preview", "Cancel Mod", "Max Team Size = 24", "Max Move Count = 24", "Max Level = 9999", "Default Level = 50"],
  },
  {
    name: "[Gen 9 Champions] Doubles Custom Game",
    mod: "champions",
    gameType: "doubles",
    debug: true,
    battle: { trunc: Math.trunc },
    ruleset: ["Team Preview", "Cancel Mod", "Max Team Size = 24", "Max Move Count = 24", "Max Level = 9999", "Default Level = 50"],
  },
];
