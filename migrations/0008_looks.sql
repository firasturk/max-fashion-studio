-- Saved looks: prompts the team liked, kept per skill to reuse as the direction of later batches
CREATE TABLE IF NOT EXISTS looks (
  id TEXT PRIMARY KEY,
  skill TEXT NOT NULL,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  negative TEXT NOT NULL DEFAULT '',
  scene TEXT NOT NULL DEFAULT '',
  pose TEXT NOT NULL DEFAULT '',
  light TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS looks_skill ON looks (skill, created);
