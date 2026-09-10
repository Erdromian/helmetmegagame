// How good someone is in a fight, as the game shows it.
//
// The sibling of db/lib/armorValue.js, and built the same way: the catalog
// carries the numbers, this file owns the three things that must not drift
// apart — the word a score is shown as, how the contributions combine, and
// nothing else. Armour is its own system and never enters the arithmetic here;
// the two only sit next to each other on the sheet.
//
// Pure and Prisma-free, so both faces and the sync can use it.
//
// See docs/systemdocs/COMBAT.md.

// ─── The scale ──────────────────────────────────────────────────────────────
//
// Everything tunable is in this block. Rebalancing the whole system is an edit
// here, not a sweep through docs/tags.yaml — which is the point, because the
// specialist sidegrades at +2 tiers are the values most likely to want a
// second pass once the game has been played.
//
// A tier is TEN points rather than one, so a tag can be authored at half a
// tier and the arithmetic still never touches a float. docs/tags.yaml speaks
// tiers (`tiers: -0.5`); db/lib/tagShapes.js multiplies by this on the way in
// and every number below here is an integer.
const POINTS_PER_TIER = 10;

// Where somebody with no fighting skill at all stands: the middle of Weak.
// 15 rather than 16 so that this and every rung above it land DEAD CENTRE of
// their band (15, 25, 35, 45, 55, 65). Mid-band matters because it is what
// makes the words stable: a peasant picking up a knife, or taking one
// half-tier knock, stays what they were. Off-centre by even a point and the
// smallest trait in the catalog starts changing what people are called.
const UNTRAINED = 15;

// What one rung of melee-*/ranged-* is worth. Equal to a tier on purpose:
// the ladder and the sidegrades speak the same unit, which is what lets
// "counts as 2 tiers higher" in a tag description stay literally true.
const RUNG_STEP = POINTS_PER_TIER;

// Eight bands, ten points each, so every rung lands in the middle of one.
// `key` is what the stylesheet colours off (.fighting-band[data-band="..."]).
// Words, never the number — the posture Tag.meleeArmor's comment sets for
// armour and db/lib/laborYield.js#qualityWord sets for Laboring. Working out
// that Seasoned beats Capable is the player's job; a score on a tile would
// turn a fight into a spreadsheet.
const BANDS = Object.freeze([
  { max: 9, key: "pitiful", label: "Pitiful" },
  { max: 19, key: "weak", label: "Weak" },
  { max: 29, key: "mediocre", label: "Mediocre" },
  { max: 39, key: "capable", label: "Capable" },
  { max: 49, key: "seasoned", label: "Seasoned" },
  { max: 59, key: "dangerous", label: "Dangerous" },
  { max: 69, key: "lethal", label: "Lethal" },
  // The top band's ceiling is a real number rather than Infinity on purpose:
  // a band object crosses the server/client boundary on both surfaces, and
  // JSON turns Infinity into null — which read back as a band with no ceiling
  // at all and put everybody in it.
  { max: Number.MAX_SAFE_INTEGER, key: "legendary", label: "Legendary" },
]);

// Nobody goes below the bottom band. A character carrying four mortal wounds
// is Pitiful, the same as one carrying six — there is no colder word to reach
// and no reason to track how far past it they are.
const SCORE_FLOOR = 0;

// The two halves of the tree. docs/tags.yaml:2495: "The single Fighting tree
// is split in two, and the halves never overlap." So there are always two
// answers, and `both` is how a tag says it lands on each of them separately —
// never that they merge.
const TREES = Object.freeze(["melee", "ranged"]);

// Which weapon classes are drawn rather than swung. A weapon's class is the
// only thing that says which half of the tree it serves, so this is also what
// stops a longbow from paying into a melee band.
const RANGED_CLASSES = Object.freeze(new Set(["bow", "crossbow", "firearm", "thrown"]));

const WEAPON_CLASSES = Object.freeze(
  new Set(["sword", "polearm", "club", "axe", "knife", "unarmed", "bow", "crossbow", "firearm", "thrown", "exotic"]),
);

// ─── Words ──────────────────────────────────────────────────────────────────

