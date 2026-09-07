// Crates: what a shipment actually looks like when the shuttle sets it down.
//
// The goods do not arrive as a tidy pile of tags. They arrive packed, in a
// random number of crates, and somebody has to open them. That does three
// things at once — it makes unloading a job worth paying a Docker for, it puts
// a delay between "I bought a pistol" and "I am holding a pistol", and it
// means a crate left on the landing pad is a crate anyone who gets in there
// can crack.
//
// A crate is a TAG, created at runtime with custom: true. That sounds heavier
// than it is: db/lib/pruneTags.js already skips custom rows, so db:prune-tags
// will not eat them, and being a tag means crates get carry weight, transfers,
// room stashes and theft for free rather than needing a parallel inventory.
// The cost is one Tag row per crate, swept once the last instance is gone.
//
// The manifest is printed on the crate, in the format Bascinet specified:
//
//   [SHIPMENT ID RV-4471-K]: Coal x 4 | Bandage x 6 | ML-23
//
// ...unless something in it ships sealed, in which case the whole crate reads
//
//   [SHIPMENT ID RV-4471-K]: SEALED
//
// and only a Depot Keycard opens it. One sealed line item seals the crate it
// lands in, which means nobody knows WHICH crate the dangerous thing is in —
// only that one of them is heavier news than the others.

const { DEPOT_KEYCARD_SLUG } = require("./depotState");
const { PACKAGE_MAX_LBS, PACKAGE_MAX_UNITS } = require("./constants");

// A crated ⬢ weighs a pound, so ⬢ pack against the same weight rule as
// everything else and ride in a crate alongside other goods. Loose on a sheet
// they weigh nothing at all and count against carryResourceCap instead
// (docs/systemdocs/CARRY.md §1) — this is freight, and the two axes never
// double-count the same ⬢.
const RESOURCE_UNIT_LBS = 1;

// Moderate. You can carry a couple; clearing a real shipment is several trips
// or several people. See docs/systemdocs/CARRY.md for the ladder this sits on.
// A crate weighs HALF what is in it. It used to be a flat 15 lb, which made a
// crate of obols heavier than the obols and a crate of armor lighter than one
// piece of it. Halving is what packaging is FOR — it is the same rule the
// player-facing Package button applies (docs/systemdocs/FACTORY.md), so a
// Depot shipment and a Banneret's wagon load obey one arithmetic.
//
// Rounded UP, and never below 1: an empty-ish crate of weightless things is
// still a wooden box.
// `resources` defaults to 0 because the player-facing Package button calls
// this too (packageItemsRequestImpl), and a player crate can never hold ⬢.
function crateWeight(contents, weightByTagId, resources = 0) {
  const inner =
    (contents ?? []).reduce(
      (sum, line) => sum + (weightByTagId?.get?.(line.tagId) ?? 0) * (line.quantity ?? 1),
      0,
    ) + (resources ?? 0) * RESOURCE_UNIT_LBS;
  return Math.max(1, Math.ceil(inner / 2));
}

// A crate is a BOX, so what fits in one is a question about weight, not about
// how many things you counted. It used to hold 3-8 units of anything, which
// made a crate of tea and a crate of anvils the same size and burst an order
// of ⬢ into eleven boxes.
//
// PACKAGE_MAX_LBS is the player Package button's cap, reused deliberately:
// FACTORY.md §5 already says a Depot shipment and a hand-packed crate obey one
// arithmetic, and now that is true of the ceiling as well as the halving.
//
// PACKAGE_MAX_UNITS is the second cap, and it exists because the weight cap
// does not bound the weightless. Eight Depot wares weigh 0 lb — paper,
// cigarettes, jewelry, spectacles and the four animals — so without it a paper
// order packs into one crate however large it is.

// A shipment never becomes more crates than this, however large the order —
// otherwise a Merchant with 200 obols could bury the landing pad in tag rows.
const MAX_CRATES = 12;

const SHIPMENT_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";

// Something that reads like a real waybill number rather than a cuid. Two
// letters for the run, four digits, a check letter. Collisions do not matter
// mechanically — the crate's slug carries a uniquifier — so this is purely
// for the look of the thing on the crate.
function shipmentId(rng = Math.random) {
  const digits = String(Math.floor(rng() * 9000) + 1000);
  const check = SHIPMENT_LETTERS[Math.floor(rng() * SHIPMENT_LETTERS.length)];
  return `RV-${digits}-${check}`;
}

