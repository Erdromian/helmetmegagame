-- CreateEnum
CREATE TYPE "ArchiveSource" AS ENUM ('DISCORD', 'WEB', 'SYSTEM');

-- AlterTable
ALTER TABLE "ArchiveEntry" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "discordSyncedAt" TIMESTAMP(3),
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "placeKey" TEXT,
ADD COLUMN     "seq" BIGSERIAL NOT NULL,
ADD COLUMN     "source" "ArchiveSource" NOT NULL DEFAULT 'DISCORD';

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveEntry_seq_key" ON "ArchiveEntry"("seq");

-- CreateIndex
CREATE INDEX "ArchiveEntry_placeKey_seq_idx" ON "ArchiveEntry"("placeKey", "seq");
