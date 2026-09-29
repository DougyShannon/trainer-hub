import { useEffect, useState } from "react";
import type { Engine } from "./engine";

// The engine carries all of Pokémon Showdown's game data (about 1 MB), so it's only fetched
// on the Team Builder pages, and only once per visit.
let loading: Promise<Engine> | null = null;
export const loadEngine = () => (loading ??= import("./engine"));

export function useEngine(): { engine: Engine | null; error: string | null } {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadEngine()
      .then((e) => live && setEngine(e))
      .catch(() => {
        loading = null;
        if (live) setError("The Pokémon data didn't download");
      });
    return () => {
      live = false;
    };
  }, []);
  return { engine, error };
}
