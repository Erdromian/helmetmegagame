-- The Depot Overhaul (E:\Bascinet\V3\Merchant\Depot Overhaul.docx,
-- docs/systemdocs/DEPOT.md). The Merchant's Terminal replaces the Depot's
-- counter page and its drop box; the train settles in bulk; the Merchant's
-- Office and Cargo Bay move to the Depot; the Storefront's counter opens onto
-- both places.
--
-- db:import-zones never updates or moves a row that already exists, so every
-- geography change docs/zones.yaml now describes is made here as well. Each
-- statement matches on slugs and is a no-op on a database that already has it.

-- ─── The terminal ───────────────────────────────────────────────────────────

-- Its own coin, separate from the treasury. Nobody has put any in yet.
ALTER TABLE "Depot" ADD COLUMN "terminalObols" INTEGER NOT NULL DEFAULT 0;

-- The Company's credit line is gone: the Merchant takes no credit through his
-- terminal. A standing balance is simply forgiven; the ledger keeps its rows.
ALTER TABLE "Depot" DROP COLUMN "debtObols";
ALTER TABLE "Depot" DROP COLUMN "creditCapObols";

-- An order on the terminal's pending list, paid when the train comes in.
CREATE TABLE "MerchantOrder" (
    "id" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "totalObols" INTEGER NOT NULL,
    "placedByCharacterId" TEXT,
    "placedByName" TEXT NOT NULL,
    "placedTurn" INTEGER NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "deliveredTurn" INTEGER,
    "paidObols" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MerchantOrder_deliveredAt_idx" ON "MerchantOrder"("deliveredAt");

-- ─── Crates ─────────────────────────────────────────────────────────────────

-- The turn a character last hauled a crate, so only the first of a turn tires.
ALTER TABLE "Character" ADD COLUMN "crateHauledTurn" INTEGER;

-- ─── The map ────────────────────────────────────────────────────────────────

-- "Merchant" is the Storefront now.
UPDATE "Location" SET "name" = 'Storefront' WHERE "slug" = 'undertown-6' AND "name" = 'Merchant';

-- Its Storefront room is the Merchant's Counter.
UPDATE "Room" SET "name" = 'Merchant''s Counter' WHERE "slug" = 'undertown-6-1' AND "name" = 'Storefront';

-- The Merchant's Office and the Cargo Bay move to the Depot. Their Discord
-- threads hang under the Storefront's channel and a thread cannot change
-- channels, so the thread columns are cleared: the next db:mirror opens a
-- fresh thread for each under the Depot's channel (the old ones are left
-- where they are, for a GM to archive). Who was in each thread is cleared
-- with them, so the access sync adds the right people to the new one.
UPDATE "Room" AS r
SET "locationId" = d."id",
    "sortOrder" = CASE r."slug" WHEN 'undertown-6-2' THEN 1 ELSE 2 END,
    "discordThreadId" = NULL,
    "starterMessageId" = NULL,
    "postHash" = NULL
FROM "Location" AS d
WHERE d."slug" = 'undertown-5'
  AND r."slug" IN ('undertown-6-2', 'undertown-6-3')
  AND r."locationId" <> d."id";

UPDATE "Character" AS c
SET "roomThreadRoomIds" = ARRAY(
  SELECT k FROM unnest(c."roomThreadRoomIds") AS k
  WHERE k NOT IN (SELECT "id" FROM "Room" WHERE "slug" IN ('undertown-6-2', 'undertown-6-3'))
)
WHERE c."roomThreadRoomIds" && ARRAY(SELECT "id" FROM "Room" WHERE "slug" IN ('undertown-6-2', 'undertown-6-3'));

-- A guest pass is bound to the side it was given at (MAP.md §2d); a room with
-- no sides has only its home, which is the Depot now.
UPDATE "RoomGuest" AS g
SET "locationId" = r."locationId"
FROM "Room" AS r
WHERE r."id" = g."roomId"
  AND r."slug" IN ('undertown-6-2', 'undertown-6-3')
  AND g."locationId" <> r."locationId";

-- The Merchant's Counter opens onto the Depot as well, publicly.
INSERT INTO "RoomSide" ("id", "roomId", "locationId", "kind", "accessTagSlugs", "sortOrder", "updatedAt")
SELECT 'depot-counter-side', r."id", d."id", 'PUBLIC', ARRAY[]::TEXT[], 0, CURRENT_TIMESTAMP
FROM "Room" AS r, "Location" AS d
WHERE r."slug" = 'undertown-6-1'
  AND d."slug" = 'undertown-5'
ON CONFLICT ("roomId", "locationId") DO NOTHING;

-- The way between the Storefront and the Depot is locked to the Merchant's
-- and the Dockers' rings: both carry the depot-keycard token.
UPDATE "LocationLink" AS l
SET "requiredTagSlug" = 'depot-keycard', "hidden" = false
FROM "Location" AS a, "Location" AS b
WHERE a."id" = l."aId"
  AND b."id" = l."bId"
  AND (
       (a."slug", b."slug") = ('undertown-5', 'undertown-6')
    OR (b."slug", a."slug") = ('undertown-5', 'undertown-6')
  );
