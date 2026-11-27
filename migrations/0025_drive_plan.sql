-- What a person chose for a delivery before approving it: which photos to generate and which
-- skill each one gets, as JSON { photo id: skill | "*" (the folder's skill) | "" (leave out) }.
ALTER TABLE drive_folders ADD COLUMN plan TEXT;
