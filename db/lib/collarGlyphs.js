// The glyph etched into every bomb collar (docs/systemdocs/COLLAR.md §2).
//
// The Remote Detonator lists collars by glyph, never by who is wearing them.
// That is what makes the collar a thing you can cheat: take a collar off a
// slave with a stolen key, lock it round somebody else's neck, and an Exactor
// who is not standing there to read it sees the same glyph glowing on his
// remote and has no idea it moved.
//
// So the glyph has to travel with the collar through every hand it passes —
// a trade, a theft, a stash, a corpse. A column on CharacterTag could not do
// that (a stack of collars is one row), so each glyph is its OWN pair of Tag
// rows, the minted-tag pattern paperMint.js and customCraftMint.js use:
//
//   custom-collar-loose-<n>    the collar in somebody's hands  (an item)
//   custom-collar-locked-<n>   the same collar round a neck     (a trait)
//
// `n` is the glyph's index in GLYPHS. The two catalog rows, `bomb-collar` and
// `bomb-collar-locked`, stay what they were: a collar nobody has marked yet.
// db/lib/collar.js stamps one the moment it is locked on, or the moment the
// Exactor's remote first reads it.
//
// ZERO requires, ever: db/lib/equipSlots.js reads the predicates here, and a
// client component imports that.

const COLLAR_ITEM_SLUG = "bomb-collar";
const COLLAR_LOCKED_SLUG = "bomb-collar-locked";

// Two prefixes that do not share a stem, so a `startsWith` on one can never
// catch the other.
const LOOSE_GLYPH_PREFIX = "custom-collar-loose-";
const LOCKED_GLYPH_PREFIX = "custom-collar-locked-";

// Letters that read as marks rather than words, from scripts every browser and
// Discord client already has a font for. Anything that looks too much like
// another letter in the list is left out — Ø beside Θ and Φ, Щ beside Ш —
// because the trick is meant to be moving a collar, not squinting at one.
const GLYPHS = [
  "Γ", "Δ", "Θ", "Λ", "Ξ", "Π", "Σ", "Φ", "Ψ", "Ω",
  "Б", "Ж", "Й", "Ш", "Ю", "Я", "Э", "Ц", "Ч", "Ы", "Ъ",
  "Þ", "Ð", "Ħ", "Ŧ", "Ŋ",
];

// One glyph for the first GLYPHS.length collars, then pairs. A game that
// marks more collars than that has had a very busy slave trade.
function glyphFor(index) {
  const n = GLYPHS.length;
  if (!Number.isInteger(index) || index < 0) return null;
  if (index < n) return GLYPHS[index];
  const pair = index - n;
  if (pair < n * n) return GLYPHS[Math.floor(pair / n)] + GLYPHS[pair % n];
  return `${GLYPHS[index % n]}${index}`;
}

const looseSlugFor = (index) => `${LOOSE_GLYPH_PREFIX}${index}`;
const lockedSlugFor = (index) => `${LOCKED_GLYPH_PREFIX}${index}`;

// The glyph's index off either slug, or null for anything else — a blank
// catalog collar included.
function glyphIndexOf(slug) {
  const m = /^custom-collar-(?:loose|locked)-(\d+)$/.exec(String(slug ?? ""));
  return m ? Number(m[1]) : null;
}

function glyphOf(slug) {
  const index = glyphIndexOf(slug);
  return index == null ? null : glyphFor(index);
}

function isLooseCollarSlug(slug) {
  return slug === COLLAR_ITEM_SLUG || String(slug ?? "").startsWith(LOOSE_GLYPH_PREFIX);
}

function isLockedCollarSlug(slug) {
  return slug === COLLAR_LOCKED_SLUG || String(slug ?? "").startsWith(LOCKED_GLYPH_PREFIX);
}

// What the next collar to be marked gets: one past the highest glyph this game
// has handed out. Never a reused one, even when the collar that wore it is
// gone — a glyph that came back on a new neck would be a trick nobody played.
// Restart Game sweeps the minted rows (they are `ephemeral`), so a new game
// starts again at the first glyph.
function nextGlyphIndex(slugs = []) {
  let max = -1;
  for (const slug of slugs) {
    const index = glyphIndexOf(slug);
    if (index != null && index > max) max = index;
  }
  return max + 1;
}

function collarName(glyph, { locked = false } = {}) {
  return locked ? `Bomb Collar ${glyph} (Locked)` : `Bomb Collar ${glyph}`;
}

module.exports = {
  COLLAR_ITEM_SLUG,
  COLLAR_LOCKED_SLUG,
  LOOSE_GLYPH_PREFIX,
  LOCKED_GLYPH_PREFIX,
  GLYPHS,
  glyphFor,
  looseSlugFor,
  lockedSlugFor,
  glyphIndexOf,
  glyphOf,
  isLooseCollarSlug,
  isLockedCollarSlug,
  nextGlyphIndex,
  collarName,
};