function bandOfScore(score) {
  const n = typeof score === "number" && Number.isFinite(score) ? score : UNTRAINED;
  return BANDS.find((b) => n <= b.max);
}

function bandByKey(key) {
  return BANDS.find((b) => b.key === key) ?? null;
}

// The one place a score becomes a word.
function fightingWord(score) {
  return bandOfScore(score).label;
}

// ─── Reading a held row ─────────────────────────────────────────────────────

// Accepts the CharacterTag shape used everywhere else (`{ tag: {...} }`) and
// tolerates a bare Tag[], the same latitude db/lib/gambitModifier.js#holds
// takes.
function tagOf(entry) {
  return entry?.tag ?? entry ?? null;
}

function blockOf(entry) {
  const block = tagOf(entry)?.fighting;
  return block && typeof block === "object" ? block : null;
}

function slugOf(entry) {
  return tagOf(entry)?.slug ?? null;
}

function nameOf(entry) {
  return tagOf(entry)?.name ?? slugOf(entry) ?? "Something";
}

// Equipped means equipped. The rule armorValue.js states for armour — "A vest
// in your cart stops nothing" — and it matters more here, because a sword in a
// sack is the whole difference between an armed and an unarmed character. A
// bare Tag[] has no flag, so `!== false` keeps those callers working the way
// the rest of the codebase treats that shape.
function isEquipped(entry) {
  return entry?.equipped !== false;
}

// Does this tag's block speak to the tree being resolved? `both` and a missing
// tree (a bare weapon, whose class decides) both answer yes.
function servesTree(block, tree) {
  if (!block?.tree) return true;
  return block.tree === tree || block.tree === "both";
}

// ─── Conditions ─────────────────────────────────────────────────────────────

// Every key present must hold — an AND. A bonus that needs several things at
// once is one entry rather than several that cannot see each other, which is
// what the Thanati robes need (the Belief AND the robes worn).
function whenHolds(when, ctx) {
  if (!when) return true;
  if (when.holds?.length && !when.holds.every((s) => ctx.held.has(s))) return false;
  if (when.equipped?.length && !when.equipped.every((s) => ctx.equipped.has(s))) return false;
  if (when.unarmoured?.length && when.unarmoured.some((slot) => ctx.armouredSlots.has(slot))) return false;
  // weaponClass is deliberately NOT tested here. It is resolved per weapon in
  // bestArmed() below, because "+2 while using swords" has to be attributed to
  // the sword being used rather than to the character in general — otherwise
  // holding a sword and a mace would pay both specialisms at once.
  return true;
}

// ─── The parts ──────────────────────────────────────────────────────────────

// What the character brings before anything is picked up: the highest rung
// held on this half of the tree. The rungs chain by parentTag in the catalog,
// so a character normally holds all of them up to their level; taking the max
// rather than summing is what makes that harmless.
function rungBase(rows, tree) {
  let best = null;
  for (const row of rows) {
    const block = blockOf(row);
    if (!block || typeof block.rung !== "number") continue;
    if (!servesTree(block, tree)) continue;
    if (!best || block.rung > best.rung) best = { rung: block.rung, label: nameOf(row) };
  }
  if (!best) return { points: UNTRAINED, label: null };
  return { points: UNTRAINED + RUNG_STEP * best.rung, label: best.label };
}

// Everything programmatic that is not about a weapon. These SUM: a maiming and
// a hangover both land, the way docs/handbook.md:350 says a weapon, a set of
// gear and a skill all stack.
function modifiers(rows, tree, ctx) {
  const out = [];
  for (const row of rows) {
    const block = blockOf(row);
    if (!block || !block.points || block.weaponClass) continue;
    if (block.situational || block.note) continue;
    if (!servesTree(block, tree)) continue;
    if (block.when?.weaponClass?.length) continue;
    const slug = slugOf(row);
    if (ctx.cancelled.has(slug)) {
      // Named rather than dropped. A player wondering why their missing hand
      // costs nothing should be able to read the answer instead of assuming
      // the system missed it.
      out.push({ label: nameOf(row), points: 0, cancelledBy: ctx.cancelledBy.get(slug) ?? null });
      continue;
    }
    if (!whenHolds(block.when, ctx)) continue;
    out.push({ label: nameOf(row), points: block.points });
  }
  return out;
}

