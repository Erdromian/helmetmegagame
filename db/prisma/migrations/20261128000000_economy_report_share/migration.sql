-- Public links to one page of the economy report (ECONOMY.md §7a). A new
-- table and nothing else, so it touches no existing row.
CREATE TABLE "EconomyReportShare" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EconomyReportShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EconomyReportShare_token_key" ON "EconomyReportShare"("token");
