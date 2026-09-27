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

type State<T> = { data: T | null; error: string | null; loading: boolean };

const cache = new Map<string, unknown>();

/** Fetches JSON from the site's own API, with a small in-memory cache for back/forward navigation. */
export function useApi<T>(url: string | null): State<T> {
  const [state, setState] = useState<State<T>>(() => ({
    data: url && cache.has(url) ? (cache.get(url) as T) : null,
    error: null,
    loading: !!url && !cache.has(url),
  }));

  useEffect(() => {
    if (!url) return;
    if (cache.has(url)) {
      setState({ data: cache.get(url) as T, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ data: s.data, error: null, loading: true }));
    fetch(url)
      .then(async (res) => {
        const body = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
        return body as T;
      })
      .then((data) => {
        cache.set(url, data);
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ data: null, error: err.message, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}
