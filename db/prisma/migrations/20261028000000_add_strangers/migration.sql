-- Strangers (docs/systemdocs/STRANGERS.md): the label that tells two people
-- who look alike apart, and the voices a character would know again.

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "presenceHidden" BOOLEAN,
ADD COLUMN     "presenceLabel" TEXT,
ADD COLUMN     "presenceNonce" TEXT;

-- CreateTable
CREATE TABLE "VoiceMemory" (
    "ownerId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "live" BOOLEAN NOT NULL DEFAULT true,
    "heardAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceMemory_pkey" PRIMARY KEY ("ownerId","subjectId")
);

-- CreateIndex
CREATE INDEX "VoiceMemory_subjectId_idx" ON "VoiceMemory"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceMemory_ownerId_number_key" ON "VoiceMemory"("ownerId", "number");

-- AddForeignKey
ALTER TABLE "VoiceMemory" ADD CONSTRAINT "VoiceMemory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceMemory" ADD CONSTRAINT "VoiceMemory_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
