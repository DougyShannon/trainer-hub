import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { send, useApi, type TeamSummary } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ErrorBox, Loading } from "../components/ui";
import { useBattleEngine, type BattleEngine } from "../battle/load";
import { problemsFor, useLiveBattleSocket } from "../battle/live";
import { battleFormat, type BattleFormat } from "../../shared/battle/opponents";
import { LIVE_AWAY_LIMIT_MS, type LiveBattleInfo, type LiveBattleView, type LiveClientMessage, type LiveSeat } from "../../shared/live-battle";
import { DEFAULT_STADIUM, savedStadium, stadiumById } from "../battle/stadiums";
import { teamFormatLabel } from "../teams/formats";
import { TrainerChip } from "./PlayPage";
import { BattleScreen } from "./BattleGamePage";

/** A battle against another trainer: waiting for them, then the battle itself. */
export function LiveBattlePage() {
  const { id = "" } = useParams();
  const { user, ready } = useAuth();
  const [key, setKey] = useState(0);
  const info = useApi<LiveBattleInfo>(`/api/live-battles/${id}`, { fresh: true, reloadKey: key });
  const socket = useLiveBattleSocket(info.data ? id : null, key);
  const view = socket.view;
  const format = battleFormat(view?.format ?? info.data?.format);
  const { engine, error: engineError } = useBattleEngine(format?.id ?? "gen9ou");

  useEffect(() => {
    const p = view?.players;
    document.title = p?.p2 ? `${p.p1.trainerName} vs ${p.p2.trainerName} · Trainer Hub` : "Battle a friend · Trainer Hub";
    return () => {
      document.title = "Trainer Hub";
    };
  }, [view?.players]);

  if (info.error) return <ErrorBox message="That battle doesn't exist any more. Open a new one on the Battle page." />;
  if (!ready || !info.data || !format) return <Loading />;
  if (socket.connection === "closed") {
    return (
      <div className="panel">
        <h2>This battle was closed</h2>
        <p className="muted">The trainer who opened it closed it before anyone joined.</p>
        <Link to="/battle" className="secondary-btn">
          Back to Battle
        </Link>
      </div>
    );
  }
  if (!view) return <Loading label="Connecting to the battle" />;

  if (view.status === "waiting") {
    return (
      <Waiting
        view={view}
        format={format}
        isHost={view.seat === "p1"}
        loggedIn={!!user}
        // Joining takes the empty seat; connecting again makes this browser that player.
        onJoined={() => setKey((k) => k + 1)}
      />
    );
  }
  if (engineError) return <ErrorBox message={engineError} />;
  if (!engine) return <Loading label="Getting the battle ready" />;
  return (
    <LiveBattle
      key={`${view.seat ?? "watch"}|${key}`}
      engine={engine}
      format={format}
      view={view}
      sendMessage={socket.send}
      error={socket.error}
      reconnecting={socket.connection === "reconnecting"}
    />
  );
}

