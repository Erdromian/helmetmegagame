-- CreateTable
CREATE TABLE "PendingTax" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "taxerId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "factionId" TEXT NOT NULL,
    "taxerRole" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "declinedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "appliedAmount" INTEGER,
    "skippedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingTax_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingTax_turnId_appliedAt_idx" ON "PendingTax"("turnId", "appliedAt");
CREATE INDEX "PendingTax_targetId_turnId_idx" ON "PendingTax"("targetId", "turnId");
CREATE INDEX "PendingTax_taxerId_turnId_idx" ON "PendingTax"("taxerId", "turnId");

ALTER TABLE "PendingTax" ADD CONSTRAINT "PendingTax_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PendingTax" ADD CONSTRAINT "PendingTax_taxerId_fkey" FOREIGN KEY ("taxerId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PendingTax" ADD CONSTRAINT "PendingTax_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
