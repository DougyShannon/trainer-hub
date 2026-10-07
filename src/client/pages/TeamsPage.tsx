import { Link } from "react-router";
import { useApi, type TeamSummary } from "../lib/api";
import { useAuth } from "../lib/auth";
import { TeamTile } from "../components/TeamTile";
import { ErrorBox, Loading, PageLogo } from "../components/ui";

export function TeamsPage() {
  const { user, ready } = useAuth();
  const { data, error, loading } = useApi<TeamSummary[]>(user ? "/api/teams/mine" : null, { fresh: true });

  if (!ready) return <Loading />;

  return (
    <div className="decks-page">
      <div className="page-head">
        <h1 className="with-logo">
          <PageLogo />
          {user ? "My teams" : "Team builder"}
        </h1>
        <div className="row-actions">
          <Link to="/teams/new?import=1" className="secondary-btn">
            Import from Showdown
          </Link>
          <Link to="/teams/new" className="primary-btn">
            Build a new team
          </Link>
        </div>
      </div>

      {(!user || data?.length === 0) && (
      <div className="panel intro-panel">
        <h2>Build a battle team of six Pokémon</h2>
        <p>
          Pick each Pokémon's moves, ability, held item, nature and EVs, and see its final stats as you go. The builder checks your team
          against the same rules Pokémon Showdown uses, for singles, doubles and VGC. Wild mode lets you mix any Pokémon with any
          ability and any moves, just for fun.
        </p>
        <p>
          Teams copy straight into Showdown: press <strong>Export</strong>, then paste into Showdown's teambuilder.
          {!user && (
            <>
              {" "}
              <Link to="/signup?next=/teams">Create an account</Link> or <Link to="/login?next=/teams">log in</Link> to save teams.
            </>
          )}
        </p>
      </div>
      )}

      {user && error && <ErrorBox message={error} />}
      {user && loading && !data && <Loading label="Loading your teams" />}
      {user && data && data.length === 0 && (
        <div className="empty-state">
          <h2>No teams yet</h2>
          <p>Build one from scratch, or paste a team you already have on Showdown.</p>
        </div>
      )}
      {user && data && data.length > 0 && (
        <div className="team-grid">
          {data.map((t) => (
            <TeamTile key={t.id} team={t} to={`/teams/${t.id}/edit`} />
          ))}
        </div>
      )}
    </div>
  );
}
