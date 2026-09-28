-- The gatehouse rework (E:\Bascinet\V3\Fates\Incarn and gates.docx,
-- docs/systemdocs/GATEHOUSE.md). The Keep's gatehouse is the Courtyard now and
-- its portcullis is worked by rings from both ends; the Town Gatehouse stops
-- being the road out, and becomes the house that works the Bridge–Square gate,
-- takes requests to pass it, and prints Documents.
--
-- db:import-zones never updates or moves a row that already exists, so every
-- geography change docs/zones.yaml now describes is made here as well. Each
-- statement matches on slugs and is a no-op on a database that already has it.

-- ─── Tables ─────────────────────────────────────────────────────────────────

CREATE TYPE "GatePassageDirection" AS ENUM ('IN', 'OUT');
CREATE TYPE "GatePassageStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'MAGMA');
CREATE TYPE "GateDocumentationStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');

-- Documents are a kind of paper of their own: fixed text, nothing writes on,
-- seals or pins them.
ALTER TYPE "PaperKind" ADD VALUE 'DOCUMENTS';

-- What is done at the gate controls goes in the archive, never on a feed.
ALTER TYPE "ArchiveKind" ADD VALUE 'GATEHOUSE';

-- The Magma button works once a turn.
ALTER TABLE "GameState" ADD COLUMN "gatehouseMagmaTurnId" TEXT;

-- The account a set of Documents opens at an infoterminal.
ALTER TABLE "Tag" ADD COLUMN "documentsBankAccountId" TEXT;

CREATE TABLE "GatePassage" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "direction" "GatePassageDirection" NOT NULL,
    "status" "GatePassageStatus" NOT NULL DEFAULT 'PENDING',
    "text" TEXT NOT NULL,
    "offered" JSONB NOT NULL DEFAULT '[]',
    "locationId" TEXT,
    "turnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedByName" TEXT,
    "resolvedByRing" TEXT,
    "moved" JSONB,

    CONSTRAINT "GatePassage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GateDocumentation" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "status" "GateDocumentationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "name" TEXT,
    "occupation" TEXT,
    "fingerprint" TEXT,

    CONSTRAINT "GateDocumentation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GatePassage_status_direction_idx" ON "GatePassage"("status", "direction");
CREATE INDEX "GatePassage_characterId_status_idx" ON "GatePassage"("characterId", "status");
CREATE INDEX "GateDocumentation_status_idx" ON "GateDocumentation"("status");
CREATE INDEX "GateDocumentation_characterId_status_idx" ON "GateDocumentation"("characterId", "status");

