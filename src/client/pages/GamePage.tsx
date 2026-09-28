import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { send, useApi, type DeckSummary, type GameInfo } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useGameSocket } from "../lib/game";
import { FORMAT_LABELS } from "../../shared/deck-rules";
import { ErrorBox, Loading } from "../components/ui";
import { GameTable } from "../components/GameTable";
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
      {view.status !== "waiting" ? (
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
          You don't have a legal {FORMAT_LABELS[game.format]} deck yet. <Link to="/decks/new">Build one</Link>, then come back to
          this link.
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
