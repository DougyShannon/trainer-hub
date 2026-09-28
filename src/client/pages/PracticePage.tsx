import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useApi, type DeckSummary } from "../lib/api";
import { useAuth } from "../lib/auth";
import { sprite } from "../lib/sprites";
import { ErrorBox, Loading, TypeBadge } from "../components/ui";
import { OPPONENTS } from "../../shared/practice/opponents";
import { venueById } from "../../shared/venues";

export type PracticeProgress = {
  progress: { level: number; wins: number; losses: number; firstWinAt: string | null }[];
  starters: { id: string; name: string; type: string }[];
  allUnlocked: boolean;
};

const DECK_KEY = "trainer-hub:practice-deck";

/** "deck=abc" or "starter=starter-fire": how a practice game says which deck you're using. */
export function readDeckChoice() {
  try {
    return localStorage.getItem(DECK_KEY) ?? "";
  } catch {
    return "";
  }
}

/** A saved game in progress against this opponent, if there is one. */
export function savedGameKey(trainer: string, level: number) {
  return `trainer-hub:practice-game:${trainer.toLowerCase()}:${level}`;
}

export function PracticePage() {
  const { user, ready } = useAuth();
  const info = useApi<PracticeProgress>(user ? "/api/practice" : null, { fresh: true });
  const decks = useApi<DeckSummary[]>(user ? "/api/decks/mine" : null, { fresh: true });
  const [choice, setChoice] = useState(readDeckChoice);

  useEffect(() => {
    document.title = "Practice play · Trainer Hub";
    return () => {
      document.title = "Trainer Hub";
    };
  }, []);

  const fullDecks = decks.data?.filter((d) => d.cardCount === 60) ?? [];
  const options = [...fullDecks.map((d) => ({ value: `deck=${d.id}`, label: d.name })), ...(info.data?.starters ?? []).map((s) => ({ value: `starter=${s.id}`, label: `${s.name} (loan deck)` }))];
  const deck = options.some((o) => o.value === choice) ? choice : (options[0]?.value ?? "");

  useEffect(() => {
    if (!deck) return;
    try {
      localStorage.setItem(DECK_KEY, deck);
    } catch {
      // Private browsing: the choice just isn't remembered.
    }
  }, [deck]);

  const wins = new Map((info.data?.progress ?? []).map((p) => [p.level, p]));
  const beaten = (level: number) => (wins.get(level)?.wins ?? 0) > 0;
  const unlocked = (level: number) => level === 1 || beaten(level - 1) || !!info.data?.allUnlocked;
  const hasSaved = (level: number) => {
    if (!user) return false;
    try {
      return !!localStorage.getItem(savedGameKey(user.trainerName, level));
    } catch {
      return false;
    }
  };

  return (
    <div className="practice-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <Link to="/play">Play</Link>
          </p>
          <h1>Practice play</h1>
          <p className="muted">
            Battle the computer and work your way up the Kanto Gym ladder. Beat each Gym Leader to earn their badge and
            unlock the next, then take on the Elite Four and the Champion. The rules are handled for you, so it's a good
            way to learn.
          </p>
        </div>
      </div>

      {!ready ? (
        <Loading />
      ) : !user ? (
        <p className="panel">
          <Link to="/login?next=/play/practice">Log in</Link> or <Link to="/signup?next=/play/practice">sign up</Link> to
          play practice games and collect badges.
        </p>
      ) : info.error ? (
        <ErrorBox message={info.error} />
      ) : !info.data || !decks.data ? (
        <Loading label="Loading the ladder" />
      ) : (
        <>
          <section className="panel practice-setup">
            <div className="badge-case" aria-label="Badges">
              {OPPONENTS.map((o) => (
                <span key={o.level} className={`badge-slot${beaten(o.level) ? " earned" : ""}`} title={beaten(o.level) ? o.badge : `${o.badge} (not yet earned)`}>
                  <img src={sprite(o.ace)} alt="" width={40} height={40} />
                  <span className="sr-only">
                    {o.badge}: {beaten(o.level) ? "earned" : "not yet earned"}
                  </span>
                </span>
              ))}
              <span className="small muted">
                {OPPONENTS.filter((o) => beaten(o.level)).length} of {OPPONENTS.length} badges
              </span>
            </div>
            <label className="field">
              <span>Your deck</span>
              <select value={deck} onChange={(e) => setChoice(e.target.value)}>
                {fullDecks.length > 0 && (
                  <optgroup label="Your decks">
                    {fullDecks.map((d) => (
                      <option key={d.id} value={`deck=${d.id}`}>
                        {d.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Loan decks">
                  {info.data.starters.map((s) => (
                    <option key={s.id} value={`starter=${s.id}`}>
                      {s.name} ({s.type})
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <p className="muted small">
              Any of your 60-card decks will do. Common Trainer cards and most attacks work automatically; abilities and
              a few unusual cards don't yet, and the game log says when that happens.
            </p>
            {info.data.allUnlocked && <p className="small practice-warn">As the site owner, every level is open to you for testing.</p>}
          </section>

          <ol className="ladder">
            {OPPONENTS.map((o) => {
              const venue = venueById(o.venue);
              const record = wins.get(o.level);
              const open = unlocked(o.level);
              return (
                <li key={o.level} className={`ladder-rung venue-card${open ? "" : " locked"}`} data-venue-type={venue?.type?.toLowerCase() ?? "league"}>
                  <div className="venue-card-mat" aria-hidden="true" />
                  <div className="ladder-body">
                    <img className="ladder-ace" src={sprite(o.ace)} alt="" width={72} height={72} />
                    <div className="ladder-text">
                      <p className="eyebrow">Level {o.level}</p>
                      <h2>{o.name}</h2>
                      <p className="small muted">
                        {o.title} · {o.deckName}
                      </p>
                      <p className="small">{o.blurb}</p>
                    </div>
                    <div className="ladder-foot">
                      {venue?.type ? <TypeBadge type={venue.type.toLowerCase()} /> : <span className="type-badge venue-league-badge">League</span>}
                      {beaten(o.level) && <span className="ladder-badge">{o.badge}</span>}
                      {record && (
                        <span className="small muted">
                          {record.wins} won · {record.losses} lost
                        </span>
                      )}
                      {open ? (
                        <Link to={`/play/practice/${o.level}?${deck}`} className="primary-btn small">
                          {hasSaved(o.level) ? "Carry on" : beaten(o.level) ? "Battle again" : "Battle"}
                        </Link>
                      ) : (
                        <span className="small muted">Beat {OPPONENTS[o.level - 2].name} to unlock</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
