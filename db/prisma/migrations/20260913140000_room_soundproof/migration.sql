-- A room the walls hold the sound in: a /shout made inside one never leaves
-- its thread. Set from `soundproof: true` in docs/zones.yaml by db:sync-zones.
ALTER TABLE "Room" ADD COLUMN "soundproof" BOOLEAN NOT NULL DEFAULT false;
