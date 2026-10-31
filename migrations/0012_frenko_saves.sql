-- Frenko Region game saves: up to 5 slots per trainer. The save itself is JSON written by the game.
-- A row is only written when the player chooses SAVE, so it stays well inside D1's daily write limit.
CREATE TABLE frenko_saves (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5),
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, slot)
);