// The weapon in hand, and the specialism keyed to it. You swing ONE weapon, so
// only the best combination pays — docs/handbook.md:350 again: "Carrying two
// weapons does not pay twice — you hunt with one of them, so only the better
// one counts."
//
// Each candidate is a weapon plus every skill that names its class, scored
// together, because the pairing is the whole point: a Broadsword is worth
// little on its own and a great deal to a swordsman.
function bestArmed(rows, tree, ctx) {
  const skills = rows.filter((row) => {
    const block = blockOf(row);
    return block?.points && block.when?.weaponClass?.length && servesTree(block, tree);
  });

  let best = null;
  for (const row of rows) {
    const block = blockOf(row);
    if (!block?.weaponClass || !isEquipped(row)) continue;
    const ranged = RANGED_CLASSES.has(block.weaponClass);
    if ((tree === "ranged") !== ranged) continue;
    if (ctx.cancelled.has(slugOf(row))) continue;

    const parts = [];
    if (block.points) parts.push({ label: nameOf(row), points: block.points });
    for (const skill of skills) {
      const sb = blockOf(skill);
      if (!sb.when.weaponClass.includes(block.weaponClass)) continue;
      if (!whenHolds(sb.when, ctx)) continue;
      parts.push({ label: nameOf(skill), points: sb.points });
    }
    const total = parts.reduce((sum, p) => sum + p.points, 0);
    if (!best || total > best.total) best = { total, parts };
  }
  return best?.parts ?? [];
}

// The things no code can know: whether this is a duel, whether the ground is
// rough, whether the thing across from you is natural. They are NEVER summed —
// that is what stops Duelist plus Guerrilla plus Sniper from running away — and
// they are shown beside the number for whoever is adjudicating.
//
// An entry with no shift at all belongs here too (Camouflage, Iron
// Constitution): real weight in a fight, no tier, one list rather than two.
function situationals(rows, tree) {
  const out = [];
  for (const row of rows) {
    const block = blockOf(row);
    if (!block || (!block.situational && !block.note)) continue;
    if (!servesTree(block, tree)) continue;
    out.push({
      label: nameOf(row),
      when: block.situational ?? block.note,
      tiers: block.points ? block.points / POINTS_PER_TIER : null,
    });
  }
  return out;
}

// A floor is not a bonus. Apex Form IS Legendary and Bound IS Pitiful —
// neither is a number to add to what somebody already had, and Apex Form in
// particular "removes almost all of your other tags", so there is nothing left
// to add to. Never a cap: a Legendary-rung fighter who turns keeps their band.
function floorBand(rows, tree) {
  let best = -1;
  let label = null;
  for (const row of rows) {
    const block = blockOf(row);
    if (!block?.floor || !servesTree(block, tree)) continue;
    const idx = BANDS.findIndex((b) => b.key === block.floor);
    if (idx > best) {
      best = idx;
      label = nameOf(row);
    }
  }
  return best < 0 ? null : { index: best, label };
}

// A ceiling stated as a band, for the tags that take somebody OUT of a fight
// rather than making them worse at one. Same shape as floorBand, opposite
// direction, and the lower of the two wins so Bound beats Apex Form.
function capBand(rows, tree) {
  let best = BANDS.length;
  let label = null;
  for (const row of rows) {
    const block = blockOf(row);
    if (!block?.cap || !servesTree(block, tree)) continue;
    const idx = BANDS.findIndex((b) => b.key === block.cap);
    if (idx >= 0 && idx < best) {
      best = idx;
      label = nameOf(row);
    }
  }
  return best >= BANDS.length ? null : { index: best, label };
}

// ─── The answer ─────────────────────────────────────────────────────────────

