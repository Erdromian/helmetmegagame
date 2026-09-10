// Shared shape helpers for the tag columns that hold JSON rather than a
// scalar, so the two surfaces that author them enforce one rule set.
//
// There are two authoring surfaces now: docs/tags.yaml through
// db/lib/syncTags.js, and the GM tag form through
// web/app/(app)/gm/dev/tags/actions.js. These lived inline in syncTags.js
// while the YAML was the only door. Leaving them there and re-deriving the
// rules in the web action would give GMs a form that happily accepts a shape
// the next `npm run db:sync-tags` would reject — the failure would surface
// hours later, in a script, against a row nobody remembers writing.
//
// The messages take a `label` so each caller can name its own source: the
// sync says `docs/tags.yaml: tag "festering" …` and the GM form says
// something a GM reading a modal can act on.

// A chain entry (expiresInto or removesInto) is either a bare slug
// ("festering") or an even random pick between several
// ({ oneOf: ["missing-leg", "missing-arm"] }). Both normalise to
// { oneOf: [...] } here — a bare slug is simply a pick of one — so
// validation, the stored Json, and the passes that apply them all handle one
// shape instead of two. Null stays null: most tags don't turn into anything.
function normalizeTagChain(field, entries, label) {
  if (entries == null) return null;
  if (!Array.isArray(entries)) {
    throw new Error(`${label}: ${field} must be a list`);
  }
  return entries.map((entry) => {
    if (typeof entry === "string") return { oneOf: [entry] };
    if (!Array.isArray(entry?.oneOf) || entry.oneOf.length === 0) {
      throw new Error(`${label}: a ${field} entry is neither a slug nor a non-empty { oneOf: [...] }`);
    }
    return { oneOf: [...entry.oneOf] };
  });
}

// The two rules every chain shares: each slug exists, and a tag may not list
// itself. The self check's failure mode differs per field, so each validator
// below names its own.
function validateChainSlugs(field, normalized, { selfSlug, knownSlugs, label, selfProblem }) {
  for (const { oneOf } of normalized ?? []) {
    for (const slug of oneOf) {
      if (!knownSlugs.has(slug)) {
        throw new Error(`${label}: tag "${selfSlug}" ${field} references unknown tag "${slug}"`);
      }
      if (slug === selfSlug) {
        throw new Error(`${label}: tag "${selfSlug}" ${field} itself — ${selfProblem}`);
      }
    }
  }
}

function normalizeExpiresInto(entries, label = "docs/tags.yaml") {
  return normalizeTagChain("expiresInto", entries, label);
}

// The three rules an expiry chain has to satisfy. Each one is a silent no-op
// rather than an error if it slips through, which is exactly why they are
// checked up front on both doors.
//
//   normalized   the output of normalizeExpiresInto, or null
//   selfSlug     the tag being authored, which may not appear in its own chain
//   knownSlugs   a Set of every slug that exists
//   durationTurns the tag's own defaultDurationTurns
function validateExpiresInto(normalized, { selfSlug, knownSlugs, durationTurns, label = "docs/tags.yaml" }) {
  // The self check: the grant happens one statement before the sweep that
  // deletes the expired row, and the sweep matches on tag id — so a tag that
  // expires into itself would be re-granted and then immediately deleted,
  // doing nothing at all. Recurring conditions are written as a two-tag loop
  // instead (migraine <-> no-migraine).
  validateChainSlugs("expiresInto", normalized, {
    selfSlug,
    knownSlugs,
    label,
    selfProblem: "the sweep would delete the fresh grant. Use a two-tag loop instead.",
  });
  if (normalized && !(durationTurns > 0)) {
    throw new Error(`${label}: tag "${selfSlug}" sets expiresInto but has no durationTurns — nothing would ever fire it`);
  }
}

// escalatesInto — the rung ABOVE this tag on a ladder (docs/tags.yaml's
// header, docs/systemdocs/BREWING.md). Consuming something that grants a tag
// you already hold clears the held one and gives you this instead, which is
// the only reason a second drink does anything at all.
//
// One bare slug, not the { oneOf } shape expiresInto uses: a ladder has
// exactly one next rung, and a random one would make "one more drink"
// impossible to plan around.
function validateEscalatesInto(value, { selfSlug, knownSlugs, label = "docs/tags.yaml" }) {
  if (value == null) return;
  if (typeof value !== "string" || !value) {
    throw new Error(`${label}: tag "${selfSlug}" escalatesInto must be a single slug`);
  }
  if (!knownSlugs.has(value)) {
    throw new Error(`${label}: tag "${selfSlug}" escalatesInto references unknown tag "${value}"`);
  }
  if (value === selfSlug) {
    throw new Error(`${label}: tag "${selfSlug}" escalatesInto itself — drinking again would change nothing`);
  }
}

