// The Recipes tab on /documents (RecipesTab.js): every craftable tag's
// `requirement:` block, read as a reference book rather than executed. Pure —
// no prisma, no auth — so the page (server) and the tab (client) run the same
// code, the way web/lib/tagCatalog.js already does for the Tag Catalog beside
// it. What a recipe MEANS is CRAFTING.md §2; this only reads it.
//
// Listing is not the same question as offering. The Craft menu asks "can you
// make this right now"; this tab asks "what does the world know how to make",
// so a recipe is listed whether or not the reader holds its skills, its ⬢ or
// its ingredients. Visibility is the tag's own `catalog:` flag, already
// applied upstream by catalogTags().
//
// THE ONE THING IT HIDES is a recipe that NAMES an ingredient the reader was
// not sent. Dreamer's Draught needs a Skinless Brain and Moonshine needs
// Godflesh — both `catalog: gm` — and printing either in a public list gives
// away that they exist. Those are meant to be found in play, or worked out by
// handing something strange to a good crafter. So the whole row goes: a
// redacted line ("and something else") advertises the secret just as loudly
// as the name would.
//
// A `group:` ingredient names no tag and so hides nothing. Miasma needs "a
// corpse" (`{ group: items-corpse }`) and every member of that group is
// `catalog: secret` — a rule that counted groups would erase a public brew
// from everyone, GMs included, over a line that gives away nothing.

import { DEAD_SIMPLE_PER_TURN, isDeadSimple } from "./tagRequests";

