// Move-fraction display, HOISTED down from web/lib/recipeCatalog.js's
// workLabel (M2, docs/systemdocs/CRAFTING.md §2a): a `turnsCost: 1/N` recipe
// or cure stores as requirementTurns: 1 + requirementPerTurn: N (the sync's
// share encoding, db/lib/tagShapes.js), and a plain "1 turn" line — this
// module's old behavior — read as a whole Move where the true cost was a
// fraction of one. web/lib/recipeCatalog.js needed this first, for the
// Recipes tab; formatTagRequirement's compact chip line needed it the moment
// M2 repriced health tags onto fractional cures (the Heal dialog's affliction
// rows read requirementLabel straight off this function). Lives HERE rather
// than staying only in web/lib/recipeCatalog.js because db/ cannot import
// web/ — see web/lib/craftBudget.js#formatMoveFraction, which re-exports this
// rather than keeping its own copy.
const FRACTION_GLYPHS = {
  "1/2": "½",
  "1/3": "⅓",
  "2/3": "⅔",
  "1/4": "¼",
  "3/4": "¾",
  // Mixed denominators (a ⅓ brew after a ½ one) land on sixths; twelfths
  // have no glyphs and fall through to "n/m", which is fine.
  "1/6": "⅙",
  "5/6": "⅚",
  // Eighths (review fix, M2): the medical pool's spill prices at
  // 1/MEDICAL_SIMPLE_PER_TURN = 1/8, and the ledger's remaining fraction
  // after a few of those lands on the other eighths too.
  "1/8": "⅛",
  "3/8": "⅜",
  "5/8": "⅝",
  "7/8": "⅞",
};

function formatMoveFraction(num, den) {
  return FRACTION_GLYPHS[`${num}/${den}`] ?? `${num}/${den}`;
}

// The turns line a chip/hovercard shows, or null when there's nothing to
// report — 0 turns (a free action) or no requirement block at all, same gate
// the pre-M2 version used. `requirementTurns` is read AS AUTHORED, never
// defaulted to 1 the way the craft/heal engines default a missing value:
// this is a display function for whatever the tag actually carries, and a
// tag with no requirement block should stay silent, not claim a turn it
// never priced.
function turnsLabel(tag) {
  if (!tag.requirementTurns) return null;
  const per = tag.requirementPerTurn ?? null;
  if (tag.requirementTurns === 1 && per > 1) {
    return `${formatMoveFraction(1, per)} turn`;
  }
  return `${tag.requirementTurns} turn${tag.requirementTurns === 1 ? "" : "s"}`;
}

// Minified "cost to add/remove this tag in play" summary, for compact
// display anywhere a tag's description already renders (web tooltip,
// Discord inspect embed) — see Tag.requirementTurns/requirementResources/
// requirementGambit/requirementSkills in db/prisma/schema.prisma. Lives here
// (rather than in web/ or bot/) since both packages depend on @lifeweb/db
// and would otherwise duplicate this. Returns null when the tag has no
// requirement data set, so callers can skip rendering entirely.
//
// Callers must fetch requirementTurns, requirementResources,
// requirementGambit, requirementItems, requirementPerTurn, and
// requirementSkills (at least { name: true }). A caller that forgets
// requirementItems renders no ingredient line rather than throwing, which is
// the quiet failure to watch for when adding a new surface.
function formatTagRequirement(tag) {
  const parts = [];
  // Spelled out, not "1t": the chip face uses a `Nt` badge for turns
  // REMAINING, and an unlabelled "1t" here (turns of work to cure) sat in
  // the same tooltip meaning something unrelated.
  const turnsText = turnsLabel(tag);
  if (turnsText) parts.push(turnsText);
  if (tag.requirementResources) parts.push(`${tag.requirementResources} ⬢`);
  if (tag.requirementSkills?.length) {
    // " + ", not "/": requirementSkills is an AND (every skill must be held,
    // see requireRecipeSkills). A "/" read as "either" — which was harmless
    // while every multi-skill recipe was a mislabelled Dead Simple item, and
    // stopped being harmless the moment a real conjunction landed.
    parts.push(tag.requirementSkills.map((t) => t.name).join(" + "));
  }
  // The ingredients, where a recipe has any (Tag.requirementItems). `label` is
  // denormalized into the stored Json by the sync precisely so this stays pure
  // and synchronous; see db/lib/tagShapes.js.
  //
  // Spent and kept are said differently, because they are different bargains
  // and the chip is the only place most players will read either one. "uses
  // Cave Fungus" means the stack goes down; "needs a corpse to hand" means it
  // does not. Two clauses rather than one, so a recipe with both still reads.
  if (tag.requirementItems?.length) {
    const spent = tag.requirementItems.filter((i) => !i.keep).map((i) => i.label);
    const kept = tag.requirementItems.filter((i) => i.keep).map((i) => i.label);
    if (spent.length) parts.push(`uses ${spent.join(" and ")}`);
    if (kept.length) parts.push(`needs ${kept.join(" and ")} to hand`);
  }
  // The Move kind is always stated, so "no Gambit needed" reads differently
  // from "no data" — but only once there's something to qualify. A tag with no
  // requirement block at all — most of the catalog, since only Health tags and
  // a handful of craftables carry one — still renders nothing rather than a
  // bare "Routine".
  if (parts.length === 0 && !tag.requirementGambit) return null;
  parts.push(tag.requirementGambit ? "Gambit" : "Routine");
  return parts.join(" · ");
}

module.exports = { formatTagRequirement, formatMoveFraction };
