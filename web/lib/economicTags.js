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

// SECRET tags (cave/antagonist content, TAGS.md §5) are never shown here, the
// same rule /gm/dev/tags itself doesn't override. Health and Status stay
// out — they're conditions, not economy. General/Meta/Demoness and
// non-economic skills (Combat, Cooking, any standalone skill outside the
// groups above) stay out too.
export function isEconomicTag(tag) {
  if (!tag || tag.catalogVisibility === "SECRET") return false;
  const category = canonicalCategory(tag.category);
  if (category === "Items" || category === "Assets") return true;
  if (category === "Skills") return ECONOMIC_SKILL_GROUP_SLUGS.has(tag.group?.slug);
  return false;
}