function joinWithOr(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

// On /documents this runs on the OUTPUT of catalogTags(), so "visible" means
// what this reader was actually sent. getVisibleTags() (the site-wide
// hovercard payload) ships GM-catalog rows to everyone and hides them at
// render time instead, so it passes `visibleSlugs` explicitly — public tags
// plus what the viewer holds — rather than letting the list speak for itself.
//
// A recipe naming a withheld ingredient loses its requirementItems and is
// marked, which does two jobs at once: recipeRows() below drops the row, and
// TagChip — which renders these same objects — has no ingredient line left to
// print. The tag itself stays; only its recipe goes quiet.
//
// An `anyOf` entry is softer: the recipe is makeable with any ONE member, so
// an unseen member NARROWS the entry (slugs, options and label rebuilt from
// the visible ones) instead of sinking the recipe — a cook who knows tea and
// honey reads "Tea or Honey", and only a reader shown no member at all loses
// the row. Rebuilding the label also covers a hand-written `as:` that might
// have named the unseen thing.
export function redactWithheldRecipes(tags, { visibleSlugs = null } = {}) {
  const visible = visibleSlugs ?? new Set(tags.map((t) => t.slug));
  return tags.map((tag) => {
    const items = Array.isArray(tag.requirementItems) ? tag.requirementItems : null;
    if (!items) return tag;
    let withheld = false;
    let narrowed = false;
    const entries = items.map((entry) => {
      if (entry?.kind === "group") return entry;
      if (entry?.kind === "anyOf") {
        const options = (entry.options ?? []).filter((o) => visible.has(o.slug));
        if (options.length === (entry.options ?? []).length) return entry;
        if (options.length === 0) {
          withheld = true;
          return entry;
        }
        narrowed = true;
        return {
          ...entry,
          slugs: options.map((o) => o.slug),
          options,
          label: joinWithOr(options.map((o) => o.name)),
        };
      }
      if (entry?.slug && !visible.has(entry.slug)) withheld = true;
      return entry;
    });
    if (withheld) return { ...tag, requirementItems: null, ingredientsWithheld: true };
    if (narrowed) return { ...tag, requirementItems: entries };
    return tag;
  });
}

// The bucket for a recipe nothing gates — a wayside shrine, a scrap of salvage.
// Not a trade, so byDiscipline() files it last rather than under "N".
export const NO_SKILL = "No skill";

// The section a recipe sits under: the discipline of the skill that gates it,
// which is the skill's name with its rung dropped — "Brewing (Skilled)" and
// "Brewing (Basic)" are both Brewing, "Smithing (Gunpowder)" is Smithing.
// Derived rather than mapped, so a new rung or a new trade needs no edit here.
//
// The first SKILL, not the first requirement: Barbed Net asks for Crafting and
// the Fundamentalist belief, and the belief is not a trade.
export function recipeDiscipline(tag) {
  const skills = tag.requirementSkills ?? [];
  const skill = skills.find((s) => s.category === "skills") ?? skills[0];
  if (!skill) return NO_SKILL;
  return skill.name.replace(/\s*\([^()]*\)\s*$/, "").trim() || skill.name;
}

// Null turns is ONE turn, not zero — the same `?? 1` craftRequest and
// CraftDialog apply. Only an explicit 0 costs no Move.
//
// `ration` says how many units a turn, mirroring the Move-budget rules
// (docs/systemdocs/CRAFTING.md §2a) rather than assuming:
//   - the recipe's own `perTurn` wins where it is set. On a 0-turn recipe it
//     is the free allowance; on a 1-turn recipe it is the BATCH — three
//     Alcohol is one Routine, and each spends a third of the Move;
//   - otherwise Dead Simple work draws on the shared pool of 4;
//   - otherwise there is NO cap beyond the Move itself.
export function recipeWork(tag) {
  const turns = tag.requirementTurns ?? 1;
  // Only 0- and 1-turn recipes read `perTurn` as a per-turn ration. A project
  // (turns ≥ 2) takes the whole Move every turn it runs, `perTurn` or not —
  // the same guard craftMoveCost carries (web/lib/craftBudget.js) — so
  // printing "up to N a turn" on one would be the catalog inventing a rule
  // the server does not enforce. No such recipe exists today.
  if (tag.requirementPerTurn != null && turns <= 1) {
    return { turns, ration: tag.requirementPerTurn, shared: false };
  }
  if (turns === 0 && isDeadSimple(tag)) {
    return { turns, ration: DEAD_SIMPLE_PER_TURN, shared: true };
  }
  return { turns, ration: null, shared: false };
}

export function workLabel(turns) {
  if (turns === 0) return "No Move";
  return turns === 1 ? "1 turn" : `${turns} turns`;
}

// The Work filter's three answers, which are the three things the number
// actually changes for a player: no Move at all, this turn's Move, or a
// project you come back to (CRAFTING.md §3).
export function workBand(turns) {
  if (turns === 0) return "No Move";
  return turns === 1 ? "One turn" : "Project";
}

// Flat, sortable row per recipe. `tag` rides along whole so the table can hand
// it to TagChip and TagDetailSheet unchanged.
export function recipeRows(tags) {
  return tags
    .filter((tag) => tag.craftable && !tag.ingredientsWithheld)
    .map((tag) => {
      const { turns, ration, shared } = recipeWork(tag);
      const skills = tag.requirementSkills ?? [];
      // Labels only — `label` is denormalized by the sync (db/lib/tagShapes.js)
      // precisely so a reader of the recipe needs no second query. Spent and
      // kept are different bargains (CORPSES.md §8): most ingredients go into
      // the thing made, a `keep` entry only has to be to hand, and the row
      // says which.
      const ingredients = (tag.requirementItems ?? []).map((item) =>
        item.keep ? `${item.label} (kept, not used up)` : item.label,
      );
      return {
        id: tag.id,
        slug: tag.slug,
        name: tag.name,
        discipline: recipeDiscipline(tag),
        // " + ", not "/": every listed skill must be held (formatTagRequirement).
        skillLabel: skills.map((s) => s.name).join(" + "),
        kind: tag.groupName ?? "—",
        turns,
        ration,
        // A shared ration is spent across every Dead Simple recipe at once, so
        // the row says so rather than implying 4 of THIS one.
        rationShared: shared,
        band: workBand(turns),
        resources: tag.requirementResources ?? 0,
        ingredients,
        ingredientText: ingredients.join(", "),
        tag,
      };
    });
}

// Sections in the order they are read: disciplines alphabetically, and the
// handful of recipes anybody can make last, since "No skill" is not a trade.
export function byDiscipline(rows) {
  const sections = new Map();
  for (const row of rows) {
    if (!sections.has(row.discipline)) sections.set(row.discipline, []);
    sections.get(row.discipline).push(row);
  }
  return [...sections.entries()]
    .sort(([a], [b]) => {
      if (a === NO_SKILL) return 1;
      if (b === NO_SKILL) return -1;
      return a.localeCompare(b);
    })
    .map(([discipline, items]) => ({ discipline, rows: items }));
}
