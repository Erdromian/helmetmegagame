-- The GM zone seat becomes a GM zone VIEW: no longer a default filter that
-- hides nothing, but the thing that decides which Discord channels and which
-- desk rows a GM gets. Nothing is carried over from GmAssignment on purpose —
-- an empty GmZoneView means every GM sees every zone, so the migration cannot
-- lock anybody out of their own job.
DROP TABLE IF EXISTS "GmAssignment";

CREATE TABLE "GmZoneView" (
    "discordUserId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmZoneView_pkey" PRIMARY KEY ("discordUserId","zoneId")
);

CREATE INDEX "GmZoneView_zoneId_idx" ON "GmZoneView"("zoneId");
CREATE INDEX "GmZoneView_discordUserId_idx" ON "GmZoneView"("discordUserId");

ALTER TABLE "GmZoneView" ADD CONSTRAINT "GmZoneView_zoneId_fkey"
  FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One "GM: <Zone>" Discord role per zone, provisioned by db:sync-zones the
-- same way "Zone: <Zone>" already is.
ALTER TABLE "Zone" ADD COLUMN "gmRoleId" TEXT;
CREATE UNIQUE INDEX "Zone_gmRoleId_key" ON "Zone"("gmRoleId");
