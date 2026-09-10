// "Melee +2 while using swords" — the line that rides under a tag's
// description wherever formatTagArmor's already does (the web tooltip, the
// chip, the Discord inspect embed, Examine). Lives here rather than in web/ or
// bot/ for the same reason that one does: both packages depend on @lifeweb/db
// and would otherwise keep two copies.
//
// Returns null for a tag with no `fighting` block at all, which is most of the
// catalog, so callers can skip rendering entirely.
//
// Callers must select `fighting` (FIGHTING_TAG_FIELDS in
// db/lib/fightingSkill.js). A caller that forgets renders nothing rather than
// throwing — the same quiet failure formatTagArmor warns about, and the first
// thing to check when a new surface shows no fighting line.
//
// This says what ONE TAG does. It is not a character's band, and it must never
// become one: a per-tag line is fine on a chip anybody can open, because the
// tags that carry a real shift are `visible: false` and never reach a stranger
// in the first place. The band itself is a different question with a different
// answer (COMBAT.md, "Nobody reads an enemy").
const { POINTS_PER_TIER } = require("./fightingSkill");

const TREE_WORDS = { melee: "Melee", ranged: "Ranged", both: "Fighting" };

// A slug back into the name it came from. docs/tags.yaml's own header states
// the invariant this rests on — "A SLUG IS ITS NAME, SLUGIFIED: lowercase,
// punctuation dropped, spaces and colons to hyphens" — and db/lib/syncTags.js
// throws when the two disagree, so this is a real guarantee rather than a
// guess.
//
// The alternative was denormalising labels into the stored Json the way
// requirementItems does (db/lib/tagShapes.js). That is the right call there,
// because an ingredient can be any tag in the catalog and its label carries
// punctuation this could never rebuild. Here the referenced slugs are a
// handful of conditions and maimings whose names are two plain words, and a
// second copy of each in the database is a thing that can go stale for no gain.
function nameFromSlug(slug) {
  return String(slug)
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function nameList(slugs, join) {
  return slugs.map(nameFromSlug).join(join);
}

// Same U+2212 minus the Gambit line and the bot's roll use.
function shift(points) {
  const tiers = points / POINTS_PER_TIER;
  return `${tiers > 0 ? "+" : "−"}${Math.abs(tiers)}`;
}

// English is fussier than the key names are. A weapon class is spoken in the
// plural ("using swords"), a worn thing takes "wearing", a held state takes
// "while", and an empty slot takes "with" — so each clause carries its own
// preposition rather than having one bolted on in front of all of them, which
// is how "when with nothing on your body" happens.
//
// Several clauses join with a comma because they are an AND: "wearing Black
// Robes, while Thanati" is the sentence, and both halves really are required.
function conditionOf(when) {
  if (!when) return null;
  const parts = [];
  if (when.weaponClass?.length) parts.push(`using ${when.weaponClass.map((c) => `${c}s`).join(" or ")}`);
  if (when.equipped?.length) parts.push(`wearing ${nameList(when.equipped, " and ")}`);
  if (when.holds?.length) parts.push(`while ${nameList(when.holds, " and ")}`);
  if (when.unarmoured?.length) {
    parts.push(`with nothing on your ${when.unarmoured.join(" or ").toLowerCase()}`);
  }
  return parts.length ? parts.join(", ") : null;
}

function formatTagFighting(tag) {
  const f = tag?.fighting;
  if (!f || typeof f !== "object") return null;

  // A weapon says what it is, not what it adds — its class is the useful fact
  // ("a sword", so the swordsman's specialism pays), and its own small value
  // is not something a player should be adding up.
  if (f.weaponClass) return `Counts as a ${f.weaponClass}`;

  // A rung is a position on the ladder, and the ladder's own tag names already
  // say where it sits. Repeating it as a number would be noise.
  if (f.rung != null && f.points == null) return null;

  // Two drafted sentences, so they carry the (CLAUDE.md). "You cannot
  // fight" and "Counts as a sword" are four words or fewer and take none —
  // there is one way to write either. A `note:` passed through below already
  // carries its own from docs/tags.yaml, so nothing is marked twice.
  if (f.floor) return `You fight as ${nameFromSlug(f.floor)} at worst`;
  if (f.cap) return "You cannot fight";
  if (f.cancels?.length) return `Cancels the penalty from ${nameList(f.cancels, ", ")}`;

  // A situational says only that a gamemaster decides it. WHICH moment it is
  // for is the tag's own description's job, and the catalog no longer keeps a
  // second copy of it here.
  if (f.points == null) return f.situational ? "Situational" : null;
  const tree = TREE_WORDS[f.tree] ?? "Fighting";
  const clause = conditionOf(f.when);
  if (clause) return `${tree} ${shift(f.points)} ${clause}`;
  return f.situational ? `${tree} ${shift(f.points)} · situational` : `${tree} ${shift(f.points)}`;
}

module.exports = { formatTagFighting };
