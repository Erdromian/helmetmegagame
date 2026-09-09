// A corpse row (db/lib/corpses.js#corpsesInReach) as the dialogs pick it.
//
// A body is identified by its tag AND where it lies: the same Nekker Corpse
// row can be in two rooms, and "that one" has to mean one of them.
export function corpseIdOf(corpse) {
  return `${corpse.tagId}@${corpse.sourceKey}`;
}

export function corpseLabel(corpse) {
  return `${corpse.tagName} — ${corpse.source.name}`;
}

// Display names for the four yields, kept here rather than fetched: the
// dialog needs a word, not a catalog row.
const CORPSE_YIELD_NAMES = {
  "nekker-pheromones": "Nekker Pheromones",
  "graga-sac": "a Graga Sac",
  "skinless-brain": "a Skinless Brain",
  "human-flesh": "Human Flesh",
};

export function yieldLabel(corpse) {
  return CORPSE_YIELD_NAMES[corpse.yieldSlug] ?? "something";
}