// The whole-document half of the check. A per-tag rule can catch a tag
// pointing at itself, but not tipsy -> wasted -> tipsy, and the resolver
// walks this chain in a loop — so a cycle there would hang the request rather
// than fail it. Cheap to prove up front, so it is proved up front.
//
// `bySlug` is a Map of slug -> escalatesInto (or null).
function validateEscalationChains(bySlug, label = "docs/tags.yaml") {
  for (const start of bySlug.keys()) {
    const seen = new Set([start]);
    let at = bySlug.get(start);
    while (at) {
      if (seen.has(at)) {
        throw new Error(
          `${label}: escalatesInto loops through "${at}" — a ladder has to end, or a drink never stops escalating`,
        );
      }
      seen.add(at);
      at = bySlug.get(at) ?? null;
    }
  }
}

// removesInto — what a tag turns into when it leaves the sheet through a
// player-driven removal (the Remove Tag request, or a Heal). Same entry
// shape as expiresInto; no duration requirement, since the removal itself is
// what fires it rather than any clock. The aftermath's own
// defaultDurationTurns decides how long it lingers.
function normalizeRemovesInto(entries, label = "docs/tags.yaml") {
  return normalizeTagChain("removesInto", entries, label);
}

function validateRemovesInto(normalized, { selfSlug, knownSlugs, label = "docs/tags.yaml" }) {
  // The self check here: re-granting the tag the player just paid to remove
  // would make removal a no-op with a bill attached.
  validateChainSlugs("removesInto", normalized, {
    selfSlug,
    knownSlugs,
    label,
    selfProblem: "removing it would grant it right back.",
  });
}

// Rolls a stored (normalized) chain into concrete slugs — an even pick per
// entry, a bare slug having normalised to a one-element oneOf. The same roll
// db/lib/tagExpiryPass.js makes inline; exposed here for the removal paths.
function rollTagChain(normalized) {
  const slugs = [];
  for (const entry of Array.isArray(normalized) ? normalized : []) {
    const choices = entry?.oneOf ?? [];
    if (!choices.length) continue;
    slugs.push(choices[Math.floor(Math.random() * choices.length)]);
  }
  return slugs;
}

