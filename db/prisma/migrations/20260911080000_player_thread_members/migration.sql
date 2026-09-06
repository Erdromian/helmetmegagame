-- CreateTable
CREATE TABLE "PlayerThreadMember" (
    "playerThreadId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerThreadMember_pkey" PRIMARY KEY ("playerThreadId","characterId")
);

-- CreateIndex
CREATE INDEX "PlayerThreadMember_characterId_idx" ON "PlayerThreadMember"("characterId");

-- AddForeignKey
ALTER TABLE "PlayerThreadMember" ADD CONSTRAINT "PlayerThreadMember_playerThreadId_fkey" FOREIGN KEY ("playerThreadId") REFERENCES "PlayerThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
