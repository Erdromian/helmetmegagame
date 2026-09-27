-- Late parties (db/lib/lateParty.js, docs/systemdocs/LATE-PARTIES.md): a
-- superadmin-opened event that narrows character creation to its own fates and
-- lets anybody without a living character come back at once, buried or not.
CREATE TABLE "LateParty" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedBy" TEXT NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,

    CONSTRAINT "LateParty_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LatePartyFate" (
    "partyId" TEXT NOT NULL,
    "roleSlug" TEXT NOT NULL,
    "slots" INTEGER,

    CONSTRAINT "LatePartyFate_pkey" PRIMARY KEY ("partyId","roleSlug")
);

ALTER TABLE "Character" ADD COLUMN "latePartyId" TEXT;

CREATE INDEX "LateParty_endedAt_idx" ON "LateParty"("endedAt");

CREATE INDEX "Character_latePartyId_roleId_idx" ON "Character"("latePartyId", "roleId");

ALTER TABLE "LatePartyFate" ADD CONSTRAINT "LatePartyFate_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "LateParty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Character" ADD CONSTRAINT "Character_latePartyId_fkey" FOREIGN KEY ("latePartyId") REFERENCES "LateParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