// Fisher-Yates on a copy. In its own function because getting this subtly
// wrong biases every shipment in the game and nobody would ever notice.
function shuffle(list, rng = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Manifest line items -> crates.
//
// `items` are `{ tagId, name, quantity, sealed }`. Every unit is expanded and
// shuffled, so a crate holds a random handful rather than one tidy line item,
// and a crate holding any sealed unit becomes a sealed crate.
//
// A line with NO `tagId` is Resources — the station ships ⬢ like anything
// else. One ⬢ is one unit through the shuffle weighing RESOURCE_UNIT_LBS, so
// they mix in with the goods, and the aggregation below collects them under
// the null key and lifts them onto the crate as a plain number.
//
// Packing is by WEIGHT: units go into the open crate until adding one more
// would put it over PACKAGE_MAX_LBS of contents or over PACKAGE_MAX_UNITS
// things, and then a new crate opens. That is what makes a crate a box rather
// than a counter — 99 tea in one, an anvil most of the way through another.
//
// Returns `[{ sealed, resources, contents: [{ tagId, name, quantity }] }]`.
// Total units out always equals total units in — the split loses nothing,
// which matters because the Merchant has already paid for all of it.
function splitIntoCrates(items = [], { weightByTagId, rng = Math.random } = {}) {
  const units = [];
  for (const item of items) {
    const n = Math.max(0, Math.floor(item?.quantity ?? 0));
    // A resources line carries no tagId and weighs a pound a unit; everything
    // else weighs whatever the catalog says.
    const lbs =
      item?.tagId == null ? RESOURCE_UNIT_LBS : (weightByTagId?.get?.(item.tagId) ?? 0);
    for (let i = 0; i < n; i++) {
      units.push({ tagId: item.tagId ?? null, name: item.name, sealed: Boolean(item.sealed), lbs });
    }
  }
  if (!units.length) return [];

  const shuffled = shuffle(units, rng);

  // A huge order does not become a hundred crates — past MAX_CRATES the last
  // one just keeps filling. Overfull beats burying the landing pad in rows.
  const slices = [];
  let current = null;
  for (const unit of shuffled) {
    const last = slices.length >= MAX_CRATES;
    const full =
      current &&
      !last &&
      // The first unit always goes in, whatever it weighs. Without this a
      // single ware heavier than the cap would never fit anywhere and the
      // loop would not terminate. Nothing in the catalog is that heavy today
      // — the worst is workshop-equipment at 100 lb — but that is a fact
      // about the data, not something to rest a loop on.
      (current.lbs + unit.lbs > PACKAGE_MAX_LBS ||
        current.units.length + 1 > PACKAGE_MAX_UNITS);
    if (!current || full) {
      current = { lbs: 0, units: [] };
      slices.push(current);
    }
    current.lbs += unit.lbs;
    current.units.push(unit);
  }

  return slices.map((slice) => {
    // Re-aggregate the units back into countable line items, preserving the
    // order they came out of the shuffle so the printed manifest looks packed
    // rather than sorted.
    const byTag = new Map();
    let resources = 0;
    for (const unit of slice.units) {
      if (unit.tagId == null) {
        resources += 1;
        continue;
      }
      const row = byTag.get(unit.tagId);
      if (row) row.quantity += 1;
      else byTag.set(unit.tagId, { tagId: unit.tagId, name: unit.name, quantity: 1 });
    }

    return {
      sealed: slice.units.some((u) => u.sealed),
      resources,
      contents: [...byTag.values()],
    };
  });
}

// The line printed on the crate. Bascinet's format exactly: a bare name for a
// single, "Name x N" for more than one, pipe-separated.
function crateDescription(shipment, crate) {
  if (crate?.sealed) return `[SHIPMENT ID ${shipment}]: SEALED`;
  const parts = (crate?.contents ?? []).map((c) =>
    c.quantity > 1 ? `${c.name} x ${c.quantity}` : c.name,
  );
  // ⬢ ride the manifest in the same shape as everything else, so a crate of
  // them reads "Resources x 40" rather than looking empty.
  if (crate?.resources > 0) parts.push(`Resources x ${crate.resources}`);
  return `[SHIPMENT ID ${shipment}]: ${parts.join(" | ")}`;
}

// Who may open this crate. A sealed one needs the keycard; an open one needs
// nothing, because its manifest is printed on the side and there is no lock to
// pick. Takes the held slugs as a Set, the shape roomAccess.js already builds.
function canOpenCrate(crateTag, heldSlugs) {
  if (!crateTag?.sealedShipping) return true;
  return Boolean(heldSlugs?.has?.(DEPOT_KEYCARD_SLUG));
}

// A crate's tag slug. Server-generated with the "custom-" prefix every
// runtime tag uses (see the Tag.custom comment in schema.prisma), so it can
// never collide with a docs/tags.yaml slug and get upserted over by a sync.
function crateSlug(shipment, index) {
  return `custom-crate-${shipment.toLowerCase()}-${index + 1}`;
}

function crateName(shipment, index) {
  return `Crate ${shipment}·${index + 1}`;
}

// The Tag rows for one shipment. `contents` is stashed on the tag itself so
// opening it needs no shipment lookup — the crate is self-describing, which is
// also what lets one be carried off, traded, and opened somewhere else
// entirely. groupId is the caller's, since db/lib/ must not read the catalog.
function crateTagData(shipment, crates, { groupId = null, weightByTagId = new Map() } = {}) {
  return crates.map((crate, index) => ({
    slug: crateSlug(shipment, index),
    name: crateName(shipment, index),
    description: crateDescription(shipment, crate),
    custom: true,
    // Game state, not catalog — a Restart Game sweeps it up. See TAGS.md §5d.
    ephemeral: true,
    category: "items",
    groupId,
    pointCost: 0,
    tradeable: true,
    stackable: false,
    weightLbs: crateWeight(crate.contents, weightByTagId, crate.resources),
    removable: true,
    sealedShipping: crate.sealed,
    // A crate is opened by CONSUMING it, the same verb as anything else on
    // the sheet — there is no Open button on /depot any more. canOpenCrate
    // below is still the gate, re-checked inside that consume path.
    consumable: true,
    // ⬢ in the crate. The ordinary consume path already grants this field, so
    // the Resources half of a shipment needs no special case downstream.
    consumesIntoResources: crate.resources > 0 ? crate.resources : null,
    // What falls out when it is opened. Read by the crate-open action; nothing
    // else looks at it.
    crateContents: crate.contents,
  }));
}

module.exports = {
  RESOURCE_UNIT_LBS,
  shipmentId,
  splitIntoCrates,
  crateTagData,
  crateWeight,
  canOpenCrate,
};
