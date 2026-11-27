-- The client's tracker sheet, copied as it is read (read only): one line per folder received.
CREATE TABLE IF NOT EXISTS tracker_rows (
  month TEXT NOT NULL,                 -- the tab, as "2026-11"
  pos INTEGER NOT NULL,                -- line inside the tab
  name TEXT NOT NULL,
  key TEXT NOT NULL,                   -- the name, normalised for matching
  done INTEGER NOT NULL DEFAULT 0,     -- products delivered
  shared INTEGER NOT NULL DEFAULT 0,   -- products received
  delivered INTEGER NOT NULL DEFAULT 0,
  received TEXT NOT NULL DEFAULT '',
  sent TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  upload TEXT NOT NULL DEFAULT '',     -- "25Nov/ReadyToPublish"
  published TEXT NOT NULL DEFAULT '',  -- what the client says about that upload
  PRIMARY KEY (month, pos)
);
-- What the tracker says about a Drive folder: 'delivered', 'working', or NULL when it is not listed.
ALTER TABLE drive_folders ADD COLUMN tracker_state TEXT;
-- The tracker line behind that, as JSON { line, sent, received, upload, published }.
ALTER TABLE drive_folders ADD COLUMN tracker_info TEXT;
