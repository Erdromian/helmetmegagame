// A role's starting_tags entry: a tag identifier and optionally a count.
//
// docs/roles.yaml authors these as display NAMES ("Merchant's License"),
// because a YAML file a human balances should read like one. What
// `Role.startingTagSlugs` stores is the resolved SLUG — db/lib/syncRoles.js
// looks each name up against the catalog as it validates it, so the lookup
// happens once at sync time and never at runtime.
//
// That is what lets Tag.name stop being unique. Every runtime reader — the
// character create, the threat spawn, db:prune-tags — matches on slug now,
// which is the identifier the rest of the game already keys on. The column
// name was always `startingTagSlugs`; it is finally honest.
//
// Most roles want one of a thing, so a bare identifier still means one. The
// Depot rework needed a role to start with five of something — obols, so that
// a Baron begins the game with coin in his pocket and the Merchant has
// somebody to trade with on turn one. Repeating the entry five times could not
// work: the resolver is a `slug: { in: [...] }` set lookup and would collapse
// the duplicates. Rather than add a parallel Int[] to the Role model and keep
// two arrays in step, the count rides in the string:
//
//   - merchants-license       -> { slug: "merchants-license", quantity: 1 }
//   - obol x5                 -> { slug: "obol", quantity: 5 }
//
// The suffix is deliberately strict — a trailing " x<digits>" and nothing
// else — so an identifier that really ends in something x-ish is not silently
// truncated into a count.
const STARTING_TAG_COUNT = /^(.*\S)\s+x(\d+)$/;

function parseStartingTag(entry) {
  const raw = String(entry ?? "").trim();
  const m = STARTING_TAG_COUNT.exec(raw);
  if (!m) return { slug: raw, quantity: 1 };
  const quantity = Number(m[2]);
  // "Thing x0" is a mistake, not a request for nothing. Fall back to one and
  // let the catalog validation speak up if the identifier is wrong too.
  if (!Number.isInteger(quantity) || quantity < 1) return { slug: m[1], quantity: 1 };
  return { slug: m[1], quantity };
}

// Just the identifiers, for the places that only care WHICH tags a role
// touches: the sync's catalog validation, db:prune-tags' "still referenced"
// set, and the point-buy catalog's granted-tag lookup.
function startingTagSlugs(entries = []) {
  return entries.map((e) => parseStartingTag(e).slug);
}

// Re-attach a count to a resolved slug, so the sync can store "obol x5" once
// it has turned the authored name into a slug.
function formatStartingTag(slug, quantity) {
  return quantity > 1 ? `${slug} x${quantity}` : slug;
}

module.exports = { parseStartingTag, startingTagSlugs, formatStartingTag };
