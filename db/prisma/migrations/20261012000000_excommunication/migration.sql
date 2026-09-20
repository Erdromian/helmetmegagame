-- Who the Bishop has excommunicated, and who did it. The mark itself is the
-- `excommunicated` tag on the target (docs/tags.yaml, carrying gambitBonus -1);
-- this table is the other half, because CharacterTag has no "granted by" column
-- and the cap, the Bishop's list and the only-your-own lift all need one.
--
-- targetCharacterId is UNIQUE: one live excommunication per person. Both sides
-- cascade — a deleted character takes their marks and the marks they laid with
-- them, since neither means anything without the person at its end.
CREATE TABLE "Excommunication" (
    "id" TEXT NOT NULL,
    "bishopId" TEXT NOT NULL,
    "targetCharacterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Excommunication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Excommunication_targetCharacterId_key" ON "Excommunication"("targetCharacterId");

CREATE INDEX "Excommunication_bishopId_idx" ON "Excommunication"("bishopId");

ALTER TABLE "Excommunication" ADD CONSTRAINT "Excommunication_bishopId_fkey" FOREIGN KEY ("bishopId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Excommunication" ADD CONSTRAINT "Excommunication_targetCharacterId_fkey" FOREIGN KEY ("targetCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
