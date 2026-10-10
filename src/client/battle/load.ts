import { useEffect, useState } from "react";

export type BattleEngine = typeof import("./engine");

// The battle engine is Pokémon Showdown's simulator plus its game data (about 1.5 MB), so it's only
// downloaded on the battle screen.
let loading: Promise<BattleEngine> | null = null;
export const loadBattleEngine = () => (loading ??= import("./engine"));

export function useBattleEngine(): { engine: BattleEngine | null; error: string | null } {
  const [engine, setEngine] = useState<BattleEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadBattleEngine()
      .then((e) => live && setEngine(e))
      .catch(() => {
        loading = null;
        if (live) setError("The battle engine didn't download. Check your connection and refresh.");
      });
    return () => {
      live = false;
    };
  }, []);
  return { engine, error };
}