function Waiting({ view, format, isHost, loggedIn, onJoined }: { view: LiveBattleView; format: BattleFormat; isHost: boolean; loggedIn: boolean; onJoined: () => void }) {
  const navigate = useNavigate();
  const host = view.players.p1;
  const teams = useApi<TeamSummary[]>(loggedIn && !isHost ? "/api/teams/mine" : null, { fresh: true });
  const myTeams = teams.data?.filter((t) => t.preview.length > 0) ?? [];
  const [teamId, setTeamId] = useState("");
  const chosen = myTeams.some((t) => t.id === teamId) ? teamId : (myTeams.find((t) => t.format === format.id)?.id ?? myTeams[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/battle/live/${view.id}`;

  const join = async () => {
    setBusy(true);
    setError(null);
    setProblems([]);
    try {
      const found = await problemsFor(chosen, format.id);
      if (found.length) {
        setProblems(found);
        return;
      }
      await send("POST", `/api/live-battles/${view.id}/join`, { teamId: chosen });
      onJoined();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!confirm("Close this battle? Nobody will be able to join it.")) return;
    try {
      await send("DELETE", `/api/live-battles/${view.id}`);
      navigate("/battle");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="panel live-waiting">
      <p className="eyebrow">
        <Link to="/battle">Battle</Link> · {format.label}
      </p>
      {isHost ? (
        <>
          <h1>Waiting for an opponent</h1>
          <p className="muted">
            Send this link to a friend. The battle starts as soon as they join with one of their teams. Keep this page open.
          </p>
          <div className="share-row">
            <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Battle link" />
            <button
              type="button"
              className="primary-btn small"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="small muted">Your team: {host.teamName}</p>
          <button type="button" className="secondary-btn small" onClick={close}>
            Close this battle
          </button>
        </>
      ) : (
        <>
          <h1>
            <TrainerChip name={host.trainerName} avatar={host.avatarDex} /> wants to battle
          </h1>
          <p className="muted">
            {format.label}: {format.blurb}
          </p>
          {!loggedIn ? (
            <p>
              <Link to={`/login?next=/battle/live/${view.id}`}>Log in</Link> or{" "}
              <Link to={`/signup?next=/battle/live/${view.id}`}>sign up</Link> to join.
            </p>
          ) : teams.loading && !teams.data ? (
            <Loading label="Loading your teams" />
          ) : !myTeams.length ? (
            <p>
              You need a team first. <Link to="/teams/new">Build one in the Team Builder</Link>, then come back to this link.
            </p>
          ) : (
            <>
              <label className="field">
                <span className="field-label">Your team</span>
                <select value={chosen} onChange={(e) => setTeamId(e.target.value)}>
                  {myTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({teamFormatLabel(t.format)})
                    </option>
                  ))}
                </select>
              </label>
              {problems.length > 0 && (
                <div className="battle-problems">
                  <p className="form-error">That team can't play {format.label}:</p>
                  <ul>
                    {problems.slice(0, 8).map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button type="button" className="primary-btn" disabled={busy || !chosen} onClick={join}>
                {busy ? "Checking your team…" : "Join the battle"}
              </button>
            </>
          )}
        </>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function LiveBattle({
  engine,
  format,
  view,
  sendMessage,
  error,
  reconnecting,
}: {
  engine: BattleEngine;
  format: BattleFormat;
  view: LiveBattleView;
  sendMessage: (msg: LiveClientMessage) => void;
  error: string | null;
  reconnecting: boolean;
}) {
  const watching = !view.seat;
  const me: LiveSeat = view.seat ?? "p1";
  const foe: LiveSeat = me === "p1" ? "p2" : "p1";
  const [state] = useState(() => {
    const session = engine.BattleSession.live(
      {
        formatid: format.id,
        p1: { name: view.players.p1.trainerName, team: [] },
        p2: { name: view.players.p2?.trainerName ?? "", team: [] },
        skill: 1,
        perspective: me,
        remote: {
          send: (choice, rqid) => sendMessage({ type: "choose", rqid, choice }),
          forfeit: () => sendMessage({ type: "forfeit" }),
          watching,
        },
      },
      view.input,
    );
    // Coming back to a battle (or watching one already going) skips straight to where it is.
    const viewer = new engine.Viewer(format.id, me);
    while (viewer.pos < session.lines.length) viewer.step(session.lines[viewer.pos]);
    return { session, viewer };
  });
  const { session, viewer } = state;
  const [stadium] = useState(() => savedStadium() || DEFAULT_STADIUM);
  const [now, setNow] = useState(Date.now());

  useEffect(() => session.apply(view.input), [session, view.input]);

  // The battle ended in this browser: tell the room so the result is saved.
  useEffect(() => {
    if (!watching && session.ended && view.status === "playing") {
      sendMessage({ type: "result", winner: (session.winner ?? "") as LiveSeat | "", turns: session.battle.turn ?? 0 });
    }
  });

  const away = view.status === "playing" && !view.online[foe] ? view.offlineSince[foe] : null;
  useEffect(() => {
    if (!away) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [away]);

  const players = view.players;
  const mine = players[me]!;
  const theirs = players[foe]!;
  const left = away ? Math.max(0, LIVE_AWAY_LIMIT_MS - (now - away)) : 0;

  const notice = (
    <>
      {reconnecting && <p className="practice-warn small">Lost connection. Reconnecting…</p>}
      {!watching && away && !session.ended && (
        <div className="practice-warn small">
          {theirs.trainerName} has lost connection.{" "}
          {left > 0 ? (
            `If they're not back in ${Math.ceil(left / 60_000)} min, you can claim the win.`
          ) : (
            <button type="button" className="primary-btn small" onClick={() => sendMessage({ type: "claim" })}>
              Claim the win
            </button>
          )}
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </>
  );

  return (
    <BattleScreen
      engine={engine}
      session={session}
      viewer={viewer}
      format={format}
      stadium={stadium}
      title={
        watching ? (
          <>
            {players.p1.trainerName} vs {players.p2?.trainerName}
          </>
        ) : (
          <>
            {mine.teamName} vs {theirs.trainerName}
          </>
        )
      }
      subtitle={`${watching ? "Watching" : `${theirs.trainerName}'s ${theirs.teamName}`} · ${stadiumById(stadium).name}`}
      foeName={theirs.trainerName}
      forfeitText={`Give up this battle? ${theirs.trainerName} wins.`}
      notice={notice}
      watching={watching}
      end={(winner) => <LiveEnd winner={winner} me={me} watching={watching} view={view} />}
    />
  );
}

function LiveEnd({ winner, me, watching, view }: { winner: string; me: LiveSeat; watching: boolean; view: LiveBattleView }) {
  const name = (seat: string) => view.players[seat as LiveSeat]?.trainerName ?? "";
  const loser = winner === "p1" ? "p2" : "p1";
  const headline =
    winner === ""
      ? "It's a draw!"
      : watching
        ? `${name(winner)} won!`
        : winner === me
          ? `You beat ${name(loser)}!`
          : `${name(winner)} won this time.`;
  const why = view.endReason === "forfeit" ? `${name(loser)} forfeited.` : view.endReason === "away" ? `${name(loser)} left the battle.` : "";
  return (
    <div className="battle-end">
      <h2>{headline}</h2>
      {why && <p className="muted">{why}</p>}
      <div className="row-actions">
        <Link to="/battle" className="primary-btn">
          Back to Battle
        </Link>
      </div>
    </div>
  );
}
