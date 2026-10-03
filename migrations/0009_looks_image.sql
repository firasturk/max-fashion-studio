-- A saved look keeps a copy of the image it was saved from, as its reminder thumbnail
ALTER TABLE looks ADD COLUMN image TEXT;