// requirement.items — the INGREDIENT half of a recipe. Three entry shapes:
//
//     items: [cave-fungus]                 a specific tag, SPENT
//     items: [{ group: items-corpse }]     any tag in a group, KEPT
//     items: [{ anyOf: [tea, sweets] }]    the player picks one, SPENT
//
// The group form is not a convenience — it is the only thing that can work for
// Miasma. A person's corpse tag is written at death (db/lib/corpseMint.js) and
// never appears in docs/tags.yaml, so no authored slug could ever name one.
// That is also why the stored column is Json rather than a Tag[] relation.
//
// CONSUMED OR KEPT, and the default differs by shape. A slug (or an `anyOf`
// pick) is SPENT — `quantity` units per craft, scaled the same way ⬢ is. A
// GROUP entry is KEPT: a body has its own lifecycle, and "any member of a
// group" has no single stack to decrement, so `keep: false` on a group is
// refused rather than guessed at. `keep: true` on a slug turns it back into
// the old hold-check (dreamers-draught's brain used to be one).
//
// `label` on each normalized entry is DENORMALIZED on purpose.
// formatTagRequirement() is pure and synchronous and is called from four
// surfaces with four different selects; resolving a group's name at render
// time would mean widening every one of them and giving the bot an extra
// query. The sync rewrites the label every run, which is the same freshness
// contract every other denormalized field in the catalog has. An `anyOf`
// entry carries `options: [{ slug, name }]` for the same reason: the Craft
// dialog's picker needs the members' names and has only the recipe row.
function joinWithOr(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

// requirement.turnsCost carries the WORK one unit takes: an integer number
// of Moves, or a `1/N` fraction — a brew that is a third of a turn's work is
// `turnsCost: 1/3`, and three of them fill a Routine (Chris 2026-09-06, the
// work-arithmetic concept: quantity is limited by work, never by a separate
// cap). Internally a fraction stores as requirementTurns: 1 +
// requirementPerTurn: N — the engine's existing share encoding — so this is
// an authoring surface, not a schema change. `perTurn:` itself is ONLY legal
// on a 0-turn recipe, where it is a RATION (a hard daily cap below the Dead
// Simple pool's 4); writing it on anything that costs a Move is refused,
// because that is the double-duty this function exists to end.
function normalizeTurnsCost(requirement, { slug }, label = "docs/tags.yaml") {
  const raw = requirement?.turnsCost;
  const perTurn = requirement?.perTurn ?? null;
  let turns = null;
  let workDen = null;
  if (raw == null) {
    turns = null;
  } else if (Number.isInteger(raw) && raw >= 0) {
    turns = raw;
  } else if (typeof raw === "string" && /^1\/[2-9][0-9]*$/.test(raw.trim())) {
    turns = 1;
    workDen = Number(raw.trim().slice(2));
  } else {
    throw new Error(
      `${label}: tag "${slug}" requirement.turnsCost must be a whole number of Moves or a "1/N" fraction — got ${JSON.stringify(raw)}`,
    );
  }
  if (perTurn != null) {
    if (!Number.isInteger(perTurn) || perTurn < 1) {
      throw new Error(`${label}: tag "${slug}" requirement.perTurn must be a positive integer`);
    }
    if ((turns ?? 1) !== 0) {
      throw new Error(
        `${label}: tag "${slug}" sets perTurn on a recipe that costs a Move — perTurn is a 0-turn ration; write the work as turnsCost: 1/${perTurn} instead`,
      );
    }
  }
  return {
    requirementTurns: turns,
    requirementPerTurn: workDen ?? perTurn,
  };
}

function normalizeRequirementItems(entries, { tagNameBySlug = null, groupNameBySlug = null } = {}, label = "docs/tags.yaml") {
  if (entries == null) return null;
  if (!Array.isArray(entries)) throw new Error(`${label}: requirement.items must be a list`);
  if (entries.length === 0) return null;
  return entries.map((entry) => {
    if (typeof entry === "string") {
      return { kind: "tag", slug: entry, label: tagNameBySlug?.get(entry) ?? entry, keep: false };
    }
    const hasTag = typeof entry?.tag === "string";
    const hasGroup = typeof entry?.group === "string";
    const hasAnyOf = entry?.anyOf != null;
    if ([hasTag, hasGroup, hasAnyOf].filter(Boolean).length !== 1) {
      throw new Error(`${label}: a requirement.items entry needs exactly one of \`tag:\`, \`group:\` or \`anyOf:\``);
    }
    if (entry.keep != null && typeof entry.keep !== "boolean") {
      throw new Error(`${label}: a requirement.items \`keep:\` must be a boolean`);
    }
    // How many units of THIS ingredient one craft takes, on top of the craft
    // quantity — a blank book is ten sheets, and three of them are thirty.
    // Carried only when it isn't 1: every reader writes `count ?? 1`, so
    // storing the default would fatten each recipe's Json for nothing.
    //
    // Refused on a `group:` and alongside `keep: true` for the same reason
    // `keep: false` is refused on a group: both are hold-checks with no single
    // stack to decrement, so a count on one would silently mean nothing.
    const count = entry.count ?? 1;
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`${label}: a requirement.items \`count:\` must be a whole number of 1 or more`);
    }
    if (count !== 1 && (hasGroup || entry.keep === true)) {
      throw new Error(
        `${label}: a requirement.items \`count:\` only applies to an ingredient that is SPENT — a kept entry names no stack to draw from`,
      );
    }
    const countField = count === 1 ? {} : { count };
    if (hasTag) {
      return {
        kind: "tag",
        slug: entry.tag,
        label: entry.as ?? tagNameBySlug?.get(entry.tag) ?? entry.tag,
        keep: entry.keep === true,
        ...countField,
      };
    }
    if (hasAnyOf) {
      if (!Array.isArray(entry.anyOf) || entry.anyOf.length < 2 || entry.anyOf.some((s) => typeof s !== "string")) {
        throw new Error(`${label}: a requirement.items \`anyOf:\` must list 2 or more tag slugs`);
      }
      const slugs = [...entry.anyOf];
      const options = slugs.map((slug) => ({ slug, name: tagNameBySlug?.get(slug) ?? slug }));
      return {
        kind: "anyOf",
        slugs,
        options,
        label: entry.as ?? joinWithOr(options.map((o) => o.name)),
        keep: entry.keep === true,
        ...countField,
      };
    }
    // A group is HELD, never spent: there is no one stack to take it out of.
    if (entry.keep === false) {
      throw new Error(
        `${label}: a requirement.items \`group:\` entry cannot set \`keep: false\` — a group names no single stack to spend`,
      );
    }
    // "Corpses" -> "a corpse". Graceless for some group names, which is what
    // the `as:` override is there for.
    const name = groupNameBySlug?.get(entry.group) ?? entry.group;
    const derived = name.replace(/s$/i, "").toLowerCase();
    return { kind: "group", slug: entry.group, label: entry.as ?? `a ${derived}`, keep: true };
  });
}

