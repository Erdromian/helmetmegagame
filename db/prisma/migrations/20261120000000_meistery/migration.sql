-- The Meistery (E:\Bascinet\V3\Fates\Meistery.docx, docs/systemdocs/MEISTERY.md):
-- daily wages, the Meister's Terminal re-keyed for the Hand, and the Meistery
-- Window onto the Residences.

-- ─── Wages ──────────────────────────────────────────────────────────────────

CREATE TABLE "Wage" (
    "id" TEXT NOT NULL,
    "roleId" TEXT,
    "characterId" TEXT,
    "amountObols" INTEGER NOT NULL,
    "setByCharacterId" TEXT,
    "setByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wage_pkey" PRIMARY KEY ("id"),
    -- For one fate or one character, never both and never neither. Prisma's
    -- schema cannot say this, and `migrate diff` never mentions it.
    CONSTRAINT "Wage_one_target" CHECK (("roleId" IS NULL) <> ("characterId" IS NULL))
);

CREATE UNIQUE INDEX "Wage_roleId_key" ON "Wage"("roleId");
CREATE UNIQUE INDEX "Wage_characterId_key" ON "Wage"("characterId");

ALTER TABLE "Wage" ADD CONSTRAINT "Wage_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Wage" ADD CONSTRAINT "Wage_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WagePayout" (
    "dayNumber" INTEGER NOT NULL,
    "turnNumber" INTEGER,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "characters" INTEGER NOT NULL DEFAULT 0,
    "creditedObols" INTEGER NOT NULL DEFAULT 0,
    "debitedObols" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WagePayout_pkey" PRIMARY KEY ("dayNumber")
);

-- Every day already over counts as paid. The wage pass also pays YESTERDAY if
-- it finds it unpaid (db/lib/wagePass.js#wageDaysDue — the backstop for a day
-- that rolled between a turn's close and the next one opening), and without
-- this the first close after the deploy would pay a day nobody had set a wage
-- for. The day in progress is left out, so it is paid at its own end.
INSERT INTO "WagePayout" ("dayNumber")
SELECT DISTINCT "dayNumber" FROM "Turn"
WHERE "dayNumber" < (SELECT MAX("dayNumber") FROM "Turn")
ON CONFLICT ("dayNumber") DO NOTHING;

-- ─── The Meister's Study ────────────────────────────────────────────────────

-- The terminal on its wall is "gated behind meister/hand/baron ring access",
-- and the room's own keys are that gate (db/lib/meisterTerminal.js#meisterActor),
-- so the Hand's ring now opens the door too. docs/zones.yaml says the same for
-- the next Restart Game.
UPDATE "Room"
SET "accessTagSlugs" = array_append("accessTagSlugs", 'hands-key'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'fortress-5-2'
  AND NOT ('hands-key' = ANY("accessTagSlugs"));

-- ─── The Meistery Window ────────────────────────────────────────────────────

-- Home in the Tower, behind the three rings; a public side onto the
-- Residences. Its Discord threads are opened by the next db:mirror, the way
-- the gatehouse rework's rooms were.
INSERT INTO "Room" ("id", "slug", "name", "description", "sortOrder", "kind", "locationId", "accessTagSlugs", "updatedAt")
SELECT 'meistery-window', 'fortress-5-4', 'Meistery Window',
       'At the bottom of one of the keep''s many spires is a small, barred window level with the streets of the town. Inside sits the Meister''s office. A small hole cut through the reinforced glass allows things to be passed through.',
       3, 'PRIVATE', l."id", ARRAY['meisters-key', 'hands-key', 'barons-key']::TEXT[], CURRENT_TIMESTAMP
FROM "Location" AS l
WHERE l."slug" = 'fortress-5'
ON CONFLICT ("slug") DO NOTHING;

-- The name check keeps the side off a room a GM may already have made at
-- fortress-5-4 on /gm/dev/zones.
INSERT INTO "RoomSide" ("id", "roomId", "locationId", "kind", "accessTagSlugs", "sortOrder", "updatedAt")
SELECT 'meistery-window-residences-side', r."id", l."id", 'PUBLIC', ARRAY[]::TEXT[], 7, CURRENT_TIMESTAMP
FROM "Room" AS r, "Location" AS l
WHERE r."slug" = 'fortress-5-4'
  AND r."name" = 'Meistery Window'
  AND l."slug" = 'town-8'
ON CONFLICT ("roomId", "locationId") DO NOTHING;
