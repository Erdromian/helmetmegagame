// Which shelf a priced ware sits on.
//
// Since the Depot Overhaul there is no counter and so no shelves to open: the
// Merchant's Terminal lists every priced ware that is not the Black Market's,
// and the License or the Merchant's ring is what unlocks it
// (db/lib/merchantTerminal.js). What is left of a manifest is the tag's
// `manifest:` line, which still decides one thing that matters — whether a ware
// is the Black Market terminal's (db/lib/blackMarket.js) — and still labels
// the rest for the economy report. The per-person gates that sat here
// (manifestsFor, canOrder) went with the counter.
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
};
