-- Changes to the studio itself, requested from the chat and carried out by the developer agent
-- (a GitHub Actions run that edits the code, checks it, deploys and reports back).
CREATE TABLE IF NOT EXISTS dev_jobs (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed
  request TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  result TEXT,
  run_url TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dev_jobs_user ON dev_jobs(user, created);
