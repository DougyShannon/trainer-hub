// The battle formats the Team Builder offers. Kept apart from the engine so team lists can
// show format names without downloading all the Pokémon data.

export type FormatGroup = "Singles" | "Doubles" | "Wild";
export type FormatInfo = { id: string; label: string; group: FormatGroup; blurb: string };

export const FORMATS: FormatInfo[] = [
  { id: "gen9ou", label: "OU", group: "Singles", blurb: "The main Smogon singles tier. The strongest Pokémon (Ubers) are banned." },
  { id: "gen9ubers", label: "Ubers", group: "Singles", blurb: "Singles with the legendary heavy hitters allowed." },
  { id: "gen9uu", label: "UU", group: "Singles", blurb: "Singles without anything used a lot in OU." },
  { id: "gen9ru", label: "RU", group: "Singles", blurb: "The tier below UU." },
  { id: "gen9nu", label: "NU", group: "Singles", blurb: "The tier below RU." },
  { id: "gen9pu", label: "PU", group: "Singles", blurb: "The tier below NU." },
  { id: "gen9lc", label: "Little Cup", group: "Singles", blurb: "Level 5, first-stage Pokémon only." },
  { id: "gen9monotype", label: "Monotype", group: "Singles", blurb: "Every Pokémon on the team must share a type." },
  { id: "gen9nationaldex", label: "National Dex", group: "Singles", blurb: "OU rules with every past Pokémon, move and item allowed." },
  { id: "gen9anythinggoes", label: "Anything Goes", group: "Singles", blurb: "Any legal Pokémon, very few bans." },
  { id: "gen9bssregi", label: "Battle Stadium Singles", group: "Singles", blurb: "The in-game ranked singles rules: bring 6, pick 3, level 50." },
  { id: "gen91v1", label: "1v1", group: "Singles", blurb: "Bring 3, pick 1." },
  { id: "gen9doublesou", label: "Doubles OU", group: "Doubles", blurb: "The main Smogon doubles tier." },
  { id: "gen9vgc2025regi", label: "VGC 2025 Reg I", group: "Doubles", blurb: "Official tournament rules: bring 6, pick 4, level 50, two restricted legendaries." },
  { id: "gen9vgc2024regg", label: "VGC 2024 Reg G", group: "Doubles", blurb: "Official tournament rules with one restricted legendary." },
  { id: "gen9doublesubers", label: "Doubles Ubers", group: "Doubles", blurb: "Doubles with legendaries allowed." },
  { id: "gen9doublesuu", label: "Doubles UU", group: "Doubles", blurb: "Doubles without anything used a lot in Doubles OU." },
  { id: "gen92v2doubles", label: "2v2 Doubles", group: "Doubles", blurb: "Bring 4, pick 2." },
  { id: "gen9nationaldexdoubles", label: "National Dex Doubles", group: "Doubles", blurb: "Doubles with every past Pokémon, move and item." },
  { id: "gen9customgame", label: "Wild Singles", group: "Wild", blurb: "Anything goes: any Pokémon with any ability, any moves and any item." },
  { id: "gen9doublescustomgame", label: "Wild Doubles", group: "Wild", blurb: "Anything goes, in doubles." },
];

export const DEFAULT_FORMAT = "gen9ou";
export const isWild = (formatId: string) => formatId === "gen9customgame" || formatId === "gen9doublescustomgame";

/** A short name for a format, e.g. "Doubles OU". */
export const teamFormatLabel = (id: string) => FORMATS.find((f) => f.id === id)?.label ?? id;
