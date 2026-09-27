-- The bomb becomes a fixture in one room, worked from an 8-digit keypad
-- (docs/systemdocs/NUKE.md). Additive only.

-- Where it is this game, and its code. Rolled at Start Game, or by the first
-- reader of a game already running (db/lib/nuke.js#ensureNuke).
ALTER TABLE "GameState" ADD COLUMN "nukeRoomId" TEXT,
ADD COLUMN "nukeCode" TEXT;

-- A note the game writes into a character's memory ("The bomb is in ..."),
-- which dies with that character. Player-written notes leave it null.
ALTER TABLE "JournalEntry" ADD COLUMN "characterId" TEXT;
CREATE INDEX "JournalEntry_characterId_idx" ON "JournalEntry"("characterId");
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Wrong codes in a row at the keypad, and the lockout the third one earns.
CREATE TABLE "NukeLockout" (
    "characterId" TEXT NOT NULL,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NukeLockout_pkey" PRIMARY KEY ("characterId")
);
ALTER TABLE "NukeLockout" ADD CONSTRAINT "NukeLockout_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
