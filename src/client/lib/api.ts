import { useEffect, useState } from "react";

export type CardSummary = {
  id: string;
  name: string;
  supertype: string;
  subtypes: string[];
  hp: number | null;
  types: string[];
  rarity: string | null;
  number: string;
  setId: string;
  setName: string;
  setCode?: string | null;
  releaseDate: string;
  image: string | null;
  legal: { standard: boolean; expanded: boolean };
};

export type Attack = { name: string; cost?: string[]; damage?: string; text?: string };
export type CardAbility = { name: string; text: string; type: string };
export type TypeValue = { type: string; value: string };

export type CardDetail = CardSummary & {
  evolvesFrom: string | null;
  artist: string | null;
  regulationMark: string | null;
  imageLarge: string | null;
  details: {
    abilities?: CardAbility[];
    attacks?: Attack[];
    weaknesses?: TypeValue[];
    resistances?: TypeValue[];
    retreatCost?: string[];
    rules?: string[];
    flavorText?: string;
    evolvesTo?: string[];
    ancientTrait?: { name: string; text: string };
  };
  set: {
    id: string;
    name: string;
    series: string;
    releaseDate: string;
    printedTotal: number;
    symbol: string | null;
    logo: string | null;
    code: string | null;
  };
  pokemon: { id: number; slug: string; name: string }[];
  otherPrintings: CardSummary[];
};

export type CardPage = { total: number; page: number; pageSize: number; cards: CardSummary[] };

export type SetInfo = {
  id: string;
  name: string;
  series: string;
  release_date: string;
  card_count: number;
  symbol_url: string | null;
  logo_url: string | null;
};

export type PokemonSummary = { id: number; slug: string; name: string; types: string[]; generation: number };

export type PokemonDetail = PokemonSummary & {
  genus: string | null;
  height: number | null;
  weight: number | null;
  stats: Record<"hp" | "attack" | "defense" | "spAttack" | "spDefense" | "speed", number>;
  abilities: { name: string; hidden: boolean; effect: string | null }[];
  flavorText: string | null;
  evolvesFrom: number | null;
  isLegendary: boolean;
  isMythical: boolean;
  evolutionChain: { id: number; slug: string; name: string; evolvesFrom: number | null; types: string[] }[];
  cards: CardSummary[];
  previous: { id: number; slug: string; name: string } | null;
  next: { id: number; slug: string; name: string } | null;
};

export type DeckFormat = "standard" | "expanded" | "unlimited";

export type DeckSummary = {
  id: string;
  name: string;
  format: DeckFormat;
  coverCardId: string | null;
  coverImage?: string | null;
  cardCount: number;
  isValid: boolean;
  isPublic: boolean;
  updatedAt: string;
  createdAt: string;
};

export type DeckEntry = { card: CardSummary; count: number };

export type DeckDetail = DeckSummary & {
  isOwner: boolean;
  owner: { trainerName: string; avatarDex: number };
  cards: DeckEntry[];
};

export type Trainer = {
  trainerName: string;
  avatarDex: number;
  favouriteDex: number | null;
  bio: string;
  country: string;
  createdAt: string;
};

export type Me = Trainer & { email: string };

/** Sends a change to the server as JSON and returns the reply, throwing the server's message on failure. */
export async function send<T = { ok: true }>(method: "POST" | "PUT" | "DELETE", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

type State<T> = { data: T | null; error: string | null; loading: boolean };

const cache = new Map<string, unknown>();

/**
 * Fetches JSON from the site's own API, with a small in-memory cache for back/forward navigation.
 * Pass `fresh` for anything that belongs to the logged-in trainer, so it's never shown out of date.
 */
export function useApi<T>(url: string | null, { fresh = false, reloadKey = 0 } = {}): State<T> & { reload: () => void } {
  const [bump, setBump] = useState(0);
  const useCache = !fresh;
  const [state, setState] = useState<State<T>>(() => ({
    data: useCache && url && cache.has(url) ? (cache.get(url) as T) : null,
    error: null,
    loading: !!url && !(useCache && cache.has(url)),
  }));

  useEffect(() => {
    if (!url) return;
    if (useCache && cache.has(url)) {
      setState({ data: cache.get(url) as T, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ data: s.data, error: null, loading: true }));
    fetch(url, { cache: fresh ? "no-store" : "default" })
      .then(async (res) => {
        const body = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
        return body as T;
      })
      .then((data) => {
        if (useCache) cache.set(url, data);
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ data: null, error: err.message, loading: false });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, bump, reloadKey]);

  return { ...state, reload: () => setBump((n) => n + 1) };
}

export type GameSeatInfo = { trainerName: string; avatarDex: number; deckName: string };

export type GameSummary = {
  id: string;
  format: DeckFormat;
  status: "waiting" | "setup" | "playing" | "finished";
  isOpen: boolean;
  venue: string | null;
  host: GameSeatInfo;
  guest: GameSeatInfo | null;
  winner: string | null;
  endReason: string | null;
  turns: number;
  createdAt: string;
  finishedAt: string | null;
};

export type GameInfo = GameSummary & { role: "host" | "guest" | "viewer" };

export type RecentGame = {
  id: string;
  won: boolean;
  opponent: string;
  opponentAvatar: number | null;
  deckName: string;
  turns: number;
  endReason: string | null;
  finishedAt: string;
};
