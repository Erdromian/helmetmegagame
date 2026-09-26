// Mount tags: buy extra free zone crossings (db/lib/locationTravel.js) and set
// mount seats. Lives in db/ so both faces read one set; web/lib/tagRequests.js
// re-exports for page gates. See DEPOT.md §3, CARRY.md §2 and ARELITZ.md.
// A mount only works while EQUIPPED (MOUNT slot, db/lib/equipSlots.js) and is
// unequipped at any indoors door — helpers here take ACTIVE slugs
// (`equippedSlugs` below), never a bare held-slug set.
//
// ZERO REQUIRES, EVER. web/app/components/EquipBoard.js is a client component
// and imports this file; one require of @lifeweb/db here drags PrismaClient
// into the browser bundle. The database half (spending a ride, the nightly
// rest) is db/lib/mountRides.js.
//
// THE RIDES LIVE ON THE MOUNT (ARELITZ.md §2a). A fresh mount buys a fixed
// number of crossings a turn, and every crossing charged to it swaps the tag
// one stage down its ladder — `motorcycle` → `motorcycle-ridden-1` →
// `motorcycle-ridden-2` — so the chip's own name says how many rides are left,
// whoever is holding it: a rider, a stable floor, the other side of a
// Transfer. The turn pass (mountRides.js#runMountRestPass) walks every stage
// back to the head. This replaced a rule that read the mount's acquiredAt
// against the turn start to guess whether it had been ridden already — which
// could not tell a handoff after a ride from an animal walked fresh out of
// the stable, and refused both.
//
// Arelitz replaced the old Horse/Warbeast/Ovum/Thoroughbred family
// (ARELITZ.md): one mount type instead of three bred variants.
// `unruly-arelitz` appears in NONE of the sets below — not being equippable
// is the entire "cannot be ridden" enforcement, so it needs no special case
// here at all.

// Rides a FRESH mount of each kind buys a turn. Arelitz Tack is not worn by
// the rider any more: it is fitted to one animal (the Tacked Arelitz recipe,
// docs/tags.yaml), which is a different head with one more ride on it.
const MOUNT_RIDES = Object.freeze({
  arelitz: 1,
  "arelitz-tacked": 2,
  motorcycle: 2,
});

// Every stage of every ladder, slug → { head, ridden, left, next }. `next` is
// the slug one ride down, or null at the bottom.
const MOUNT_STAGES = new Map();
for (const [head, rides] of Object.entries(MOUNT_RIDES)) {
  for (let ridden = 0; ridden <= rides; ridden++) {
    const slug = ridden === 0 ? head : `${head}-ridden-${ridden}`;
    const next = ridden < rides ? `${head}-ridden-${ridden + 1}` : null;
    MOUNT_STAGES.set(slug, { head, ridden, left: rides - ridden, next });
  }
}

// Every rideable slug, at every stage. This is what "is a mount" means to the
// rest of the codebase (isMounted, the indoors park, the equip board's menu,
// the Motion Sickness gate).
const FAST_TRAVEL_SLUGS = new Set(MOUNT_STAGES.keys());

// The arelitz ladders alone — what the Stable feeds, what the Butcher yields
// meat for, what a Cart can be towed behind. Tacked or not, tired or not, it
// is the same animal.
const ARELITZ_MOUNT_SLUGS = new Set([...MOUNT_STAGES].filter(([, s]) => s.head !== "motorcycle").map(([slug]) => slug));

// Tags that stop working once unequipped. Fishing Boat (and the whole
// water-travel/BOAT_CONFLICT concept it needed) is gone with the rest of
// Laboring's Fishing kind — upstream's own removal, confirmed no consumer
// anywhere in the tree references it any more.
const STOWABLE_SLUGS = new Set([...FAST_TRAVEL_SLUGS, "cart"]);

// The consumable that upgrades one arelitz. Renamed from "horseshoes" — an
// arachnid does not wear shoes.
const ARELITZ_TACK_SLUG = "arelitz-tack";

