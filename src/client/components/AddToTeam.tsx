import { useState } from "react";
import { Link, useLocation } from "react-router";
import { send, useApi, type TeamSummary } from "../lib/api";
import { useAuth } from "../lib/auth";

/** "Add to team" on a Pokédex page: drops the Pokémon into one of your teams, or starts a new team with it. */
export function AddToTeam({ name, num }: { name: string; num: number }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [reloadKey, setReloadKey] = useState(0);
  const { data: teams } = useApi<TeamSummary[]>(user ? "/api/teams/mine" : null, { fresh: true, reloadKey });
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean; to?: string } | null>(null);
  const newTeam = `/teams/new?fresh=1&add=${encodeURIComponent(name)}&num=${num}`;

  if (!user) {
    return (
      <p className="muted small add-to-team">
        <Link to={newTeam}>Start a battle team with {name}</Link>, or <Link to={`/login?next=${encodeURIComponent(pathname)}`}>log in</Link> to add it
        to a saved team.
      </p>
    );
  }

  const open = (teams ?? []).filter((t) => t.preview.length < 6);
  const target = open.find((t) => t.id === teamId) ?? open[0];

  const add = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await send<{ teamName: string; size: number }>("POST", `/api/teams/${target.id}/add`, { species: name, sprite: num });
      setNote({ text: `Added ${name} to ${res.teamName} (${res.size}/6).`, to: `/teams/${target.id}/edit` });
      setReloadKey((k) => k + 1);
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="add-to-team">
      {open.length ? (
        <>
          <label htmlFor="team-target" className="small">
            Add to battle team
          </label>
          <select id="team-target" value={target?.id ?? ""} onChange={(e) => setTeamId(e.target.value)}>
            {open.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.preview.length}/6)
              </option>
            ))}
          </select>
          <button type="button" className="secondary-btn small" onClick={add} disabled={busy}>
            {busy ? "Adding…" : "Add"}
          </button>
          <span className="muted small">or</span>
        </>
      ) : null}
      <Link to={newTeam} className="secondary-btn small">
        Start a new team with {name}
      </Link>
      {note && (
        <p className={`small${note.bad ? " form-error" : ""}`} role="status">
          {note.text} {note.to && <Link to={note.to}>Open team</Link>}
        </p>
      )}
    </div>
  );
}
