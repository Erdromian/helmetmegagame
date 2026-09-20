-- The Charon's ignition (docs/systemdocs/CHARON.md). One row, ever: `launchAt`
-- set is a countdown running, `launchedAt` set is a ship that has gone.
CREATE TABLE "CharonLaunch" (
    "id" TEXT NOT NULL,
    "launchAt" TIMESTAMP(3),
    "launchedAt" TIMESTAMP(3),
    "launchedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharonLaunch_pkey" PRIMARY KEY ("id")
);
