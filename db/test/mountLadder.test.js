// The mount ladder (db/lib/mounts.js, ARELITZ.md §2a): a fresh mount buys a
// fixed number of crossings a turn, every ride takes its tag one rung down,
// and the rung says how many are left. Plus the hold limits (§2b): one mount,
// and up to 3 unruly or young arelitz. Pure, so it needs no database.
//
// Run with: npm test --workspace=db
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MOUNT_RIDES,
  MOUNT_STAGES,
  FAST_TRAVEL_SLUGS,
  ARELITZ_MOUNT_SLUGS,
  ridesLeft,
  nextStage,
  mountHead,
  equippedSlugs,
  fastTravelBonus,
  fastTravelRides,
  fastTravelCapacity,
  isMounted,
  holdLimitRefusal,
  holdLimitExcess,
} = require("../lib/mounts");
const fs = require("node:fs");
const path = require("node:path");

const held = (slug, equipped = true) => [{ equipped, tag: { slug, name: slug } }];

test("an arelitz buys 1 ride fresh, a tacked arelitz and a motorcycle 2", () => {
  assert.equal(MOUNT_RIDES.arelitz, 1);
  assert.equal(MOUNT_RIDES["arelitz-tacked"], 2);
  assert.equal(MOUNT_RIDES.motorcycle, 2);
});

test("each ride is one rung down, and the bottom rung has nothing left", () => {
  assert.equal(nextStage("arelitz"), "arelitz-ridden-1");
  assert.equal(nextStage("arelitz-ridden-1"), null);
  assert.deepEqual([ridesLeft("arelitz"), ridesLeft("arelitz-ridden-1")], [1, 0]);
  assert.deepEqual(["arelitz-tacked", "arelitz-tacked-ridden-1", "arelitz-tacked-ridden-2"].map(ridesLeft), [2, 1, 0]);
  assert.equal(nextStage("arelitz-tacked-ridden-2"), null);
  assert.deepEqual(["motorcycle", "motorcycle-ridden-1", "motorcycle-ridden-2"].map(ridesLeft), [2, 1, 0]);
  assert.equal(MOUNT_STAGES.has("arelitz-ridden-2"), false);
});

test("every rung knows its head, and the unruly arelitz is on no ladder", () => {
  for (const [slug, stage] of MOUNT_STAGES) assert.equal(mountHead(slug), stage.head);
  assert.equal(mountHead("arelitz-tacked-ridden-2"), "arelitz-tacked");
  assert.equal(mountHead("unruly-arelitz"), null);
  assert.equal(ridesLeft("unruly-arelitz"), 0);
  assert.equal(FAST_TRAVEL_SLUGS.has("unruly-arelitz"), false);
});

test("the bonus is read off the rung, never off a rider's counter", () => {
  assert.equal(fastTravelBonus(equippedSlugs(held("arelitz"))), 1);
  assert.equal(fastTravelBonus(equippedSlugs(held("arelitz-ridden-1"))), 0);
  assert.equal(fastTravelBonus(equippedSlugs(held("motorcycle"))), 2);
  assert.equal(fastTravelBonus(equippedSlugs(held("motorcycle-ridden-1"))), 1);
  // Stowed in a pack it is not a mount at all.
  assert.equal(fastTravelBonus(equippedSlugs(held("arelitz", false))), 0);
  assert.equal(isMounted(equippedSlugs(held("arelitz", false))), false);
});

test("a spent mount is still a mount: seats, the narrow-way dismount and the cart all still apply", () => {
  const spent = equippedSlugs(held("arelitz-ridden-1"));
  assert.equal(isMounted(spent), true);
  assert.equal(fastTravelCapacity(spent), 2);
  assert.equal(fastTravelCapacity(new Set(["arelitz-tacked-ridden-2", "cart"])), 6);
  assert.equal(fastTravelCapacity(new Set(["motorcycle-ridden-2", "cart"])), 2);
  assert.equal(fastTravelRides(spent), 1);
  assert.equal(fastTravelRides(equippedSlugs(held("arelitz-tacked-ridden-1"))), 2);
});

test("the arelitz family is every arelitz rung and nothing else", () => {
  assert.deepEqual(
    [...ARELITZ_MOUNT_SLUGS].sort(),
    ["arelitz", "arelitz-ridden-1", "arelitz-tacked", "arelitz-tacked-ridden-1", "arelitz-tacked-ridden-2"],
  );
});

