-- Searching a room (docs/systemdocs/SEARCH.md §9).
--
-- RoomTag.hiddenQuantity: the units of a stack still under the floor. A
-- second COUNT beside `quantity` rather than a flag, because a room holds one
-- RoomTag row per tag and a flag would swallow anything a player later dropped
-- onto the same stack. Every stash reader selects on `quantity`, so a stack
-- that is entirely hidden is invisible to Storage, Transfer, Take and Steal
-- with no filter added. Defaulted to 0, so every existing row is unchanged.
--
-- RoomSearchAttempt: one row per search. The rule it answers is ONE ROOM A
-- TURN — a character may go through the same room again, never a second one —
-- and it is checked under the Character row lock rather than by a unique
-- index, since several searches of one room are all allowed. turnId is a claim
-- token, not a foreign key, so deleting a turn never rewrites who searched
-- where.
--
-- RoomTag.hiddenPoisonedCount and RoomTag.floorDay: what a character leaves
-- on a public floor sinks under it after a whole in-game day
-- (docs/systemdocs/CARRY.md §6a). floorDay is the day it was left, stamped
-- by the drop paths only; the poison twin keeps a sinking poisoned stack
-- poisoned. Both default to "nothing": 0, and NULL, which never sinks.
--
-- Additive only. No existing row or column is touched.

ALTER TABLE "RoomTag" ADD COLUMN "hiddenQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RoomTag" ADD COLUMN "hiddenPoisonedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RoomTag" ADD COLUMN "floorDay" INTEGER;
CREATE INDEX "RoomTag_floorDay_idx" ON "RoomTag"("floorDay");

CREATE TABLE "RoomSearchAttempt" (
    "id" TEXT NOT NULL,
    "searcherId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomSearchAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RoomSearchAttempt_searcherId_turnId_idx" ON "RoomSearchAttempt"("searcherId", "turnId");
CREATE INDEX "RoomSearchAttempt_roomId_idx" ON "RoomSearchAttempt"("roomId");

ALTER TABLE "RoomSearchAttempt" ADD CONSTRAINT "RoomSearchAttempt_searcherId_fkey" FOREIGN KEY ("searcherId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomSearchAttempt" ADD CONSTRAINT "RoomSearchAttempt_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
