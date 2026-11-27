-- Each gathered picture is looked at once in the background: usable means a real photograph of a
-- model with most of the body in view and nothing printed over it. Ready skills are complete
-- skills (reference photos and written text) the studio prepared and nobody has approved yet.
ALTER TABLE pin_library ADD COLUMN usable INTEGER; -- NULL = not looked at yet
CREATE INDEX pin_library_usable ON pin_library(state, usable, account, board);
CREATE TABLE skill_drafts (
  id TEXT PRIMARY KEY,       -- becomes the skill's id on approval; its photos already sit under it
  origin TEXT NOT NULL,      -- account and board the photos came from
  title TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL,
  library TEXT NOT NULL,
  photos INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'waiting', -- waiting | approved | dismissed
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX skill_drafts_state ON skill_drafts(state, created);
