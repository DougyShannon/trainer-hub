import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { send, useApi, type Me, type TeamDetail } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ErrorBox, Loading } from "../components/ui";
import { useBattleEngine, type BattleEngine } from "../battle/load";
import type { BattleSession, Estimate, Lab, LogEntry, Request, Viewer, Anim } from "../battle/engine";
import { BATTLE_OPPONENTS, battleFormat, battleOpponent, opponentTeam, LOAN_TEAMS, type BattleFormat, type BattleOpponent } from "../../shared/battle/opponents";
import { stadiumById } from "../battle/stadiums";
import { FieldMon, HpBox, ShowdownSprite, StadiumBackdrop, type ShownMon } from "../components/battle/Scene";
import { CalcCard, RESIDUAL_HINTS } from "../components/battle/CalcCard";
import { savedBattleKey } from "./BattlePage";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Saved = { inputLog: string[]; stadium: string; teamName: string; recorded: boolean };
type Speed = "normal" | "fast" | "instant";
const SPEED_KEY = "trainer-hub:battle-speed";

const readSaved = (key: string): Saved | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
};
const writeSaved = (key: string, saved: Saved | null) => {
  try {
    if (saved) localStorage.setItem(key, JSON.stringify(saved));
    else localStorage.removeItem(key);
  } catch {
    // Storage full or blocked: the battle just can't be carried on later.
  }
};

export function BattleGamePage() {
  const { opponent: opponentId = "" } = useParams();
  const [params] = useSearchParams();
  const { user, ready } = useAuth();
  const opponent = battleOpponent(opponentId);
  const format = battleFormat(params.get("format"));
  const teamId = params.get("team") ?? "";
  const { engine, error: engineError } = useBattleEngine();
  const loan = LOAN_TEAMS.find((l) => l.id === teamId);
  const team = useApi<TeamDetail>(user && teamId && !loan ? `/api/teams/${teamId}` : null, { fresh: true });
  const [round, setRound] = useState(0);

  useEffect(() => {
    document.title = opponent ? `Battle vs ${opponent.name} · Trainer Hub` : "Battle · Trainer Hub";
    return () => {
      document.title = "Trainer Hub";
    };
  }, [opponent]);

  if (!opponent || !format) return <ErrorBox message="That battle doesn't exist. Pick an opponent on the Battle page." />;
  if (!ready) return <Loading />;
  if (!user) {
    return (
      <p className="panel">
        <Link to="/login?next=/battle">Log in</Link> to battle.
      </p>
    );
  }
  if (engineError) return <ErrorBox message={engineError} />;
  if (team.error) return <ErrorBox message={team.error} />;
  if (!engine || (!loan && !team.data)) return <Loading label="Getting the battle ready" />;

  const loanFrom = loan ? battleOpponent(loan.from) : null;
  const sets: object[] = loanFrom ? engine.importTeam(opponentTeam(loanFrom, format.id)) : (team.data?.sets ?? []).map(cleanForSim);
  const teamName = loan ? loan.name : (team.data?.name ?? "Your team");
  const stadium = params.get("stadium") || opponent.stadium;

  return (
    <BattleGame
      key={`${opponent.id}|${format.id}|${teamId}|${round}`}
      engine={engine}
      user={user}
      opponent={opponent}
      format={format}
      sets={sets}
      teamName={teamName}
      stadium={stadium}
      onRematch={() => setRound((r) => r + 1)}
    />
  );
}

/** Team Builder sets in the simulator's shape (blank moves dropped). */
function cleanForSim(set: TeamDetail["sets"][number]) {
  return {
    ...set,
    moves: set.moves.filter(Boolean),
    gender: set.gender || undefined,
    teraType: set.teraType || undefined,
    name: set.name || set.species,
  };
}

