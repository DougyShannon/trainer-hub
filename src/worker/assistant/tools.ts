// The tools the assistant can use. Each one reads the site's own database or changes something
// that belongs to the trainer who is chatting; none of them can touch another trainer's things.

import type { User } from "../types";
import { CARD_SUMMARY, cardsById, parseJson, summarise } from "../lib/json";
import { newDeckId, readDeckBody } from "../routes/decks";
import { checkDeck, type DeckFormat } from "../../shared/deck-rules";

export type ClientAction = { type: "navigate"; to: string } | { type: "theme"; theme: "light" | "dark" | "system" };

export type ToolContext = {
  db: D1Database;
  user: User | null;
  isAdmin: boolean;
  actions: ClientAction[];
  savedDecks: { id: string; name: string }[];
};

type Input = Record<string, unknown>;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const FORMATS: DeckFormat[] = ["standard", "expanded", "unlimited"];
export const MAX_NOTES = 40;

export const TOOLS = [
  {
    name: "search_cards",
    description:
      "Search the site's database of every English Pokémon TCG card. Returns up to `limit` cards with their id, set, HP, types, attacks, abilities, weakness and retreat cost. Use the card ids exactly as returned when checking or saving a deck.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Part of the card name, e.g. 'Charizard ex' or 'Ultra Ball'." },
        text: { type: "string", description: "Words that appear in the card's attacks, abilities or rules, e.g. 'search your deck'." },
        supertype: { type: "string", enum: ["Pokémon", "Trainer", "Energy"] },
        subtype: { type: "string", description: "e.g. Basic, Stage 1, Stage 2, ex, Item, Supporter, Stadium, Pokémon Tool, Special." },
        type: { type: "string", description: "Energy type of a Pokémon: Grass, Fire, Water, Lightning, Psychic, Fighting, Darkness, Metal, Fairy, Dragon, Colorless." },
        format: { type: "string", enum: FORMATS, description: "Only cards legal in this format. Use 'standard' for decks unless told otherwise." },
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
    },
  },
  {
    name: "get_pokemon",
    description: "Look up a Pokémon's Pokédex entry: types, stats, abilities, evolutions and flavour text.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "check_deck",
    description: "Check a deck list against the rules (60 cards, max 4 of a name, at least one Basic Pokémon, ACE SPEC and Radiant limits, format legality). Always check before saving.",
    input_schema: {
      type: "object",
      properties: {
        format: { type: "string", enum: FORMATS },
        cards: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string" }, count: { type: "integer" } }, required: ["id", "count"] },
        },
      },
      required: ["format", "cards"],
    },
  },
  {
    name: "save_deck",
    description: "Save a deck to the logged-in trainer's decks. Only do this when they asked for a deck to be made or saved. Returns the deck's page.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        format: { type: "string", enum: FORMATS },
        is_public: { type: "boolean", description: "Only true if the trainer asked to share it." },
        cards: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string" }, count: { type: "integer" } }, required: ["id", "count"] },
        },
      },
      required: ["name", "format", "cards"],
    },
  },
  {
    name: "list_my_decks",
    description: "List the logged-in trainer's saved decks.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_deck",
    description: "Read one of the trainer's own decks (or any public deck) card by card.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "update_profile",
    description: "Change the logged-in trainer's own profile. Only change what they asked for.",
    input_schema: {
      type: "object",
      properties: {
        bio: { type: "string", description: "Up to 300 characters." },
        country: { type: "string" },
        favourite_pokemon: { type: "string", description: "Name of a Pokémon." },
        partner_pokemon: { type: "string", description: "Name of the Pokémon used as their avatar." },
      },
    },
  },
  {
    name: "remember",
    description:
      "Save a short note to your memory of this trainer, e.g. their favourite type, the deck they're working on, or how they like answers. You will see these notes before every future question. Keep each note under 200 characters.",
    input_schema: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
  },
  {
    name: "forget",
    description: "Delete a note from your memory of this trainer, by its number in the list you were given.",
    input_schema: { type: "object", properties: { number: { type: "integer" } }, required: ["number"] },
  },
  {
    name: "open_page",
    description: "Take the trainer to a page on this site, e.g. /pokedex/pikachu, /cards?q=charizard, /decks/new or /play.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "set_theme",
    description: "Switch the site between light and dark mode for this trainer, or back to following their device.",
    input_schema: { type: "object", properties: { theme: { type: "string", enum: ["light", "dark", "system"] } }, required: ["theme"] },
  },
  {
    name: "request_site_change",
    description:
      "Pass a request for a change to the whole website (a new page, feature, layout change or bug fix) to the site owner, who decides what gets built. Write it clearly so they can act on it.",
    input_schema: { type: "object", properties: { request: { type: "string" } }, required: ["request"] },
  },
] as const;

