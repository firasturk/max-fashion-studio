-- No prompt references carry what the vision model read from them: light, shadows, camera and standing spot
-- for a background; stance, hands, head and gaze for a pose. Written once, reused by every batch.
ALTER TABLE refs ADD COLUMN notes TEXT;
