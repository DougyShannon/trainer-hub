import { useEffect, useState } from "react";
import { BACKDROPS, DEFAULT_MAT, MATS, UPLOADED_PREFIX } from "./library";

/** "full" is the one big board; "mats" is two half mats, theirs upside down at the top and yours below. */
export type BoardLayout = "full" | "mats";

export type BoardPrefs = {
  layout: BoardLayout;
  /** Your half mat (an id from MATS). */
  mat: string;
  /** The full board's background (an id from BACKDROPS), or "" for the plain board. */
  backdrop: string;
};

// Saved in this browser only, so choosing a board never uses up the database's free writes.
const KEY = "trainer-hub:board";
const EVENT = "trainer-hub:board";
const DEFAULTS: BoardPrefs = { layout: "full", mat: DEFAULT_MAT, backdrop: "" };

export function getBoardPrefs(): BoardPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<BoardPrefs>;
    return {
      layout: saved.layout === "mats" ? "mats" : "full",
      // An uploaded mat may not have loaded yet, so keep its id.
      mat: MATS.some((m) => m.id === saved.mat) || saved.mat?.startsWith(UPLOADED_PREFIX) ? saved.mat! : DEFAULTS.mat,
      backdrop: BACKDROPS.some((b) => b.id === saved.backdrop) ? saved.backdrop! : "",
    };
  } catch {
    return DEFAULTS;
  }
}

export function setBoardPrefs(change: Partial<BoardPrefs>) {
  const next = { ...getBoardPrefs(), ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
    memory = next;
  }
  window.dispatchEvent(new Event(EVENT));
}

let memory: BoardPrefs | null = null;

/** The board choices, kept up to date when they change anywhere on the page. */
export function useBoardPrefs(): BoardPrefs {
  const [prefs, setPrefs] = useState(() => memory ?? getBoardPrefs());
  useEffect(() => {
    const update = () => setPrefs(memory ?? getBoardPrefs());
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return prefs;
}