export const STATUS: Record<string, string> = {
  search_cards: "Searching the card database",
  get_pokemon: "Looking in the Pokédex",
  check_deck: "Checking the deck rules",
  save_deck: "Saving the deck",
  list_my_decks: "Looking at your decks",
  get_deck: "Reading the deck",
  update_profile: "Updating your profile",
  remember: "Making a note",
  forget: "Updating my notes",
  open_page: "Opening the page",
  set_theme: "Changing the theme",
  request_site_change: "Passing your request to the site owner",
  web_search: "Searching the web",
};

const needLogin = { error: "The trainer isn't logged in. Ask them to log in first." };

const trimText = (t: unknown, n = 160) => (typeof t === "string" ? (t.length > n ? `${t.slice(0, n)}…` : t) : undefined);

async function findPokemon(db: D1Database, name: string) {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return db
    .prepare(`SELECT id, slug, name FROM pokemon WHERE slug = ? OR LOWER(name) = ? OR slug LIKE ? ORDER BY id LIMIT 1`)
    .bind(slug, name.toLowerCase().trim(), `${slug}%`)
    .first<{ id: number; slug: string; name: string }>();
}

async function deckEntries(db: D1Database, raw: unknown) {
  const list = Array.isArray(raw) ? raw : [];
  const found = await cardsById(db, list.map((e) => String(e?.id ?? "")));
  const missing = list.filter((e) => !found.has(String(e?.id ?? ""))).map((e) => String(e?.id));
  const entries = list
    .filter((e) => found.has(String(e?.id ?? "")))
    .map((e) => ({ card: found.get(String(e.id))!, count: Math.max(1, Math.min(60, Math.floor(Number(e.count) || 1))) }));
  return { entries, missing };
}

