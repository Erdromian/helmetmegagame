-- Trinket (docs/systemdocs/TRINKETS.md): a raw material's worth as an inlay
-- ingredient, read back by the turn-end pass (db/lib/trinketPass.js) that
-- prices a minted Trinket. Sibling of the existing `cooked` column, and
-- deliberately its own column rather than a key inside it — see the schema
-- comment on Tag.inlayValue for why the two ingredient pools stay separate.

ALTER TABLE "Tag" ADD COLUMN "inlayValue" INTEGER;