ALTER TABLE "Tag" ADD CONSTRAINT "Tag_documentsBankAccountId_fkey" FOREIGN KEY ("documentsBankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GatePassage" ADD CONSTRAINT "GatePassage_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GateDocumentation" ADD CONSTRAINT "GateDocumentation_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── The Courtyard ──────────────────────────────────────────────────────────

-- The Keep's gatehouse is the Courtyard. Its rooms and its portcullis stay;
-- the portcullis's button moves to the two Location anchors in code.
UPDATE "Location" SET "name" = 'Courtyard' WHERE "slug" = 'fortress-2' AND "name" = 'Gatehouse';

-- ─── The Black Hills gate ───────────────────────────────────────────────────

-- The Town Gatehouse no longer opens onto the Bridge…
DELETE FROM "LocationLink" AS l
USING "Location" AS a, "Location" AS b
WHERE a."id" = l."aId"
  AND b."id" = l."bId"
  AND (
       (a."slug", b."slug") = ('bridge', 'town-1')
    OR (b."slug", a."slug") = ('bridge', 'town-1')
  );

-- …the Bridge opens straight onto the Square through the gate instead. A
-- manned gate, open as authored. The ends are stored in ascending slug order
-- (db/lib/locationGraph.js#orderEndpoints): 'bridge' < 'town-2'.
INSERT INTO "LocationLink" ("id", "aId", "bId", "announce", "modular", "isOpen", "authoredOpen", "updatedAt")
SELECT 'gatehouse-bridge-square', b."id", s."id", 'TRUE_NAME', true, true, true, CURRENT_TIMESTAMP
FROM "Location" AS b, "Location" AS s
WHERE b."slug" = 'bridge'
  AND s."slug" = 'town-2'
ON CONFLICT ("aId", "bId") DO NOTHING;

-- …and the way from the Square into the Gatehouse is for the rings that man it.
UPDATE "LocationLink" AS l
SET "requiredTagSlug" = 'gatehouse-key', "hidden" = false
FROM "Location" AS a, "Location" AS b
WHERE a."id" = l."aId"
  AND b."id" = l."bId"
  AND (
       (a."slug", b."slug") = ('town-1', 'town-2')
    OR (b."slug", a."slug") = ('town-1', 'town-2')
  );

-- ─── The Town Gatehouse's rooms ─────────────────────────────────────────────

-- The Gate: the doc's description, and a public side on the Bridge.
UPDATE "Room"
SET "description" = 'Great doors of steel loom, keeping the evils out of Ravenheart. A tiny window connects the gatehouse, allowing newcomers to be properly inspected. A small terminal is inlaid into the wall, with a small hole for you to insert your finger into if you are feeling brave. The metal floor of the fort''s entryway sounds hollow and almost feels warm to the touch.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'town-1-1';

INSERT INTO "RoomSide" ("id", "roomId", "locationId", "kind", "accessTagSlugs", "sortOrder", "updatedAt")
SELECT 'gatehouse-gate-bridge-side', r."id", l."id", 'PUBLIC', ARRAY[]::TEXT[], 0, CURRENT_TIMESTAMP
FROM "Room" AS r, "Location" AS l
WHERE r."slug" = 'town-1-1'
  AND l."slug" = 'bridge'
ON CONFLICT ("roomId", "locationId") DO NOTHING;

-- The Watchhouse becomes Gate Controls: open to whoever is in the Gatehouse
-- (getting into the Gatehouse is the lock), and its stash seed keeps only the
-- phonebook. What is lying in it now is left where it is.
UPDATE "Room"
SET "name" = 'Gate Controls',
    "description" = 'A room overlooking the gateway into the fortress. A terminal stands at the centre, allowing travellers to be easily processed, with some levers to the sides controlling the gate. Windows peer down at the bridge below.',
    "kind" = 'PUBLIC',
    "accessTagSlugs" = ARRAY[]::TEXT[],
    "stashSeed" = jsonb_build_object('items', '[["phonebook", 1]]'::jsonb, 'hidden', '[]'::jsonb, 'resources', 0),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'town-1-2'
  AND "name" = 'Watchhouse';

-- Two new rooms. Their Discord threads are opened by the next db:mirror.
INSERT INTO "Room" ("id", "slug", "name", "description", "sortOrder", "kind", "locationId", "accessTagSlugs", "updatedAt")
SELECT 'gatehouse-incarns-chambers', 'town-1-3', 'Incarn''s Chambers',
       'Tucked inside the interior of the fortress walls is a cramped room with a bunk and a wooden table stained by countless spilt cups of tea.',
       2, 'PRIVATE', l."id", ARRAY['incarns-key']::TEXT[], CURRENT_TIMESTAMP
FROM "Location" AS l
WHERE l."slug" = 'town-1'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "Room" ("id", "slug", "name", "description", "sortOrder", "kind", "locationId", "accessTagSlugs", "updatedAt")
SELECT 'gatehouse-window', 'town-1-4', 'Gatehouse Window',
       'A window between the streets of the fortress and the gatehouse gives a small glimpse into the inner machinations of the gate''s mechanisms.',
       3, 'PUBLIC', l."id", ARRAY[]::TEXT[], CURRENT_TIMESTAMP
FROM "Location" AS l
WHERE l."slug" = 'town-1'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "RoomSide" ("id", "roomId", "locationId", "kind", "accessTagSlugs", "sortOrder", "updatedAt")
SELECT 'gatehouse-window-square-side', r."id", l."id", 'PUBLIC', ARRAY[]::TEXT[], 0, CURRENT_TIMESTAMP
FROM "Room" AS r, "Location" AS l
WHERE r."slug" = 'town-1-4'
  AND l."slug" = 'town-2'
ON CONFLICT ("roomId", "locationId") DO NOTHING;

-- ─── Migrants ───────────────────────────────────────────────────────────────

-- A Migrant no longer starts with a treasury account: the Gatehouse opens one
-- when it documents them, once a character. The accounts creation already
-- opened for living Migrants would stand in the way of that, so the untouched
-- ones go — empty, no ring linked, no Documents, never used at the Depot.
-- Anything that ever held money or moved some is left alone, and the Meister
-- can delete it by hand.
DELETE FROM "BankAccount" AS acct
USING "Character" AS c, "Role" AS r
WHERE c."id" = acct."characterId"
  AND r."id" = c."roleId"
  AND r."slug" = 'migrant'
  AND acct."balanceObols" = 0
  AND NOT EXISTS (SELECT 1 FROM "Tag" AS t WHERE t."ringBankAccountId" = acct."id")
  AND NOT EXISTS (SELECT 1 FROM "DepotSale" AS s WHERE s."accountId" = acct."id")
  AND NOT EXISTS (SELECT 1 FROM "DepotOrder" AS o WHERE o."accountId" = acct."id");
