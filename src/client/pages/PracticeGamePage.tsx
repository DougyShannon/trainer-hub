import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { send, type Me } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ErrorBox, Loading } from "../components/ui";
import { PracticeTable } from "../components/PracticeTable";
import { VenueFrame } from "../components/Venue";
import { applyPractice, newPracticeGame, RuleError } from "../../shared/practice/engine";
import { botAction } from "../../shared/practice/bot";
import { OPPONENTS, opponentByLevel, type Opponent } from "../../shared/practice/opponents";
import type { PAction, PCard, PState } from "../../shared/practice/types";
import { savedGameKey } from "./PracticePage";

type DeckData = { name: string; cards: { card: Omit<PCard, "uid">; count: number }[] };
type Saved = { deck: string; state: PState; recorded: boolean };

const expand = (deck: DeckData, prefix: string): PCard[] => {
  let n = 0;
  return deck.cards.flatMap(({ card, count }) => Array.from({ length: count }, () => ({ ...card, uid: `${prefix}${n++}` })));
};

const readSaved = (key: string): Saved | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
};

export function PracticeGamePage() {
  const { level = "" } = useParams();
  const [params] = useSearchParams();
  const { user, ready } = useAuth();
  const opponent = opponentByLevel(level);
  const deck = params.get("deck") ? `deck=${params.get("deck")}` : params.get("starter") ? `starter=${params.get("starter")}` : "";
  // Bumped by "Rematch" so the game starts over.
  const [round, setRound] = useState(0);

  useEffect(() => {
    document.title = opponent ? `Practice vs ${opponent.name} · Trainer Hub` : "Practice play · Trainer Hub";
    return () => {
      document.title = "Trainer Hub";
    };
  }, [opponent]);

  if (!opponent) return <ErrorBox message="There's no opponent at that level" />;
  if (!ready) return <Loading />;
  if (!user) {
    return (
      <p className="panel">
        <Link to={`/login?next=/play/practice`}>Log in</Link> to play practice games.
      </p>
    );
  }
  if (!deck) {
    return (
      <p className="panel">
        Choose a deck on the <Link to="/play/practice">practice page</Link> first.
      </p>
    );
  }
  return (
    <VenueFrame id={opponent.venue}>
      <PracticeGame key={`${level}|${deck}|${round}`} user={user} opponent={opponent} deck={deck} onRematch={() => setRound((r) => r + 1)} />
    </VenueFrame>
  );
}

