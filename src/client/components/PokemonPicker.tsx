import { useMemo, useState } from "react";
import { useApi, type PokemonSummary } from "../lib/api";
import { dexNumber, sprite } from "../lib/sprites";

/** Search box plus a scrolling grid of sprites for choosing one Pokémon. */
export function PokemonPicker({
  id,
  value,
  onChange,
  allowNone = false,
}: {
  id: string;
  value: number | null;
  onChange: (dex: number | null) => void;
  allowNone?: boolean;
}) {
  const { data } = useApi<PokemonSummary[]>("/api/pokemon");
  const [q, setQ] = useState("");
  const selected = data?.find((p) => p.id === value);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle)).slice(0, 60);
  }, [data, q]);

  return (
    <div className="picker">
      <div className="picker-current">
        {selected ? (
          <>
            <img src={sprite(selected.id)} alt="" width={64} height={64} />
            <span>
              <span className="dex-no">{dexNumber(selected.id)}</span> {selected.name}
            </span>
          </>
        ) : (
          <span className="muted">None chosen</span>
        )}
        {allowNone && selected && (
          <button type="button" className="link-btn" onClick={() => onChange(null)}>
            Clear
          </button>
        )}
      </div>
      <input id={id} type="search" placeholder="Search Pokémon" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="picker-grid" role="listbox" aria-label="Pokémon">
        {shown.map((p) => (
          <button
            key={p.id}
            type="button"
            role="option"
            aria-selected={p.id === value}
            className={p.id === value ? "active" : ""}
            onClick={() => onChange(p.id)}
            title={p.name}
          >
            <img src={sprite(p.id)} alt={p.name} loading="lazy" width={56} height={56} />
          </button>
        ))}
      </div>
    </div>
  );
}
