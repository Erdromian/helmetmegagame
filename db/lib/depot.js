// The Merchant's Depot: shared constants and pure helpers behind /depot and the three DEPOT_* request
// kinds (docs/systemdocs/DEPOT.md). Lives in db/lib because the numbers are game balance, not page
// logic. Touches no Prisma/network, so it's safe on the barrel and safe from either face.

// The tag that opens the counter — the /depot route gate, the server-action re-check, and the reason
// the Depot's turret doesn't shoot you. Tradeable, so handing it away hands away the Depot.
const MERCHANT_LICENSE_SLUG = "merchants-license";

// The Merchant's ROLE (a seat, not the tradeable licence above). A slug predicate, same shape as
// db/lib/dynasty.js, since it's one role, not a role property. Tells the Depot's turret whose face to spare.
const MERCHANT_ROLE_SLUG = "merchant";

function isMerchantRole(slug) {
  return slug === MERCHANT_ROLE_SLUG;
}

// The Meister's study, and the room whose key decides who reads /treasury.
// A ROOM rather than a tag: the terminal is a thing on a desk, so the gate is
// standing in the Tower and being able to get through that door — whichever
// key docs/zones.yaml says opens it. See docs/systemdocs/DEPOT.md §0h.
//
// The study was in the Keep until the 2026-09-19 map rework moved it up the
// Tower. These two have to name the SAME place or the gate is unsatisfiable.
const MEISTERS_OFFICE_ROOM_SLUG = "fortress-5-2";
const TOWER_LOCATION_SLUG = "fortress-5";

// Where the counter is — a LOCATION slug (docs/zones.yaml), one hop east of Customs via
// `connections:`. Buying and selling both require standing here, same as the Lifeweb requiring the Fortress.
const DEPOT_LOCATION_SLUG = "undertown-5";

// Where a cash machine is bolted to a wall. There are two: the counter's own,
// on the Depot's Storefront (db/lib/train.js#STOREFRONT_ROOM_SLUG), and a
// second one in the Inn's bar with no counter behind it — an ATM and nothing
// else, no ordering, no drop box, no sell window. Named here rather than
// imported from train.js, which would be a cycle for two strings.
const ATM_ROOM_SLUGS = new Set(["undertown-5-1", "town-7-2"]);

// The same two machines as LOCATIONS, because presence is by Location and not
// by Room — this is the set a counter function actually gates on.
const INN_LOCATION_SLUG = "town-7";
const ATM_LOCATION_SLUGS = new Set([DEPOT_LOCATION_SLUG, INN_LOCATION_SLUG]);

// The station imports ⬢ at RESOURCE_IMPORT_PRICE and pays RESOURCE_EXPORT_PRICE for them back, so the
// round trip always loses money — the spread can never be run in a loop to print obols (db/lib/syncTags.js
// enforces the same invariant for every priced tag).
const RESOURCE_IMPORT_PRICE = 2;
const RESOURCE_EXPORT_PRICE = 1;

// The id the ⬢ row carries on the Order and Price List tables. It was a sentinel when Resources weren't
// a Tag; they are one now, and this is that tag's slug — still not a cuid, so it never collides with a
// real ware's id, and a caller holding it has the slug it needs to find the stack.
const RESOURCE_WARE_ID = "resources";

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
  INN_LOCATION_SLUG,
  ATM_ROOM_SLUGS,
  ATM_LOCATION_SLUGS,
  DEPOT_MAX_QUANTITY,
  RESOURCE_IMPORT_PRICE,
  RESOURCE_EXPORT_PRICE,
  RESOURCE_WARE_ID,
  normalizeQuantity,
};
