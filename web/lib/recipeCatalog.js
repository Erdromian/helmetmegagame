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

// A withheld SKILL is the harder version of the same leak, and it loses the
// whole recipe rather than one line. The six courtier wax seals are public
// objects — a courtier buys their own mark openly — but the only way to MAKE
// one is Forger, a Brigand-only `catalog: gm` skill. Printing "Forger · 1 turn
// · 2 ⬢" under a seal tells the whole game that seals get forged, which is the
// one thing the forger is buying. So a craftable whose gating skill this
// reader was not sent keeps its name, its description and its point cost, and
// simply stops being craftable as far as the page is concerned.

import { DEAD_SIMPLE_PER_TURN, isDeadSimple } from "./tagRequests";
import { formatMoveFraction } from "./craftBudget";

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
    // The skill gate first, and it answers for the whole recipe: a reader who
    // cannot see the trade has no business reading the method either. Every
    // requirement column goes, so formatTagRequirement renders nothing at all
    // rather than a recipe with a hole in it.
    const skills = tag.requirementSkills ?? [];
    if (tag.craftable && skills.some((s) => s.slug && !visible.has(s.slug))) {
      return {
        ...tag,
        // `craftable` goes too, or TagDetailSheet's flag row still whispers
        // "somebody can make this" over an item whose only maker is a forger.
        craftable: false,
        requirementSkills: [],
        requirementItems: null,
        requirementTurns: null,
        requirementResources: null,
        requirementPerTurn: null,
        requirementGambit: false,
        recipeWithheld: true,
      };
    }
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
  const per = tag.requirementPerTurn ?? null;
  // Two meanings share the perTurn column, told apart by turns (CRAFTING.md
  // §2): at 0 turns it is a RATION (a hard daily cap); at 1 turn it is the
  // WORK DENOMINATOR the sync derived from `turnsCost: 1/N` — the fraction
  // is the story there, not a cap. A project (turns ≥ 2) reads neither.
  if (turns === 0 && per != null) {
    return { turns, workDen: null, ration: per, shared: false };
  }
  if (turns === 0 && isDeadSimple(tag)) {
    return { turns, workDen: null, ration: DEAD_SIMPLE_PER_TURN, shared: true };
  }
  if (turns === 1 && per > 1) {
    return { turns, workDen: per, ration: null, shared: false };
  }
  return { turns, workDen: null, ration: null, shared: false };
}

// The work a unit takes, in the player's words — the one label the Recipes
// tab and the Craft menu both print, so they cannot disagree. Fractional
// work reads as its fraction. A 0-turn recipe returns NULL, not a label:
// the Move isn't a requirement there, so it simply isn't listed (Chris
// 2026-09-06) — the ration line is that row's whole story.
export function workLabel(tag) {
  const { turns, workDen } = recipeWork(tag);
  if (turns === 0) return null;
  if (workDen) return `${formatMoveFraction(1, workDen)} turn`;
  return turns === 1 ? "1 turn" : `${turns} turns`;
}

// The Work filter's three answers, which are the three things the number
// actually changes for a player: no Move at all, this turn's Move, or a
// project you come back to (CRAFTING.md §3).
export function workBand(turns) {
  if (turns === 0) return "Free";
  return turns === 1 ? "One turn" : "Project";
}

// Flat, sortable row per recipe. `tag` rides along whole so the table can hand
// it to TagChip and TagDetailSheet unchanged.
//
// `placement` is the building system's marker — a craftable carrying it is
// raised on the ground as a Structure rather than crafted into a pocket
// (db/lib/structures.js), and building isn't crafting: those rows belong to
// the building paper, not the recipe book. Same predicate the Craft menu
// uses to route them to its own build flow.
export function recipeRows(tags) {
  return tags
    .filter(
      (tag) => tag.craftable && !tag.ingredientsWithheld && !tag.recipeWithheld && !tag.placement,
    )
    .map((tag) => {
      const { turns, ration, shared } = recipeWork(tag);
      const work = workLabel(tag);
      const skills = tag.requirementSkills ?? [];
      // Labels only — `label` is denormalized by the sync (db/lib/tagShapes.js)
      // precisely so a reader of the recipe needs no second query. Spent and
      // kept are different bargains (CORPSES.md §8): most ingredients go into
      // the thing made, a `keep` entry only has to be to hand, and the row
      // says which.
      const ingredients = (tag.requirementItems ?? []).map((item) => {
        if (item.keep) return `${item.label} (kept, not used up)`;
        return (item.count ?? 1) > 1 ? `${item.label} ×${item.count}` : item.label;
      });
      return {
        id: tag.id,
        slug: tag.slug,
        name: tag.name,
        discipline: recipeDiscipline(tag),
        // " + ", not "/": every listed skill must be held (formatTagRequirement).
        skillLabel: skills.map((s) => s.name).join(" + "),
        kind: tag.groupName ?? "—",
        turns,
        work,
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
