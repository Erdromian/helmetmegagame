// Pure classification for the Research skill (Scholastic-only,
// docs/systemdocs/CRAFTING.md §2b). Studying a held ingredient in the Cathedral
// spends the Move as a Gambit; the die is rolled and stored at file time
// (web/app/(app)/character/requestActions.js), and this module tells the
// turn-close pass (db/lib/researchPass.js) — and the desk that files the
// Move in the first place — what a given ingredient can turn up.
//
// No prisma here except loadResearchCatalog, which both the pass and the web
// desk's picker share so they can never see two different pools of recipes.

const RESEARCH_TAG_SLUG = "research";
const CATHEDRAL_LOCATION_SLUG = "cathedral";

// The marker Action.gmNotes carries for a filed research Move — the same
// machine-marker idiom as auto:lesson (db/lib/lessonPass.js), never rendered
// (MoveDesk.js) and refused on a player Edit (moves.js). `(?:^|\n)` rather
// than anchoring at the start of the string: stagedPush.js APPENDS
// "auto:silent_close" onto an OPEN row's gmNotes with a newline join
// (~:291), so a research row read back after that append still has to match
// on its own line, not just at offset 0.
const RESEARCH_MARKER_RE = /(?:^|\n)auto:research:([a-z0-9-]+)/;

function researchMarker(slug) {
  return `auto:research:${slug}`;
}

// One requirementItems entry (db/lib/tagShapes.js#normalizeRequirementItems)
// against one ingredient tag — `tag` matches its own slug, `anyOf` matches
// any of its slugs, `group` matches the ingredient's OWN group slug (a
// group entry names no single tag, e.g. items-corpse for the Death Mask).
// `tagLike` only needs { slug, group?: { slug } }, so this runs the same
// whether the caller has a CharacterTag's .tag or a bare catalog Tag row.
function entryMatches(entry, tagLike) {
  if (entry.kind === "group") return entry.slug === tagLike.group?.slug;
  const slugs = entry.kind === "anyOf" ? entry.slugs : [entry.slug];
  return slugs.includes(tagLike.slug);
}

function isCraftableIngredientOf(recipe, tagLike) {
  return (
    recipe.craftable === true &&
    (recipe.requirementItems ?? []).some((entry) => entryMatches(entry, tagLike))
  );
}

// The picker's shortlist (CRAFTING.md §2b): every held tag that is an ingredient of ANY
// craftable recipe in the catalog — not just the secret ones, or the picker
// would itself answer the question it's supposed to be posing. Deduped by
// tag slug (holding two corpses is one entry, "a corpse"), stable by name so
// the picker doesn't reshuffle between requests.
function researchableHeld(characterTags, catalogTags) {
  const held = new Map();
  for (const ct of characterTags ?? []) {
    if (!ct?.tag || held.has(ct.tag.slug)) continue;
    const isIngredient = (catalogTags ?? []).some((recipe) =>
      isCraftableIngredientOf(recipe, ct.tag),
    );
    if (isIngredient) held.set(ct.tag.slug, ct);
  }
  return [...held.values()].sort((a, b) => a.tag.name.localeCompare(b.tag.name));
}

// CRAFTING.md §2b: a "secret recipe" is a craftable whose PRODUCT is
// `catalog: gm` — never `catalog: secret` (the cult's own content, hidden
// even from GMs) and never `catalog: all`. A public recipe naming a gm
// ingredient is worthless as a reward: holding the ingredient already puts
// that recipe in the reader's own Tag Catalog in full
// (web/lib/tagCatalog.js's relates() + web/lib/recipeCatalog.js), so dealing
// it back as a "discovery" would tell the player nothing they couldn't
// already read on /documents.
function secretRecipesFor(ingredientTag, catalogTags) {
  return (catalogTags ?? []).filter(
    (recipe) =>
      recipe.catalogVisibility === "GM" &&
      isCraftableIngredientOf(recipe, ingredientTag),
  );
}

// The three outcomes a research Gambit can land on. `total` is the die plus
// its stored modifier; `secrets` is the ingredient's secret-recipe pool
// AFTER the caller has already dropped anything this character has been
// dealt before — this function does no ledger-reading of its own.
//
//   paper    — total >= 6 AND at least one undealt secret recipe remains.
//   unlikely — nothing undealt to find, but the roll still cleared 4: the
//              scholar can tell the shelves have nothing more on this.
//   nothing  — anything else, including a good roll (>=6) that just came up
//              against an ingredient with secrets still left in its pool
//              that this roll didn't reach.
function researchOutcome({ total, secrets }) {
  if (total >= 6 && secrets.length > 0) return "paper";
  if (secrets.length === 0 && total >= 4) return "unlikely";
  return "nothing";
}

