-- A rail tunnel between two Locations. One more modifier on the edge rather
-- than a new kind of edge, so it composes with locked/hidden/modular/keyed/
-- on_foot the way those already compose with each other -- see LocationLink's
-- header in schema.prisma, and db/lib/railroad.js for what it actually costs
-- somebody who walks into one while the cargo train is running.
--
-- Additive, NOT NULL with a default, no backfill and no index: every existing
-- edge is already correct as `false`, which is what "not a railroad" means.
ALTER TABLE "LocationLink" ADD COLUMN "railroad" BOOLEAN NOT NULL DEFAULT false;
