import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { send, useApi, type TeamDetail } from "../lib/api";
import { useAuth } from "../lib/auth";
import { sprite } from "../lib/sprites";
import { ErrorBox, Loading } from "../components/ui";
import { NotFoundPage } from "./NotFoundPage";
import { ExportTeamModal, MonSprite, TypeTag } from "./TeamBuilderPage";
import { useEngine } from "../teams/load";
import { STAT_IDS } from "../../shared/team-sets";

const STAT_NAMES = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" } as const;

/** A read-only page for a shared team, with Export and "Copy to my teams". */
export function TeamViewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { engine, error: engineError } = useEngine();
  const { data: team, error, loading } = useApi<TeamDetail>(`/api/teams/${id}`, { fresh: true });
  const [exporting, setExporting] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const sets = useMemo(() => (engine && team ? team.sets.map((s) => engine.completeSet(team.format, s)) : []), [engine, team]);
  const problems = useMemo(() => (engine && team ? engine.validateTeam(sets, team.format) : []), [engine, team, sets]);

  if (loading && !team) return <Loading label="Loading team" />;
  if (error === "Team not found") return <NotFoundPage what="team" />;
  if (error || !team) return <ErrorBox message={error ?? "Unknown error"} />;
  if (engineError) return <ErrorBox message={engineError} />;
  if (!engine) return <Loading label="Loading the Pokémon data" />;

  const info = engine.formatInfo(team.format);
  const copy = async () => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/teams/${team.id}`)}`);
      return;
    }
    try {
      const res = await send<{ id: string }>("POST", `/api/teams/${team.id}/copy`);
      navigate(`/teams/${res.id}/edit`);
    } catch (err) {
      setCopyError((err as Error).message);
    }
  };

  return (
    <div className="deck-view team-view">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {info.label} team · {sets.length} Pokémon
          </p>
          <h1>{team.name}</h1>
          <Link to={`/trainer/${team.owner.trainerName}`} className="owner-link">
            <img src={sprite(team.owner.avatarDex)} alt="" width={40} height={40} />
            {team.owner.trainerName}
          </Link>
        </div>
        <div className="row-actions">
          <button type="button" className="secondary-btn" onClick={() => setExporting(true)} disabled={!sets.length}>
            Export for Showdown
          </button>
          {team.isOwner ? (
            <Link to={`/teams/${team.id}/edit`} className="primary-btn">
              Edit team
            </Link>
          ) : (
            <button type="button" className="primary-btn" onClick={copy}>
              Copy to my teams
            </button>
          )}
        </div>
      </div>
      {copyError && <p className="form-error">{copyError}</p>}
      {sets.length > 0 &&
        (problems.length ? (
          <p className="form-error">Not legal in {info.label} yet: {problems[0]}</p>
        ) : (
          <p className="form-ok">Legal in {info.label}.</p>
        ))}

      <div className="team-cards">
        {sets.map((s, i) => {
          const stats = engine.calcStats(s, team.format);
          const evs = STAT_IDS.filter((k) => s.evs[k]).map((k) => `${s.evs[k]} ${STAT_NAMES[k]}`);
          return (
            <article key={i} className="panel team-card">
              <div className="team-card-head">
                <MonSprite set={s} size={80} />
                <div>
                  <h2>{s.name || s.species}</h2>
                  {s.name && <p className="muted small">{s.species}</p>}
                  <div className="type-row">
                    {(engine.speciesRow(team.format, s.species)?.types ?? []).map((t) => (
                      <TypeTag key={t} type={t} />
                    ))}
                  </div>
                </div>
              </div>
              <dl className="facts compact">
                <div>
                  <dt>Item</dt>
                  <dd>{s.item || "None"}</dd>
                </div>
                <div>
                  <dt>Ability</dt>
                  <dd>{s.ability || "None"}</dd>
                </div>
                <div>
                  <dt>Tera Type</dt>
                  <dd>{s.teraType}</dd>
                </div>
                <div>
                  <dt>Nature</dt>
                  <dd>{s.nature || "Serious"}</dd>
                </div>
              </dl>
              <ul className="team-card-moves">
                {s.moves.map((m) => {
                  const row = engine.moveRow(m);
                  return (
                    <li key={m}>
                      {row ? <TypeTag type={row.type} /> : null} {m}
                    </li>
                  );
                })}
              </ul>
              <p className="small muted">
                {evs.length ? `EVs: ${evs.join(" / ")}` : "No EVs"}
                {stats && <> · Stats: {STAT_IDS.map((k) => stats[k]).join(" / ")}</>}
              </p>
            </article>
          );
        })}
      </div>

      {exporting && <ExportTeamModal text={engine.exportTeam(sets)} format={engine.showdownFormatName(team.format)} onClose={() => setExporting(false)} />}
    </div>
  );
}
