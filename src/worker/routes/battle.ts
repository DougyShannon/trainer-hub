import { Hono } from "hono";
import type { AppEnv } from "../types";
import { isAdmin, requireUser } from "../lib/auth";
import { battleFormat, battleOpponent } from "../../shared/battle/opponents";

export const battle = new Hono<AppEnv>();

/** The trainer's record against each battle simulator opponent, in every format. */
battle.get("/api/battle", requireUser, async (c) => {
  const user = c.get("user")!;
  const { results } = await c.env.DB.prepare(`SELECT format, opponent, wins, losses, first_win_at FROM battle_results WHERE user_id = ?`)
    .bind(user.id)
    .all<Record<string, unknown>>();
  return c.json({
    progress: results.map((r) => ({
      format: r.format as string,
      opponent: r.opponent as string,
      wins: r.wins as number,
      losses: r.losses as number,
      firstWinAt: (r.first_win_at as string | null) ?? null,
    })),
    // The site owner can battle anyone, to try them out.
    allUnlocked: isAdmin(c.env, user),
  });
});

/** Records a finished battle. One row per trainer, format and opponent, so it stays small. */
battle.post("/api/battle/result", requireUser, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const opponent = battleOpponent(body.opponent);
  const format = battleFormat(body.format);
  if (!opponent || !format) return c.json({ error: "Opponent not found" }, 404);
  const won = body.won === true;
  await c.env.DB.prepare(
    `INSERT INTO battle_results (user_id, format, opponent, wins, losses, first_win_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, format, opponent) DO UPDATE SET
       wins = wins + excluded.wins,
       losses = losses + excluded.losses,
       first_win_at = COALESCE(first_win_at, excluded.first_win_at),
       updated_at = datetime('now')`,
  )
    .bind(user.id, format.id, opponent.id, won ? 1 : 0, won ? 0 : 1, won ? new Date().toISOString() : null)
    .run();
  return c.json({ ok: true });
});
