-- Player accounts, login sessions and saved decks.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  trainer_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,           -- base64 PBKDF2-SHA256
  password_salt TEXT NOT NULL,           -- base64
  avatar_dex INTEGER NOT NULL DEFAULT 25,-- Pokédex number shown as the trainer's avatar
  favourite_dex INTEGER,
  bio TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Only a hash of each session token is stored, so a leaked database can't be used to log in.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE decks (
  id TEXT PRIMARY KEY,                   -- short random id used in URLs
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'standard', -- standard, expanded or unlimited
  cover_card_id TEXT,
  cards TEXT NOT NULL DEFAULT '[]',      -- JSON [{ "id": "sv1-1", "count": 4 }]
  card_count INTEGER NOT NULL DEFAULT 0,
  is_valid INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX decks_user ON decks(user_id, updated_at);
CREATE INDEX decks_public ON decks(is_public, updated_at);
