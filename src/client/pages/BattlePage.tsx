import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useApi, type TeamSummary } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ErrorBox, Loading, PageLogo } from "../components/ui";
import { BATTLE_FORMATS, BATTLE_OPPONENTS, LOAN_TEAMS, battleFormat, type BattleFormatId } from "../../shared/battle/opponents";
import { teamFormatLabel } from "../teams/formats";
import { STADIUMS, savedStadium, saveStadium, stadiumById } from "../battle/stadiums";
import { StadiumPreview, ShowdownSprite } from "../components/battle/Scene";

export type BattleProgress = {
  progress: { format: string; opponent: string; wins: number; losses: number; firstWinAt: string | null }[];
  allUnlocked: boolean;
};

const CHOICE_KEY = "trainer-hub:battle-choice";

type Choice = { format: BattleFormatId; team: string };

function readChoice(): Partial<Choice> {
  try {
    return JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "{}") as Partial<Choice>;
  } catch {
    return {};
  }
}

/** Where a battle in progress against this opponent is saved in this browser. */
export const savedBattleKey = (trainer: string, format: string, opponent: string) =>
  `trainer-hub:battle:${trainer.toLowerCase()}:${format}:${opponent}`;

export function hasSavedBattle(trainer: string, format: string, opponent: string) {
  try {
    return !!localStorage.getItem(savedBattleKey(trainer, format, opponent));
  } catch {
    return false;
  }
}

