-- Pose references of the No prompt approach carry their verified framing (FULL_BODY / THREE_QUARTER / UPPER_BODY / LOWER_BODY)
ALTER TABLE refs ADD COLUMN framing TEXT;
