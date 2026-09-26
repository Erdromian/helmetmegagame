-- Signet rings replace the seat keys and wax stamps (docs/systemdocs/RINGS.md).

-- AlterEnum
ALTER TYPE "EquipSlot" ADD VALUE 'FINGER';

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "ringOfCharacterId" TEXT,
ADD COLUMN     "ringInitials" TEXT,
ADD COLUMN     "ringRoleSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "ringAccessSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "ringRegisteredAt" TIMESTAMP(3),
ADD COLUMN     "ringBankAccountId" TEXT,
ADD COLUMN     "sealOffice" TEXT;

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "ringSpawns" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ringAccessSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "ringSealOffice" TEXT,
ADD COLUMN     "ringSealMark" TEXT,
ADD COLUMN     "ringName" TEXT,
ADD COLUMN     "ringDescription" TEXT,
ADD COLUMN     "ringAuthorisedBy" TEXT;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_ringBankAccountId_fkey" FOREIGN KEY ("ringBankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
