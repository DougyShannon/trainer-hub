-- Battle tab battles between two trainers. The battle itself lives in a LiveBattleRoom Durable
-- Object; this table lists battles for the lobby and keeps results.
CREATE TABLE live_battles (
  id TEXT PRIMARY KEY,
  format TEXT NOT NULL,                   -- Showdown format id, e.g. gen9ou
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting, playing, finished, cancelled
  is_open INTEGER NOT NULL DEFAULT 1,     -- 1 = listed in the lobby, 0 = only people with the link can join
  host_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_team_name TEXT NOT NULL,
  guest_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_team_name TEXT,
  winner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  end_reason TEXT,
  turns INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX live_battles_lobby ON live_battles (status, is_open, created_at);
CREATE INDEX live_battles_host ON live_battles (host_user_id, created_at);
CREATE INDEX live_battles_guest ON live_battles (guest_user_id, created_at);
