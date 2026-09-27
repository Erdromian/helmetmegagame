-- Multi-locational rooms.docx: a room that opens onto more than one Location
-- (a window, a counter), gated separately on each side, with a Discord thread
-- per side and every line relayed between them (docs/systemdocs/MAP.md §2d).
-- Additive: no room has a side until a GM adds one at /gm/dev/zones.

-- One further Location a Room opens onto. The home side stays on "Room".
CREATE TABLE "RoomSide" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "kind" "RoomKind" NOT NULL DEFAULT 'PUBLIC',
    "accessTagSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "discordThreadId" TEXT,
    "starterMessageId" TEXT,
    "postHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomSide_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoomSide_discordThreadId_key" ON "RoomSide"("discordThreadId");
CREATE UNIQUE INDEX "RoomSide_roomId_locationId_key" ON "RoomSide"("roomId", "locationId");
CREATE INDEX "RoomSide_locationId_idx" ON "RoomSide"("locationId");

ALTER TABLE "RoomSide" ADD CONSTRAINT "RoomSide_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoomSide" ADD CONSTRAINT "RoomSide_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One copy of an archive row in a thread other than the one it was said in.
CREATE TABLE "ArchiveRelay" (
    "id" TEXT NOT NULL,
    "archiveEntryId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "discordMessageId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveRelay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArchiveRelay_discordMessageId_key" ON "ArchiveRelay"("discordMessageId");
CREATE UNIQUE INDEX "ArchiveRelay_archiveEntryId_threadId_key" ON "ArchiveRelay"("archiveEntryId", "threadId");

ALTER TABLE "ArchiveRelay" ADD CONSTRAINT "ArchiveRelay_archiveEntryId_fkey"
    FOREIGN KEY ("archiveEntryId") REFERENCES "ArchiveEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A guest is let in at one side. Every existing grant was given at the room's
-- only Location, its home, so that is the backfill.
ALTER TABLE "RoomGuest" ADD COLUMN "locationId" TEXT;
UPDATE "RoomGuest" g SET "locationId" = r."locationId" FROM "Room" r WHERE r."id" = g."roomId";
ALTER TABLE "RoomGuest" ALTER COLUMN "locationId" SET NOT NULL;
