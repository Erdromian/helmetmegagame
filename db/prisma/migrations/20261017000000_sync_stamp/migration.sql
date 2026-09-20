-- CreateTable
CREATE TABLE "SyncStamp" (
    "key" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncStamp_pkey" PRIMARY KEY ("key")
);
