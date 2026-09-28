// The Merchant's Depot: shared constants and pure helpers behind the Merchant's Terminal, the
// infoterminals and the train (docs/systemdocs/DEPOT.md). Lives in db/lib because the numbers are game balance, not page
// logic. Touches no Prisma/network, so it's safe on the barrel and safe from either face.

// The Merchant's License: one of the two keys to the Merchant's Terminal (db/lib/merchantTerminal.js),
// the gun on his office wall, and his office door. Tradeable, so handing it away hands away the business.
const MERCHANT_LICENSE_SLUG = "merchants-license";

// The Merchant's ROLE (a seat, not the tradeable licence above). A slug predicate, same shape as
// db/lib/dynasty.js, since it's one role, not a role property. Tells the Depot's turret whose face to spare.
const MERCHANT_ROLE_SLUG = "merchant";

function isMerchantRole(slug) {
  return slug === MERCHANT_ROLE_SLUG;
}

// The Meister's Study, and the room whose keys decide who works the Meister's
// Terminal on its wall. A ROOM rather than a tag: the terminal is a thing on a
// wall, so the gate is standing in the Tower with a key to that door — whichever
// keys docs/zones.yaml says open it. See docs/systemdocs/MEISTERY.md §2.
//
// The study was in the Keep until the 2026-09-19 map rework moved it up the
// Tower. These two have to name the SAME place or the gate is unsatisfiable.
const MEISTERS_OFFICE_ROOM_SLUG = "fortress-5-2";
const TOWER_LOCATION_SLUG = "fortress-5";

// Where the counter is — a LOCATION slug (docs/zones.yaml), one hop east of Customs via
// `connections:`. Buying and selling both require standing here, same as the Lifeweb requiring the Fortress.
const DEPOT_LOCATION_SLUG = "undertown-5";

// Where a cash machine is bolted to a wall. There are FOUR, and two of them
// are at the station: the Depot's own on its Railway, and the Merchant's on
// his Counter in the Storefront next door (db/lib/train.js#STOREFRONT_ROOM_SLUG)
// — on the Storefront's side of the Counter, the fixture side (MAP.md §2d). The other two have no counter behind them — the Inn's
// bar and the Den's — and are an ATM and nothing else, no ordering, no drop
// box, no sell window. Named here rather than imported from train.js, which
// would be a cycle for two strings.
const ATM_ROOM_SLUGS = new Set([
  "undertown-5-1",
  "undertown-6-1",
  "town-7-2",
  "undertown-8-1",
]);

// The same four machines as LOCATIONS, because presence is by Location and not
// by Room — this is the set a counter function actually gates on.
const MERCHANT_LOCATION_SLUG = "undertown-6";
const INN_LOCATION_SLUG = "town-7";
const DEN_LOCATION_SLUG = "undertown-8";
const ATM_LOCATION_SLUGS = new Set([
  DEPOT_LOCATION_SLUG,
  MERCHANT_LOCATION_SLUG,
  INN_LOCATION_SLUG,
  DEN_LOCATION_SLUG,
]);

// Sanity bound on a single line item — a fat-fingered quantity can't file for ten thousand vials.
const DEPOT_MAX_QUANTITY = 99;

// Coerce a client-supplied quantity into range; null for anything unusable, so callers reject rather than trade 1.
function normalizeQuantity(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > DEPOT_MAX_QUANTITY) return null;
  return n;
}

module.exports = {
  MERCHANT_LICENSE_SLUG,
  MEISTERS_OFFICE_ROOM_SLUG,
  TOWER_LOCATION_SLUG,
  MERCHANT_ROLE_SLUG,
  isMerchantRole,
  DEPOT_LOCATION_SLUG,
  MERCHANT_LOCATION_SLUG,
  INN_LOCATION_SLUG,
  DEN_LOCATION_SLUG,
  ATM_ROOM_SLUGS,
  ATM_LOCATION_SLUGS,
  DEPOT_MAX_QUANTITY,
  normalizeQuantity,
};