export function BattlePage() {
  const { user, ready } = useAuth();
  const info = useApi<BattleProgress>(user ? "/api/battle" : null, { fresh: true });
  const teams = useApi<TeamSummary[]>(user ? "/api/teams/mine" : null, { fresh: true });
  const [format, setFormat] = useState<BattleFormatId>(() => battleFormat(readChoice().format)?.id ?? "gen9ou");
  const [team, setTeam] = useState(() => readChoice().team ?? "");
  // "" means each opponent's own stadium.
  const [stadium, setStadium] = useState(savedStadium);

  useEffect(() => {
    document.title = "Battle · Trainer Hub";
    return () => {
      document.title = "Trainer Hub";
    };
  }, []);

  const myTeams = teams.data?.filter((t) => t.preview.length > 0) ?? [];
  const teamOk = team.startsWith("loan-") ? LOAN_TEAMS.some((l) => l.id === team) : myTeams.some((t) => t.id === team);
  const chosenTeam = teamOk ? team : (myTeams.find((t) => t.format === format)?.id ?? myTeams[0]?.id ?? LOAN_TEAMS[0].id);

  useEffect(() => {
    try {
      localStorage.setItem(CHOICE_KEY, JSON.stringify({ format, team: chosenTeam }));
    } catch {
      // Private browsing: the choice just isn't remembered.
    }
  }, [format, chosenTeam]);

  const pickTeam = (id: string) => {
    setTeam(id);
    // A team built for one of the battle formats switches to that format.
    const t = myTeams.find((m) => m.id === id);
    const f = t && battleFormat(t.format);
    if (f) setFormat(f.id);
  };

  const pickStadium = (id: string) => {
    setStadium(id);
    saveStadium(id);
  };

  const record = new Map((info.data?.progress ?? []).filter((p) => p.format === format).map((p) => [p.opponent, p]));
  const beaten = (id: string) => (record.get(id)?.wins ?? 0) > 0;
  const unlocked = (level: number) => level === 1 || beaten(BATTLE_OPPONENTS[level - 2].id) || !!info.data?.allUnlocked;
  const fmt = battleFormat(format)!;
  const teamInfo = myTeams.find((t) => t.id === chosenTeam);

  return (
    <div className="battle-lobby">
      <div className="page-head">
        <div>
          <h1 className="with-logo">
            <PageLogo />
            Battle
          </h1>
          <p className="muted">
            Battle like the video games: your Team Builder team against the computer, with real Scarlet and Violet maths.
            Work your way up from Paldea's Gym Leaders to the Elite Four, the Champions and a super-competitive final boss.
            Every hit can show you exactly how its damage was worked out.
          </p>
        </div>
        <Link to="/teams" className="secondary-btn">
          My teams
        </Link>
      </div>

      {!ready ? (
        <Loading />
      ) : !user ? (
        <p className="panel">
          <Link to="/login?next=/battle">Log in</Link> or <Link to="/signup?next=/battle">sign up</Link> to battle with your
          teams and work up the ladder.
        </p>
      ) : info.error ? (
        <ErrorBox message={info.error} />
      ) : !info.data || !teams.data ? (
        <Loading label="Loading your teams" />
      ) : (
        <>
          <section className="panel battle-setup">
            <div className="field">
              <span className="field-label">Format</span>
              <div className="chip-row" role="radiogroup" aria-label="Format">
                {BATTLE_FORMATS.map((f) => (
                  <button key={f.id} type="button" role="radio" aria-checked={f.id === format} className={`chip${f.id === format ? " on" : ""}`} onClick={() => setFormat(f.id)}>
                    {f.label}
                  </button>
                ))}
              </div>
              <span className="small muted">{fmt.blurb}</span>
            </div>

            <label className="field">
              <span className="field-label">Your team</span>
              <select value={chosenTeam} onChange={(e) => pickTeam(e.target.value)}>
                {myTeams.length > 0 && (
                  <optgroup label="Your teams">
                    {myTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({teamFormatLabel(t.format)})
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Loan teams">
                  {LOAN_TEAMS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </optgroup>
              </select>
              {teamInfo && (
                <span className="battle-team-row" aria-hidden="true">
                  {teamInfo.preview.map((p, i) => (
                    <ShowdownSprite key={i} species={p.species} num={p.sprite} size={40} still />
                  ))}
                </span>
              )}
              <span className="small muted">
                {myTeams.length === 0 ? (
                  <>
                    No teams yet? Use a loan team, or <Link to="/teams/new">build your own</Link>.
                  </>
                ) : teamInfo && !battleFormat(teamInfo.format) ? (
                  "This team was built for another format. It will be checked against this format's rules when the battle starts."
                ) : (
                  "Teams are checked against the format's rules when the battle starts. Wild formats allow anything."
                )}
              </span>
            </label>

            <div className="field">
              <label className="field-label" htmlFor="battle-stadium">
                Stadium
              </label>
              <div className="stadium-pick">
                <StadiumPreview id={stadium || "battle-stadium"} label={stadium ? stadiumById(stadium).name : "Each opponent's home stadium"} />
                <select id="battle-stadium" value={stadium} onChange={(e) => pickStadium(e.target.value)}>
                  <option value="">Each opponent's home stadium</option>
                  {[...new Set(STADIUMS.map((s) => s.group))].map((g) => (
                    <optgroup key={g} label={g}>
                      {STADIUMS.filter((s) => s.group === g).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.note ? ` (${s.note})` : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
            {info.data.allUnlocked && <p className="small practice-warn">As the site owner, every opponent is open to you for testing.</p>}
          </section>

          <ol className="ladder battle-ladder">
            {BATTLE_OPPONENTS.map((o) => {
              const open = unlocked(o.level);
              const rec = record.get(o.id);
              const venue = stadiumById(o.stadium);
              const saved = hasSavedBattle(user.trainerName, format, o.id);
              const href = `/battle/${o.id}?format=${format}&team=${encodeURIComponent(chosenTeam)}${stadium ? `&stadium=${stadium}` : ""}`;
              return (
                <li key={o.id} className={`ladder-rung venue-card${open ? "" : " locked"}`} data-venue-type={venue.look}>
                  <div className="venue-card-mat" aria-hidden="true" />
                  <div className="ladder-body">
                    <span className="ladder-ace battle-ace">
                      <ShowdownSprite species={o.ace} num={o.aceDex} size={72} still />
                    </span>
                    <div className="ladder-text">
                      <p className="eyebrow">
                        Level {o.level} · {"★".repeat(o.skill)}
                      </p>
                      <h2>{o.name}</h2>
                      <p className="small muted">
                        {o.title} · {venue.name}
                      </p>
                      <p className="small">{o.blurb}</p>
                    </div>
                    <div className="ladder-foot">
                      {beaten(o.id) && <span className="ladder-badge">Beaten</span>}
                      {rec && (
                        <span className="small muted">
                          {rec.wins} won · {rec.losses} lost
                        </span>
                      )}
                      {open ? (
                        <Link to={href} className="primary-btn small">
                          {saved ? "Carry on" : beaten(o.id) ? "Battle again" : "Battle"}
                        </Link>
                      ) : (
                        <span className="small muted">Beat {BATTLE_OPPONENTS[o.level - 2].name} to unlock</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="small muted battle-credit">
            Battles run on Pokémon Showdown's open-source battle engine, so every move, ability and item works the way it
            does on Showdown and in Scarlet and Violet. Sprites from Pokémon Showdown and PokeAPI.
          </p>
        </>
      )}
    </div>
  );
}
