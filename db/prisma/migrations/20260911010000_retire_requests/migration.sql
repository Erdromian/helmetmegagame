-- Player actions stop being Requests.
--
-- The effect always landed immediately; the Request row was the review record
-- behind /gm/turns' Requests tab and its Undo. Both are gone, and the AuditLog
-- row that every action already wrote alongside is now the whole record.
--
-- Written by hand rather than from `migrate diff`, because the diff also
-- proposed dropping ArchiveEntry_content_trgm_idx, DirectMessage_content_trgm_idx
-- and Action.opposed. The first two are raw-SQL indexes Prisma's schema cannot
-- express (CLAUDE.md says decline them) and the third is not this change's.

-- The Caving find carries its own undo stamp now, instead of pointing at a
-- CAVING_LOOT Request.
ALTER TABLE "CavingRoll" DROP CONSTRAINT "CavingRoll_lootRequestId_fkey";
DROP INDEX "CavingRoll_lootRequestId_key";
ALTER TABLE "CavingRoll" DROP COLUMN "lootRequestId",
  ADD COLUMN "lootUndoneAt" TIMESTAMP(3);

-- The per-turn rations (MEDICAL_TIER_CAPS, DEAD_SIMPLE_PER_TURN, a tag's own
-- requirementPerTurn) counted Request rows. They count audit rows now, so the
-- turn has to be on the row and the lookup has to be indexed.
ALTER TABLE "AuditLog" ADD COLUMN "turnId" TEXT;
CREATE INDEX "AuditLog_targetCharacterId_actionType_turnId_idx"
  ON "AuditLog"("targetCharacterId", "actionType", "turnId");

-- /gm/audit's free-text search casts details to text and ILIKEs it, which was
-- an unindexable full-table scan. Same treatment ArchiveEntry_content_trgm_idx
-- already gets. Prisma's schema cannot express this, so `migrate diff` will
-- propose dropping it forever after — decline.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "AuditLog_details_trgm_idx"
  ON "AuditLog" USING GIN ((details::text) gin_trgm_ops);

-- Dead links to the row that no longer exists.
ALTER TABLE "CraftProject" DROP COLUMN "requestId";
ALTER TABLE "Structure" DROP COLUMN "requestId";

DROP TABLE "Request";
DROP TYPE "RequestStatus";
DROP TYPE "RequestType";
