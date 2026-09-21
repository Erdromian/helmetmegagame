-- Instruments (docs/systemdocs/SOUND.md, "Performances"). Two Tag columns: the
-- player-chosen consume list (the Instrument Kit) and the instrument flag.
ALTER TABLE "Tag" ADD COLUMN "consumeChoice" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Tag" ADD COLUMN "instrument" BOOLEAN NOT NULL DEFAULT false;

-- One song on one instrument, heard by everyone at the Location.
CREATE TABLE "Performance" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "instrumentSlug" TEXT NOT NULL,
    "songKey" TEXT NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "stoppedAt" TIMESTAMP(3),
    "stoppedReason" TEXT,

    CONSTRAINT "Performance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Performance_locationId_stoppedAt_idx" ON "Performance"("locationId", "stoppedAt");
CREATE INDEX "Performance_characterId_idx" ON "Performance"("characterId");

ALTER TABLE "Performance" ADD CONSTRAINT "Performance_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Performance" ADD CONSTRAINT "Performance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one unstopped row per character. PARTIAL, so Prisma's schema cannot
-- say it: `migrate diff` proposes dropping it on every run, and the drop must
-- be declined (CLAUDE.md, "Notes for future work").
CREATE UNIQUE INDEX "Performance_live_unique" ON "Performance"("characterId") WHERE "stoppedAt" IS NULL;
