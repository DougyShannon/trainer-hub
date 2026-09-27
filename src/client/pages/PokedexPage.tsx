import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useApi, type PokemonSummary } from "../lib/api";
import { animatedSprite, artwork, dexNumber, sprite } from "../lib/sprites";
import { ErrorBox, GAME_TYPES, Loading, TypeBadge } from "../components/ui";

const GENERATIONS: Record<number, string> = {
  1: "Kanto", 2: "Johto", 3: "Hoenn", 4: "Sinnoh", 5: "Unova", 6: "Kalos", 7: "Alola", 8: "Galar", 9: "Paldea",
};

type SpriteStyle = "pixel" | "animated" | "artwork";
const SPRITE_URL: Record<SpriteStyle, (id: number) => string> = { pixel: sprite, animated: animatedSprite, artwork };

function loadStyle(): SpriteStyle {
  try {
    const v = localStorage.getItem("dex-sprite-style");
    if (v === "pixel" || v === "animated" || v === "artwork") return v;
  } catch {
    // Storage can be blocked; fall back to the default.
  }
  return "pixel";
}

export function PokedexPage() {
  const { data, error, loading } = useApi<PokemonSummary[]>("/api/pokemon");
  const [params, setParams] = useSearchParams();
  const [style, setStyle] = useState<SpriteStyle>(loadStyle);

  const q = params.get("q") ?? "";
  const type = params.get("type") ?? "";
  const gen = Number(params.get("gen") ?? 0);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: key === "q" });
  };

  const chooseStyle = (s: SpriteStyle) => {
    setStyle(s);
    try {
      localStorage.setItem("dex-sprite-style", s);
    } catch {
      // Not saved; the choice still applies for this visit.
    }
  };

  const shown = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.filter(
      (p) =>
        (!needle || p.name.toLowerCase().includes(needle) || String(p.id) === needle.replace(/^#?0*/, "")) &&
        (!type || p.types.includes(type)) &&
        (!gen || p.generation === gen),
    );
  }, [data, q, type, gen]);

  return (
    <div className="dex-page">
      <div className="page-head">
        <h1>Pokédex</h1>
        <p className="muted">{data ? `${shown.length.toLocaleString()} of ${data.length.toLocaleString()} Pokémon` : "Loading"}</p>
      </div>

      <div className="dex-controls">
        <label htmlFor="dex-q" className="sr-only">
          Search Pokémon
        </label>
        <input id="dex-q" type="search" placeholder="Search by name or number" value={q} onChange={(e) => set("q", e.target.value)} />
        <label>
          <span>Region</span>
          <select id="dex-gen" value={gen || ""} onChange={(e) => set("gen", e.target.value)}>
            <option value="">All generations</option>
            {Object.entries(GENERATIONS).map(([n, region]) => (
              <option key={n} value={n}>
                Gen {n} · {region}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="group" aria-label="Sprite style">
          {(["pixel", "animated", "artwork"] as SpriteStyle[]).map((s) => (
            <button key={s} type="button" aria-pressed={style === s} className={style === s ? "active" : ""} onClick={() => chooseStyle(s)}>
              {s === "pixel" ? "Pixel" : s === "animated" ? "Animated" : "Artwork"}
            </button>
          ))}
        </div>
      </div>

      <div className="type-filter" role="group" aria-label="Filter by type">
        {GAME_TYPES.map((t) => (
          <button key={t} type="button" aria-pressed={type === t} className={type === t ? "active" : ""} onClick={() => set("type", type === t ? "" : t)}>
            <TypeBadge type={t} />
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading label="Loading Pokédex" />}
      {data && shown.length === 0 && (
        <div className="empty-state">
          <h2>No Pokémon match</h2>
          <p>Try a different name, type or region.</p>
        </div>
      )}

      <div className={`dex-grid style-${style}`}>
        {shown.map((p) => (
          <Link key={p.id} to={`/pokedex/${p.slug}`} className="dex-tile">
            <span className="dex-sprite">
              <img src={SPRITE_URL[style](p.id)} alt="" loading="lazy" width={96} height={96} />
            </span>
            <span className="dex-no">{dexNumber(p.id)}</span>
            <span className="dex-name">{p.name}</span>
            <span className="type-row">
              {p.types.map((t) => (
                <TypeBadge key={t} type={t} />
              ))}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
