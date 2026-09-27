import { useState } from "react";

/** A personal best kept in this browser only. Falls back to memory if storage is blocked. */
export function useBest(key: string): [number, (score: number) => boolean] {
  const storageKey = `trainer-hub:best:${key}`;
  const [best, setBest] = useState(() => {
    try {
      return Number(localStorage.getItem(storageKey)) || 0;
    } catch {
      return 0;
    }
  });
  const offer = (score: number) => {
    if (score <= best) return false;
    setBest(score);
    try {
      localStorage.setItem(storageKey, String(score));
    } catch {
      // Private browsing: keep the best for this visit only.
    }
    return true;
  };
  return [best, offer];
}

export function shuffled<T>(list: T[]) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