// HOW MANY A CHARACTER MAY HOLD (ARELITZ.md §2b). One mount of any kind —
// every rung of every ladder counts, ridden or fresh, arelitz or motorcycle —
// and, separately, up to 3 arelitz that can't be ridden yet: an unruly adult
// or any rung of the brood. Eggs are not animals and are not counted; a Cart
// is towed, not ridden, and is not a mount. The slugs mirror db/lib/constants.js
// (this file may not require it).
const MOUNT_HOLD_LIMIT = 1;
const YOUNG_ARELITZ_HOLD_LIMIT = 3;
const YOUNG_ARELITZ_SLUGS = new Set(["unruly-arelitz", "arelitz-hatchling", "arelitz-youngling", "arelitz-yearling"]);

const HOLD_LIMITS = [
  {
    slugs: FAST_TRAVEL_SLUGS,
    limit: MOUNT_HOLD_LIMIT,
    refusal: "You can only keep one mount at a time.",
    dropped: "You can only keep one mount at a time",
  },
  {
    slugs: YOUNG_ARELITZ_SLUGS,
    limit: YOUNG_ARELITZ_HOLD_LIMIT,
    refusal: `You can only keep ${YOUNG_ARELITZ_HOLD_LIMIT} unruly or young arelitz at a time.`,
    dropped: `You can only keep ${YOUNG_ARELITZ_HOLD_LIMIT} unruly or young arelitz at a time`,
  },
];

// Whether `incoming` ([{ slug, quantity }]) would take a character holding
// `held` (CharacterTag rows with `tag.slug`) past either limit. The refusal
// sentence, or null. The same "check before it lands" posture as
// db/lib/carry.js#carryAdmits: a hand-over, a pickup or a purchase is refused
// rather than landing and being set down again.
function holdLimitRefusal(held = [], incoming = []) {
  for (const rule of HOLD_LIMITS) {
    const adding = incoming.reduce((n, i) => n + (rule.slugs.has(i?.slug) ? Math.max(0, i.quantity ?? 1) : 0), 0);
    if (adding === 0) continue;
    const holding = (held ?? []).reduce((n, ct) => n + (rule.slugs.has(ct?.tag?.slug) ? (ct.quantity ?? 1) : 0), 0);
    if (holding + adding > rule.limit) return rule.refusal;
  }
  return null;
}

// What has to be set down when a character is ALREADY over a limit — goods
// that arrived without asking (a GM grant, a staged effect, a break-in at the
// push). Returns [{ row, quantity, reason }]. Keeps the equipped mount first,
// then the longest-held, so the thing that just arrived is what goes back on
// the ground — the same newest-first rule carry.js#drawDrops uses, and for the
// same reason: handing somebody a second animal must not make them lose theirs.
function holdLimitExcess(characterTags = []) {
  const out = [];
  for (const rule of HOLD_LIMITS) {
    const rows = (characterTags ?? []).filter((ct) => rule.slugs.has(ct?.tag?.slug) && (ct.quantity ?? 1) > 0);
    rows.sort(
      (a, b) =>
        (b.equippedQuantity ?? (b.equipped ? 1 : 0)) - (a.equippedQuantity ?? (a.equipped ? 1 : 0)) ||
        (new Date(a.acquiredAt ?? 0).getTime() - new Date(b.acquiredAt ?? 0).getTime()),
    );
    let room = rule.limit;
    for (const row of rows) {
      const qty = row.quantity ?? 1;
      const keep = Math.min(qty, room);
      room -= keep;
      if (qty > keep) out.push({ row, quantity: qty - keep, reason: rule.dropped });
    }
  }
  return out;
}

function mountStage(slug) {
  return MOUNT_STAGES.get(slug) ?? null;
}

// Crossings this mount slug has left before it rests. 0 for the bottom of a
// ladder; 0 for anything that isn't a mount.
function ridesLeft(slug) {
  return MOUNT_STAGES.get(slug)?.left ?? 0;
}

// The slug one ride down, or null when there is no ride left to spend.
function nextStage(slug) {
  return MOUNT_STAGES.get(slug)?.next ?? null;
}

// The fresh slug at the top of this slug's ladder.
function mountHead(slug) {
  return MOUNT_STAGES.get(slug)?.head ?? null;
}

