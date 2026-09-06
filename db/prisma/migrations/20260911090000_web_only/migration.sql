-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "webOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "webOnlyChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "webOnlyCooldownSeconds" INTEGER NOT NULL DEFAULT 7200;
