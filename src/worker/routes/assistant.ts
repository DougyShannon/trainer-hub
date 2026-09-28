import { Hono } from "hono";
import type { AppEnv, User } from "../types";
import { requireUser } from "../lib/auth";
import { STATUS, TOOLS, loadNotes, runTool, type ClientAction, type ToolContext } from "../assistant/tools";

export const assistant = new Hono<AppEnv>();

const DEFAULT_MODEL = "claude-sonnet-5";
const DAILY_LIMIT = 40; // messages per trainer per day, to keep the AI bill small
const MAX_STEPS = 10; // tool rounds per question
const MAX_HISTORY = 20;

const isAdmin = (env: AppEnv["Bindings"], user: User | null) =>
  !!user &&
  (env.ADMIN_TRAINERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(user.trainerName.toLowerCase());

const SITE_GUIDE = `You are Professor Hub, the friendly assistant on Trainer Hub, an unofficial fan-made Pokémon Trading Card Game website. You help trainers with the site, the TCG and Pokémon in general.

## The site
- /cards: search and filter every English Pokémon TCG card (type, set, rarity, HP, format). /cards/<id> shows one card.
- /pokedex: all 1,025 Pokémon. /pokedex/<name> shows stats, abilities, evolutions, type matchups, sprites, cries and every card of that Pokémon.
- /decks: the trainer's saved decks. /decks/new is the deck builder: search cards, the 60-card rules are checked as you build, import and export Pokémon TCG Live lists, draw sample hands. /decks/<id> is a deck's page; public decks can be copied.
- /play: the lobby for live games against other trainers. Open a table (listed or link-only), send the link, and play on a shared mat. The mat is manual like a real one: players move their own cards; hidden hands and prizes, coin flips, turns, damage counters and Special Conditions are handled by the site. Anyone can watch. Results show on profiles.
- /arcade: mini-games. /arcade/whos-that-pokemon (guess the silhouette) and /arcade/type-quiz (type matchups).
- /trainer/<name>: a trainer's profile with their partner Pokémon, bio, public decks and win/loss record. /me/settings edits the profile.
- /signup and /login. Trainers need an account to save decks, play and use you.

## Building decks
When asked to make a deck:
1. Work out the plan (main attackers, support Pokémon, how it beats what they're facing) using type matchups: in the TCG, Fire is weak to Water; Psychic Pokémon are usually weak to Darkness or Metal (newer cards) and Psychic (older cards); check the real weakness on the cards you find.
2. Use search_cards (format "standard" unless told otherwise) to find real, legal cards. Include enough Basic Pokémon, evolution lines in sensible ratios (e.g. 4-3-3 or 4-1-3 with Rare Candy), draw Supporters, search Items, switching, and 8-14 Energy.
3. Build exactly 60 cards and run check_deck. Fix every problem and check again.
4. Save it with save_deck only if the trainer is logged in and asked for a deck, then tell them the name and link it like [Deck name](/decks/<id>). Summarise the strategy in a few lines, not the whole list.

## Changing things
- You can change the trainer's own things: their profile (update_profile), their decks (save_deck), and their light or dark theme (set_theme). You can take them to any page (open_page).
- You cannot change the website itself. When someone asks for a change to the whole site (a new page, feature, layout or a bug), use request_site_change to pass it on, and tell them the site owner will review it.

## Memory
You have notes about this trainer from earlier chats, shown below. Read them before answering. When you learn something worth keeping (their favourite type or Pokémon, the deck they're building, their skill level, how they like answers), save it with remember. Don't save things that are only about this one question. Use forget when a note is wrong or out of date.

## Style
- Friendly, clear and short, like a helpful Pokémon Professor. Answers may be read aloud, so avoid tables and long lists; a short list is fine.
- Link to site pages with markdown links like [Pikachu](/pokedex/pikachu).
- For news, tournament results, prices or anything that changes, use web search and say where it came from.
- Never pretend to be official. Pokémon is owned by Nintendo, Creatures, GAME FREAK and The Pokémon Company.`;

type ApiBlock = { type: string; [k: string]: unknown };
type ApiMessage = { role: "user" | "assistant"; content: string | ApiBlock[] };

// Adds a note to the latest user turn (the API wants user and assistant turns to alternate).
function addUserNote(messages: ApiMessage[], note: string) {
  const last = messages[messages.length - 1];
  if (last?.role !== "user") return void messages.push({ role: "user", content: note });
  last.content = typeof last.content === "string" ? `${last.content}\n\n${note}` : [...last.content, { type: "text", text: note }];
}

class ClaudeError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
  }
}