// Line endings normalised, so the check reads the same on a CRLF checkout.
const tagsYaml = () =>
  fs.readFileSync(path.join(__dirname, "..", "..", "docs", "tags.yaml"), "utf8").replace(/\r\n/g, "\n");

test("every rung the code generates is authored in docs/tags.yaml, equippable in the MOUNT slot, at its head's price", () => {
  const yaml = tagsYaml();
  const entry = (slug) => {
    const m = yaml.match(new RegExp(`^  ${slug.replace(/[-]/g, "\\-")}:\\n([\\s\\S]*?)(?=^  [a-z0-9-]+:\\n|^[^ ])`, "m"));
    assert.ok(m, `docs/tags.yaml has no "${slug}"`);
    return m[1];
  };
  const price = (body) => Number((body.match(/^\s+sellablePrice: (\d+)/m) ?? [])[1]);
  for (const [slug, stage] of MOUNT_STAGES) {
    const body = entry(slug);
    assert.match(body, /^\s+equippable: true/m, `${slug} must be equippable`);
    assert.match(body, /^\s+equipSlot: MOUNT/m, `${slug} must sit in the MOUNT slot`);
    assert.equal(price(body), price(entry(stage.head)), `${slug} must carry its head's price so the ledger adds up across a rung swap`);
  }
});

test("docs/tags.yaml authors no rung the code no longer generates", () => {
  const authored = [...tagsYaml().matchAll(/^  ([a-z0-9-]+-ridden-\d+):$/gm)].map((m) => m[1]);
  for (const slug of authored) assert.ok(MOUNT_STAGES.has(slug), `docs/tags.yaml still has "${slug}"`);
});

const row = (slug, quantity = 1, extra = {}) => ({ quantity, tag: { slug, name: slug }, ...extra });

test("one mount of any kind: a second is refused, ridden or fresh, arelitz or motorcycle", () => {
  assert.equal(holdLimitRefusal([], [{ slug: "arelitz", quantity: 1 }]), null);
  assert.match(holdLimitRefusal([], [{ slug: "arelitz", quantity: 2 }]), /one mount/);
  assert.match(holdLimitRefusal([row("motorcycle-ridden-1")], [{ slug: "arelitz" }]), /one mount/);
  assert.match(holdLimitRefusal([row("arelitz-tacked")], [{ slug: "motorcycle", quantity: 1 }]), /one mount/);
  // A cart is towed, not ridden, and an unruly arelitz can't be ridden at all.
  assert.equal(holdLimitRefusal([row("arelitz")], [{ slug: "cart", quantity: 1 }]), null);
  assert.equal(holdLimitRefusal([row("arelitz")], [{ slug: "unruly-arelitz", quantity: 1 }]), null);
});

test("up to 3 unruly or young arelitz, counted together, apart from the mount and the eggs", () => {
  const brood = [row("unruly-arelitz"), row("arelitz-hatchling")];
  assert.equal(holdLimitRefusal(brood, [{ slug: "arelitz-yearling", quantity: 1 }]), null);
  assert.match(holdLimitRefusal(brood, [{ slug: "arelitz-youngling", quantity: 2 }]), /3 unruly or young/);
  assert.equal(holdLimitRefusal([row("unruly-arelitz", 3)], [{ slug: "arelitz-egg", quantity: 10 }]), null);
  assert.equal(holdLimitRefusal([row("unruly-arelitz", 3)], [{ slug: "arelitz", quantity: 1 }]), null);
});

test("over a limit, the equipped mount and the longest-held stay; the newest is set down", () => {
  const old = new Date("2026-09-01");
  const recent = new Date("2026-09-20");
  const excess = holdLimitExcess([
    row("motorcycle", 1, { acquiredAt: recent }),
    row("arelitz-ridden-1", 1, { equipped: true, equippedQuantity: 1, acquiredAt: recent }),
    row("arelitz", 2, { acquiredAt: old }),
    row("unruly-arelitz", 2, { acquiredAt: old }),
    row("arelitz-hatchling", 3, { acquiredAt: recent }),
  ]);
  const shed = Object.fromEntries(excess.map((e) => [e.row.tag.slug, e.quantity]));
  assert.deepEqual(shed, { arelitz: 2, motorcycle: 1, "arelitz-hatchling": 2 });
  assert.equal(holdLimitExcess([row("arelitz"), row("unruly-arelitz", 3), row("cart")]).length, 0);
});
