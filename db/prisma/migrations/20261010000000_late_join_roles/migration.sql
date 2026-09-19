-- The open late-join seats. See db/lib/lateJoin.js for the candidate catalog;
-- a row here is only whether that seat is open and how many of it there are.
CREATE TABLE "LateJoinRole" (
    "roleSlug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "slots" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LateJoinRole_pkey" PRIMARY KEY ("roleSlug")
);
