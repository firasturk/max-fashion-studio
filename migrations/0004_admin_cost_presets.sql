-- Roles and account state
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_seen INTEGER;

-- Estimated spend recorded per generation attempt
ALTER TABLE tasks ADD COLUMN cost REAL NOT NULL DEFAULT 0;

-- Saved creative-direction templates
CREATE TABLE presets (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX presets_owner ON presets(owner, created);

-- The first registered account becomes the admin
UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM users ORDER BY created ASC LIMIT 1);
