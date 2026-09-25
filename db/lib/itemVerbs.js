// Which verb an item in your pockets opens, beyond the generic four (Consume,
// Equip, Give, Destroy). One line per link. `mode` is a mode in
// web/app/components/actionRegistry.js, which owns the label, the show/gate
// flags and the greyed reason — nothing is copied here. `trumpet` and `horn`
// are the two exceptions: they are their own buttons on the sheet
// (SoundTrumpetButton.js, SoundHornButton.js), not registry modes, and the
// menus that read this handle them by name.
//
// `match` is one of { slug }, { prefix }, { suffix } or { flag } — a truthy
// column on the tag — with an optional `unless` flag that must be falsy.
//
// ZERO requires, ever: the client bundle imports this.

const ITEM_VERBS = [
  { mode: "play", match: { flag: "instrument" } },
  { mode: "detonatecollar", match: { slug: "remote-detonator" } },
  { mode: "unlockcollar", match: { slug: "collar-key" } },
  { mode: "applycollar", match: { slug: "bomb-collar" } },
  { mode: "brand", match: { slug: "branding-iron" } },
  // Equipment in reach improves the torture roll (character/actions/misc.js).
  { mode: "torture", match: { slug: "torturing-equipment" } },
  { mode: "pointer", match: { slug: "nuclear-datacard" } },
  { mode: "arm", match: { slug: "nuclear-datacard" } },
  { mode: "disarm", match: { slug: "nuclear-datacard" } },
  { mode: "pointerdevice", match: { prefix: "custom-pointer-" } },
  { mode: "stepstone", match: { slug: "stepstone" } },
  { mode: "disguise", match: { slug: "disguise-kit" } },
  { mode: "write", match: { slug: "paper" } },
  { mode: "write", match: { slug: "blank-book" } },
  // A wax stamp, the test db/lib/paper.js#isSeal makes: a mark and no paper.
  { mode: "seal", match: { flag: "sealMark", unless: "paperKind" } },
  { mode: "bird", match: { slug: "bird" } },
  { mode: "mine", match: { slug: "pickaxe" } },
  { mode: "mine", match: { slug: "mining-helmet" } },
  // An equipped shovel makes a burial cheaper (character/actions/corpse.js).
  { mode: "bury", match: { slug: "shovel" } },
  { mode: "trumpet", match: { slug: "trumpet" } },
  { mode: "horn", match: { slug: "deep-beast-horn" } },
];

// The two that are not registry modes.
const LOCAL_MODES = new Set(["trumpet", "horn"]);

function matches(tag, match) {
  const slug = tag?.slug ?? "";
  if (match.unless && tag?.[match.unless]) return false;
  if (match.slug) return slug === match.slug;
  if (match.prefix) return slug.startsWith(match.prefix);
  if (match.suffix) return slug.endsWith(match.suffix);
  if (match.flag) return Boolean(tag?.[match.flag]);
  return false;
}

// The modes this tag opens, in list order, each once.
function verbsForTag(tag) {
  if (!tag) return [];
  const out = [];
  for (const { mode, match } of ITEM_VERBS) {
    if (!out.includes(mode) && matches(tag, match)) out.push(mode);
  }
  return out;
}

module.exports = { ITEM_VERBS, LOCAL_MODES, verbsForTag };
