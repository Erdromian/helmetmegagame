-- Feedback: one note from the in-app Feedback composer. See db/lib/feedback.js.
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "discordUsername" TEXT NOT NULL,
    "characterName" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Feedback_discordUserId_createdAt_idx" ON "Feedback"("discordUserId", "createdAt");

CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");
