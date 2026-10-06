-- The "Cards to fix" list: cards players found that the game can't play for them yet. Shared by
-- everyone and kept between games; a site owner removes a card once it's been fixed.
CREATE TABLE cards_to_fix (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE, -- one entry per card name (reprints share their effect)
  card_id TEXT NOT NULL,                    -- the printing the player picked, for its picture
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
