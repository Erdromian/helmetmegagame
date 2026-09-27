// What a character is offered at the Depot's counter.
//
// The Depot used to stock one shelf for one man. It is a public market now, and
// a manifest is the answer to "what may THIS person order" — a shelf, and the
// thing that opens it. Most people get the short one; a licence opens a longer
// one.
//
// Zero requires, ever, like db/lib/dmKinds.js and db/lib/economyReasons.js: the
// Buying tab is a client component, and one require of @lifeweb/db here would
// drag PrismaClient into the browser bundle.
//
// A ware names its manifest with `manifest:` in docs/tags.yaml; absent means
// MERCHANT, so a newly priced ware is his to stock until somebody says
// otherwise. db/lib/syncTags.js refuses a value that is not an id below.
// See docs/systemdocs/DEPOT.md §3a.

const MANIFEST_GENERAL = "general";
const MANIFEST_BLACK_MARKET = "black-market";
const MANIFEST_MERCHANT = "merchant";

// The shelves at the counter. Order is display order on the Buying tab,
// cheapest door first.
const MANIFESTS = [
  {
    id: MANIFEST_GENERAL,
    name: "General",
    // Open to everybody standing at the counter, account or not.
    requiredTagSlug: null,
  },
  {
    id: MANIFEST_MERCHANT,
    name: "Merchant",
    requiredTagSlug: "merchants-license",
  },
];

// The Black Market is a manifest the counter does NOT stock. Its wares are
// sold only by the terminal in the Exactor's Office (db/lib/blackMarket.js,
// DEPOT.md §0n), so it is a valid `manifest:` value and on no shelf here:
// manifestsFor and canOrder never offer it, whatever anybody holds.
const BLACK_MARKET = { id: MANIFEST_BLACK_MARKET, name: "Black Market" };

const MANIFEST_IDS = [...MANIFESTS.map((m) => m.id), MANIFEST_BLACK_MARKET];

function isManifestId(id) {
  return MANIFEST_IDS.includes(id);
}

// A ware with no `manifest:` is the Merchant's. Deliberately the strictest
// default: a new ware is offered to one person until the catalog says wider.
function manifestOf(tag) {
  const id = tag?.manifest;
  return isManifestId(id) ? id : MANIFEST_MERCHANT;
}

function isBlackMarketWare(tag) {
  return manifestOf(tag) === MANIFEST_BLACK_MARKET;
}

// Which manifests this character may see, in display order. `heldSlugs` is a
// Set, the shape db/lib/roomAccess.js already builds.
function manifestsFor(heldSlugs) {
  return MANIFESTS.filter((m) => !m.requiredTagSlug || Boolean(heldSlugs?.has?.(m.requiredTagSlug)));
}

// Whether this character may order this ware at the counter at all.
// Re-checked server-side in every order action — the tab only ever drew a hint.
function canOrder(tag, heldSlugs) {
  const manifest = MANIFESTS.find((m) => m.id === manifestOf(tag));
  if (!manifest) return false;
  return !manifest.requiredTagSlug || Boolean(heldSlugs?.has?.(manifest.requiredTagSlug));
}

module.exports = {
  MANIFEST_GENERAL,
  MANIFEST_BLACK_MARKET,
  MANIFEST_MERCHANT,
  MANIFESTS,
  BLACK_MARKET,
  MANIFEST_IDS,
  isManifestId,
  manifestOf,
  isBlackMarketWare,
  manifestsFor,
  canOrder,
};
