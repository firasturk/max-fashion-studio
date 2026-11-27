-- The client's Drive is a tree (month / day / department / delivery / product), so the inbox
-- remembers the folders it walked through as well as the deliveries themselves.
ALTER TABLE drive_folders ADD COLUMN parent TEXT;
-- Product folders inside a delivery.
ALTER TABLE drive_folders ADD COLUMN products INTEGER NOT NULL DEFAULT 0;
-- When the folder's own contents were last listed (0 = never).
ALTER TABLE drive_folders ADD COLUMN walked INTEGER NOT NULL DEFAULT 0;
-- When a delivery's photos were last counted (0 = never).
ALTER TABLE drive_folders ADD COLUMN scanned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS drive_folders_parent ON drive_folders(parent);
