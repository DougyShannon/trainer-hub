-- Where a game is played: a gym or stadium id from src/shared/venues.ts, or NULL for "anywhere".
ALTER TABLE games ADD COLUMN venue TEXT;
