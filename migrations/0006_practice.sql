-- Practice games against the computer: each trainer's record against each ladder opponent.
-- Beating an opponent earns their badge and unlocks the next level.
CREATE TABLE practice_results (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  first_win_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, level)
);
