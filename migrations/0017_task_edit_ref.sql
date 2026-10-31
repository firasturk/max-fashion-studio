-- A reference photo the team attached in the assistant chat for the pending revision (R2 key):
-- the engine copies only its pose. Cleared with the revision text once the new result is stored.
ALTER TABLE tasks ADD COLUMN edit_ref TEXT;
