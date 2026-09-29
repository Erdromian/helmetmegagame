-- What docs/zones.yaml said the last time the zones sync applied it
-- (db/lib/zonesSync.js). Nullable and additive: the deploy row never uses it.
ALTER TABLE "SyncStamp" ADD COLUMN "snapshot" JSONB;
