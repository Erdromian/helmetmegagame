-- The Merchant's vending machine. See docs/systemdocs/VENDING.md.
--
-- One column on Room (whether there is a machine on this wall) and two new
-- tables: the machine, and one row per shelf line.

ALTER TABLE "Room" ADD COLUMN "vendingMachine" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "VendingMachine" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "floatObols" INTEGER NOT NULL DEFAULT 0,
    "tillObols" INTEGER NOT NULL DEFAULT 0,
    "holderId" TEXT,
    "holderSince" TIMESTAMP(3),
    "unlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendingMachine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VendingSlot" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceObols" INTEGER NOT NULL DEFAULT 0,
    "poisonedCount" INTEGER NOT NULL DEFAULT 0,
    "poisonPayload" TEXT,
    "expiresTurn" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendingSlot_pkey" PRIMARY KEY ("id")
);

-- One machine per room, and one machine per holder. The second is a PLAIN
-- unique on a NULLABLE column, not a partial index: Postgres counts NULLs as
-- distinct, so "free" never collides with "free" and Prisma can express the
-- whole thing. That is the difference from PhoneCall's four, whose `status` is
-- non-null and which therefore had to be partial -- so there is nothing here
-- for `migrate diff` to keep proposing a drop of.
CREATE UNIQUE INDEX "VendingMachine_roomId_key" ON "VendingMachine"("roomId");
CREATE UNIQUE INDEX "VendingMachine_holderId_key" ON "VendingMachine"("holderId");

CREATE UNIQUE INDEX "VendingSlot_machineId_tagId_key" ON "VendingSlot"("machineId", "tagId");
CREATE INDEX "VendingSlot_machineId_idx" ON "VendingSlot"("machineId");

ALTER TABLE "VendingMachine" ADD CONSTRAINT "VendingMachine_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: a GM deleting a character must free the machine, not
-- delete it with the coin still inside.
ALTER TABLE "VendingMachine" ADD CONSTRAINT "VendingMachine_holderId_fkey"
  FOREIGN KEY ("holderId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VendingSlot" ADD CONSTRAINT "VendingSlot_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "VendingMachine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendingSlot" ADD CONSTRAINT "VendingSlot_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- THE FIXTURE ITSELF, and the reason this statement is here rather than in
-- docs/zones.yaml alone. db/lib/importZones.js SKIPS a room that already exists
-- -- the importer is additive and never updates -- so authoring `vending: true`
-- on undertown-6-1 reaches a fresh `npm run dev:setup` and reaches the database
-- with players in it not at all. Both halves are needed: the YAML for new
-- databases, this for the live one.
--
-- No VendingMachine row is inserted. db/lib/vending.js#ensureMachine upserts one
-- on first open, so a GM ticking the box on a second room later needs no script.
UPDATE "Room" SET "vendingMachine" = true WHERE "slug" = 'undertown-6-1';