function PracticeGame({ user, opponent, deck, onRematch }: { user: Me; opponent: Opponent; deck: string; onRematch: () => void }) {
  const navigate = useNavigate();
  const storeKey = savedGameKey(user.trainerName, opponent.level);
  const game = useRef<Saved | null>(null);
  const [version, setVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const botSteps = useRef({ turn: -1, count: 0 });

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Carry on a saved game with this deck, or deal a new one.
  useEffect(() => {
    let cancelled = false;
    const saved = readSaved(storeKey);
    if (saved && saved.deck === deck && saved.state.status !== "finished") {
      game.current = saved;
      bump();
      return;
    }
    const [kind, id] = deck.split("=");
    Promise.all([
      send<DeckData>("POST", "/api/practice/deck", kind === "deck" ? { deckId: id } : { starter: id }),
      send<DeckData>("POST", "/api/practice/deck", { level: opponent.level }),
    ])
      .then(([mine, theirs]) => {
        if (cancelled) return;
        const state = newPracticeGame({ name: user.trainerName, cards: expand(mine, "a") }, { name: opponent.name, cards: expand(theirs, "b") });
        game.current = { deck, state, recorded: false };
        bump();
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [storeKey, deck, opponent, user.trainerName, bump]);

  // Save after every move so a refresh (or a phone locking) doesn't lose the game.
  useEffect(() => {
    const g = game.current;
    if (!g) return;
    try {
      if (g.state.status === "finished" && g.recorded) localStorage.removeItem(storeKey);
      else localStorage.setItem(storeKey, JSON.stringify(g));
    } catch {
      // Storage full or blocked: the game carries on, it just won't survive a refresh.
    }
  }, [version, storeKey]);

  // Record the result once.
  useEffect(() => {
    const g = game.current;
    if (!g || g.state.status !== "finished" || g.recorded) return;
    g.recorded = true;
    send("POST", "/api/practice/result", { level: opponent.level, won: g.state.winner === "p1" })
      .catch(() => {
        // The badge will be missed this time; nothing else depends on it.
      })
      .finally(bump);
  }, [version, opponent.level, bump]);

  /** Applies a move, undoing it completely if the rules say no. */
  const apply = useCallback((seat: "p1" | "p2", action: PAction) => {
    const g = game.current!;
    const before = structuredClone(g.state);
    try {
      applyPractice(g.state, seat, action);
      return null;
    } catch (err) {
      g.state = before;
      if (err instanceof RuleError) return err.message;
      throw err;
    }
  }, []);

  // The computer's moves, one at a time with a short pause so you can follow them.
  useEffect(() => {
    const g = game.current;
    if (!g || g.state.status === "finished") return;
    const state = g.state;
    const action = botAction(state, "p2", opponent.skill);
    if (!action) return;
    const pace = state.status === "setup" ? 250 : action.type === "choose" ? 700 : 900;
    const t = setTimeout(() => {
      const steps = botSteps.current;
      if (steps.turn !== state.turn) Object.assign(steps, { turn: state.turn, count: 0 });
      steps.count++;
      const tooMany = steps.count > 50 && state.current === "p2" && !state.prompt;
      const problem = apply("p2", tooMany ? { type: "endTurn" } : action);
      if (problem) {
        // Shouldn't happen, but never leave the game stuck on the computer's move.
        const p = g.state.prompt;
        apply("p2", p?.seat === "p2" ? { type: "choose", picks: p.options.slice(0, p.min) } : { type: "endTurn" });
      }
      bump();
    }, pace);
    return () => clearTimeout(t);
  }, [version, opponent.skill, apply, bump]);

  const act = useCallback(
    (action: PAction) => {
      if (!game.current) return;
      setError(apply("p1", action));
      bump();
    },
    [apply, bump],
  );
  const clearError = useCallback(() => setError(null), []);

  if (loadError) return <ErrorBox message={loadError} />;
  const g = game.current;
  if (!g) return <Loading label={`Shuffling your deck and ${opponent.name}'s`} />;
  const state = g.state;
  const thinking = state.status === "playing" && ((state.current === "p2" && !state.prompt) || state.prompt?.seat === "p2");

  let finished = null;
  if (state.status === "finished") {
    const won = state.winner === "p1";
    const next = OPPONENTS.find((o) => o.level === opponent.level + 1);
    finished = (
      <div className={`banner ${won ? "done" : ""} practice-result`}>
        <strong>{won ? `You beat ${opponent.name}!` : `${opponent.name} wins this time.`}</strong>
        <span>
          {state.endReason}
          {won && ` You earned the ${opponent.badge}.`}
        </span>
        <span className="banner-actions">
          {won && next && (
            <button type="button" className="primary-btn small" onClick={() => navigate(`/play/practice/${next.level}?${deck}`)}>
              Next: {next.name}
            </button>
          )}
          <button type="button" className={won && next ? "secondary-btn small" : "primary-btn small"} onClick={onRematch}>
            Rematch
          </button>
          <Link to="/play/practice" className="secondary-btn small">
            Back to the ladder
          </Link>
        </span>
      </div>
    );
  }

  return (
    <PracticeTable
      state={state}
      me="p1"
      you={{ name: user.trainerName, avatar: user.avatarDex }}
      opponent={opponent}
      act={act}
      error={error}
      clearError={clearError}
      thinking={thinking}
      finished={finished}
    />
  );
}
