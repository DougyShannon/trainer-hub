// Which copy of Pokémon Showdown's simulator runs a format. Most formats use @pkmn/sim. Pokémon
// Champions formats (Regulation M-C) use a newer build of Showdown itself, made by
// scripts/champions-engine/build.mjs, because @pkmn/sim doesn't have Champions yet. Both have
// the same parts with the same names, so the rest of the battle code works with either.

import * as pkmn from "@pkmn/sim";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type SimLib = {
  Battle: any;
  Dex: any;
  Teams: any;
  TeamValidator: any;
  State: any;
  Pokemon: any;
  Side: any;
};

export const isChampionsFormat = (formatid: string) => formatid.startsWith("gen9champions");

let champions: SimLib | null = null;

/** The simulator for a format. A Champions format needs `loadSimLib` first. */
export function simLib(formatid: string): SimLib {
  if (!isChampionsFormat(formatid)) return pkmn as SimLib;
  if (!champions) throw new Error("The Champions battle engine hasn't loaded yet.");
  return champions;
}

/** Downloads the simulator a format needs (only Champions formats need anything extra). */
export async function loadSimLib(formatid: string): Promise<SimLib> {
  if (isChampionsFormat(formatid) && !champions) {
    champions = (await import("./champions/showdown-sim.js")) as unknown as SimLib;
  }
  return simLib(formatid);
}
