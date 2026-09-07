-- Web Push subscriptions: one row per browser that agreed to be notified.
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- The endpoint is the push service's own id for this browser: upserting on it
-- is what keeps a re-subscribe from piling up duplicate rows.
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

CREATE INDEX "PushSubscription_discordUserId_idx" ON "PushSubscription"("discordUserId");