export async function runTool(name: string, input: Input, ctx: ToolContext): Promise<unknown> {
  const { db, user } = ctx;
  switch (name) {
    case "search_cards": {
      const where: string[] = [];
      const args: unknown[] = [];
      const nameQ = str(input.name).toLowerCase();
      const textQ = str(input.text).toLowerCase();
      if (nameQ) { where.push("LOWER(c.name) LIKE ?"); args.push(`%${nameQ}%`); }
      if (textQ) { where.push("c.search_text LIKE ?"); args.push(`%${textQ}%`); }
      if (str(input.supertype)) { where.push("c.supertype = ?"); args.push(str(input.supertype)); }
      if (str(input.subtype)) { where.push("c.subtypes LIKE ?"); args.push(`%"${str(input.subtype)}"%`); }
      if (str(input.type)) { where.push("c.types LIKE ?"); args.push(`%"${str(input.type)}"%`); }
      if (input.format === "standard") where.push("c.legal_standard = 1");
      if (input.format === "expanded") where.push("c.legal_expanded = 1");
      const limit = Math.max(1, Math.min(25, Number(input.limit) || 12));
      const { results } = await db
        .prepare(
          `SELECT ${CARD_SUMMARY}, c.details FROM cards c JOIN sets s ON s.id = c.set_id
           ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY s.release_date DESC, c.number_sort LIMIT ?`,
        )
        .bind(...args, limit)
        .all<Record<string, unknown>>();
      return results.map((r) => {
        const s = summarise(r);
        const d = parseJson<Record<string, unknown>>(r.details, {});
        const attacks = (d.attacks as { name: string; cost?: string[]; damage?: string; text?: string }[] | undefined)?.map((a) => ({
          name: a.name,
          cost: a.cost?.join(""),
          damage: a.damage || undefined,
          text: trimText(a.text),
        }));
        const abilities = (d.abilities as { name: string; text: string }[] | undefined)?.map((a) => ({ name: a.name, text: trimText(a.text) }));
        return {
          id: s.id,
          name: s.name,
          supertype: s.supertype,
          subtypes: s.subtypes,
          hp: s.hp ?? undefined,
          types: s.types.length ? s.types : undefined,
          set: `${s.setName} ${s.setCode ?? ""} ${s.number}`.trim(),
          legal: s.legal,
          attacks,
          abilities,
          rules: s.supertype !== "Pokémon" ? (d.rules as string[] | undefined)?.map((t) => trimText(t, 220)) : undefined,
          weakness: (d.weaknesses as { type: string; value: string }[] | undefined)?.map((w) => `${w.type} ${w.value}`).join(", ") || undefined,
          retreat: (d.retreatCost as string[] | undefined)?.length,
        };
      });
    }

    case "get_pokemon": {
      const hit = await findPokemon(db, str(input.name));
      if (!hit) return { error: "No Pokémon by that name." };
      const p = await db.prepare(`SELECT * FROM pokemon WHERE id = ?`).bind(hit.id).first<Record<string, unknown>>();
      const { results: chain } = await db
        .prepare(`SELECT name FROM pokemon WHERE evolution_chain_id = ? ORDER BY id`)
        .bind(p!.evolution_chain_id)
        .all<{ name: string }>();
      return {
        name: p!.name,
        page: `/pokedex/${p!.slug}`,
        dex: p!.id,
        genus: p!.genus,
        generation: p!.generation,
        types: parseJson(p!.types, []),
        stats: parseJson(p!.stats, {}),
        abilities: parseJson(p!.abilities, []),
        evolutionFamily: chain.map((c) => c.name),
        flavorText: p!.flavor_text,
        legendary: !!p!.is_legendary,
        mythical: !!p!.is_mythical,
      };
    }

    case "check_deck": {
      const format = FORMATS.includes(input.format as DeckFormat) ? (input.format as DeckFormat) : "standard";
      const { entries, missing } = await deckEntries(db, input.cards);
      const problems = checkDeck(entries, format).map((p) => p.message);
      if (missing.length) problems.unshift(`These card ids don't exist: ${missing.join(", ")}. Use ids from search_cards.`);
      return { total: entries.reduce((n, e) => n + e.count, 0), legal: problems.length === 0, problems };
    }

    case "save_deck": {
      if (!user) return needLogin;
      const deck = await readDeckBody(db, { name: input.name, format: input.format, cards: input.cards, isPublic: input.is_public });
      if ("error" in deck) return { error: deck.error };
      const id = newDeckId();
      await db
        .prepare(
          `INSERT INTO decks (id, user_id, name, format, cover_card_id, cards, card_count, is_valid, is_public)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, user.id, deck.name, deck.format, deck.cover, JSON.stringify(deck.cards), deck.total, deck.isValid ? 1 : 0, deck.isPublic ? 1 : 0)
        .run();
      ctx.savedDecks.push({ id, name: deck.name });
      return { saved: true, id, name: deck.name, legal: deck.isValid, page: `/decks/${id}`, editPage: `/decks/${id}/edit` };
    }

    case "list_my_decks": {
      if (!user) return needLogin;
      const { results } = await db
        .prepare(`SELECT id, name, format, card_count, is_valid, is_public FROM decks WHERE user_id = ? ORDER BY updated_at DESC LIMIT 30`)
        .bind(user.id)
        .all<Record<string, unknown>>();
      return results.map((r) => ({ id: r.id, name: r.name, format: r.format, cards: r.card_count, legal: !!r.is_valid, public: !!r.is_public }));
    }

    case "get_deck": {
      const row = await db.prepare(`SELECT * FROM decks WHERE id = ?`).bind(str(input.id)).first<Record<string, unknown>>();
      if (!row || (!row.is_public && row.user_id !== user?.id)) return { error: "Deck not found." };
      const stored = parseJson<{ id: string; count: number }[]>(row.cards, []);
      const found = await cardsById(db, stored.map((e) => e.id));
      return {
        id: row.id,
        name: row.name,
        format: row.format,
        legal: !!row.is_valid,
        cards: stored.map((e) => ({ count: e.count, id: e.id, name: found.get(e.id)?.name, supertype: found.get(e.id)?.supertype })),
      };
    }

    case "update_profile": {
      if (!user) return needLogin;
      const sets: string[] = [];
      const args: unknown[] = [];
      const changed: string[] = [];
      if (typeof input.bio === "string") { sets.push("bio = ?"); args.push(str(input.bio, 300)); changed.push("bio"); }
      if (typeof input.country === "string") { sets.push("country = ?"); args.push(str(input.country, 60)); changed.push("country"); }
      for (const [key, col] of [["favourite_pokemon", "favourite_dex"], ["partner_pokemon", "avatar_dex"]] as const) {
        if (typeof input[key] !== "string") continue;
        const p = await findPokemon(db, str(input[key]));
        if (!p) return { error: `No Pokémon called ${str(input[key])}.` };
        sets.push(`${col} = ?`);
        args.push(p.id);
        changed.push(`${key.replace("_", " ")}: ${p.name}`);
      }
      if (!sets.length) return { error: "Nothing to change." };
      await db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...args, user.id).run();
      return { updated: changed, profilePage: `/trainer/${user.trainerName}` };
    }

    case "remember":
    case "forget": {
      if (!user) return { error: "You can only remember things for logged-in trainers." };
      const notes = await loadNotes(db, user.id);
      if (name === "remember") {
        const note = str(input.note, 200);
        if (!note) return { error: "Empty note." };
        notes.push(note);
        if (notes.length > MAX_NOTES) notes.splice(0, notes.length - MAX_NOTES);
      } else {
        const i = Math.floor(Number(input.number)) - 1;
        if (!(i >= 0 && i < notes.length)) return { error: "No note with that number." };
        notes.splice(i, 1);
      }
      await db
        .prepare(
          `INSERT INTO assistant_memory (user_id, notes, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT (user_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at`,
        )
        .bind(user.id, JSON.stringify(notes))
        .run();
      return { notes: notes.map((n, i) => `${i + 1}. ${n}`) };
    }

    case "open_page": {
      const path = str(input.path, 300);
      if (!path.startsWith("/") || path.startsWith("//")) return { error: "Only pages on this site can be opened." };
      ctx.actions.push({ type: "navigate", to: path });
      return { opened: path };
    }

    case "set_theme": {
      const theme = input.theme === "light" || input.theme === "dark" ? input.theme : "system";
      ctx.actions.push({ type: "theme", theme });
      return { theme };
    }

    case "request_site_change": {
      const request = str(input.request, 2000);
      if (!request) return { error: "Empty request." };
      await db.prepare(`INSERT INTO site_requests (user_id, request) VALUES (?, ?)`).bind(user?.id ?? null, request).run();
      return { passedOn: true, note: ctx.isAdmin ? "Saved to your list of site change requests." : "The site owner will review it." };
    }
  }
  return { error: `Unknown tool ${name}` };
}

export async function loadNotes(db: D1Database, userId: number) {
  const row = await db.prepare(`SELECT notes FROM assistant_memory WHERE user_id = ?`).bind(userId).first<{ notes: string }>();
  return parseJson<string[]>(row?.notes, []);
}