// Slugs a character currently has in play: held, minus any stowable not equipped.
function equippedSlugs(characterTags = []) {
  const active = new Set();
  for (const ct of characterTags) {
    const slug = ct?.tag?.slug;
    if (!slug) continue;
    if (STOWABLE_SLUGS.has(slug) && ct.equipped !== true) continue;
    active.add(slug);
  }
  return active;
}

// The one mount slug out of an active set, or null. There is only ever one:
// MOUNT layer 1 is a single slot (db/lib/equipSlots.js).
function activeMountSlug(activeSlugs) {
  for (const slug of activeSlugs) if (FAST_TRAVEL_SLUGS.has(slug)) return slug;
  return null;
}

// Seats a mount carries, rider included. An arelitz seats 2 (6 with Cart).
// Motorcycle is checked before Arelitz so the Cart upgrade can never reach
// it — a hand-cart towed behind a bike isn't a thing.
function fastTravelCapacity(activeSlugs) {
  const slug = activeMountSlug(activeSlugs);
  if (!slug) return 0;
  if (mountHead(slug) === "motorcycle") return 2;
  return activeSlugs.has("cart") ? 6 : 2;
}

// The equipped fast-travel tag row itself, so its name (and, for the spend,
// its id) can be read — activeSlugs alone is a bare Set.
function fastTravelMountTag(characterTags = []) {
  return (characterTags ?? []).find((ct) => FAST_TRAVEL_SLUGS.has(ct?.tag?.slug) && ct.equipped === true) ?? null;
}

// Extra zone crossings the equipped mount still has in it this turn. Read
// straight off the stage, which is why nothing subtracts a per-rider counter
// from it any more (locationTravel.js#movesLeft): the ride that was spent
// already took the tag a stage down.
function fastTravelBonus(activeSlugs) {
  const slug = activeMountSlug(activeSlugs);
  return slug ? ridesLeft(slug) : 0;
}

// The full number of rides this mount buys when fresh, for the sentence that
// explains a lower number ("1 of its 2 rides").
function fastTravelRides(activeSlugs) {
  const slug = activeMountSlug(activeSlugs);
  return slug ? MOUNT_RIDES[mountHead(slug)] : 0;
}

// A mount's name for a sentence: the rung's own name carries its rides in
// parentheses ("Arelitz (1 ride left)"), which beside a number that already
// says so would be the same fact twice — so this strips it back to the animal.
function mountLabel(name) {
  return typeof name === "string" ? name.replace(/\s*\([^)]*\)\s*$/, "") : name;
}

function isMounted(activeSlugs) {
  return activeMountSlug(activeSlugs) !== null;
}

// STOWABLE_SLUGS an indoors Location parks on arrival (db/lib/indoors.js),
// checked before the crossing so it refuses instead of spending the free
// move first (MAP.md §2c). Wider than isMounted: a bare Cart buys no free
// move but still won't fit where a horse can't.
function blocksOnFoot(activeSlugs) {
  for (const slug of STOWABLE_SLUGS) if (activeSlugs.has(slug)) return true;
  return false;
}

// Mounts held but not equipped, so Travel can warn before someone walks a
// day's road with a horse in their pocket. Returns display NAMES, not slugs —
// this goes straight into a sentence — falling back to slug only if unnamed.
function stowedMounts(characterTags = []) {
  return (characterTags ?? [])
    .filter((ct) => STOWABLE_SLUGS.has(ct?.tag?.slug) && ct.equipped !== true)
    .map((ct) => ct.tag.name ?? ct.tag.slug);
}

module.exports = {
  MOUNT_RIDES,
  MOUNT_STAGES,
  FAST_TRAVEL_SLUGS,
  ARELITZ_MOUNT_SLUGS,
  STOWABLE_SLUGS,
  ARELITZ_TACK_SLUG,
  MOUNT_HOLD_LIMIT,
  YOUNG_ARELITZ_HOLD_LIMIT,
  YOUNG_ARELITZ_SLUGS,
  holdLimitRefusal,
  holdLimitExcess,
  mountStage,
  ridesLeft,
  nextStage,
  mountHead,
  equippedSlugs,
  activeMountSlug,
  fastTravelCapacity,
  fastTravelBonus,
  fastTravelRides,
  fastTravelMountTag,
  mountLabel,
  isMounted,
  blocksOnFoot,
  stowedMounts,
};
