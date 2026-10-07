-- Per-image engine override: set when a content checker refused the photo on the batch's engine
-- and the image is retried on another connected engine.
ALTER TABLE tasks ADD COLUMN model TEXT;