const VOLATILE_LABEL: Record<string, string> = {
  substitute: "Substitute",
  confusion: "Confused",
  leechseed: "Seeded",
  taunt: "Taunted",
  encore: "Encore",
  attract: "In love",
  yawn: "Drowsy",
  perishsong: "Perish count",
  saltcure: "Salt Cure",
  protect: "Protected",
  focusenergy: "Pumped",
  partiallytrapped: "Trapped",
  disable: "Disabled",
  tarshot: "Tar Shot",
  charge: "Charged",
};
const SIDE_LABEL: Record<string, string> = {
  stealthrock: "Stealth Rock",
  spikes: "Spikes",
  toxicspikes: "Toxic Spikes",
  stickyweb: "Sticky Web",
  reflect: "Reflect",
  lightscreen: "Light Screen",
  auroraveil: "Aurora Veil",
  tailwind: "Tailwind",
  safeguard: "Safeguard",
  mist: "Mist",
};
const WEATHER_LABEL: Record<string, string> = {
  RainDance: "Rain",
  SunnyDay: "Harsh sunlight",
  Sandstorm: "Sandstorm",
  Snowscape: "Snow",
  Snow: "Snow",
  DesolateLand: "Extremely harsh sunlight",
  PrimordialSea: "Heavy rain",
  DeltaStream: "Strong winds",
};

