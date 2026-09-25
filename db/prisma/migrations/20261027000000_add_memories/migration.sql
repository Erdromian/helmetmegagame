-- The Memories page (docs/systemdocs/MEMORIES.md): Friends entries, the day's
-- heard lines, the role-knowledge matrix and the ATM PIN.

-- CreateEnum
CREATE TYPE "AcquaintanceSource" AS ENUM ('SEED', 'HEARD', 'MANUAL');

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "pin" TEXT;

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "knowsRoleSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Acquaintance" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "subjectId" TEXT,
    "name" TEXT NOT NULL,
    "roleText" TEXT,
    "roleSlug" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "source" "AcquaintanceSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Acquaintance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeardLine" (
    "characterId" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeardLine_pkey" PRIMARY KEY ("characterId","seq")
);

-- CreateIndex
CREATE INDEX "Acquaintance_ownerId_idx" ON "Acquaintance"("ownerId");

-- CreateIndex
CREATE INDEX "Acquaintance_subjectId_idx" ON "Acquaintance"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Acquaintance_ownerId_subjectId_key" ON "Acquaintance"("ownerId", "subjectId");

-- CreateIndex
CREATE INDEX "HeardLine_characterId_dayNumber_idx" ON "HeardLine"("characterId", "dayNumber");

-- CreateIndex
CREATE INDEX "HeardLine_dayNumber_idx" ON "HeardLine"("dayNumber");

-- AddForeignKey
ALTER TABLE "Acquaintance" ADD CONSTRAINT "Acquaintance_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acquaintance" ADD CONSTRAINT "Acquaintance_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeardLine" ADD CONSTRAINT "HeardLine_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
