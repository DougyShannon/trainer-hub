import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useApi, type CardPage, type SetInfo } from "../lib/api";
import { CardThumb, Energy, ErrorBox, Loading, TCG_TYPES, PageLogo } from "../components/ui";

const SUBTYPES: Record<string, string[]> = {
  "Pokémon": ["Basic", "Stage 1", "Stage 2", "ex", "EX", "GX", "V", "VMAX", "VSTAR", "Radiant", "Tera", "BREAK", "MEGA"],
  Trainer: ["Item", "Supporter", "Stadium", "Pokémon Tool", "ACE SPEC"],
  Energy: ["Basic", "Special"],
};

const SORT_LABELS: Record<string, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "Name A–Z",
  hp: "Highest HP",
  set: "Set number",
};

export function CardsPage() {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(params.get("q") ?? "");

  useEffect(() => {
    setDraft(params.get("q") ?? "");
  }, [params]);

  const sets = useApi<SetInfo[]>("/api/sets");
  const filters = useApi<{ rarities: string[] }>("/api/cards/filters");
  const apiUrl = `/api/cards?${params.toString()}`;
  const { data, error, loading } = useApi<CardPage>(apiUrl);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next);
  };

  const supertype = params.get("supertype") ?? "";
  const activeType = params.get("type") ?? "";
  const page = Number(params.get("page") ?? 1);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasFilters = [...params.keys()].some((k) => k !== "page" && k !== "sort");

  return (
    <div className="cards-page">
      <div className="page-head">
        <h1 className="with-logo">
          <PageLogo />
          Card database
        </h1>
        <p className="muted">
          {data ? `${data.total.toLocaleString()} card${data.total === 1 ? "" : "s"}` : "Searching"}
          {hasFilters && " match your filters"}
        </p>
      </div>

      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: draft.trim() || null });
        }}
      >
        <label htmlFor="card-q" className="sr-only">
          Search cards
        </label>
        <input
          id="card-q"
          type="search"
          value={draft}
          placeholder={params.get("text") === "1" ? "Search names and card text, e.g. draw 3 cards" : "Search by card name"}
          onChange={(e) => setDraft(e.target.value)}
        />
        <label className="check">
          <input
            id="card-text"
            type="checkbox"
            checked={params.get("text") === "1"}
            onChange={(e) => update({ text: e.target.checked ? "1" : null })}
          />
          Include attack and ability text
        </label>
        <button type="submit">Search</button>
      </form>

      <div className="filters">
        <div className="energy-filter" role="group" aria-label="Filter by energy type">
          {TCG_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`energy-btn ${activeType === t ? "active" : ""}`}
              aria-pressed={activeType === t}
              onClick={() => update({ type: activeType === t ? null : t })}
              title={t}
            >
              <Energy type={t} />
            </button>
          ))}
        </div>

        <div className="filter-row">
          <label>
            <span>Card kind</span>
            <select id="f-supertype" value={supertype} onChange={(e) => update({ supertype: e.target.value || null, subtype: null })}>
              <option value="">All cards</option>
              <option value="Pokémon">Pokémon</option>
              <option value="Trainer">Trainer</option>
              <option value="Energy">Energy</option>
            </select>
          </label>
          <label>
            <span>Stage or kind</span>
            <select
              id="f-subtype"
              value={params.get("subtype") ?? ""}
              onChange={(e) => update({ subtype: e.target.value || null })}
            >
              <option value="">Any</option>
              {(supertype ? SUBTYPES[supertype] : Object.values(SUBTYPES).flat())
                .filter((v, i, a) => a.indexOf(v) === i)
                .map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Set</span>
            <select id="f-set" value={params.get("set") ?? ""} onChange={(e) => update({ set: e.target.value || null })}>
              <option value="">All sets</option>
              {sets.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.release_date.slice(0, 4)})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Rarity</span>
            <select id="f-rarity" value={params.get("rarity") ?? ""} onChange={(e) => update({ rarity: e.target.value || null })}>
              <option value="">Any rarity</option>
              {filters.data?.rarities.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Format</span>
            <select id="f-format" value={params.get("format") ?? ""} onChange={(e) => update({ format: e.target.value || null })}>
              <option value="">Any format</option>
              <option value="standard">Standard legal</option>
              <option value="expanded">Expanded legal</option>
            </select>
          </label>
          <label>
            <span>Sort</span>
            <select id="f-sort" value={params.get("sort") ?? ""} onChange={(e) => update({ sort: e.target.value || null })}>
              <option value="">{params.get("set") ? "Set number" : "Newest first"}</option>
              {Object.entries(SORT_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {hasFilters && (
            <button type="button" className="link-btn" onClick={() => setParams(new URLSearchParams())}>
              Clear all filters
            </button>
          )}
        </div>
      </div>

      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading label="Finding cards" />}
      {data && data.cards.length === 0 && (
        <div className="empty-state">
          <h2>No cards match</h2>
          <p>Try removing a filter or searching for part of the name.</p>
        </div>
      )}
      {data && data.cards.length > 0 && (
        <>
          <div className={`card-grid ${loading ? "is-stale" : ""}`}>
            {data.cards.map((c) => (
              <CardThumb key={c.id} card={c} />
            ))}
          </div>
          {pages > 1 && (
            <nav className="pager" aria-label="Pages">
              <button type="button" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                Previous
              </button>
              <span>
                Page {page} of {pages}
              </span>
              <button type="button" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
