-- Whether a customizable recipe charges its naming surcharge once per craft action instead of once per unit
-- (db/lib/customCost.js, docs/tags.yaml `custom.perBatch`). Defaults to false, so every recipe already in the
-- catalog keeps charging per unit until the tag sync says otherwise.
ALTER TABLE "Tag" ADD COLUMN "customPerBatch" BOOLEAN NOT NULL DEFAULT false;
