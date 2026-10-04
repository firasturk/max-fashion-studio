-- Verified crop of each upload (FULL_BODY / UPPER_BODY / LOWER_BODY), checked once before any prompt is written
ALTER TABLE sources ADD COLUMN framing TEXT;
