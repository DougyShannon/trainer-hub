-- Battle simulator games against the computer: each trainer's record against each opponent in
-- each format. Beating an opponent unlocks the next one on that format's ladder.
CREATE TABLE battle_results (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  opponent TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  first_win_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, format, opponent)
);
