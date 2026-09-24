-- Searching a room (docs/systemdocs/SEARCH.md §9).
--
-- RoomTag.hiddenQuantity: the units of a stack still under the floor. A
-- second COUNT beside `quantity` rather than a flag, because a room holds one
-- RoomTag row per tag and a flag would swallow anything a player later dropped
-- onto the same stack. Every stash reader selects on `quantity`, so a stack
-- that is entirely hidden is invisible to Storage, Transfer, Take and Steal
-- with no filter added. Defaulted to 0, so every existing row is unchanged.
--
-- RoomSearchAttempt: the ration. One row per searcher per room per turn, and
-- the unique index IS the rule — the insert is the claim, the
-- SearchAttempt / PickpocketAttempt discipline. turnId is a claim token, not a
-- foreign key, so deleting a turn never cascades into a spent ration.
--
-- Additive only. No existing row or column is touched.

ALTER TABLE "RoomTag" ADD COLUMN "hiddenQuantity" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "RoomSearchAttempt" (
    "id" TEXT NOT NULL,
    "searcherId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomSearchAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoomSearchAttempt_searcherId_roomId_turnId_key" ON "RoomSearchAttempt"("searcherId", "roomId", "turnId");
CREATE INDEX "RoomSearchAttempt_roomId_idx" ON "RoomSearchAttempt"("roomId");

ALTER TABLE "RoomSearchAttempt" ADD CONSTRAINT "RoomSearchAttempt_searcherId_fkey" FOREIGN KEY ("searcherId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomSearchAttempt" ADD CONSTRAINT "RoomSearchAttempt_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
