// The save file. Saves live in the player's Trainer Hub account (up to 5 slots), so anyone can play
// without signing in, but saving needs a signed-in trainer. They follow the player between devices.
//
// Each time the save file gains new kinds of information (the party, the Pokédex, badges...), bump
// SAVE_VERSION and teach `upgrade` to fill in the new parts for older saves, so nobody loses theirs.

import type { Gender } from "../art/player";
import type { Direction } from "../world/direction";

// Version 3: saves moved into the trainer's account and gained the player's name and boy/girl choice.
export const SAVE_VERSION = 3;

/** How many save slots each trainer has. */
export const SLOT_COUNT = 5;

/** The longest name the player can type. */
export const NAME_LENGTH = 10;

export type Location = { map: string; x: number; y: number; facing: Direction };

export type SaveFile = {
  version: number;
  /** When the game was started and last saved (milliseconds since 1970, as JavaScript counts). */
  startedAt: number;
  savedAt: number;
  /** Total seconds played, shown on the Continue screen. */
  playSeconds: number;
  player: { name: string; gender: Gender };
  /** Where the player is, or null for a new game (which starts at the map's starting point). */
  location: Location | null;
};

export function newSave(player: SaveFile["player"]): SaveFile {
  const now = Date.now();
  return { version: SAVE_VERSION, startedAt: now, savedAt: now, playSeconds: 0, player, location: null };
}

/** The trainer's slots, slot 1 first; null for an empty slot. Signed out, there are none. */
export type Slots = { signedIn: true; slots: (SaveFile | null)[] } | { signedIn: false };

export async function loadSlots(): Promise<Slots> {
  const res = await fetch("/api/frenko/saves", { cache: "no-store" });
  if (res.status === 401) return { signedIn: false };
  if (!res.ok) throw new Error(`Couldn't load saves (${res.status})`);
  const body = (await res.json()) as { saves: { slot: number; data: unknown }[] };
  const slots: (SaveFile | null)[] = Array.from({ length: SLOT_COUNT }, () => null);
  for (const { slot, data } of body.saves) {
    if (slot >= 1 && slot <= SLOT_COUNT && data && typeof data === "object") slots[slot - 1] = upgrade(data as Partial<SaveFile>);
  }
  return { signedIn: true, slots };
}

/** Saves into a slot (1 to 5). */
export async function writeSlot(slot: number, save: SaveFile): Promise<"saved" | "signed-out" | "failed"> {
  try {
    const savedAt = Date.now();
    const res = await fetch(`/api/frenko/saves/${slot}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { ...save, savedAt } }),
    });
    if (res.status === 401) return "signed-out";
    if (!res.ok) return "failed";
    save.savedAt = savedAt;
    return "saved";
  } catch {
    return "failed";
  }
}

function upgrade(stored: Partial<SaveFile>): SaveFile {
  const name = typeof stored.player?.name === "string" ? stored.player.name.slice(0, NAME_LENGTH) : "";
  return {
    version: SAVE_VERSION,
    startedAt: Number(stored.startedAt) || Date.now(),
    savedAt: Number(stored.savedAt) || Date.now(),
    playSeconds: Number(stored.playSeconds) || 0,
    player: { name: name || "PLAYER", gender: stored.player?.gender === "girl" ? "girl" : "boy" },
    location: validLocation(stored.location),
  };
}

const FACINGS: Direction[] = ["up", "down", "left", "right"];

/** A missing or broken location starts back at the map's starting point. */
function validLocation(location: unknown): Location | null {
  const l = location as Partial<Location> | null | undefined;
  if (!l || typeof l.map !== "string" || !Number.isInteger(l.x) || !Number.isInteger(l.y)) return null;
  return { map: l.map, x: l.x!, y: l.y!, facing: FACINGS.includes(l.facing!) ? l.facing! : "down" };
}

/** "1:05" style hours and minutes, as on the GBA Continue screen. */
export function formatPlayTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}
