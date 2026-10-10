// Where a battle takes place. Every gym and league from the Battle venues map is a stadium, plus a
// few classic battle arenas. Each has drawn placeholder scenery in its type's colours until a
// picture is added: put an image called <stadium id>.png, .jpg or .webp in public/art/stadiums/
// (for example public/art/stadiums/levincia-gym.png) and it appears behind the battle by itself.

import { REGIONS, VENUES } from "../../shared/venues";

export type Stadium = {
  id: string;
  name: string;
  /** Group heading in the picker. */
  group: string;
  /** Pokémon type for the placeholder colours, or "league" for arenas. */
  look: string;
  /** A Gym Leader or note shown under the name. */
  note: string;
};

const ARENAS: Stadium[] = [
  { id: "battle-stadium", name: "Battle Stadium", group: "Battle arenas", look: "league", note: "The classic tournament arena" },
  { id: "pokemon-stadium", name: "Pokémon Stadium", group: "Battle arenas", look: "league", note: "Kanto's big stadium" },
  { id: "battle-tower", name: "Battle Tower", group: "Battle arenas", look: "steel", note: "Win streaks at the top" },
  { id: "wyndon-stadium", name: "Wyndon Stadium", group: "Battle arenas", look: "dragon", note: "Galar's Champion Cup" },
  { id: "blueberry-academy", name: "Blueberry Academy", group: "Battle arenas", look: "water", note: "League Club room" },
  { id: "grassy-route", name: "Grassy route", group: "Battle arenas", look: "grass", note: "A wild battle on the road" },
];

export const STADIUMS: Stadium[] = [
  ...ARENAS,
  ...REGIONS.flatMap((r) =>
    VENUES.filter((v) => v.region === r.id).map((v) => ({
      id: v.id,
      name: v.name,
      group: r.name,
      look: v.type?.toLowerCase() ?? "league",
      note: v.leader ? (v.kind === "gym" ? `Gym Leader ${v.leader}` : v.leader) : "",
    })),
  ),
];

export const DEFAULT_STADIUM = "battle-stadium";

export const stadiumById = (id: string | null | undefined) => STADIUMS.find((s) => s.id === id) ?? STADIUMS[0];

/** CSS background layers for a stadium's picture. Missing files just don't show, leaving the placeholder. */
export const stadiumImages = (id: string) =>
  ["webp", "png", "jpg"].map((ext) => `url("/art/stadiums/${id}.${ext}")`).join(", ");

const KEY = "trainer-hub:battle-stadium";

export function savedStadium(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveStadium(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Private browsing: the choice just isn't remembered.
  }
}
