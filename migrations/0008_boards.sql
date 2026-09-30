-- Play mats players upload on the "Add a board" page (/play/mats). The picture is kept in the row
-- (a WebP the browser shrinks first, well under D1's 2 MB limit), so no separate file storage is needed.
CREATE TABLE boards (
  id TEXT PRIMARY KEY,                    -- "u-" plus a short random id; used as the mat id in saved choices
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aspect REAL NOT NULL,                   -- width / height of the picture
  layout TEXT NOT NULL,                   -- JSON MatLayout: where each card spot sits, as % of the picture
  image BLOB NOT NULL,                    -- the picture (image/webp or image/jpeg)
  image_type TEXT NOT NULL,
  thumb BLOB NOT NULL,                    -- a small copy for the board picker
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX boards_user ON boards(user_id);