function validateRequirementItems(normalized, { selfSlug, tagSlugs, groupSlugs, craftable, placement = null, label = "docs/tags.yaml" }) {
  if (!normalized) return;
  const seen = new Set();
  let pickers = 0;
  for (const entry of normalized) {
    const slugs = entry.kind === "anyOf" ? entry.slugs : [entry.slug];
    const known = entry.kind === "group" ? groupSlugs : tagSlugs;
    for (const slug of slugs) {
      if (!known?.has(slug)) {
        throw new Error(`${label}: tag "${selfSlug}" references unknown requirement item ${entry.kind} "${slug}"`);
      }
    }
    if (entry.kind === "anyOf" && new Set(slugs).size !== slugs.length) {
      throw new Error(`${label}: tag "${selfSlug}" lists the same slug twice inside one anyOf`);
    }
    if (entry.kind === "anyOf") pickers += 1;
    const key = entry.kind === "anyOf" ? `anyOf:${[...slugs].sort().join("|")}` : `${entry.kind}:${entry.slug}`;
    if (seen.has(key)) {
      throw new Error(`${label}: tag "${selfSlug}" lists requirement item "${slugs.join("/")}" twice`);
    }
    seen.add(key);
  }
  // ONE picker per recipe. The Craft dialog posts a single `ingredientChoice`,
  // so a second anyOf would have no way to be answered — refuse it here rather
  // than ship a recipe nobody can file.
  if (pickers > 1) {
    throw new Error(`${label}: tag "${selfSlug}" has ${pickers} anyOf ingredients — the Craft dialog posts one choice`);
  }
  // Not pedantry. The only enforcement point is the Craft path, so an `items`
  // block on anything else would sit in the catalog looking enforced and do
  // nothing — which is the exact failure mode this field exists to end.
  if (!craftable) {
    throw new Error(`${label}: tag "${selfSlug}" declares requirement.items but is not craftable — nothing would ever check it`);
  }
  // A `placement:` recipe is raised by a CREW over several turns
  // (openBuildSiteImpl / joinBuildSite), and nothing on that path spends an
  // ingredient — whose stack would it come out of, on turn three, when a
  // second builder lends the Move? Refusing at sync is cheaper than inventing
  // crew-turn ingredient semantics nobody asked for.
  if (placement) {
    throw new Error(
      `${label}: tag "${selfSlug}" declares requirement.items and placement — a build site never spends an ingredient`,
    );
  }
}


// The `laborBonus:` block — what a tool adds to one kind of Laboring
// (docs/systemdocs/LABORING.md). Normalised here rather than trusted straight
// from YAML because a typo in `kind` would silently make a tool worthless, and
// the symptom (a bow that pays nothing) looks like a rules question rather than
// a data bug.
//
// { kind, amount, equipped, requiresTag } or null. `equipped` defaults TRUE —
// nearly every tool is something you carry, and the two that aren't say so.
const LABOR_BONUS_KINDS = new Set(["hunting", "farming", "fishing", "prospecting"]);

