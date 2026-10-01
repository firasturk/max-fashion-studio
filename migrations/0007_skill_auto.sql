-- auto = 1: the skill's direction and library are written from its reference photos and refreshed when they change
ALTER TABLE skills ADD COLUMN auto INTEGER NOT NULL DEFAULT 1;
