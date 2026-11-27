-- Skills the studio proposes from the Pinterest boards it watches. Nothing becomes a skill until
-- a person approves it; a dismissed board is remembered so it is not proposed again.
CREATE TABLE skill_suggestions (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,   -- which board of which account this came from
  link TEXT NOT NULL,     -- the Pinterest page to open
  title TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT '',
  pins TEXT NOT NULL,     -- JSON: [{ id, thumb, image }]
  state TEXT NOT NULL DEFAULT 'waiting', -- waiting | approved | dismissed
  skill TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE UNIQUE INDEX skill_suggestions_origin ON skill_suggestions(origin);
