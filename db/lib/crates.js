// What a crate is, and the rules the Depot Overhaul put on one
// (E:\Bascinet\V3\Merchant\Depot Overhaul.docx; CARRY.md §10, DEPOT.md §0d).
//
// Zero requires, like db/lib/tradeable.js: the Package dialog is a client
// component and the hold limit in db/lib/mounts.js may not require anything.
//
//   - A crate is worth what is in it: its sell price is the sum of its
//     contents' (crateValue), set when it is packed or lands off the train.
//   - Only some things go in one (packRefusal). What cannot — a mount, ⬢ —
//     is exported loose from the Railway instead, and arrives loose.
//   - Nobody carries more than one crate, or three with a Cart on
//     (crateHoldLimit), and hauling one tires you and sours your mood unless
//     you are built for it (CRATE_HAULER_SLUGS).
//   - A crate never sinks under a floor (db/lib/floorSettle.js).

const RESOURCES_SLUG = "resources";
const CART_SLUG = "cart";

// The catalog's own crates: props and seeds that are crates in every sense
// but were authored in docs/tags.yaml rather than packed. Starting Wares is
// left out on purpose — it is a creation bundle on a sheet, not a box anybody
// hauls. A packed or shipped crate is a runtime tag (below).
const CATALOG_CRATE_SLUGS = new Set(["cargo-crate", "crate-rv-6207-m", "flooded-crate"]);

// Pack Mule and Strong haul a crate for free: no Tired, no mood.
const CRATE_HAULER_SLUGS = new Set(["pack-mule", "strong"]);

// One crate on your back, three with a Cart.
const CRATE_HOLD_LIMIT = 1;
const CRATE_CART_HOLD_LIMIT = 3;

function tagOf(entry) {
  return entry?.tag ?? entry ?? null;
}

// Every runtime crate's slug starts with this, the train's
// (db/lib/depotCrates.js#crateSlug) and a packed one's alike.
const RUNTIME_CRATE_SLUG_PREFIX = "custom-crate-";

// A runtime crate — one the train set down or a player packed — carries its
// manifest in crateContents and a custom-crate- slug; either is enough, so a
// caller holding only a slug still gets the answer. The catalog's three props
// count too.
function isCrateTag(tag) {
  if (!tag) return false;
  if (tag.custom && tag.crateContents) return true;
  if (typeof tag.slug === "string" && tag.slug.startsWith(RUNTIME_CRATE_SLUG_PREFIX)) return true;
  return CATALOG_CRATE_SLUGS.has(tag.slug);
}

// Why this thing can't go in a crate, or null if it can. The one list, shared
// by the Package button (web/app/(app)/character/actions/misc.js), its picker
// (web/lib/tagRequests.js#packableTags) and the train, which lands and ships
// whatever can't be crated loose.
function packRefusal(tag) {
  if (!tag) return "That isn't something that can be packed.";
  if (!tag.tradeable) return "That isn't something that can be packed.";
  // A crate of crates would nest a manifest arbitrarily deep, and halving
  // twice is a free carry exploit besides.
  if (isCrateTag(tag)) return "You can't crate a crate.";
  // A crate weighs half its contents, so crated ⬢ would be a flat 2× carry
  // multiplier on bulk wealth.
  if (tag.slug === RESOURCES_SLUG) return "⬢ are already bulk — they don't go in a crate.";
  // A mount is not cargo.
  if (tag.equipSlot === "MOUNT") return "That doesn't fit.";
  return null;
}

function canPack(tag) {
  return packRefusal(tag) === null;
}

// What a crate is worth to the train: the sum of what its contents sell for.
// `lines` are [{ tagId, quantity }]; `sellPriceByTagId` a Map of tagId ->
// sellablePrice (null or absent for a thing the Depot won't buy, which adds
// nothing). `resources` is ⬢ carried as freight on an old crate, at their own
// sell price.
function crateValue(lines, sellPriceByTagId, { resources = 0, resourcePrice = 0 } = {}) {
  let sum = 0;
  for (const line of lines ?? []) {
    const price = sellPriceByTagId?.get?.(line?.tagId) ?? 0;
    sum += Math.max(0, Math.trunc(price ?? 0)) * Math.max(0, Math.trunc(line?.quantity ?? 1));
  }
  sum += Math.max(0, Math.trunc(resources ?? 0)) * Math.max(0, Math.trunc(resourcePrice ?? 0));
  return sum;
}

// The sellable/sellablePrice pair a crate's Tag row carries. The sync's rule
// is that the two travel together, so a crate of nothing the Depot buys is
// simply not sellable.
function crateSaleFields(value) {
  const v = Math.max(0, Math.trunc(value ?? 0));
  return v > 0 ? { sellable: true, sellablePrice: v } : { sellable: false, sellablePrice: null };
}

// How many crates this character may hold: three with a Cart on (equipped —
// an unequipped one is stowed, db/lib/mounts.js), one otherwise.
function crateHoldLimit(characterTags) {
  const cart = (characterTags ?? []).some((ct) => tagOf(ct)?.slug === CART_SLUG && ct?.equipped === true);
  return cart ? CRATE_CART_HOLD_LIMIT : CRATE_HOLD_LIMIT;
}

function cratesHeld(characterTags) {
  return (characterTags ?? []).reduce(
    (n, ct) => n + (isCrateTag(tagOf(ct)) ? Math.max(0, ct?.quantity ?? 1) : 0),
    0,
  );
}

// Whether a haul costs this character anything: Pack Mule and Strong don't feel it.
function hauls(characterTags) {
  return !(characterTags ?? []).some((ct) => CRATE_HAULER_SLUGS.has(tagOf(ct)?.slug));
}

// What a dialog says before crates land in somebody's own hands by their own
// doing (CARRY.md §10), or null when it will cost them nothing. No number: a
// player reads their mood as a word, never a figure (MOOD.md).
function haulWarning(characterTags, pickedUp) {
  if (!(pickedUp > 0) || !hauls(characterTags)) return null;
  return "Picking up a crate sours your mood, and the first crate you move in a turn tires you.";
}

module.exports = {
  CATALOG_CRATE_SLUGS,
  CRATE_HAULER_SLUGS,
  CRATE_HOLD_LIMIT,
  CRATE_CART_HOLD_LIMIT,
  isCrateTag,
  packRefusal,
  canPack,
  crateValue,
  crateSaleFields,
  crateHoldLimit,
  cratesHeld,
  hauls,
  haulWarning,
};
