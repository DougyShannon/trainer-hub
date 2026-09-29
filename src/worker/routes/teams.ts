import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireUser } from "../lib/auth";
import { parseJson } from "../lib/json";
import { newDeckId } from "./decks";
import { MAX_TEAM_SIZE, cleanSet, type PokemonSet, type TeamPreview } from "../../shared/team-sets";

export const teams = new Hono<AppEnv>();

export const teamSummary = (r: Record<string, unknown>) => ({
  id: r.id as string,
  name: r.name as string,
  format: r.format as string,
  preview: parseJson<TeamPreview[]>(r.preview, []),
  isPublic: !!r.is_public,
  updatedAt: r.updated_at as string,
  createdAt: r.created_at as string,
});

/** Checks a team sent by the browser. Legality is checked in the browser with Showdown's own rules. */
function readTeamBody(body: Record<string, unknown>) {
  const name = String(body.name ?? "").trim().slice(0, 60) || "Untitled team";
  const format = /^[a-z0-9]{3,40}$/.test(String(body.format)) ? String(body.format) : "gen9ou";
  const sets = (Array.isArray(body.sets) ? body.sets : [])
    .slice(0, MAX_TEAM_SIZE)
    .map(cleanSet)
    .filter((s): s is PokemonSet => !!s);
  const preview: TeamPreview[] = sets.map((s, i) => {
    const p = Array.isArray(body.preview) ? (body.preview[i] as Record<string, unknown> | undefined) : undefined;
    const sprite = Math.floor(Number(p?.sprite));
    return { species: s.species, sprite: Number.isFinite(sprite) && sprite > 0 && sprite < 20000 ? sprite : 0 };
  });
  return { name, format, sets, preview, isPublic: !!body.isPublic };
}

teams.get("/api/teams/mine", requireUser, async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM teams WHERE user_id = ? ORDER BY updated_at DESC`)
    .bind(c.get("user")!.id)
    .all<Record<string, unknown>>();
  return c.json(results.map(teamSummary));
});

teams.post("/api/teams", requireUser, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const team = readTeamBody(body);
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM teams WHERE user_id = ?`)
    .bind(c.get("user")!.id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= 200) return c.json({ error: "You have 200 teams already. Delete one to make room." }, 400);

  const id = newDeckId();
  await c.env.DB.prepare(
    `INSERT INTO teams (id, user_id, name, format, sets, preview, is_public) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, c.get("user")!.id, team.name, team.format, JSON.stringify(team.sets), JSON.stringify(team.preview), team.isPublic ? 1 : 0)
    .run();
  return c.json({ id }, 201);
});

teams.get("/api/teams/:id", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT t.*, u.trainer_name, u.avatar_dex FROM teams t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
  )
    .bind(c.req.param("id"))
    .first<Record<string, unknown>>();
  const viewer = c.get("user");
  const isOwner = !!row && viewer?.id === row.user_id;
  if (!row || (!row.is_public && !isOwner)) return c.json({ error: "Team not found" }, 404);
  return c.json({
    ...teamSummary(row),
    isOwner,
    owner: { trainerName: row.trainer_name, avatarDex: row.avatar_dex },
    sets: parseJson<PokemonSet[]>(row.sets, []),
  });
});

teams.put("/api/teams/:id", requireUser, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const team = readTeamBody(body);
  const result = await c.env.DB.prepare(
    `UPDATE teams SET name = ?, format = ?, sets = ?, preview = ?, is_public = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(team.name, team.format, JSON.stringify(team.sets), JSON.stringify(team.preview), team.isPublic ? 1 : 0, c.req.param("id"), c.get("user")!.id)
    .run();
  if (!result.meta.changes) return c.json({ error: "Team not found" }, 404);
  return c.json({ ok: true });
});

// Adds a Pokémon to one of the trainer's teams (the "Add to team" button in the Pokédex).
// The browser fills in its moves and ability when the team is next opened.
teams.post("/api/teams/:id/add", requireUser, async (c) => {
  const body = await c.req.json<{ species?: unknown; sprite?: unknown }>().catch(() => ({}) as { species?: unknown; sprite?: unknown });
  const row = await c.env.DB.prepare(`SELECT * FROM teams WHERE id = ? AND user_id = ?`)
    .bind(c.req.param("id"), c.get("user")!.id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Team not found" }, 404);
  const sets = parseJson<PokemonSet[]>(row.sets, []);
  if (sets.length >= MAX_TEAM_SIZE) return c.json({ error: `${row.name} already has 6 Pokémon.` }, 400);
  const set = cleanSet({ species: body.species, moves: [] });
  if (!set) return c.json({ error: "Pick a Pokémon to add." }, 400);
  set.level = 0; // 0 tells the editor to fill in the format's level and the Pokémon's defaults
  const preview = [...parseJson<TeamPreview[]>(row.preview, []), { species: set.species, sprite: Math.floor(Number(body.sprite)) || 0 }];
  await c.env.DB.prepare(`UPDATE teams SET sets = ?, preview = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(JSON.stringify([...sets, set]), JSON.stringify(preview), row.id)
    .run();
  return c.json({ ok: true, teamName: row.name, size: sets.length + 1 });
});

teams.delete("/api/teams/:id", requireUser, async (c) => {
  const result = await c.env.DB.prepare(`DELETE FROM teams WHERE id = ? AND user_id = ?`)
    .bind(c.req.param("id"), c.get("user")!.id)
    .run();
  if (!result.meta.changes) return c.json({ error: "Team not found" }, 404);
  return c.json({ ok: true });
});

teams.post("/api/teams/:id/copy", requireUser, async (c) => {
  const user = c.get("user")!;
  const row = await c.env.DB.prepare(`SELECT * FROM teams WHERE id = ? AND (is_public = 1 OR user_id = ?)`)
    .bind(c.req.param("id"), user.id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Team not found" }, 404);
  const id = newDeckId();
  await c.env.DB.prepare(
    `INSERT INTO teams (id, user_id, name, format, sets, preview, is_public) VALUES (?, ?, ?, ?, ?, ?, 0)`,
  )
    .bind(id, user.id, `${row.name} (copy)`.slice(0, 60), row.format, row.sets, row.preview)
    .run();
  return c.json({ id }, 201);
});
