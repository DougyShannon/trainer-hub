import { useEffect, useState } from "react";
import type { Engine } from "./engine";

// The engine carries all of Pokémon Showdown's game data (about 1 MB), so it's only fetched
// on the Team Builder pages, and only once per visit. Pokémon Champions formats need a second,
// newer copy of Showdown's data, fetched only when a Champions team is opened or picked.
let loading: Promise<Engine> | null = null;
export const loadEngine = () => (loading ??= import("./engine"));

/** The engine, once it and the data for every format listed are ready. */
export function useEngine(formats: (string | null | undefined)[] = []): { engine: Engine | null; error: string | null } {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = formats.filter(Boolean).join(",");
  useEffect(() => {
    let live = true;
    const needed = key ? key.split(",") : [];
    loadEngine()
      .then(async (e) => {
        if (needed.some((f) => !e.readyFor(f))) {
          if (live) setEngine(null);
          await Promise.all(needed.map((f) => e.loadFor(f)));
        }
        if (live) setEngine(e);
      })
      .catch(() => {
        loading = null;
        if (live) setError("The Pokémon data didn't download");
      });
    return () => {
      live = false;
    };
  }, [key]);
  return { engine, error };
}
