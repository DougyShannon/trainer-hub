import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { REGIONS, VENUES, venueById, type RegionId, type Venue } from "../../shared/venues";
import { OPPONENTS } from "../../shared/practice/opponents";
import { useApi, type GameSummary } from "../lib/api";
import { useAuth } from "../lib/auth";
import { sprite } from "../lib/sprites";
import { TypeBadge } from "../components/ui";
import { RegionMap } from "../components/RegionMap";
import { REGION_MAPS } from "../maps";
import { readDeckChoice, type PracticeProgress } from "./PracticePage";

/** Every gym, grand trial and league, by region, on a map where we've drawn one. Pick one to open a themed table there. */
export function WorldPage() {
  const [params, setParams] = useSearchParams();
  const region = (REGIONS.find((r) => r.id === params.get("region"))?.id ?? "kanto") as RegionId;
  const info = REGIONS.find((r) => r.id === region)!;
  const map = REGION_MAPS[region];
  const picked = venueById(params.get("venue"));
  const selected = picked?.region === region ? picked : null;
  const { user } = useAuth();
  const open = useApi<GameSummary[]>("/api/games/open", { fresh: true });
  const practice = useApi<PracticeProgress>(user ? "/api/practice" : null, { fresh: true });
  const intel = useRef<HTMLElement>(null);

  useEffect(() => {
    document.title = "Battle venues · Trainer Hub";
    return () => {
      document.title = "Trainer Hub";
    };
  }, []);

  const waitingAt: Record<string, number> = {};
  for (const g of open.data ?? []) if (g.venue) waitingAt[g.venue] = (waitingAt[g.venue] ?? 0) + 1;

  const beaten = new Set((practice.data?.progress ?? []).filter((p) => p.wins > 0).map((p) => p.level));
  const earned = new Set(
    VENUES.filter((v) => {
      const here = OPPONENTS.filter((o) => o.venue === v.id);
      return here.length > 0 && here.every((o) => beaten.has(o.level));
    }).map((v) => v.id),
  );

  const choose = (next: { region?: RegionId; venue?: string | null }) => {
    const out: Record<string, string> = { region: next.region ?? region };
    const venue = next.venue === undefined ? selected?.id : next.venue;
    if (venue) out.venue = venue;
    setParams(out, { replace: true });
  };

  const pickOnMap = (id: string) => {
    choose({ venue: id });
    // On a phone the details sit under the map, so bring them into view.
    if (window.matchMedia?.("(max-width: 900px)").matches) {
      requestAnimationFrame(() => {
        intel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  };

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
            onClick={() => choose({ region: r.id, venue: null })}
          >
            {r.name}
          </button>
        ))}
      </div>
      <p className="muted small region-note">
        {info.name} is inspired by {info.inspiredBy}.
        {!map && ` We haven't drawn the ${info.name} map yet, so its venues are listed below.`}
      </p>

      {map && (
        <div className="world-map-layout">
          <figure className="region-map">
            <RegionMap map={map} selected={selected?.id ?? null} onSelect={pickOnMap} onRegion={(r) => choose({ region: r, venue: null })} waitingAt={waitingAt} earned={earned} />
            <figcaption className="small muted region-map-hint">Swipe to see the whole map.</figcaption>
          </figure>
          <aside ref={intel} className="venue-intel" aria-live="polite">
            {selected ? (
              <VenueIntel venue={selected} waiting={waitingAt[selected.id] ?? 0} practice={practice.data ?? null} loggedIn={!!user} />
            ) : (
              <MapKey />
            )}
          </aside>
        </div>
      )}

      {map && <h2 className="world-list-head">All {info.name} venues</h2>}
      <div className="venue-grid">
        {VENUES.filter((v) => v.region === region).map((v) => (
          <article key={v.id} className="venue-card" data-venue-type={v.type?.toLowerCase() ?? "league"}>
            <div className="venue-card-mat" aria-hidden="true" />
            <div className="venue-card-body">
              <h2>{v.name}</h2>
              <p className="muted small">{leaderLine(v)}</p>
              <div className="venue-card-foot">
                {v.type ? <TypeBadge type={v.type.toLowerCase()} /> : <span className="type-badge venue-league-badge">League</span>}
                {waitingAt[v.id] ? <span className="small">{tablesWaiting(waitingAt[v.id])}</span> : null}
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

const leaderLine = (v: Venue) => (v.kind === "gym" ? `Gym Leader ${v.leader}` : v.kind === "trial" ? `${v.leader} · ${v.place}` : v.leader);
const tablesWaiting = (n: number) => `${n} table${n > 1 ? "s" : ""} waiting`;

/** What the pins mean, shown until a venue is picked. */
function MapKey() {
  return (
    <div className="panel map-key">
      <h2>Choose a venue</h2>
      <p className="muted small">Tap a gym, grand trial or league on the map to see who's there and start a battle.</p>
      <ul>
        <li>
          <svg viewBox="-14 -14 28 28" aria-hidden="true">
            <rect className="key-gym" x={-7} y={-7} width={14} height={14} transform="rotate(45)" />
          </svg>
          Gym or grand trial, coloured by its type
        </li>
        <li>
          <svg viewBox="-14 -14 28 28" aria-hidden="true">
            <circle className="key-league" r={10} />
          </svg>
          Pokémon League
        </li>
        <li>
          <svg viewBox="-14 -14 28 28" aria-hidden="true">
            <circle className="key-count" r={8} />
          </svg>
          Tables waiting for a player
        </li>
        <li>
          <svg viewBox="-14 -14 28 28" aria-hidden="true">
            <circle className="key-earned" r={6} />
          </svg>
          Practice badge you've won
        </li>
      </ul>
    </div>
  );
}

function VenueIntel({ venue, waiting, practice, loggedIn }: { venue: Venue; waiting: number; practice: PracticeProgress | null; loggedIn: boolean }) {
  const region = REGIONS.find((r) => r.id === venue.region)!;
  const opponents = OPPONENTS.filter((o) => o.venue === venue.id);
  const beaten = (level: number) => (practice?.progress ?? []).some((p) => p.level === level && p.wins > 0);
  const unlocked = (level: number) => level === 1 || beaten(level - 1) || !!practice?.allUnlocked;
  const deck = readDeckChoice();

  return (
    <article className="venue-card" data-venue-type={venue.type?.toLowerCase() ?? "league"}>
      <div className="venue-card-mat" aria-hidden="true" />
      <div className="venue-card-body">
        <p className="eyebrow">
          {region.name} · {venue.kind === "gym" ? "Gym" : venue.kind === "trial" ? "Grand trial" : "League"}
        </p>
        <h2>{venue.name}</h2>
        <p className="muted small">{leaderLine(venue)}</p>
        <div className="venue-card-foot">
          {venue.type ? <TypeBadge type={venue.type.toLowerCase()} /> : <span className="type-badge venue-league-badge">League</span>}
          <span className="small">{waiting ? tablesWaiting(waiting) : "No tables waiting"}</span>
        </div>
        <Link to={`/play?venue=${venue.id}`} className="primary-btn">
          Battle here
        </Link>
        {waiting > 0 && (
          <Link to="/play" className="small">
            Join a waiting table on the Play page
          </Link>
        )}

        {opponents.length > 0 && (
          <div className="intel-practice">
            <h3>Practice here</h3>
            {opponents.map((o) => {
              const next = OPPONENTS.find((p) => p.level === o.level - 1);
              return (
                <div key={o.level} className="intel-opponent">
                  <img src={sprite(o.ace)} alt="" width={44} height={44} />
                  <div>
                    <strong>{o.name}</strong>
                    <span className="small muted">
                      Level {o.level} · {o.deckName}
                    </span>
                  </div>
                  {!loggedIn ? (
                    <Link to="/login?next=/play/practice" className="secondary-btn small">
                      Log in
                    </Link>
                  ) : !practice ? null : beaten(o.level) ? (
                    <Link to={deck ? `/play/practice/${o.level}?${deck}` : "/play/practice"} className="secondary-btn small" title={`${o.badge} earned`}>
                      Rematch
                    </Link>
                  ) : unlocked(o.level) ? (
                    <Link to={deck ? `/play/practice/${o.level}?${deck}` : "/play/practice"} className="secondary-btn small">
                      Practice
                    </Link>
                  ) : (
                    <span className="small muted">Beat {next?.name} first</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}
