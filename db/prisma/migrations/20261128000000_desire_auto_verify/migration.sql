-- Auto-confirmed Desire claims (docs/systemdocs/DESIRES.md §6b). Additive only.
ALTER TABLE "DesireTemplate" ADD COLUMN "autoVerify" JSONB;

ALTER TABLE "Desire" ADD COLUMN "autoVerifiedAt" TIMESTAMP(3),
ADD COLUMN "autoVerifiedAuditIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "autoVerifiedNote" TEXT;
