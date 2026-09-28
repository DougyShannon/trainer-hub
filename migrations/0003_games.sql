-- Live games. The game itself lives in a GameRoom Durable Object; this table lists games
-- for the Play lobby and keeps each trainer's results.
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting, setup, playing, finished, cancelled
  is_open INTEGER NOT NULL DEFAULT 1,     -- 1 = listed in the lobby, 0 = only people with the link can join
  host_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_deck_name TEXT NOT NULL,
  guest_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_deck_name TEXT,
  winner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  end_reason TEXT,
  turns INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX games_lobby ON games (status, is_open, created_at);
CREATE INDEX games_host ON games (host_user_id, created_at);
CREATE INDEX games_guest ON games (guest_user_id, created_at);
