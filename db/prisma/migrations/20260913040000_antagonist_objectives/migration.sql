-- Antagonist objectives (docs/systemdocs/THREATS.md §6a): one row per win
-- condition a GM hands a party. Snapshot ids, no foreign keys — the table is
-- wiped by Restart Game and the reveal is snapshotted onto Game.epilogue.
CREATE TYPE "ObjectiveWeight" AS ENUM ('MINOR', 'MAJOR');

CREATE TABLE "Objective" (
    "id" TEXT NOT NULL,
    "partyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "weight" "ObjectiveWeight",
    "targetCharacterId" TEXT,
    "targetName" TEXT,
    "targetLocationId" TEXT,
    "targetLocationName" TEXT,
    "value" INTEGER,
    "text" TEXT,
    "pinned" BOOLEAN,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Objective_pkey" PRIMARY KEY ("id")
);
