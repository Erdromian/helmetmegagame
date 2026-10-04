-- A staged public declaration can post into one Location's channel or one
-- Room's thread instead of the zone's #summary (docs/systemdocs/ADJUDICATION.md
-- §1). Three nullable columns; every existing row keeps posting where it did.
-- The index drops `migrate diff` proposes alongside this are declined, as
-- CLAUDE.md "Notes for future work" says.

-- AlterTable
ALTER TABLE "StagedMessage" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "placeName" TEXT,
ADD COLUMN     "roomId" TEXT;

-- CreateIndex
CREATE INDEX "StagedMessage_locationId_idx" ON "StagedMessage"("locationId");

-- CreateIndex
CREATE INDEX "StagedMessage_roomId_idx" ON "StagedMessage"("roomId");

-- AddForeignKey
ALTER TABLE "StagedMessage" ADD CONSTRAINT "StagedMessage_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedMessage" ADD CONSTRAINT "StagedMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
