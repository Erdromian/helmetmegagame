-- Medical pass M0 (docs/systemdocs/TAGS.md §5c; planning/medical-pass-plan.md):
-- the item-cures mechanic's schema, plus the poison-state columns it shares
-- a migration with. All nullable/defaulted, following the `expiresInto`
-- Json precedent — every row already in these tables is valid as it stands.
--
-- Tag.cures / Tag.curesInto — what a consumable cures, and the per-item
--   aftermath override (prosthetics). Tag.administerable / administerSkill —
--   whether and by whom an item may be applied to someone else. Tag.poison /
--   Tag.resists are schema-only for now; the Poison action that reads them
--   is a later milestone.
ALTER TABLE "Tag" ADD COLUMN "cures" JSONB;
ALTER TABLE "Tag" ADD COLUMN "curesInto" JSONB;
ALTER TABLE "Tag" ADD COLUMN "administerable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tag" ADD COLUMN "administerSkill" TEXT;
ALTER TABLE "Tag" ADD COLUMN "poison" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tag" ADD COLUMN "resists" JSONB;

-- CharacterTag/RoomTag.poisonedCount + poisonPayload — poison state on the
-- real food/drink row (never a minted clone), or the same pair on a room
-- stash. Schema-only until the Poison action lands.
ALTER TABLE "CharacterTag" ADD COLUMN "poisonedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CharacterTag" ADD COLUMN "poisonPayload" JSONB;

ALTER TABLE "RoomTag" ADD COLUMN "poisonedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RoomTag" ADD COLUMN "poisonPayload" JSONB;