function normalizeLaborBonus(entry, label = "docs/tags.yaml") {
  if (entry == null) return null;
  if (typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${label}: laborBonus must be a mapping`);
  }
  const kind = String(entry.kind ?? "").toLowerCase();
  if (!LABOR_BONUS_KINDS.has(kind)) {
    throw new Error(`${label}: laborBonus.kind must be one of ${[...LABOR_BONUS_KINDS].join(", ")}`);
  }
  const amount = Number(entry.amount);
  if (!Number.isInteger(amount) || amount === 0) {
    throw new Error(`${label}: laborBonus.amount must be a non-zero integer`);
  }
  const requiresTag = entry.requiresTag == null ? null : String(entry.requiresTag);
  return { kind, amount, equipped: entry.equipped !== false, requiresTag };
}

// Two things the shape alone can't catch: a bonus that only pays while
// equipped on a tag nothing can equip, and a requiresTag naming a tag that
// isn't in the catalog.
function validateLaborBonus(normalized, { selfSlug, tagSlugs, equippable, label = "docs/tags.yaml" }) {
  if (!normalized) return;
  if (normalized.equipped && !equippable) {
    throw new Error(
      `${label}: "${selfSlug}" has a laborBonus that requires being equipped, but the tag is not equippable`,
    );
  }
  if (normalized.requiresTag && !tagSlugs.has(normalized.requiresTag)) {
    throw new Error(`${label}: "${selfSlug}" laborBonus.requiresTag names unknown tag "${normalized.requiresTag}"`);
  }
}

// The `placement:` block — what makes a craftable BUILD ON SITE (a Structure
// row at the builder's Location) instead of landing in a pocket, from
// docs/tags.yaml (schema.prisma's Tag.placement comment has the full shape).
// Normalised here, same posture as laborBonus above: db/lib/structures.js is
// the read side and trusts this shape rather than re-deriving it.
//
// Shape checks only — no selfSlug in the messages, matching
// normalizeLaborBonus above. Cross-field rules (craftable, never
// tradeable/stackable/equippable/carryBonus, provides naming real tags) need
// the rest of the tag entry and knownSlugs, so those live in validatePlacement.
function normalizePlacement(raw, label = "docs/tags.yaml") {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}: placement must be a mapping`);
  }
  // No hp key, deliberately: structure condition is the status enum and the
  // words printed from it, never a numeric pool (the plan cut HP on purpose).
  if (raw.hp != null) {
    throw new Error(`${label}: placement.hp is not a thing — condition is status words, not a pool`);
  }
  if (raw.unique != null && typeof raw.unique !== "boolean") {
    throw new Error(`${label}: placement.unique must be a boolean`);
  }
  if (raw.fieldwork != null && typeof raw.fieldwork !== "boolean") {
    throw new Error(`${label}: placement.fieldwork must be a boolean`);
  }
  if (raw.examine != null && (typeof raw.examine !== "string" || !raw.examine.trim())) {
    throw new Error(`${label}: placement.examine must be a non-empty string`);
  }
  if (raw.defenseNote != null && (typeof raw.defenseNote !== "string" || !raw.defenseNote.trim())) {
    throw new Error(`${label}: placement.defenseNote must be a non-empty string`);
  }
  if (raw.provides != null && (!Array.isArray(raw.provides) || raw.provides.some((s) => typeof s !== "string"))) {
    throw new Error(`${label}: placement.provides must be a list of tag slugs`);
  }
  if (raw.inscribable != null && typeof raw.inscribable !== "boolean") {
    throw new Error(`${label}: placement.inscribable must be a boolean`);
  }
  // Where this type may be raised at all, by Location slug. ABSENT means
  // anywhere the ground rules allow — the gate is opt-in, so the twelve
  // structures written before it keep working untouched. A slug list rather
  // than a zone list because it is the more precise tool and because
  // `unique` is already per-Location: naming exactly one Location is how a
  // type becomes one-of-a-kind without a game-wide uniqueness rule, which
  // does not exist.
  if (
    raw.locations != null &&
    (!Array.isArray(raw.locations) || raw.locations.some((s) => typeof s !== "string" || !s.trim()))
  ) {
    throw new Error(`${label}: placement.locations must be a list of location slugs`);
  }
  // What this structure PRODUCES every turn, into a Room's floor rather than
  // into anybody's pockets (db/lib/structureYieldPass.js). The room is named
  // by slug and need not be at the structure's own Location — the Brewery
  // stands at the inn and pours into its cellar.
  let yields = null;
  if (raw.yields != null) {
    if (typeof raw.yields !== "object" || Array.isArray(raw.yields)) {
      throw new Error(`${label}: placement.yields must be a mapping`);
    }
    const tag = String(raw.yields.tag ?? "").trim();
    const room = String(raw.yields.room ?? "").trim();
    if (!tag) throw new Error(`${label}: placement.yields.tag must be a tag slug`);
    if (!room) throw new Error(`${label}: placement.yields.room must be a room slug`);
    const quantity = raw.yields.quantity == null ? 1 : Number(raw.yields.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error(`${label}: placement.yields.quantity must be a positive integer`);
    }
    // Who has to be MINDING it. A skill slug: the structure produces nothing
    // on a turn that closes with nobody standing at its Location who counts
    // as having that skill — "counts as" meaning the tier ladder, so a
    // Brewing (Skilled) brewer satisfies a `brewing-basic` requirement
    // (db/lib/medicalVision.js#satisfiedSkillIds). Absent means the thing
    // runs itself.
    const skill = raw.yields.skill == null ? null : String(raw.yields.skill).trim();
    if (raw.yields.skill != null && !skill) {
      throw new Error(`${label}: placement.yields.skill must be a tag slug`);
    }
    yields = { tag, room, quantity, skill };
  }
  // How many bird flights a day standing here is worth (BIRD.md). The Bird's
  // own allowance is 1; a structure raises it, and the biggest one at the
  // Location wins — the same best-wins posture structureTools keeps for
  // laborBonus, so two rookeries are not twice a rookery.
  let birdSendsPerDay = null;
  if (raw.birdSendsPerDay != null) {
    const n = Number(raw.birdSendsPerDay);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`${label}: placement.birdSendsPerDay must be a positive integer`);
    }
    birdSendsPerDay = n;
  }
  // Music: what the six-hourly sweep pays a listener, and the item that has
  // to be lying about for any of it to happen (bot/src/lib/stagePlay.js).
  let music = null;
  if (raw.music != null) {
    if (typeof raw.music !== "object" || Array.isArray(raw.music)) {
      throw new Error(`${label}: placement.music must be a mapping`);
    }
    const mood = Number(raw.music.mood);
    // Positive only, and for the reason laborBonus.amount gives: relief is
    // never multiplied (MOOD.md §7), so a negative here would be a harm term
    // wearing a relief's clothes and would skip every phobia it should read.
    if (!Number.isInteger(mood) || mood < 1) {
      throw new Error(`${label}: placement.music.mood must be a positive integer`);
    }
    const needs = String(raw.music.needs ?? "").trim();
    if (!needs) throw new Error(`${label}: placement.music.needs must be a tag slug`);
    music = { mood, needs };
  }
  let laborBonus = null;
  if (raw.laborBonus != null) {
    if (typeof raw.laborBonus !== "object" || Array.isArray(raw.laborBonus)) {
      throw new Error(`${label}: placement.laborBonus must be a mapping`);
    }
    const kind = String(raw.laborBonus.kind ?? "").toLowerCase();
    if (!LABOR_BONUS_KINDS.has(kind)) {
      throw new Error(`${label}: placement.laborBonus.kind must be one of ${[...LABOR_BONUS_KINDS].join(", ")}`);
    }
    const amount = Number(raw.laborBonus.amount);
    // Positive only: a malus would apply to EVERYONE laboring the ground,
    // and a negative bonus can drag the paid range's floor below zero,
    // where the machine expression stops parsing and pays nothing at all.
    if (!Number.isInteger(amount) || amount < 1) {
      throw new Error(`${label}: placement.laborBonus.amount must be a positive integer`);
    }
    laborBonus = { kind, amount };
  }
  return {
    unique: raw.unique !== false,
    fieldwork: raw.fieldwork === true,
    examine: raw.examine ?? null,
    defenseNote: raw.defenseNote ?? null,
    laborBonus,
    locations: raw.locations ?? [],
    yields,
    birdSendsPerDay,
    music,
    provides: raw.provides ?? [],
    // The builder may write a line on the finished thing
    // (Structure.inscription) — their words replace `examine` in the
    // readout. The wayside shrine's flag; see CRAFTING.md.
    inscribable: raw.inscribable === true,
  };
}

