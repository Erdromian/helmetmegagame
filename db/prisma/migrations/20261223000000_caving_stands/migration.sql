-- Where everybody stood when the turn locked (docs/systemdocs/CAVING.md §5c).
--
-- Until the lock, the Caving lens shows each caver's 1s as their own result. At the lock,
-- everybody standing in one Location becomes ONE result, cavers with no 1s included, and this
-- table is the record of who stood where — so History groups a past turn the way it was
-- adjudicated, whoever has walked off since. db/lib/cavingStand.js writes it.
--
-- Additive: one new table, nothing dropped and no backfill. A turn that never froze (every turn
-- before this, and a turn that never locks) keeps one result per caver.
--
-- `prisma migrate diff` also proposes dropping Action_locationId_idx and two trgm indexes.
-- Declined — none of them is drift this introduced (CLAUDE.md, "Notes for future work").

-- CreateTable
CREATE TABLE "CavingStand" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "locationId" TEXT,
    "zoneId" TEXT,
    "presentedState" JSONB,
    "presentedAs" JSONB,
    "alert" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CavingStand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CavingStand_turnId_locationId_idx" ON "CavingStand"("turnId", "locationId");

-- CreateIndex
CREATE INDEX "CavingStand_characterId_idx" ON "CavingStand"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "CavingStand_turnId_characterId_key" ON "CavingStand"("turnId", "characterId");

-- AddForeignKey
ALTER TABLE "CavingStand" ADD CONSTRAINT "CavingStand_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CavingStand" ADD CONSTRAINT "CavingStand_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CavingStand" ADD CONSTRAINT "CavingStand_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The desk's live channel (20260921030000_desk_notify). A stand is not a desk row; it announces
-- the CHARACTER it belongs to, type 'stand', because the desk keeps one "standing" per character
-- (web/lib/deskRows.js#cavingStandingsFor) and re-reads that. The character id, not the stand's
-- own, so a cascade delete still names a row the desk can drop.
CREATE OR REPLACE FUNCTION bascinet_caving_stand_notify() RETURNS trigger AS $$
DECLARE
  character_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    character_id := OLD."characterId";
  ELSE
    character_id := NEW."characterId";
  END IF;
  PERFORM pg_notify(
    'bascinet_desk',
    json_build_object('t', 'stand', 'id', character_id, 'op', 'row')::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "CavingStand_notify" ON "CavingStand";
CREATE TRIGGER "CavingStand_notify"
  AFTER INSERT OR UPDATE OR DELETE ON "CavingStand"
  FOR EACH ROW EXECUTE FUNCTION bascinet_caving_stand_notify();
