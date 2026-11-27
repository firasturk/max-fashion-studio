-- Google Drive inbox: delivery folders found under the connected folder. A folder waits here
-- until someone approves it; approval imports its photos into a batch.
CREATE TABLE IF NOT EXISTS drive_folders (
  id TEXT PRIMARY KEY,                  -- Drive folder id
  name TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',         -- category folder it sits in, if any
  files INTEGER NOT NULL DEFAULT 0,      -- photos found
  bytes INTEGER NOT NULL DEFAULT 0,
  modified INTEGER NOT NULL DEFAULT 0,   -- newest photo (ms)
  thumbs TEXT NOT NULL DEFAULT '[]',     -- up to four Drive file ids for the preview strip
  state TEXT NOT NULL DEFAULT 'waiting', -- waiting | importing | imported | failed | skipped | gone
  batch TEXT,
  imported INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,    -- files left out (unsupported type, too large)
  error TEXT,
  seen INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS drive_folders_state ON drive_folders(state, updated);