// The craftable catalog, shaped for both researchableHeld/secretRecipesFor
// above and formatTagRequirement (db/lib/formatTagRequirement.js) — one
// query so the turn-close pass and the desk's picker read the same pool.
async function loadResearchCatalog(prisma) {
  return prisma.tag.findMany({
    where: { craftable: true },
    // `craftable` is selected as well as filtered on: isCraftableIngredientOf
    // reads it off each row, and a Prisma select returns nothing it wasn't
    // asked for — the where alone left every row reading as undefined.
    select: {
      id: true,
      slug: true,
      name: true,
      craftable: true,
      catalogVisibility: true,
      description: true,
      requirementItems: true,
      requirementSkills: { select: { name: true } },
      requirementTurns: true,
      requirementResources: true,
      requirementGambit: true,
      group: { select: { slug: true } },
    },
  });
}

// A description's `{tag:slug}` tokens, the one token kind a craftable's
// description uses (web/app/components/richTokens.js has the grammar).
const TAG_TOKEN_RE = /\{tag:([A-Za-z0-9_-]+)\}/g;

// The note a successful Research mints (Chris's layout, 2026-09-08): the
// recipe's name, its catalog description in quotes, then the requirement
// block one line each, with the ingredients under a "Requires" rule. It is
// markdown — PaperSheet.js renders a paper through ChatMarkdown, and a bird
// can carry it into Discord raw — so line breaks inside a block are the
// two-space hard break, blocks are paragraphs, and the rule's leading dash
// is escaped or it would read as a bullet.
//
// Tokens are flattened to names on purpose: on the web a `{tag:blessed}`
// would render as a live chip inside the sheet, and in a Discord DM it would
// be the raw braces. `nameOf(slug)` supplies the name; a slug it can't
// resolve is left as the token so the gap is visible rather than silent.
function researchPaperText(recipe, nameOf = () => null) {
  const description = (recipe.description ?? "")
    .replace(TAG_TOKEN_RE, (raw, slug) => nameOf(slug) ?? raw)
    .trim();
  const costLines = [];
  if (recipe.requirementTurns) {
    costLines.push(`${recipe.requirementTurns} turn${recipe.requirementTurns === 1 ? "" : "s"}`);
  }
  if (recipe.requirementResources) costLines.push(`${recipe.requirementResources} ⬢`);
  for (const skill of recipe.requirementSkills ?? []) if (skill?.name) costLines.push(skill.name);
  if (recipe.requirementGambit) costLines.push("Gambit");
  // Spent and kept are still said differently (formatTagRequirement's
  // "uses" / "needs to hand"), just as a suffix here so the list stays a list.
  const itemLines = (recipe.requirementItems ?? []).map((item) => {
    const count = (item.count ?? 1) > 1 ? ` ×${item.count}` : "";
    return `${item.label}${count}${item.keep ? " (kept)" : ""}`;
  });
  const blocks = [recipe.name];
  if (description) blocks.push(`"${description}"`);
  if (costLines.length) blocks.push(costLines.join("  \n"));
  if (itemLines.length) blocks.push(["\\- Requires -", ...itemLines].join("  \n"));
  return blocks.join("\n\n");
}

// Familiarity (Chris, 2026-09-08): every earlier attempt on the SAME
// ingredient adds +1 to this one's total, so the first try needs a 6, the
// second a 5, and the sixth cannot miss — a flat 1-in-6 a day was accurate
// for research and no fun to wait on. It counts `research_filed` AuditLog
// rows for the character and ingredient, and starts over at the last
// `research_revealed` for that ingredient: a corpse's second mask is a fresh
// study, not a freebie. The current turn's own filing is excluded, since
// that row is written at submit and is the attempt being scored.
function familiarityBonus({ filed = [], revealed = [], ingredientSlug, currentTurnId }) {
  const forSlug = (row) => row?.details?.ingredientSlug === ingredientSlug;
  const lastReveal = revealed
    .filter(forSlug)
    .reduce((latest, row) => (row.createdAt > (latest ?? 0) ? row.createdAt : latest), null);
  return filed.filter(
    (row) => forSlug(row) && row.turnId !== currentTurnId && (!lastReveal || row.createdAt > lastReveal),
  ).length;
}

module.exports = {
  RESEARCH_TAG_SLUG,
  CATHEDRAL_LOCATION_SLUG,
  RESEARCH_MARKER_RE,
  researchMarker,
  researchableHeld,
  secretRecipesFor,
  researchOutcome,
  familiarityBonus,
  loadResearchCatalog,
  TAG_TOKEN_RE,
  researchPaperText,
};
