-- Kissing (docs/systemdocs/KISS.md): a consent verb between two characters
-- standing in the same place. One enum value and nothing else — the Offer
-- table's initiatorId/responderId already carry everything a kiss needs, so
-- there is no payload column to add and nothing to backfill.
--
-- The 2-hour cooldown and the per-turn mood ration are both AuditLog reads
-- (db/lib/kiss.js, db/lib/mood.js), deliberately not columns.

ALTER TYPE "OfferKind" ADD VALUE IF NOT EXISTS 'KISS';
