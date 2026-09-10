// A tag's name as a human should see it: the bare name, plus the mastery star.
//
// Shared because three surfaces draw a tag name from a Tag row and all three
// have to agree — db/lib/examine.js (the Examine readout), the bot's 🔍 inspect
// embed, and the web, which reaches the same glyph through
// web/app/components/ChipLabel.js rather than this file (it renders JSX, not a
// string). Keep the glyph here rather than in Tag.name: the name is a match key
// in more than one place (web/lib/characterCreation.js#purchasableTags compares
// a role's granted tags BY NAME, and forcedName stands in for a first name), so
// a star living in the column would break a lookup instead of decorating one.
//
// Prisma-free, so bot/ and web/ both require it by path.
const MASTERY_STAR = "★";

function tagDisplayName(tag) {
  const name = tag?.name ?? "";
  return tag?.mastery ? `${MASTERY_STAR} ${name}` : name;
}

module.exports = { tagDisplayName };