// Pulls the readable message out of an API error body, e.g. "Your credit balance is too low".
function apiMessage(body: string) {
  try {
    return String((JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body).slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

async function callClaude(env: AppEnv["Bindings"], system: ApiBlock[], messages: ApiMessage[]) {
  const res = await fetch(`${env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.ASSISTANT_MODEL || DEFAULT_MODEL,
      max_tokens: 8000,
      system,
      messages,
      tools: [...TOOLS, { type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error("Claude API error", res.status, detail);
    throw new ClaudeError(res.status === 429 || res.status === 529 ? "busy" : "failed", `${res.status}: ${apiMessage(detail)}`);
  }
  return (await res.json()) as { content: ApiBlock[]; stop_reason: string };
}

const today = () => new Date().toISOString().slice(0, 10);

assistant.get("/api/assistant/status", async (c) => {
  const user = c.get("user");
  const enabled = !!c.env.ANTHROPIC_API_KEY;
  if (!user) return c.json({ enabled, loggedIn: false });
  const admin = isAdmin(c.env, user);
  const used = await c.env.DB.prepare(`SELECT messages FROM assistant_usage WHERE user_id = ? AND day = ?`)
    .bind(user.id, today())
    .first<{ messages: number }>();
  return c.json({
    enabled,
    loggedIn: true,
    isAdmin: admin,
    remaining: admin ? null : Math.max(0, DAILY_LIMIT - (used?.messages ?? 0)),
    notes: await loadNotes(c.env.DB, user.id),
  });
});

// Answers one question. The reply is streamed as lines of JSON so the chat can show what the
// assistant is doing ("Searching the card database…") while it works.
assistant.post("/api/assistant/chat", requireUser, async (c) => {
  const user = c.get("user")!;
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "The assistant isn't switched on yet." }, 503);
  const admin = isAdmin(c.env, user);

  const body = await c.req.json<{ messages?: unknown }>().catch(() => ({ messages: [] }));
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m): m is { role: "user" | "assistant"; text: string } => (m?.role === "user" || m?.role === "assistant") && typeof m.text === "string" && !!m.text.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.text.slice(0, 4000) }) as ApiMessage);
  while (history.length && history[0].role !== "user") history.shift();
  if (!history.length || history[history.length - 1].role !== "user") return c.json({ error: "Ask me something first." }, 400);

  if (!admin) {
    const usage = await c.env.DB.prepare(
      `INSERT INTO assistant_usage (user_id, day, messages) VALUES (?, ?, 1)
       ON CONFLICT (user_id, day) DO UPDATE SET messages = messages + 1 RETURNING messages`,
    )
      .bind(user.id, today())
      .first<{ messages: number }>();
    if ((usage?.messages ?? 0) > DAILY_LIMIT) {
      return c.json({ error: `You've used all ${DAILY_LIMIT} questions for today. Come back tomorrow!` }, 429);
    }
  }

  const notes = await loadNotes(c.env.DB, user.id);
  const system: ApiBlock[] = [
    { type: "text", text: SITE_GUIDE, cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: `## This trainer
You're talking to ${user.trainerName} (profile: /trainer/${user.trainerName}). Today is ${today()}.${admin ? " They run this site." : ""}

## Your notes about them
${notes.length ? notes.map((n, i) => `${i + 1}. ${n}`).join("\n") : "(none yet)"}`,
    },
  ];

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const emit = (event: Record<string, unknown>) => writer.write(encoder.encode(JSON.stringify(event) + "\n"));

  const ctx: ToolContext = { db: c.env.DB, user, isAdmin: admin, actions: [], savedDecks: [] };

  const work = async () => {
    const messages = [...history];
    let lastText = ""; // text from earlier steps, in case the final step has none
    let nudged = false;
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const res = await callClaude(c.env, system, messages);
        const stepText = res.content
          .filter((b) => b.type === "text")
          .map((b) => b.text as string)
          .join("")
          .trim();
        if (stepText) lastText = stepText;
        if (res.stop_reason === "max_tokens" && step < MAX_STEPS - 1) {
          // Ran out of room mid-answer (usually while writing a long deck list). Keep any text,
          // drop the cut-off tool call and ask it to carry on more briefly.
          if (stepText) messages.push({ role: "assistant", content: stepText });
          addUserNote(messages, "(You ran out of space in that reply. Carry on from where you were, keeping each step shorter.)");
          continue;
        }
        const toolUses = res.content.filter((b) => b.type === "tool_use") as { type: string; id: string; name: string; input: Record<string, unknown> }[];
        for (const b of res.content) {
          if (b.type === "server_tool_use") await emit({ type: "status", text: STATUS.web_search });
        }
        if (res.stop_reason === "pause_turn") {
          messages.push({ role: "assistant", content: res.content });
          continue;
        }
        if (res.stop_reason !== "tool_use" || !toolUses.length) {
          if (!stepText && !nudged && step < MAX_STEPS - 1) {
            // Sometimes it finishes its tool work without saying anything; ask once for the answer.
            nudged = true;
            addUserNote(messages, "(Now reply to the trainer with your answer.)");
            continue;
          }
          const text = stepText || lastText;
          if (!text) console.error("assistant gave no text", res.stop_reason, res.content.map((b) => b.type));
          const fallback = ctx.savedDecks.length
            ? "Done! Your deck is saved."
            : `Sorry, I didn't catch that. Could you ask again?${admin ? ` (Details for the site owner: Claude stopped with "${res.stop_reason}" after ${step + 1} steps.)` : ""}`;
          await emit({ type: "reply", text: text || fallback, decks: ctx.savedDecks, actions: ctx.actions });
          return;
        }
        messages.push({ role: "assistant", content: res.content });
        const results: ApiBlock[] = [];
        for (const t of toolUses) {
          await emit({ type: "status", text: STATUS[t.name] ?? "Working" });
          let out: unknown;
          try {
            out = await runTool(t.name, t.input ?? {}, ctx);
          } catch (e) {
            console.error("tool failed", t.name, e);
            out = { error: "That didn't work on our side." };
          }
          results.push({ type: "tool_result", tool_use_id: t.id, content: JSON.stringify(out).slice(0, 30_000) });
        }
        messages.push({ role: "user", content: results });
      }
      await emit({ type: "reply", text: "That took more steps than I'm allowed. Could you ask in a simpler way?", decks: ctx.savedDecks, actions: ctx.actions });
    } catch (e) {
      console.error("assistant failed", e);
      const friendly = (e as Error).message === "busy" ? "I'm a bit busy right now. Try again in a minute." : "Something went wrong on my side. Try again.";
      // The site owner sees the technical reason too, so problems like a bad key or no credit are easy to spot.
      const detail = e instanceof ClaudeError ? `Claude said ${e.detail}` : String((e as Error)?.message ?? e);
      await emit({ type: "error", message: admin ? `${friendly} (Details for the site owner: ${detail})` : friendly });
    } finally {
      await writer.close();
    }
  };
  c.executionCtx.waitUntil(work());

  return new Response(stream.readable, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
});

// Site change requests, for the trainers named in ADMIN_TRAINERS.
assistant.get("/api/assistant/requests", requireUser, async (c) => {
  if (!isAdmin(c.env, c.get("user"))) return c.json({ error: "Not found" }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.request, r.status, r.created_at, u.trainer_name FROM site_requests r
     LEFT JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT 100`,
  ).all<Record<string, unknown>>();
  return c.json(results);
});

assistant.put("/api/assistant/requests/:id", requireUser, async (c) => {
  if (!isAdmin(c.env, c.get("user"))) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string });
  if (!["new", "done", "declined"].includes(body.status ?? "")) return c.json({ error: "Bad status" }, 400);
  await c.env.DB.prepare(`UPDATE site_requests SET status = ? WHERE id = ?`).bind(body.status, Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

// Lets a trainer see and clear what the assistant remembers about them.
assistant.delete("/api/assistant/memory", requireUser, async (c) => {
  await c.env.DB.prepare(`DELETE FROM assistant_memory WHERE user_id = ?`).bind(c.get("user")!.id).run();
  return c.json({ ok: true });
});
