-- Video clips rendered from finished images (Kling through the team's Higgsfield account).
CREATE TABLE clips (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(id),
  batch TEXT NOT NULL,
  task TEXT NOT NULL,
  name TEXT NOT NULL,
  skill TEXT,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | rendering | ready | approved | failed
  job TEXT,             -- Higgsfield job id once submitted
  seconds INTEGER NOT NULL,
  ratio TEXT NOT NULL,
  motion TEXT NOT NULL,
  credits REAL NOT NULL DEFAULT 0,
  key TEXT,             -- R2 key of the finished clip
  poster TEXT,          -- R2 key of the still it starts from
  error TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX clips_owner ON clips(owner, created);
CREATE INDEX clips_status ON clips(status);
