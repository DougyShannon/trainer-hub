import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { send, useApi, type DeckSummary, type GameInfo } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useGameSocket } from "../lib/game";
import { FORMAT_LABELS } from "../../shared/deck-rules";
import { ErrorBox, Loading } from "../components/ui";
import { GameTable } from "../components/GameTable";
import { PracticeTable } from "../components/PracticeTable";
import { useBoardPrefs } from "../boards/prefs";
import type { GameView } from "../../shared/game-types";
import type { PAction } from "../../shared/practice/types";
import { VenueFrame } from "../components/Venue";
import { NotFoundPage } from "./NotFoundPage";
import { TrainerChip } from "./PlayPage";

export function GamePage() {
  const { id = "" } = useParams();
  const { user, ready } = useAuth();
  // Bumped after joining so the connection reopens as a player rather than a spectator.
  const [seatKey, setSeatKey] = useState(0);
  const info = useApi<GameInfo>(`/api/games/${id}`, { fresh: true, reloadKey: seatKey });
  const socket = useGameSocket(ready && info.data ? id : null, seatKey);
  const { view } = socket;

  useEffect(() => {
    document.title = "Game · Trainer Hub";
    return () => {
      document.title = "Trainer Hub";
    };
  }, []);

  if (info.error === "Game not found" || socket.connection === "closed") return <NotFoundPage what="game" />;
  if (info.error) return <ErrorBox message={info.error} />;
  if (!info.data || !view) return <Loading label="Joining the table" />;

  return (
    <VenueFrame id={info.data.venue}>
      {view.status !== "waiting" && view.rules ? (
        <RulesGame view={view} act={socket.act} error={socket.error} clearError={socket.clearError} connection={socket.connection} />
      ) : view.status !== "waiting" ? (
        <GameTable {...socket} view={view} />
      ) : info.data.role === "host" ? (
        <WaitingRoom game={info.data} />
      ) : (
        <JoinTable game={info.data} loggedIn={!!user} onJoined={() => setSeatKey((k) => k + 1)} />
      )}
    </VenueFrame>
  );
}

