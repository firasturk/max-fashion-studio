-- Every click and decision in the studio, and every engine outcome, as one event stream: the
-- record the brand memory learns from.
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  user TEXT,                              -- user id; NULL for the engine and the learner
  actor TEXT NOT NULL DEFAULT 'user',     -- user | engine | learn
  kind TEXT NOT NULL,                     -- click | revise | approve | export | config | rule | reference | engine.result | engine.failed | ...
  batch TEXT,
  task TEXT,
  source TEXT,
  skill TEXT,
  mode TEXT,
  data TEXT NOT NULL DEFAULT '{}'         -- JSON details (button label, revision text, error, qa summary ...)
);
CREATE INDEX IF NOT EXISTS events_at ON events(at);
CREATE INDEX IF NOT EXISTS events_batch ON events(batch, at);
CREATE INDEX IF NOT EXISTS events_kind ON events(kind, at);

-- Brand memory: what the team's corrections taught the studio, as rules and insights per skill.
CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global',   -- global | skill:<id> | mode:<id>
  kind TEXT NOT NULL DEFAULT 'insight',   -- rule | avoid | insight
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  evidence INTEGER NOT NULL DEFAULT 0,    -- how many events support it
  examples TEXT NOT NULL DEFAULT '[]',    -- JSON: short quotes from the events
  status TEXT NOT NULL DEFAULT 'suggested', -- suggested | active | dismissed
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_status ON memory(status, scope);
