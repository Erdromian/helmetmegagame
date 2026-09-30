// What counts as an "economic" tag for the Economist role's limited player
// lookup (/econ/players, ECONOMY.md §7). One named list, so widening or
// narrowing it later is a one-line edit here rather than a hunt through
// several pages' worth of scattered category checks.
//
// The skill groups below aren't a guess — they're cross-checked against what
// db/scripts/analysis/economy/report.js actually prices: Smithing/Building/
// Siege Engineer recipes, Brewing, Cooking's hunger/mood economics, and
// Prospecting/Soilery yield, on top of Medical's cure costs — matched against
// the group slugs docs/taggroups.yaml declares.
import { canonicalCategory } from "./sheetCards";

const ECONOMIC_SKILL_GROUP_SLUGS = new Set([
  "skills-crafting", // Smithing I/II, Crafting, Building I/II, Siege Engineer, Smithing (Gunpowder)
  "skills-brewing",
  "skills-medical",
  "skills-work", // Prospecting, Soilery
]);

// The Tag columns isEconomicTag() reads, on top of whatever the chip needs.
// One select shared with the page, so a new rule here can't be starved of its
// column by a query that never heard of it.
export const ECONOMIC_TAG_RULE_SELECT = {
  category: true,
  catalogVisibility: true,
  paperKind: true,
  photoOfCharacterId: true,
  requiredTag: { select: { catalogVisibility: true } },
  group: { select: { slug: true, name: true, requiredTag: { select: { catalogVisibility: true } } } },
};

const isSecret = (tag) => tag?.catalogVisibility === "SECRET";

// SECRET tags (cave/antagonist content, TAGS.md §5) are never shown here, the
// same rule /gm/dev/tags itself doesn't override — and neither is anything
// standing behind a SECRET gate, its own requiredTag or its group's, the way
// web/lib/secretTags.js withholds a row from a player's browser. The Grimoire,
// Black Robes and the rest of the cult's kit are SECRET themselves; a
// catalog:gm ware in a group the cult's Belief gates is caught by the second
// half.
//
// A written sheet, a book, an envelope, a set of Documents (Tag.paperKind) or a
// photograph stays out too. The row is an Item, but its NAME is a title
// somebody wrote — "A Note", "To the Baron" — and the Economist's page is a
// ledger of what people own, not what they have read.
//
// Health and Status stay out — they're conditions, not economy.
// General/Meta/Demoness and non-economic skills (Combat, Cooking, any
// standalone skill outside the groups above) stay out too.
export function isEconomicTag(tag) {
  if (!tag) return false;
  if (isSecret(tag) || isSecret(tag.requiredTag) || isSecret(tag.group?.requiredTag)) return false;
  if (tag.paperKind || tag.photoOfCharacterId) return false;
  const category = canonicalCategory(tag.category);
  if (category === "Items" || category === "Assets") return true;
  if (category === "Skills") return ECONOMIC_SKILL_GROUP_SLUGS.has(tag.group?.slug);
  return false;
}