function BattleGame({
  engine,
  user,
  opponent,
  format,
  sets,
  teamName,
  stadium,
  onRematch,
}: {
  engine: BattleEngine;
  user: Me;
  opponent: BattleOpponent;
  format: BattleFormat;
  sets: object[];
  teamName: string;
  stadium: string;
  onRematch: () => void;
}) {
  const storeKey = savedBattleKey(user.trainerName, format.id, opponent.id);
  const [state] = useState(() => {
    const saved = readSaved(storeKey);
    const setup = {
      formatid: format.id,
      p1: { name: user.trainerName, team: sets },
      p2: { name: opponent.name, team: engine.importTeam(opponentTeam(opponent, format.id)) },
      skill: opponent.skill,
    };
    if (saved) {
      try {
        const session = engine.BattleSession.resume(setup, saved.inputLog);
        const viewer = new engine.Viewer();
        while (viewer.pos < session.lines.length) viewer.step(session.lines[viewer.pos]);
        return { session, viewer, saved, problems: [] as string[] };
      } catch (e) {
        console.error("Couldn't carry on the saved battle", e);
      }
    }
    const problems = engine.checkTeam(format.id, sets);
    if (problems.length) return { session: null, viewer: null, saved: null, problems };
    const session = engine.BattleSession.start(setup);
    return { session, viewer: new engine.Viewer(), saved: null, problems };
  });

  if (!state.session || !state.viewer) {
    return (
      <div className="panel battle-problems">
        <h2>{teamName} can't play {format.label}</h2>
        <ul>
          {state.problems.slice(0, 12).map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
        <p className="muted">
          Fix the team in the <Link to="/teams">Team Builder</Link>, pick another format (Wild Singles and Wild Doubles allow
          anything), or use a loan team.
        </p>
        <Link to="/battle" className="secondary-btn">
          Back to Battle
        </Link>
      </div>
    );
  }
  return (
    <BattleScreen
      engine={engine}
      session={state.session}
      viewer={state.viewer}
      storeKey={storeKey}
      initialSaved={state.saved}
      opponent={opponent}
      format={format}
      teamName={teamName}
      stadium={state.saved?.stadium ?? stadium}
      onRematch={() => {
        writeSaved(storeKey, null);
        onRematch();
      }}
    />
  );
}

function BattleScreen({
  engine,
  session,
  viewer,
  storeKey,
  initialSaved,
  opponent,
  format,
  teamName,
  stadium,
  onRematch,
}: {
  engine: BattleEngine;
  session: BattleSession;
  viewer: Viewer;
  storeKey: string;
  initialSaved: Saved | null;
  opponent: BattleOpponent;
  format: BattleFormat;
  teamName: string;
  stadium: string;
  onRematch: () => void;
}) {
  const [version, setVersion] = useState(0);
  const [tick, setTick] = useState(0);
  const [speed, setSpeedState] = useState<Speed>(() => {
    try {
      const s = localStorage.getItem(SPEED_KEY);
      return s === "fast" || s === "instant" ? s : "normal";
    } catch {
      return "normal";
    }
  });
  const anims = useRef<Record<string, Anim & { n: number }>>({});
  const animN = useRef(0);
  const recorded = useRef(initialSaved?.recorded ?? false);
  const [openCalcs, setOpenCalcs] = useState<Set<number>>(new Set());

  const setSpeed = (s: Speed) => {
    setSpeedState(s);
    try {
      localStorage.setItem(SPEED_KEY, s);
    } catch {
      // Not remembered.
    }
  };

  useEffect(() => session.subscribe(() => setVersion((v) => v + 1)), [session]);

  const busy = viewer.pos < session.lines.length;

  // Play the log a line at a time, pausing so moves, damage and fainting can be seen.
  useEffect(() => {
    if (viewer.pos >= session.lines.length) {
      // Caught up since the last render (for example the lines needed no pause): show the result.
      if (busy) setTick((x) => x + 1);
      return;
    }
    const mult = speed === "fast" ? 0.4 : speed === "instant" ? 0 : 1;
    let delay = 0;
    while (viewer.pos < session.lines.length) {
      const r = viewer.step(session.lines[viewer.pos]);
      if (r.anim && mult > 0) anims.current = { ...anims.current, [r.anim.at]: { ...r.anim, n: ++animN.current } };
      delay = r.delay * mult;
      if (delay > 0) break;
    }
    const t = setTimeout(() => setTick((x) => x + 1), delay);
    return () => clearTimeout(t);
  }, [tick, version, speed, session, viewer, busy]);

  // Save after every choice so the battle can be carried on later.
  useEffect(() => {
    if (session.ended) return;
    writeSaved(storeKey, { inputLog: session.inputLog, stadium, teamName, recorded: false });
  }, [version, session, storeKey, stadium, teamName]);

  const winner = !busy ? session.winner : null;

  // Record the result once, when the battle has finished playing out.
  useEffect(() => {
    if (winner === null || recorded.current) return;
    recorded.current = true;
    writeSaved(storeKey, null);
    void send("POST", "/api/battle/result", { opponent: opponent.id, format: format.id, won: winner === "p1" }).catch(() => {});
  }, [winner, storeKey, opponent.id, format.id]);

  const client = viewer.client;
  const req = session.request as Request | null;
  const showControls = !busy && !session.ended && !!req && !req.wait;
  const lab = useMemo(() => (showControls && req?.active ? new engine.Lab(session.battle) : null), [showControls, req, engine, session]);

  const toShown = (p: any, exact: boolean): ShownMon | null => {
    if (!p) return null;
    return {
      key: p.originalIdent ?? p.ident ?? p.name,
      species: p.speciesForme,
      num: engine.spriteFor(p.speciesForme),
      name: p.name,
      level: p.level,
      gender: p.gender ?? "",
      shiny: !!p.shiny,
      hp: p.hp,
      maxhp: p.maxhp,
      status: p.status ?? "",
      fainted: !!p.fainted || p.hp <= 0,
      tera: p.terastallized ?? "",
      boosts: Object.entries(p.boosts ?? {}).filter(([, v]) => v) as [string, number][],
      volatiles: Object.keys(p.volatiles ?? {})
        .map((v) => VOLATILE_LABEL[v])
        .filter(Boolean),
      exact,
    };
  };

  const doubles = format.doubles;
  const slots = doubles ? [0, 1] : [0];
  const mine = slots.map((i) => toShown(client.p1?.active?.[i], true));
  const foes = slots.map((i) => toShown(client.p2?.active?.[i], false));
  const field = client.field;
  const weather = field?.weather ? (WEATHER_LABEL[field.weather] ?? field.weather) : "";
  const terrain = field?.terrain ? String(field.terrain).replace(/([a-z])([A-Z])/g, "$1 $2") : "";
  const pseudo = Object.keys(field?.pseudoWeather ?? {}).map((k) => (k === "trickroom" ? "Trick Room" : k === "gravity" ? "Gravity" : k));
  const sideConds = (s: any) =>
    Object.entries(s?.sideConditions ?? {}).map(([id, c]: [string, any]) => `${SIDE_LABEL[id] ?? c?.name ?? id}${c?.level > 1 ? ` ×${c.level}` : ""}`);
  const venue = stadiumById(stadium);

  const turns = useMemo(() => groupByTurn(viewer.entries), [viewer.entries.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (choice: string) => {
    session.choose(choice);
  };

  return (
    <div className="battle-page">
      <div className="battle-head">
        <div>
          <p className="eyebrow">
            <Link to="/battle">Battle</Link> · {format.label}
          </p>
          <h1>
            {teamName} vs {opponent.name}
          </h1>
          <p className="small muted">
            {opponent.title} · {venue.name} · Turn {viewer.turn}
          </p>
        </div>
        <div className="row-actions">
          <div className="speed-pick" role="radiogroup" aria-label="Battle speed">
            {(["normal", "fast", "instant"] as Speed[]).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={speed === s} className={`chip${speed === s ? " on" : ""}`} onClick={() => setSpeed(s)}>
                {s === "normal" ? "Normal" : s === "fast" ? "Fast" : "Instant"}
              </button>
            ))}
          </div>
          {!session.ended && (
            <button
              type="button"
              className="secondary-btn small"
              onClick={() => {
                if (confirm("Give up this battle? It counts as a loss.")) session.forfeit();
              }}
            >
              Forfeit
            </button>
          )}
        </div>
      </div>

      <div className={`battle-scene${doubles ? " doubles" : ""}`}>
        <StadiumBackdrop id={venue.id} />
        {weather && <div className="weather-fx" data-weather={field.weather} aria-hidden="true" />}
        <div className="scene-tags">
          {weather && <span className="field-tag">{weather}</span>}
          {terrain && <span className="field-tag">{terrain}</span>}
          {pseudo.map((p) => (
            <span key={p} className="field-tag">
              {p}
            </span>
          ))}
        </div>
        <div className="foe-side">
          <div className="hp-boxes">{foes.map((m, i) => m && <HpBox key={i} mon={m} side="foe" />)}</div>
          <div className="field-row">
            {foes.map((m, i) => (
              <FieldMon key={i} mon={m} side="foe" anim={anims.current[`p2${"ab"[i]}`]} />
            ))}
          </div>
          <SideTags items={sideConds(client.p2)} />
        </div>
        <div className="my-side">
          <div className="field-row">
            {mine.map((m, i) => (
              <FieldMon key={i} mon={m} side="mine" anim={anims.current[`p1${"ab"[i]}`]} />
            ))}
          </div>
          <div className="hp-boxes">{mine.map((m, i) => m && <HpBox key={i} mon={m} side="mine" />)}</div>
          <SideTags items={sideConds(client.p1)} />
        </div>
        <TeamBalls side={client.p1} className="balls-mine" />
        <TeamBalls side={client.p2} className="balls-foe" />
      </div>

      <div className="battle-bottom">
        <section className="panel battle-controls" aria-live="polite">
          {winner !== null ? (
            <EndPanel winner={winner} opponent={opponent} format={format} onRematch={onRematch} />
          ) : session.ended || busy ? (
            <p className="muted">{busy ? "…" : "The battle is over."}</p>
          ) : !req || req.wait ? (
            <p className="muted">Waiting for {opponent.name}…</p>
          ) : (
            <Controls key={`${req.rqid ?? 0}-${version}`} engine={engine} req={req} lab={lab} doubles={doubles} session={session} onChoose={choose} />
          )}
          {session.error && <p className="error small">{session.error}</p>}
        </section>

        <section className="panel battle-log" aria-label="Battle log">
          <h2>Battle log</h2>
          {turns.length === 0 && <p className="muted small">The battle is about to start.</p>}
          {[...turns].reverse().map((t) => (
            <div key={t.turn} className="log-turn">
              <h3>{t.turn === 0 ? "Start" : `Turn ${t.turn}`}</h3>
              {t.entries.map((e) => (
                <Fragment key={e.id}>
                  <p className={`log-line ${e.kind}`}>
                    <LogText text={e.text} />
                    {e.from && RESIDUAL_HINTS[e.from] && <span className="log-hint">{RESIDUAL_HINTS[e.from]}</span>}
                    {e.calcs.length > 0 && (
                      <button
                        type="button"
                        className="link-btn small"
                        onClick={() =>
                          setOpenCalcs((s) => {
                            const n = new Set(s);
                            if (n.has(e.id)) n.delete(e.id);
                            else n.add(e.id);
                            return n;
                          })
                        }
                      >
                        {openCalcs.has(e.id) ? "Hide the maths" : "Show the maths"}
                      </button>
                    )}
                  </p>
                  {openCalcs.has(e.id) && (
                    <div className="calc-list">
                      {e.calcs.map((n) => session.calcs[n] && <CalcCard key={n} calc={session.calcs[n]} />)}
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function groupByTurn(entries: LogEntry[]) {
  const out: { turn: number; entries: LogEntry[] }[] = [];
  for (const e of entries) {
    if (e.kind === "turn") continue;
    const last = out[out.length - 1];
    if (last && last.turn === e.turn) last.entries.push(e);
    else out.push({ turn: e.turn, entries: [e] });
  }
  return out;
}

/** Showdown's log text: **bold** words, and ||exact HP||percentage|| pairs. */
function LogText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\|\|[^|]*\|\|[^|]*\|\|)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("||")) {
          const [, exact, pct] = p.split("||");
          return (
            <abbr key={i} title={exact}>
              {pct}
            </abbr>
          );
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

function SideTags({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="side-tags">
      {items.map((t) => (
        <span key={t} className="field-tag small">
          {t}
        </span>
      ))}
    </div>
  );
}

function TeamBalls({ side, className }: { side: any; className: string }) {
  if (!side) return null;
  const team: any[] = side.team ?? [];
  const total = Math.max(side.totalPokemon ?? team.length, team.length);
  return (
    <div className={`team-balls ${className}`} aria-label={`${side.name}'s team`}>
      {Array.from({ length: total }, (_, i) => {
        const p = team[i];
        const state = !p ? "unknown" : p.fainted || p.hp <= 0 ? "fainted" : p.status ? "status" : "ok";
        return <span key={i} className={`ball ${state}`} title={p ? `${p.name}${p.fainted ? " (fainted)" : ""}` : "Not seen yet"} />;
      })}
    </div>
  );
}

function EndPanel({ winner, opponent, format, onRematch }: { winner: string; opponent: BattleOpponent; format: BattleFormat; onRematch: () => void }) {
  const next = BATTLE_OPPONENTS.find((o) => o.level === opponent.level + 1);
  const won = winner === "p1";
  return (
    <div className="battle-end">
      <h2>{won ? `You beat ${opponent.name}!` : winner === "" ? "It's a draw!" : `${opponent.name} won this time.`}</h2>
      <p className="muted">
        {won
          ? next
            ? `${next.name} is now unlocked in ${format.label}.`
            : "You've beaten every opponent in this format. Try another format!"
          : "Have a look through the log and the maths, change your team or your plan, and try again."}
      </p>
      <div className="row-actions">
        <button type="button" className="primary-btn" onClick={onRematch}>
          Rematch
        </button>
        {won && next && (
          <Link to={`/battle?format=${format.id}`} className="secondary-btn">
            Next opponent
          </Link>
        )}
        <Link to="/battle" className="secondary-btn">
          Back to Battle
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Choosing moves, switches and leads

const TARGETED = new Set(["normal", "any", "adjacentFoe", "adjacentAlly", "adjacentAllyOrSelf"]);
const SPREAD = new Set(["allAdjacentFoes", "allAdjacent"]);
const STATUS_SHORT: Record<string, string> = { brn: "BRN", par: "PAR", psn: "PSN", tox: "TOX", slp: "SLP", frz: "FRZ" };

const isFainted = (condition: string) => condition.endsWith(" fnt") || condition.startsWith("0");
const hpText = (condition: string) => condition.split(" ")[0];
const speciesOf = (details: string) => details.split(",")[0];
const nameOf = (ident: string) => ident.slice(ident.indexOf(":") + 1).trim();

function Controls({
  engine,
  req,
  lab,
  doubles,
  session,
  onChoose,
}: {
  engine: BattleEngine;
  req: Request;
  lab: Lab | null;
  doubles: boolean;
  session: BattleSession;
  onChoose: (choice: string) => void;
}) {
  const [picks, setPicks] = useState<string[]>([]);
  const [pending, setPending] = useState<{ move: number; tera: boolean } | null>(null);
  const [tera, setTera] = useState(false);
  const sent = useRef(false);
  const party = req.side.pokemon;
  const activeCount = doubles ? 2 : 1;

  // Pokémon to switch in, leaving out ones already picked this turn.
  const benchFor = (slot: number, chosen: string[]) => {
    const taken = new Set(chosen.filter((p) => p.startsWith("switch")).map((p) => Number(p.split(" ")[1]) - 1));
    const reviving = !!req.forceSwitch && party[slot]?.reviving;
    return party
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i >= activeCount && !taken.has(i) && (reviving ? isFainted(p.condition) : !isFainted(p.condition)));
  };
  const total = req.teamPreview ? 0 : (req.forceSwitch?.length ?? req.active?.length ?? 0);
  // Slots with nothing to choose (no Pokémon there, or nothing to switch to) pass automatically.
  const needsPass = (slot: number, chosen: string[]) => {
    if (req.forceSwitch) return !req.forceSwitch[slot] || !benchFor(slot, chosen).length;
    const me = party[slot];
    return !me || !req.active?.[slot] || isFainted(me.condition) || !!(me as any).commanding;
  };
  const filled = [...picks];
  while (filled.length < total && needsPass(filled.length, filled)) filled.push("pass");
  const done = total > 0 && filled.length >= total;

  useEffect(() => {
    if (done && !sent.current) {
      sent.current = true;
      onChoose(filled.join(", "));
    }
  });

  const pick = (choice: string) => {
    setPicks([...picks, ...filled.slice(picks.length), choice]);
    setPending(null);
    setTera(false);
  };

  // ---- Team preview ----
  if (req.teamPreview) {
    return <TeamPreview engine={engine} req={req} doubles={doubles} session={session} onChoose={onChoose} />;
  }
  if (done) return <p className="muted">…</p>;

  // ---- Switching in after a faint ----
  if (req.forceSwitch) {
    const slot = filled.length;
    const reviving = party[slot]?.reviving;
    return (
      <div className="choose">
        <h2>{reviving ? "Who should Revival Blessing bring back?" : "Choose your next Pokémon"}</h2>
        <PartyButtons engine={engine} options={benchFor(slot, filled)} onPick={(i) => pick(`switch ${i + 1}`)} />
      </div>
    );
  }

  if (!req.active) return null;
  const slot = filled.length;
  const me = party[slot];
  const active = req.active[slot];
  if (!me || !active) return null;
  const teraUsed = filled.some((p) => p.includes("terastallize"));
  const canTera = !!active.canTerastallize && !teraUsed;
  const bench = benchFor(slot, filled);
  const battle = session.battle;
  const foeActive: any[] = battle.sides[1].active;

  const est = (moveId: string, foeSlot: number, target: string, withTera: boolean): Estimate | null => {
    if (!lab) return null;
    const foe = foeActive[foeSlot];
    if (!foe || foe.fainted) return null;
    const foesUp = foeActive.filter((f) => f && !f.fainted).length;
    return lab.damage(
      { side: 0, index: slot },
      { side: 1, index: battle.sides[1].pokemon.indexOf(foe) },
      moveId,
      { tera: withTera, spread: doubles && SPREAD.has(target) && foesUp > 1 },
    );
  };

  if (pending) {
    const m = active.moves[pending.move];
    const targets: { label: string; n: number; species?: string }[] = [];
    foeActive.forEach((f, k) => {
      if (f && !f.fainted && m.target !== "adjacentAlly") targets.push({ label: f.name, n: k + 1, species: f.species.name });
    });
    if (["normal", "any", "adjacentAlly", "adjacentAllyOrSelf"].includes(m.target)) {
      const allySlot = slot ^ 1;
      const ally = battle.sides[0].active[allySlot];
      if (ally && !ally.fainted) targets.push({ label: `${ally.name} (your partner)`, n: -(allySlot + 1), species: ally.species.name });
    }
    return (
      <div className="choose">
        <h2>Use {m.move} on…</h2>
        <div className="target-grid">
          {targets.map((t) => (
            <button key={t.n} type="button" className="target-btn" onClick={() => pick(`move ${pending.move + 1} ${t.n}${pending.tera ? " terastallize" : ""}`)}>
              {t.species && <ShowdownSprite species={t.species} size={56} still />}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="link-btn" onClick={() => setPending(null)}>
          Back
        </button>
      </div>
    );
  }

  const mySpeed = lab?.speed({ side: 0, index: slot });
  const speedInfo = lab
    ? foeActive
        .map((f) => {
          if (!f || f.fainted) return null;
          const theirs = lab.speed({ side: 1, index: battle.sides[1].pokemon.indexOf(f) });
          const tr = lab.trickRoom;
          const first = mySpeed! === theirs ? "speed tie: a coin flip decides" : (mySpeed! > theirs) !== tr ? "you move first" : "they move first";
          return `${f.name} ${theirs}: ${first}${tr ? " (Trick Room: slower goes first)" : ""}`;
        })
        .filter(Boolean)
    : [];

  return (
    <div className="choose">
      <div className="choose-head">
        <h2>What will {nameOf(me.ident)} do?</h2>
        {picks.length > 0 && (
          <button type="button" className="link-btn" onClick={() => setPicks(picks.slice(0, -1))}>
            Back
          </button>
        )}
      </div>
      {speedInfo.length > 0 && (
        <p className="small muted speed-line">
          Speed {mySpeed} vs {speedInfo.join(" · ")}. Priority moves go before Speed is compared.
        </p>
      )}
      <div className="move-grid">
        {active.moves.map((m, j) => {
          const move = battle.dex.moves.get(m.id);
          const usable = !m.disabled && (m.pp > 0 || !m.maxpp);
          const estimates = move && move.category !== "Status" ? foeActive.map((_, k) => ({ k, e: est(m.id, k, m.target, tera && canTera) })).filter((x) => x.e) : [];
          const type = (estimates[0]?.e?.moveType ?? move?.type ?? "Normal").toLowerCase();
          return (
            <button
              key={m.id + j}
              type="button"
              className={`move-btn type-${type}`}
              disabled={!usable}
              title={move?.shortDesc || move?.desc || ""}
              onClick={() => {
                if (doubles && TARGETED.has(m.target)) setPending({ move: j, tera: tera && canTera });
                else pick(`move ${j + 1}${tera && canTera ? " terastallize" : ""}`);
              }}
            >
              <span className="move-name">{m.move}</span>
              <span className="move-meta">
                <span>{estimates[0]?.e?.moveType ?? move?.type}</span>
                <span>{move?.category}</span>
                {move && move.category !== "Status" && <span>Power {move.basePower || "–"}</span>}
                {move && <span>{move.accuracy === true ? "Never misses" : `${move.accuracy}%`}</span>}
                {m.maxpp ? (
                  <span>
                    PP {m.pp}/{m.maxpp}
                  </span>
                ) : null}
              </span>
              {estimates.map(({ k, e }) => (
                <span key={k} className="move-est">
                  {doubles && <span className="muted">{foeActive[k]?.name}: </span>}
                  {e!.immune ? (
                    "No effect"
                  ) : (
                    <>
                      {pct(e!.min, foeActive[k])}–{pct(e!.max, foeActive[k])}%
                      {e!.hits[1] > 1 && <> per hit ×{e!.hits[0] === e!.hits[1] ? e!.hits[0] : `${e!.hits[0]}–${e!.hits[1]}`}</>}
                      {e!.min * e!.hits[0] >= foeActive[k].hp ? <b> KO</b> : e!.max * e!.hits[1] >= foeActive[k].hp ? <b> could KO</b> : null}
                      {e!.accuracy !== true && e!.accuracy !== move?.accuracy && <span className="muted"> · hits {e!.accuracy}%</span>}
                    </>
                  )}
                </span>
              ))}
            </button>
          );
        })}
      </div>
      <div className="choose-foot">
        {canTera && (
          <label className="tera-toggle">
            <input type="checkbox" checked={tera} onChange={(e) => setTera(e.target.checked)} />
            Terastallize to {active.canTerastallize} type
          </label>
        )}
        {active.trapped && <span className="small muted">{nameOf(me.ident)} can't switch out.</span>}
      </div>
      {!active.trapped && bench.length > 0 && (
        <>
          <h3 className="switch-head">Switch to</h3>
          <PartyButtons engine={engine} options={bench} onPick={(i) => pick(`switch ${i + 1}`)} />
        </>
      )}
    </div>
  );
}

const pct = (dmg: number, foe: any) => (foe?.maxhp ? Math.round((dmg / foe.maxhp) * 1000) / 10 : 0);

function PartyButtons({ engine, options, onPick }: { engine: BattleEngine; options: { p: Request["side"]["pokemon"][number]; i: number }[]; onPick: (i: number) => void }) {
  return (
    <div className="party-grid">
      {options.map(({ p, i }) => {
        const species = speciesOf(p.details);
        const status = p.condition.split(" ")[1];
        return (
          <button key={i} type="button" className="party-btn" onClick={() => onPick(i)}>
            <ShowdownSprite species={species} num={engine.spriteFor(species)} size={48} still />
            <span className="party-name">{nameOf(p.ident)}</span>
            <span className="small muted">
              {isFainted(p.condition) ? "Fainted" : `HP ${hpText(p.condition)}`}
              {status && status !== "fnt" ? ` · ${STATUS_SHORT[status] ?? status}` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TeamPreview({ engine, req, doubles, session, onChoose }: { engine: BattleEngine; req: Request; doubles: boolean; session: BattleSession; onChoose: (c: string) => void }) {
  const [order, setOrder] = useState<number[]>([]);
  const party = req.side.pokemon;
  const need = Math.min(req.maxChosenTeamSize ?? party.length, party.length);
  const leads = doubles ? 2 : 1;
  const min = need < party.length ? need : Math.min(leads, party.length);
  const foeTeam: any[] = session.battle.sides[1].pokemon;
  return (
    <div className="choose">
      <h2>{need < party.length ? `Pick ${need} Pokémon to bring` : "Pick your lead"}</h2>
      <p className="small muted">
        Tap your Pokémon in the order you want them. The first {leads === 2 ? "two go" : "one goes"} out first
        {need < party.length ? "" : "; the rest follow in team order unless you pick more"}.
      </p>
      <div className="preview-foes" aria-label="Their team">
        <span className="small muted">Their team:</span>
        {foeTeam.map((p, i) => (
          <ShowdownSprite key={i} species={p.species.name} num={engine.spriteFor(p.species.name)} size={44} still />
        ))}
      </div>
      <div className="party-grid">
        {party.map((p, i) => {
          const at = order.indexOf(i);
          const species = speciesOf(p.details);
          return (
            <button
              key={i}
              type="button"
              className={`party-btn${at >= 0 ? " picked" : ""}`}
              disabled={at < 0 && order.length >= need}
              onClick={() => setOrder(at >= 0 ? order.filter((x) => x !== i) : [...order, i])}
            >
              <ShowdownSprite species={species} num={engine.spriteFor(species)} size={48} still />
              <span className="party-name">{nameOf(p.ident)}</span>
              <span className="small muted">{at >= 0 ? (at < leads ? `Lead ${at + 1}` : `#${at + 1}`) : p.item ? `@ ${session.battle.dex.items.get(p.item).name}` : ""}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className="primary-btn" disabled={order.length < min} onClick={() => onChoose(`team ${order.map((i) => i + 1).join("")}`)}>
        Start the battle
      </button>
    </div>
  );
}