function WaitingRoom({ game }: { game: GameInfo }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = `${location.origin}/play/${game.id}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Select the link and copy it yourself.");
    }
  };
  const cancel = async () => {
    try {
      await send("DELETE", `/api/games/${game.id}`);
      navigate("/play");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="waiting-room panel">
      <span className="spinner" aria-hidden="true" />
      <h1>Waiting for an opponent</h1>
      <p>
        You're playing <strong>{game.host.deckName}</strong> ({FORMAT_LABELS[game.format]}).{" "}
        {game.isOpen ? "Your table is listed in the lobby. You can also send this link to a friend:" : "Send this link to a friend so they can join:"}
      </p>
      <div className="share-row">
        <input readOnly value={link} aria-label="Game link" onFocus={(e) => e.target.select()} />
        <button type="button" className="primary-btn" onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <p className="muted small">The game starts on its own as soon as someone joins. Keep this page open.</p>
      {error && <p className="form-error">{error}</p>}
      <button type="button" className="secondary-btn" onClick={cancel}>
        Close this table
      </button>
    </div>
  );
}

function JoinTable({ game, loggedIn, onJoined }: { game: GameInfo; loggedIn: boolean; onJoined: () => void }) {
  const decks = useApi<DeckSummary[]>(loggedIn ? "/api/decks/mine" : null, { fresh: true });
  const playable = decks.data?.filter((d) => d.isValid && d.format === game.format) ?? [];
  const [deckId, setDeckId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = deckId || playable[0]?.id || "";

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      await send("POST", `/api/games/${game.id}/join`, { deckId: chosen });
      onJoined();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="waiting-room panel">
      <p className="eyebrow">Challenge</p>
      <h1>
        <TrainerChip name={game.host.trainerName} avatar={game.host.avatarDex} /> wants to play
      </h1>
      <p>
        {FORMAT_LABELS[game.format]} format. You'll need a legal {FORMAT_LABELS[game.format]} deck.
      </p>
      {!loggedIn ? (
        <p>
          <Link to={`/login?next=/play/${game.id}`} className="primary-btn">
            Log in to join
          </Link>{" "}
          or <Link to={`/signup?next=/play/${game.id}`}>make an account</Link>.
        </p>
      ) : decks.loading && !decks.data ? (
        <Loading label="Loading your decks" />
      ) : !playable.length ? (
        <p>
          You don't have a legal {FORMAT_LABELS[game.format]} deck yet. <Link to="/decks/new">Build one</Link>, then come back to this link.
        </p>
      ) : (
        <>
          <label className="field">
            <span>Your deck</span>
            <select value={chosen} onChange={(e) => setDeckId(e.target.value)}>
              {playable.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="button" className="primary-btn" disabled={busy} onClick={join}>
            {busy ? "Joining…" : "Join the game"}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * A live game on the rules engine: the same table as practice games, with moves sent to the game
 * room. The room checks every move, so it's always the table the other player sees too.
 */
function RulesGame({
  view,
  act,
  error,
  clearError,
  connection,
}: {
  view: GameView;
  act: ReturnType<typeof useGameSocket>["act"];
  error: string | null;
  clearError: () => void;
  connection: ReturnType<typeof useGameSocket>["connection"];
}) {
  const state = view.rules!;
  // Spectators watch from the host's side.
  const me = view.you ?? "p1";
  const opp = me === "p1" ? "p2" : "p1";
  const mine = view.players[me]!;
  const theirs = view.players[opp]!;
  const prefs = useBoardPrefs();

  // Each player's mat choice travels with the game, so both see the same two mats.
  useEffect(() => {
    if (view.you && connection === "open" && mine.mat !== prefs.mat) act({ type: "mat", id: prefs.mat });
  }, [view.you, connection, prefs.mat, mine.mat, act]);

  const move = useCallback((action: PAction) => (view.you ? act({ type: "rules", action }) : undefined), [act, view.you]);
  const theirMove = state.status !== "finished" && (state.prompt ? state.prompt.seat === opp : state.status === "playing" && state.current === opp);

  let banner = null;
  if (state.status === "finished") {
    const won = view.you && state.winner === view.you;
    banner = (
      <div className={`banner ${won ? "done" : ""} practice-result`}>
        <strong>{!view.you ? `${view.players[state.winner ?? "p1"]?.trainerName} wins.` : won ? "You win!" : `${theirs.trainerName} wins this time.`}</strong>
        <span>{state.endReason}</span>
        <span className="banner-actions">
          <Link to="/play" className="primary-btn small">
            Back to Play
          </Link>
        </span>
      </div>
    );
  } else if (view.canClaimWin) {
    banner = (
      <div className="banner practice-result">
        <strong>{theirs.trainerName} has left the game.</strong>
        <span className="banner-actions">
          <button type="button" className="primary-btn small" onClick={() => act({ type: "claimWin" })}>
            Claim the win
          </button>
        </span>
      </div>
    );
  } else if (view.you && !theirs.online) {
    banner = (
      <div className="banner practice-result">
        <span>{theirs.trainerName} has lost connection. If they don't come back in a few minutes you can claim the win.</span>
      </div>
    );
  }

  return (
    <>
      {connection === "reconnecting" && <p className="banner">Reconnecting…</p>}
      <PracticeTable
        state={state}
        me={me}
        you={{ name: mine.trainerName, avatar: mine.avatarDex }}
        opponent={{ name: theirs.trainerName, title: theirs.deckName, ace: theirs.avatarDex, mat: theirs.mat }}
        act={move}
        error={error}
        clearError={clearError}
        thinking={theirMove}
        thinkingText={`Waiting for ${theirs.trainerName}…`}
        finished={banner}
      />
      <LiveChat view={view} act={act} />
    </>
  );
}

/** Chat between the players (and what the table says about connections). */
function LiveChat({ view, act }: { view: GameView; act: ReturnType<typeof useGameSocket>["act"] }) {
  const [text, setText] = useState("");
  const lines = view.log
    .filter((l) => l.kind === "chat" || l.kind === "system")
    .slice(-30)
    .reverse();
  return (
    <section className="panel live-chat" aria-label="Chat">
      <h2 className="small">Chat</h2>
      {view.you && (
        <form
          className="chat-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            act({ type: "chat", text });
            setText("");
          }}
        >
          <label htmlFor="live-chat" className="sr-only">
            Message
          </label>
          <input id="live-chat" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="Say something…" autoComplete="off" />
          <button type="submit" className="secondary-btn small">
            Send
          </button>
        </form>
      )}
      <ul className="chat-lines">
        {lines.map((l) => (
          <li key={l.n} className={l.kind === "system" ? "muted small" : "small"}>
            {l.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