// `customizable:` — the recipe may be crafted as a player-named custom item
// (CRAFTING.md; the craft mints a custom+ephemeral row via the paperMint.js
// door), and `customizableSkill:` is the tag somebody has to hold to do it —
// `smithing-skilled` on the arms and armour. A typo there would open the door
// to nobody at all rather than fail loudly, which is why the slug is checked
// against the catalog the way excludedRoles is. Four rules, each closing a
// real hole rather than expressing taste:
// not craftable and nothing would ever mint one; not stackable and the
// one-per-character checks (craftGrantChecks, tier replacement) compare the
// BASE tag's id against held ids, which a minted row never matches — so a
// non-stackable custom would dodge its own exclusivity; and a `placement:`
// recipe is a Structure with its own words (placement.inscribable), not a
// pocket item to rename.
function validateCustomizable(entry, { slug, knownSlugs = null, label = "docs/tags.yaml" }) {
  // The skill gate is authored on the recipe, so it is checked even when the
  // recipe is not customizable at all — a `customizableSkill` left behind on a
  // row whose flag came off would otherwise sit there gating nothing.
  const gate = entry?.customizableSkill;
  if (gate !== undefined && gate !== null) {
    if (typeof gate !== "string" || !gate.trim()) {
      throw new Error(`${label}: tag "${slug}" customizableSkill must be a tag slug`);
    }
    if (knownSlugs && !knownSlugs.has(gate)) {
      throw new Error(`${label}: tag "${slug}" customizableSkill references unknown tag "${gate}"`);
    }
    if (!entry.customizable) {
      throw new Error(`${label}: tag "${slug}" has customizableSkill but is not customizable — the gate would guard a door that isn't there`);
    }
  }
  if (!entry?.customizable) return;
  if (!entry.craftable) {
    throw new Error(`${label}: tag "${slug}" is customizable but not craftable — nothing would ever mint one`);
  }
  if (!entry.stackable) {
    throw new Error(`${label}: tag "${slug}" is customizable but not stackable — a minted custom row dodges the base recipe's one-per-character checks`);
  }
  if (entry.placement) {
    throw new Error(`${label}: tag "${slug}" is customizable and carries placement — a structure takes placement.inscribable, not a custom name`);
  }
}

// Two things the shape alone can't catch: a placement block on a tag nothing
// would ever build (the Craft path is the only enforcement point, same
// reasoning as validateRequirementItems), and a placement block on a tag that
// could otherwise leave a Location — tradeable, stackable, equippable and
// carryBonus all mean "this can end up on somebody's person", which a
// Structure never does. `tag` is the raw YAML entry, so those flags are read
// as authored rather than re-derived.
function validatePlacement(placement, { slug, tag, knownSlugs, label = "docs/tags.yaml" }) {
  if (!placement) return;
  if (!tag?.craftable) {
    throw new Error(
      `${label}: tag "${slug}" declares placement but is not craftable — the build path is the only enforcement point`,
    );
  }
  if (tag.tradeable) {
    throw new Error(`${label}: tag "${slug}" declares placement but is tradeable — a structure is never on anyone's person`);
  }
  if (tag.stackable) {
    throw new Error(`${label}: tag "${slug}" declares placement but is stackable — a structure is never on anyone's person`);
  }
  if (tag.equippable) {
    throw new Error(`${label}: tag "${slug}" declares placement but is equippable — a structure is never on anyone's person`);
  }
  if (tag.carryBonus != null) {
    throw new Error(`${label}: tag "${slug}" declares placement but carries a carryBonus — a structure is never on anyone's person`);
  }
  if (tag.laborBonus != null) {
    throw new Error(
      `${label}: tag "${slug}" declares placement but a top-level laborBonus — a structure is never held, so that would be dead config; use placement.laborBonus`,
    );
  }
  for (const provided of placement.provides) {
    if (!knownSlugs.has(provided)) {
      throw new Error(`${label}: tag "${slug}" placement.provides references unknown tag "${provided}"`);
    }
  }
  if (placement.yields && !knownSlugs.has(placement.yields.tag)) {
    throw new Error(`${label}: tag "${slug}" placement.yields.tag references unknown tag "${placement.yields.tag}"`);
  }
  if (placement.yields?.skill && !knownSlugs.has(placement.yields.skill)) {
    throw new Error(`${label}: tag "${slug}" placement.yields.skill references unknown tag "${placement.yields.skill}"`);
  }
  if (placement.music && !knownSlugs.has(placement.music.needs)) {
    throw new Error(`${label}: tag "${slug}" placement.music.needs references unknown tag "${placement.music.needs}"`);
  }
  // `placement.locations` and `placement.yields.room` name LOCATIONS and
  // ROOMS, which live in docs/zones.yaml behind a different sync — knownSlugs
  // holds tag slugs and nothing else, so there is nothing here to check them
  // against. Same reasoning syncZones.js keeps for the tag slugs it cannot
  // see (SYNC.md): the two masters sync independently, so a cross-master
  // reference is resolved at RUNTIME and must fail soft. It does — the yield
  // pass logs and skips a room it cannot find, and the build gate refuses a
  // Location that does not match rather than throwing.
  // A 0-turn placement would be born finished with turnsDone above
  // turnsNeeded — a build takes at least one crew-turn, always.
  const turns = tag.requirement?.turnsCost ?? 1;
  if (!Number.isInteger(turns) || turns < 1) {
    throw new Error(
      `${label}: tag "${slug}" declares placement but requirement.turnsCost is ${tag.requirement?.turnsCost} — a structure takes at least 1 crew-turn`,
    );
  }
}

