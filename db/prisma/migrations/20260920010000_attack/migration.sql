-- Attack (docs/systemdocs/ATTACK.md). One row per attacker per target per
-- turn; the unique below is the "attacking is permanent for the turn" rule.

-- Which of the two things is holding somebody, so heldReasonFor can name the
-- right one without a query.
ALTER TABLE "Character" ADD COLUMN "heldReason" TEXT;

-- Every hold running at this moment is an intercept — the only kind there was
-- until now. Naming them is what keeps them releasable: the clears that must
-- leave a FIGHT alone are written as "not one of the two fight reasons", and a
-- NULL would have to be reasoned about at every one of them.
UPDATE "Character" SET "heldReason" = 'intercept' WHERE "heldUntil" IS NOT NULL;

CREATE TABLE "Attack" (
    "id" TEXT NOT NULL,
    "attackerId" TEXT NOT NULL,
    "targetCharacterId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "fromAmbush" BOOLEAN NOT NULL DEFAULT false,
    "locationId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attack_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Attack_targetCharacterId_idx" ON "Attack"("targetCharacterId");
CREATE INDEX "Attack_turnId_idx" ON "Attack"("turnId");
CREATE UNIQUE INDEX "Attack_attackerId_targetCharacterId_turnId_key" ON "Attack"("attackerId", "targetCharacterId", "turnId");

ALTER TABLE "Attack" ADD CONSTRAINT "Attack_attackerId_fkey" FOREIGN KEY ("attackerId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attack" ADD CONSTRAINT "Attack_targetCharacterId_fkey" FOREIGN KEY ("targetCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attack" ADD CONSTRAINT "Attack_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
