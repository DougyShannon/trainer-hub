// The save file. For now it lives in this browser only (like a cartridge in one Game Boy). A later
// stage can also copy it to the player's Trainer Hub account so it follows them between devices.
//
// Each time the save file gains new kinds of information (the party, the Pokédex, badges...), bump
// SAVE_VERSION and teach `upgrade` to fill in the new parts for older saves, so nobody loses theirs.

export const SAVE_VERSION = 1;

export type SaveFile = {
  version: number;
  /** When the game was started and last saved (milliseconds since 1970, as JavaScript counts). */
  startedAt: number;
  savedAt: number;
  /** Total seconds played, shown on the Continue screen. */
  playSeconds: number;
  /** Where the player is. Only the blank test room exists so far. */
  location: { map: string };
};

const KEY = "frenko.save";

export function newSave(): SaveFile {
  const now = Date.now();
  return { version: SAVE_VERSION, startedAt: now, savedAt: now, playSeconds: 0, location: { map: "test-room" } };
}

export function loadSave(): SaveFile | null {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return stored && typeof stored === "object" ? upgrade(stored) : null;
  } catch {
    return null;
  }
}

/** Writes the save. Returns false when the browser won't store it (private browsing, full storage). */
export function writeSave(save: SaveFile): boolean {
  try {
    save.savedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

function upgrade(stored: Partial<SaveFile>): SaveFile {
  const fresh = newSave();
  return {
    version: SAVE_VERSION,
    startedAt: Number(stored.startedAt) || fresh.startedAt,
    savedAt: Number(stored.savedAt) || fresh.savedAt,
    playSeconds: Number(stored.playSeconds) || 0,
    location: { map: stored.location?.map ?? fresh.location.map },
  };
}

/** "1:05" style hours and minutes, as on the GBA Continue screen. */
export function formatPlayTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}
