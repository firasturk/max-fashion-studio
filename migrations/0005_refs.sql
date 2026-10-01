-- Reference library: inspiration photos per skill (background, pose and lighting only)
CREATE TABLE IF NOT EXISTS refs (
  id TEXT PRIMARY KEY,
  skill TEXT NOT NULL,
  key TEXT NOT NULL,
  name TEXT,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS refs_skill ON refs(skill);