function contextOf(rows) {
  const held = new Set();
  const equipped = new Set();
  const armouredSlots = new Set();
  const cancelled = new Set();
  const cancelledBy = new Map();

  for (const row of rows) {
    const tag = tagOf(row);
    if (!tag?.slug) continue;
    held.add(tag.slug);
    if (isEquipped(row)) {
      equipped.add(tag.slug);
      // "Wearing armour" for Flamboyant's sake means something is IN the slot,
      // whatever it turns aside — a robe counts. The armour VALUES never come
      // near this file; only the fact that a slot is occupied.
      if (tag.equipSlot) armouredSlots.add(tag.equipSlot);
    }
    for (const slug of blockOf(row)?.cancels ?? []) {
      cancelled.add(slug);
      if (!cancelledBy.has(slug)) cancelledBy.set(slug, tag.name ?? tag.slug);
    }
  }
  return { held, equipped, armouredSlots, cancelled, cancelledBy };
}

// One half of the tree, resolved. Returns the score, its band, the named
// breakdown behind it (the shape db/lib/gambitModifier.js established, so the
// sheet's hover can print every contributor) and the situational list.
function fightingSkillFor(characterTags = [], tree = "melee", ctx = null) {
  const rows = Array.isArray(characterTags) ? characterTags.filter(Boolean) : [];
  const context = ctx ?? contextOf(rows);

  const base = rungBase(rows, tree);
  const parts = [
    // The base is a standing, not a shift, so it carries no tier count — "+5.6
    // tiers of being an Expert" is not a thing anybody says. The rest of the
    // breakdown is shifts and reads in tiers.
    { label: base.label ?? "Untrained", points: base.points, base: true },
    ...modifiers(rows, tree, context),
    ...bestArmed(rows, tree, context),
  ];

  const raw = parts.reduce((sum, p) => sum + p.points, 0);
  const score = Math.max(SCORE_FLOOR, raw);

  let index = BANDS.indexOf(bandOfScore(score));
  const floor = floorBand(rows, tree);
  if (floor && floor.index > index) index = floor.index;
  const cap = capBand(rows, tree);
  if (cap && cap.index < index) index = cap.index;

  return {
    tree,
    score,
    // Only the two fields a caller has any business reading. `max` stays
    // internal: it is the band table's business where the edges are, and
    // shipping it invites a surface to re-derive a band instead of asking.
    band: { key: BANDS[index].key, label: BANDS[index].label },
    // Named for the hover, and in tiers rather than points because tiers are
    // the unit the tag descriptions speak.
    contributors: parts.map((p) => (p.base ? p : { ...p, tiers: p.points / POINTS_PER_TIER })),
    floor: floor?.label ?? null,
    cap: cap?.label ?? null,
    situational: situationals(rows, tree),
  };
}

// Both halves at once, which is what every surface actually wants: the catalog
// keeps them separate, so the readout says "Seasoned · Weak" the way the
// armour line says "Melee: Good | Ballistic: Meager".
function fightingSkill(characterTags = []) {
  const rows = Array.isArray(characterTags) ? characterTags.filter(Boolean) : [];
  const ctx = contextOf(rows);
  const out = {};
  for (const tree of TREES) out[tree] = fightingSkillFor(rows, tree, ctx);
  return out;
}

// "Seasoned · Weak" — melee first, the order the sheet and the GM inspector
// both print.
function formatFightingSkill(resolved) {
  if (!resolved) return null;
  return TREES.map((t) => resolved[t]?.band?.label ?? "Weak").join(" · ");
}

// The Tag columns anything resolving a fighting band must select. Same
// discipline as ARMOR_TAG_FIELDS in db/lib/armorValue.js: miss one and combat
// silently stops working at that surface only. `equipSlot` is here because
// Flamboyant asks whether a body slot is filled.
const FIGHTING_TAG_FIELDS = { fighting: true, equipSlot: true };

module.exports = {
  BANDS,
  POINTS_PER_TIER,
  RANGED_CLASSES,
  RUNG_STEP,
  TREES,
  UNTRAINED,
  WEAPON_CLASSES,
  FIGHTING_TAG_FIELDS,
  bandByKey,
  fightingSkill,
  fightingSkillFor,
  fightingWord,
  formatFightingSkill,
};
