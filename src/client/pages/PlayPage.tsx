import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { send, useApi, type DeckSummary, type GameSummary } from "../lib/api";
import { useAuth } from "../lib/auth";
import { sprite } from "../lib/sprites";
import { FORMAT_LABELS } from "../../shared/deck-rules";
import { Loading } from "../components/ui";
import { VenueSelect, VenueTag } from "../components/Venue";
import { venueById } from "../../shared/venues";

/** Re-fetches lobby lists every few seconds so new tables show up without a refresh. */
function useTicker(ms: number) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === "visible" && setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return tick;
}

export const timeAgo = (sqlTime: string) => {
  const mins = Math.round((Date.now() - Date.parse(sqlTime.replace(" ", "T") + "Z")) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(sqlTime.replace(" ", "T") + "Z").toLocaleDateString(undefined, { dateStyle: "medium" });
};

export function TrainerChip({ name, avatar }: { name: string; avatar: number | null }) {
  return (
    <span className="trainer-chip">
      {avatar && <img src={sprite(avatar)} alt="" width={40} height={40} />}
      {name}
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = {
  waiting: "Waiting for an opponent",
  setup: "Setting up",
  playing: "In progress",
  finished: "Finished",
};

export function PlayPage() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const tick = useTicker(5000);
  const open = useApi<GameSummary[]>("/api/games/open", { fresh: true, reloadKey: tick });
  const live = useApi<GameSummary[]>("/api/games/live", { fresh: true, reloadKey: tick });
  const mine = useApi<GameSummary[]>(user ? "/api/games/mine" : null, { fresh: true, reloadKey: tick });
  const decks = useApi<DeckSummary[]>(user ? "/api/decks/mine" : null, { fresh: true });

  const playable = decks.data?.filter((d) => d.isValid) ?? [];
  const [deckId, setDeckId] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const [params] = useSearchParams();
  // The map page links here with ?venue=pewter-city-gym to open a table at that gym.
  const [venue, setVenue] = useState(() => venueById(params.get("venue"))?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deckId && playable.length) setDeckId(playable[0].id);
  }, [playable, deckId]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await send<{ id: string }>("POST", "/api/games", { deckId, isOpen, venue: venue || null });
      navigate(`/play/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const myActive = mine.data?.filter((g) => g.status !== "finished") ?? [];
  const openOthers = open.data?.filter((g) => g.host.trainerName !== user?.trainerName) ?? [];

  return (
    <div className="play">
      <div className="page-head">
        <div>
          <h1>Play</h1>
          <p className="muted">
            Play a live game against another trainer. The table works like a real play mat: you move your own cards and
            the site keeps hidden cards hidden, deals prizes, flips coins and tracks turns.
          </p>
        </div>
        <Link to="/play/venues" className="secondary-btn">
          Battle venues
        </Link>
      </div>

      <div className="play-grid">
        <section className="panel">
          <h2>Start a game</h2>
          {!ready ? (
            <Loading />
          ) : !user ? (
            <p>
              <Link to="/login?next=/play">Log in</Link> or <Link to="/signup?next=/play">sign up</Link> to play. You can
              still watch games without an account.
            </p>
          ) : decks.loading && !decks.data ? (
            <Loading label="Loading your decks" />
          ) : !playable.length ? (
            <p>
              You need a legal 60-card deck first. <Link to="/decks/new">Build a deck</Link>, or copy one from another
              trainer's profile.
            </p>
          ) : (
            <>
              <label className="field">
                <span>Your deck</span>
                <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                  {playable.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({FORMAT_LABELS[d.format]})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Where to battle</span>
                <VenueSelect value={venue} onChange={setVenue} />
              </label>
              <div className="field">
                <span>Who can join</span>
                <div className="segmented" role="group" aria-label="Who can join">
                  <button type="button" className={isOpen ? "active" : ""} onClick={() => setIsOpen(true)}>
                    Anyone in the lobby
                  </button>
                  <button type="button" className={!isOpen ? "active" : ""} onClick={() => setIsOpen(false)}>
                    Only people with the link
                  </button>
                </div>
              </div>
              {error && <p className="form-error">{error}</p>}
              <button type="button" className="primary-btn" disabled={busy || !deckId} onClick={create}>
                {busy ? "Opening…" : "Open a table"}
              </button>
              <p className="muted small">You'll get a link to send to a friend. Your opponent needs a deck in the same format.</p>
            </>
          )}
        </section>

        <section className="panel">
          <h2>Open tables</h2>
          {open.loading && !open.data ? (
            <Loading />
          ) : openOthers.length ? (
            <ul className="game-list">
              {openOthers.map((g) => (
                <li key={g.id}>
                  <TrainerChip name={g.host.trainerName} avatar={g.host.avatarDex} />
                  <span className="game-meta">
                    {FORMAT_LABELS[g.format]} · {timeAgo(g.createdAt)}
                  </span>
                  <VenueTag id={g.venue} />
                  <Link to={`/play/${g.id}`} className="primary-btn small">
                    Join
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No one is waiting right now. Open a table and it will show up here for other trainers.</p>
          )}
        </section>
      </div>

      {user && myActive.length > 0 && (
        <section className="related">
          <h2>Your games</h2>
          <ul className="game-list wide">
            {myActive.map((g) => {
              const opponent = g.host.trainerName === user.trainerName ? g.guest : g.host;
              return (
                <li key={g.id}>
                  <span>
                    {opponent ? <>vs {opponent.trainerName}</> : <>Your table</>} · {FORMAT_LABELS[g.format]}
                  </span>
                  <span className="game-meta">{STATUS_LABEL[g.status]}</span>
                  <VenueTag id={g.venue} />
                  <Link to={`/play/${g.id}`} className="secondary-btn small">
                    {g.status === "waiting" ? "Open" : "Return to game"}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="related">
        <h2>Being played now</h2>
        {live.data?.length ? (
          <ul className="game-list wide">
            {live.data.map((g) => (
              <li key={g.id}>
                <span>
                  {g.host.trainerName} vs {g.guest?.trainerName}
                </span>
                <span className="game-meta">
                  {FORMAT_LABELS[g.format]} · {STATUS_LABEL[g.status]}
                </span>
                <VenueTag id={g.venue} />
                <Link to={`/play/${g.id}`} className="secondary-btn small">
                  Watch
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No games are being played right now.</p>
        )}
      </section>
    </div>
  );
}
