-- The AI assistant: what it remembers about each trainer, a daily message count to keep costs
-- in check, and site change requests for the site owner to review.
CREATE TABLE assistant_memory (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notes TEXT NOT NULL DEFAULT '[]', -- JSON array of short notes
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE assistant_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE site_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  request TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', -- new, done, declined
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