// ─── fighting ───────────────────────────────────────────────────────────────
// The `fighting:` block — what a tag does in a fight (docs/systemdocs/COMBAT.md).
// Normalised here, same posture as laborBonus and placement above:
// db/lib/fightingSkill.js is the read side and trusts this shape rather than
// re-deriving it.
//
// The one thing worth knowing before reading the code: the YAML authors TIERS
// and this stores POINTS. Tiers are what twenty tag descriptions already say
// ("counts as 2 tiers higher"), so authoring in anything else would make the
// catalog and its own prose disagree. Points are what the arithmetic wants,
// because a tier takes decimals and a running total should not.
const { BANDS, POINTS_PER_TIER, WEAPON_CLASSES } = require("./fightingSkill");

const FIGHTING_TREES = new Set(["melee", "ranged", "both"]);
const FIGHTING_BAND_KEYS = new Set(BANDS.map((b) => b.key));
const FIGHTING_WHEN_KEYS = new Set(["weaponClass", "holds", "equipped", "unarmoured"]);

// A tier is authored to one decimal place and nothing finer. The check is not
// fussiness: `tiers: 0.25` would silently become 2.5 points, round somewhere,
// and land as a value nobody authored. Refusing it means a typo fails the sync
// instead of quietly changing a tag.
function tiersToPoints(value, label, what) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label}: ${what} must be a number`);
  const points = n * POINTS_PER_TIER;
  if (!Number.isInteger(Math.round(points * 1000) / 1000)) {
    throw new Error(`${label}: ${what} must be a multiple of 0.1 tiers, got ${n}`);
  }
  return Math.round(points);
}

function normalizeStringList(raw, field, label) {
  if (raw == null) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  if (!list.length) return null;
  return list.map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(`${label}: ${field} entries must be non-empty strings`);
    }
    return entry.trim();
  });
}

function normalizeFightingWhen(raw, label) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}: fighting.when must be a mapping`);
  }
  for (const key of Object.keys(raw)) {
    if (!FIGHTING_WHEN_KEYS.has(key)) {
      throw new Error(`${label}: fighting.when has unknown key "${key}" — expected ${[...FIGHTING_WHEN_KEYS].join(", ")}`);
    }
  }
  const when = {};
  for (const key of FIGHTING_WHEN_KEYS) {
    const list = normalizeStringList(raw[key], `fighting.when.${key}`, label);
    if (list) when[key] = list;
  }
  if (!Object.keys(when).length) {
    throw new Error(`${label}: fighting.when is empty — drop it rather than writing a condition that is always true`);
  }
  for (const cls of when.weaponClass ?? []) {
    if (!WEAPON_CLASSES.has(cls)) {
      throw new Error(`${label}: fighting.when.weaponClass has unknown class "${cls}"`);
    }
  }
  return when;
}

