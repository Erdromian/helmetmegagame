-- Seats a weighted role has before its per-100-players share is counted
-- (docs/systemdocs/CHARACTERS.md "Seat caps"). Defaults 0, so every role
-- keeps the cap it has until db:sync-roles writes a `base_seats:` from the YAML.
ALTER TABLE "Role" ADD COLUMN "baseSeats" INTEGER NOT NULL DEFAULT 0;
