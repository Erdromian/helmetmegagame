-- Telephones. See docs/systemdocs/PHONES.md.
--
-- Two columns on Room (the phone's NAME, and whether it takes coins) and one
-- new table holding a live call.

ALTER TABLE "Room" ADD COLUMN "phone" TEXT;
ALTER TABLE "Room" ADD COLUMN "payphone" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "PhoneCallStatus" AS ENUM ('RINGING', 'CONNECTED', 'ENDED');

CREATE TABLE "PhoneCall" (
    "id" TEXT NOT NULL,
    "fromRoomId" TEXT NOT NULL,
    "toRoomId" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "calleeId" TEXT,
    "status" "PhoneCallStatus" NOT NULL DEFAULT 'RINGING',
    "ringsSent" INTEGER NOT NULL DEFAULT 0,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,
    "turnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PhoneCall_status_fromRoomId_idx" ON "PhoneCall"("status", "fromRoomId");
CREATE INDEX "PhoneCall_status_toRoomId_idx" ON "PhoneCall"("status", "toRoomId");
CREATE INDEX "PhoneCall_status_callerId_idx" ON "PhoneCall"("status", "callerId");
CREATE INDEX "PhoneCall_status_calleeId_idx" ON "PhoneCall"("status", "calleeId");

ALTER TABLE "PhoneCall" ADD CONSTRAINT "PhoneCall_fromRoomId_fkey" FOREIGN KEY ("fromRoomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhoneCall" ADD CONSTRAINT "PhoneCall_toRoomId_fkey" FOREIGN KEY ("toRoomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhoneCall" ADD CONSTRAINT "PhoneCall_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhoneCall" ADD CONSTRAINT "PhoneCall_calleeId_fkey" FOREIGN KEY ("calleeId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PhoneCall" ADD CONSTRAINT "PhoneCall_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ONE RECEIVER PER PHONE, and the reason "The line is busy." is true rather
-- than hopeful. PARTIAL unique indexes, which Prisma's schema language cannot
-- express, so `prisma migrate diff` will propose dropping both on every run
-- from here on -- DECLINE IT, the same answer ThreatSpawn_pending_unique and
-- DirectMessage_clientNonce_key already have (CLAUDE.md, Notes for future work).
--
-- Without these, two people dialling the same office in the same second both
-- read "free" and both write, and the office rings twice with two callers who
-- can each hear only half of it. db/lib/phone.js#placeCall treats the P2002
-- these raise as the busy signal rather than as an error, which is the only
-- way to get that answer without a race.
CREATE UNIQUE INDEX "PhoneCall_from_active_unique" ON "PhoneCall"("fromRoomId") WHERE "status" IN ('RINGING', 'CONNECTED');
CREATE UNIQUE INDEX "PhoneCall_to_active_unique" ON "PhoneCall"("toRoomId") WHERE "status" IN ('RINGING', 'CONNECTED');

-- A person holds ONE receiver, wherever they are standing. Not implied by the
-- two above: the same character could otherwise be the caller on one line and
-- the callee on another, in two different rooms, which is not a thing a person
-- with two hands and one location can be.
CREATE UNIQUE INDEX "PhoneCall_caller_active_unique" ON "PhoneCall"("callerId") WHERE "status" IN ('RINGING', 'CONNECTED');
CREATE UNIQUE INDEX "PhoneCall_callee_active_unique" ON "PhoneCall"("calleeId") WHERE "status" IN ('RINGING', 'CONNECTED');