function normalizeFighting(raw, label = "docs/tags.yaml") {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}: fighting must be a mapping`);
  }

  const out = {};

  if (raw.tree != null) {
    const tree = String(raw.tree).toLowerCase();
    if (!FIGHTING_TREES.has(tree)) {
      throw new Error(`${label}: fighting.tree must be one of ${[...FIGHTING_TREES].join(", ")}`);
    }
    out.tree = tree;
  }

  // Rungs are 1-indexed: Basic is the first rung of the ladder, not the
  // zeroth. Rung 0 would mean "on the ladder at the height of somebody who
  // isn't", which is a block that says nothing — and saying nothing is spelt
  // by leaving the block off.
  if (raw.rung != null) {
    if (!Number.isInteger(raw.rung) || raw.rung < 1) {
      throw new Error(`${label}: fighting.rung must be an integer of at least 1 — Basic is rung 1`);
    }
    out.rung = raw.rung;
  }

  // `tiers` and `points` are the same field in two units. Authoring both would
  // be two answers to one question, so it is refused rather than picked between.
  if (raw.tiers != null && raw.points != null) {
    throw new Error(`${label}: fighting names both tiers and points — write one`);
  }
  if (raw.tiers != null) out.points = tiersToPoints(raw.tiers, label, "fighting.tiers");
  if (raw.points != null) {
    if (!Number.isInteger(raw.points)) throw new Error(`${label}: fighting.points must be an integer`);
    out.points = raw.points;
  }

  for (const key of ["floor", "cap"]) {
    if (raw[key] == null) continue;
    const band = String(raw[key]).toLowerCase();
    if (!FIGHTING_BAND_KEYS.has(band)) {
      throw new Error(`${label}: fighting.${key} must be a band key — ${[...FIGHTING_BAND_KEYS].join(", ")}`);
    }
    out[key] = band;
  }

  if (raw.weaponClass != null) {
    const cls = String(raw.weaponClass).toLowerCase();
    if (!WEAPON_CLASSES.has(cls)) {
      throw new Error(`${label}: fighting.weaponClass must be one of ${[...WEAPON_CLASSES].join(", ")}`);
    }
    out.weaponClass = cls;
  }

  const when = normalizeFightingWhen(raw.when, label);
  if (when) out.when = when;

  // A FLAG, not a sentence. It used to carry the condition as prose ("when
  // dueling", "at long range") and that came back out of the catalog: which
  // moment a tag is for is already in the tag's own description, and saying it
  // twice is two things to keep in step. All this says now is: a gamemaster
  // decides this one, so it never enters the number.
  if (raw.situational != null) {
    if (raw.situational !== true) {
      throw new Error(`${label}: fighting.situational is a flag — write \`true\` or leave it out`);
    }
    out.situational = true;
  }

  const cancels = normalizeStringList(raw.cancels, "fighting.cancels", label);
  if (cancels) out.cancels = cancels;

  if (!Object.keys(out).length) {
    throw new Error(`${label}: fighting is empty — drop the block rather than writing one that says nothing`);
  }
  return out;
}

// What the shape alone cannot catch: a block that says nothing the resolver
// will ever read, a condition naming a tag that is not in the catalog, and a
// weapon that cannot be equipped. Each of these is a SILENT no-op at runtime
// rather than a crash, which is exactly why they are caught at the door.
function validateFighting(normalized, { selfSlug, tagSlugs, equippable, label = "docs/tags.yaml" }) {
  if (!normalized) return;

  const saysSomething =
    normalized.rung != null ||
    normalized.points != null ||
    normalized.floor ||
    normalized.cap ||
    normalized.weaponClass ||
    // `situational: true` on its own is a real answer: Camouflage has no tier
    // and no tree, and still has to reach the sheet's situational list. That
    // list is the whole reason such a tag carries a block at all.
    normalized.situational ||
    normalized.cancels;
  if (!saysSomething) {
    throw new Error(`${label}: "${selfSlug}" fighting has a condition but nothing to apply — add tiers, a floor, or a note`);
  }

  // A shift needs to know which half of the tree it lands on. A weapon is the
  // exception: its class already answers that, and saying it twice invites the
  // two to disagree.
  if (normalized.points != null && !normalized.tree && !normalized.weaponClass) {
    throw new Error(`${label}: "${selfSlug}" fighting has tiers but no tree — write melee, ranged, or both`);
  }
  if (normalized.weaponClass && normalized.tree) {
    throw new Error(`${label}: "${selfSlug}" fighting names a weaponClass and a tree — the class already decides the tree`);
  }
  if (normalized.weaponClass && !equippable) {
    throw new Error(`${label}: "${selfSlug}" fighting names a weaponClass, but the tag is not equippable — a weapon nobody can draw is worth nothing`);
  }

  // Every condition and cancellation names a real tag. A typo here would read
  // as a bonus that simply never fires.
  for (const field of ["holds", "equipped"]) {
    for (const slug of normalized.when?.[field] ?? []) {
      if (!tagSlugs.has(slug)) {
        throw new Error(`${label}: "${selfSlug}" fighting.when.${field} names unknown tag "${slug}"`);
      }
    }
  }
  for (const slug of normalized.cancels ?? []) {
    if (!tagSlugs.has(slug)) {
      throw new Error(`${label}: "${selfSlug}" fighting.cancels names unknown tag "${slug}"`);
    }
    if (slug === selfSlug) {
      throw new Error(`${label}: "${selfSlug}" fighting.cancels itself — a tag cannot undo its own contribution`);
    }
  }
}

module.exports = {
  LABOR_BONUS_KINDS,
  normalizeFighting,
  validateFighting,
  normalizeLaborBonus,
  validateLaborBonus,
  normalizeExpiresInto,
  validateExpiresInto,
  normalizeRemovesInto,
  validateRemovesInto,
  validateEscalatesInto,
  validateEscalationChains,
  rollTagChain,
  normalizeTurnsCost,
  normalizeRequirementItems,
  validateRequirementItems,
  normalizePlacement,
  validatePlacement,
  validateCustomizable,
};
