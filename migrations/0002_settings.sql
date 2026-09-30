-- Server-side settings entered from the app (values encrypted with SESSION_SECRET)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated INTEGER NOT NULL
);
