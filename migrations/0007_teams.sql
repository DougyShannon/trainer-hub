-- Pokémon video game teams (up to 6 Pokémon with moves, items and stats), built on the Teams page.
-- Separate from TCG decks. Each team is one row, so saving a team costs one write.
CREATE TABLE teams (
  id TEXT PRIMARY KEY,                   -- short random id used in URLs
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'gen9ou', -- Showdown format id, e.g. gen9ou, gen9vgc2025regi, gen9customgame
  sets TEXT NOT NULL DEFAULT '[]',       -- JSON array of Showdown-style sets (species, item, ability, moves, EVs...)
  preview TEXT NOT NULL DEFAULT '[]',    -- JSON [{ "species": "Garchomp", "sprite": 445 }] for team lists
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX teams_user ON teams(user_id, updated_at);
