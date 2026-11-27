-- The Pinterest library: pictures gathered from the watched accounts, waiting for a person to
-- pick them into a skill or hide them. "twin" marks near-copies of one picture (the same photo
-- posted again with different text over it), so only the first is ever kept.
CREATE TABLE pin_library (
  id TEXT PRIMARY KEY,     -- the Pinterest pin id
  account TEXT NOT NULL,   -- the watched account it came from
  board TEXT NOT NULL DEFAULT '',
  thumb TEXT NOT NULL,
  image TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  twin TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'new', -- new | hidden | used
  seen INTEGER NOT NULL
);
CREATE UNIQUE INDEX pin_library_twin ON pin_library(twin);
CREATE INDEX pin_library_state ON pin_library(state, seen);
DROP TABLE IF EXISTS skill_suggestions;
