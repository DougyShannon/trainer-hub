import { Link, useSearchParams } from "react-router";
import { REGIONS, VENUES, type RegionId } from "../../shared/venues";
import { useApi, type GameSummary } from "../lib/api";
import { TypeBadge } from "../components/ui";

/** Every gym, grand trial and league, by region. Pick one to open a themed table there. */
export function WorldPage() {
  const [params, setParams] = useSearchParams();
  const region = (REGIONS.find((r) => r.id === params.get("region"))?.id ?? "kanto") as RegionId;
  const info = REGIONS.find((r) => r.id === region)!;
  const open = useApi<GameSummary[]>("/api/games/open", { fresh: true });
  const waitingAt: Record<string, number> = {};
  for (const g of open.data ?? []) if (g.venue) waitingAt[g.venue] = (waitingAt[g.venue] ?? 0) + 1;

  return (
    <div className="world">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <Link to="/play">Play</Link>
          </p>
          <h1>Battle venues</h1>
          <p className="muted">Pick a gym or stadium and open a table there. Each one has its own look.</p>
        </div>
      </div>

      <div className="region-tabs" role="tablist" aria-label="Regions">
        {REGIONS.map((r) => (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={r.id === region}
            className={r.id === region ? "active" : ""}
            onClick={() => setParams({ region: r.id }, { replace: true })}
          >
            {r.name}
          </button>
        ))}
      </div>
      <p className="muted small region-note">
        {info.name} is inspired by {info.inspiredBy}.
      </p>

      <div className="venue-grid">
        {VENUES.filter((v) => v.region === region).map((v) => (
          <article key={v.id} className="venue-card" data-venue-type={v.type?.toLowerCase() ?? "league"}>
            <div className="venue-card-mat" aria-hidden="true" />
            <div className="venue-card-body">
              <h2>{v.name}</h2>
              <p className="muted small">
                {v.kind === "gym" ? `Gym Leader ${v.leader}` : v.kind === "trial" ? `${v.leader} · ${v.place}` : v.leader}
              </p>
              <div className="venue-card-foot">
                {v.type ? <TypeBadge type={v.type.toLowerCase()} /> : <span className="type-badge venue-league-badge">League</span>}
                {waitingAt[v.id] ? (
                  <span className="small">
                    {waitingAt[v.id]} table{waitingAt[v.id] > 1 ? "s" : ""} waiting
                  </span>
                ) : null}
                <Link to={`/play?venue=${v.id}`} className="primary-btn small">
                  Battle here
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
