-- Users and sessions (own authentication boundary)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Batches own settings; every source/task row belongs to exactly one batch
CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle', -- idle | running | paused
  last_error TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX batches_owner_created ON batches(owner, created);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  batch TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stem TEXT NOT NULL,
  key TEXT NOT NULL,
  reference_key TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'lead', -- lead | supporting
  engine_url TEXT, -- cached public URL of the inference reference on the image engine
  created INTEGER NOT NULL
);
CREATE UNIQUE INDEX sources_batch_stem ON sources(batch, stem);

CREATE TABLE identities (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  engine_url TEXT,
  created INTEGER NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  batch TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  source TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  card INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | processing | finalizing | ready | review | approved | failed
  output TEXT,          -- R2 key of the latest revision
  output_engine_url TEXT, -- cached public URL of the latest result on the engine (for chaining)
  qa TEXT,
  error TEXT,
  prompt TEXT NOT NULL DEFAULT '',
  edit TEXT,            -- pending revision instruction while processing
  attempts INTEGER NOT NULL DEFAULT 0,
  recenter INTEGER NOT NULL DEFAULT 0, -- 1 when the next submission is the one automatic centering retry
  request_id TEXT,      -- engine request id while processing
  lease TEXT,
  leased_at INTEGER,
  updated INTEGER NOT NULL
);
CREATE INDEX tasks_batch ON tasks(batch);
CREATE INDEX tasks_status ON tasks(batch, status);
