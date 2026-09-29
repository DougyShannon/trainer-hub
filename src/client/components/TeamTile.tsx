import { Link } from "react-router";
import type { TeamSummary } from "../lib/api";
import { sprite } from "../lib/sprites";
import { teamFormatLabel } from "../teams/formats";

/** The six Pokémon of a team as small sprites, with empty slots shown as Poké Ball outlines. */
export function TeamSprites({ preview, size = 48 }: { preview: TeamSummary["preview"]; size?: number }) {
  return (
    <span className="team-sprites">
      {Array.from({ length: 6 }, (_, i) => {
        const p = preview[i];
        if (!p) return <span key={i} className="team-sprite-empty" style={{ width: size, height: size }} aria-hidden="true" />;
        return p.sprite ? (
          <img key={i} src={sprite(p.sprite)} alt={p.species} title={p.species} width={size} height={size} loading="lazy" />
        ) : (
          <span key={i} className="team-sprite-empty named" style={{ width: size, height: size }} title={p.species}>
            ?
          </span>
        );
      })}
    </span>
  );
}

export function TeamTile({ team, to }: { team: TeamSummary; to: string }) {
  return (
    <Link to={to} className="team-tile">
      <TeamSprites preview={team.preview} />
      <span className="team-tile-body">
        <strong>{team.name}</strong>
        <span className="deck-tile-meta">
          <span>{teamFormatLabel(team.format)}</span>
          <span>{team.preview.length} / 6 Pokémon</span>
          {team.isPublic && <span>Public</span>}
        </span>
      </span>
    </Link>
  );
}
