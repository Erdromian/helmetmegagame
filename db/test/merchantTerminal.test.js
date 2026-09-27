// node --test over the Depot Overhaul's pure half (E:\Bascinet\V3\Merchant\Depot
// Overhaul.docx, docs/systemdocs/DEPOT.md §0c and CARRY.md §10): the Merchant's
// Terminal, the train's bulk import and export, and what a crate is. Nothing
// here touches Prisma. Run with `npm test --workspace=db`.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { unlocksTerminal, priceCart, orderSummary, pendingSubtotal } = require("../lib/merchantTerminal");
const { MERCHANT_TERMINAL_TOKEN, taxOn, withTax } = require("../lib/merchantTerminalText");
const { affordablePrefix } = require("../lib/trainArrivalPass");
const { exportValue } = require("../lib/trainDeparturePass");
const {
  isCrateTag,
  packRefusal,
  canPack,
  crateValue,
  crateSaleFields,
  crateHoldLimit,
  cratesHeld,
  hauls,
} = require("../lib/crates");
const { holdLimitRefusal, holdLimitExcess } = require("../lib/mounts");
const { canSink, NEVER_SINKS_ROOM_SLUGS } = require("../lib/floorSettle");
const { crateTagData, splitIntoCrates } = require("../lib/depotCrates");
const { locationAffordances } = require("../lib/placeAffordances");

const tea = { id: "t-tea", slug: "tea", name: "Tea", depotPrice: 2, stackable: true, group: { name: "Tonic" } };
const pistol = { id: "t-ml23", slug: "ml-23", name: "ML-23", depotPrice: 167, stackable: false, sealedShipping: true };
const arelitz = { id: "t-arelitz", slug: "arelitz", name: "Arelitz", depotPrice: 81, stackable: false };
const SHELF = [tea, pistol, arelitz];

function ring(ringAccessSlugs, { equipped = true } = {}) {
  return {
    equipped,
    tag: { slug: "custom-ring-x", ringOfCharacterId: "c1", ringRegisteredAt: new Date(), ringAccessSlugs },
  };
}

// ---------------------------------------------------------------- unlocking

test("the License in hand or the Merchant's ring on the finger unlocks the terminal; a Docker's does not", () => {
  assert.equal(unlocksTerminal([{ tag: { slug: "merchants-license" } }]), true);
  assert.equal(unlocksTerminal([ring(["depot-keycard", MERCHANT_TERMINAL_TOKEN])]), true);
  // The Docker's ring opens the way through and the Cargo Bay, not the terminal.
  assert.equal(unlocksTerminal([ring(["depot-keycard"])]), false);
  // A ring in a pocket opens nothing.
  assert.equal(unlocksTerminal([ring([MERCHANT_TERMINAL_TOKEN], { equipped: false })]), false);
  assert.equal(unlocksTerminal([]), false);
});

test("the Merchant's ring carries the terminal's token, and only his", () => {
  const roles = yaml.load(fs.readFileSync(path.join(__dirname, "..", "..", "docs", "roles.yaml"), "utf8"));
  const seats = Object.values(roles.groups).flatMap((g) => Object.entries(g));
  const withToken = seats.filter(([, r]) => (r?.ring?.opens ?? []).includes(MERCHANT_TERMINAL_TOKEN)).map(([slug]) => slug);
  assert.deepEqual(withToken, ["merchant"]);
  const docker = seats.find(([slug]) => slug === "docker")[1];
  assert.ok(docker.ring.opens.includes("depot-keycard"));
});

test("the terminal is on the Depot's own anchor, and nowhere else", () => {
  const depot = { id: "loc-depot", slug: "undertown-5", attributes: { depot: true } };
  const storefront = { id: "loc-storefront", slug: "undertown-6", attributes: {} };
  assert.ok(locationAffordances(depot).some((a) => a.id === "merchantTerminal"));
  assert.ok(!locationAffordances(storefront).some((a) => a.id === "merchantTerminal"));
});

// ---------------------------------------------------------------- the cart

test("a cart is priced off the shelf, duplicate lines merged before the clamp", () => {
  const priced = priceCart(SHELF, [
    { tagId: tea.id, quantity: 2 },
    { tagId: tea.id, quantity: "3" },
    { tagId: pistol.id, quantity: 1 },
  ]);
  assert.equal(priced.ok, true);
  assert.equal(priced.subtotal, 2 * 5 + 167);
  assert.equal(priced.lines.find((l) => l.slug === "ml-23").sealed, true);
  assert.equal(orderSummary(priced.lines), "Tea x 5, ML-23");
});

test("a cart refuses what the terminal doesn't list, two of a one-to-a-hand ware, and a nonsense quantity", () => {
  assert.equal(priceCart(SHELF, [{ tagId: "t-heroin", quantity: 1 }]).ok, false);
  assert.equal(priceCart(SHELF, [{ tagId: pistol.id, quantity: 2 }]).ok, false);
  assert.equal(priceCart(SHELF, [{ tagId: tea.id, quantity: 0 }]).ok, false);
  assert.equal(priceCart(SHELF, [{ tagId: tea.id, quantity: 100 }]).ok, false);
  assert.equal(priceCart(SHELF, []).ok, false);
});

test("an edit may take a line to nothing, and a cart of nothing is an empty order", () => {
  const edited = priceCart(SHELF, [{ tagId: tea.id, quantity: 0 }, { tagId: pistol.id, quantity: 1 }], { allowEmpty: true });
  assert.equal(edited.ok, true);
  assert.deepEqual(edited.lines.map((l) => l.slug), ["ml-23"]);
  const emptied = priceCart(SHELF, [{ tagId: tea.id, quantity: 0 }], { allowEmpty: true });
  assert.equal(emptied.ok, true);
  assert.equal(emptied.lines.length, 0);
});

// ---------------------------------------------------------------- the tax

test("the tax is whole obols, to the nearest, never more than the sum", () => {
  assert.equal(taxOn(100, 0), 0);
  assert.equal(taxOn(10, 15), 2); // 1.5 rounds up
  assert.equal(taxOn(10, 14), 1); // 1.4 rounds down
  assert.equal(taxOn(7, 100), 7);
  assert.equal(taxOn(7, 500), 7);
  assert.equal(taxOn(0, 50), 0);
  assert.equal(withTax(10, 15), 12);
});

test("the tax is levied on the train's whole load, not line by line", () => {
  // Three 3 ¢ lines at 10%: each alone would round to 0, the load taxes 1.
  const orders = [{ id: "a", totalObols: 3 }, { id: "b", totalObols: 3 }, { id: "c", totalObols: 3 }];
  const { chosen, subtotal, tax } = affordablePrefix(orders, 100, 10);
  assert.equal(chosen.length, 3);
  assert.equal(subtotal, 9);
  assert.equal(tax, 1);
  assert.equal(pendingSubtotal(orders), 9);
  assert.equal(pendingSubtotal(orders, { except: "b" }), 6);
});

test("the train takes pending orders oldest first, and stops at the first it can't cover", () => {
  const orders = [{ id: "a", totalObols: 40 }, { id: "b", totalObols: 50 }, { id: "c", totalObols: 5 }];
  // 40 + 10% = 44 fits in 60; 90 + 9 does not; the 5 ¢ order behind it waits its turn too.
  const { chosen, subtotal, tax } = affordablePrefix(orders, 60, 10);
  assert.deepEqual(chosen.map((o) => o.id), ["a"]);
  assert.equal(subtotal + tax, 44);
  assert.equal(affordablePrefix(orders, 0, 0).chosen.length, 0);
});

// ---------------------------------------------------------------- crates

test("a crate is a runtime crate or one of the catalog's three, and nothing else", () => {
  assert.equal(isCrateTag({ custom: true, crateContents: [], slug: "custom-crate-rv-1234-k-1" }), true);
  assert.equal(isCrateTag({ slug: "custom-crate-abc123-xyz" }), true);
  assert.equal(isCrateTag({ slug: "cargo-crate" }), true);
  assert.equal(isCrateTag({ slug: "starting-wares" }), false);
  assert.equal(isCrateTag({ slug: "tea" }), false);
});

test("what can't go in a crate: the untradeable, a crate, ⬢ and a mount", () => {
  assert.equal(canPack({ slug: "tea", tradeable: true }), true);
  assert.match(packRefusal({ slug: "badge", tradeable: false }), /can be packed/);
  assert.match(packRefusal({ slug: "cargo-crate", tradeable: true }), /crate a crate/);
  assert.match(packRefusal({ slug: "resources", tradeable: true }), /bulk/);
  assert.match(packRefusal({ slug: "arelitz", tradeable: true, equipSlot: "MOUNT" }), /fit/);
});

test("a crate is worth the sum of its contents' sell prices, and a worthless one isn't sellable", () => {
  const prices = new Map([["t-tea", 2], ["t-ml23", 167]]);
  assert.equal(crateValue([{ tagId: "t-tea", quantity: 4 }, { tagId: "t-ml23", quantity: 1 }, { tagId: "t-rock", quantity: 9 }], prices), 175);
  assert.deepEqual(crateSaleFields(175), { sellable: true, sellablePrice: 175 });
  assert.deepEqual(crateSaleFields(0), { sellable: false, sellablePrice: null });
});

test("a train-packed crate carries its value on the tag", () => {
  const crates = splitIntoCrates([{ tagId: "t-tea", name: "Tea", quantity: 3, sealed: false }]);
  const [data] = crateTagData("RV-1000-A", crates, {
    weightByTagId: new Map([["t-tea", 1]]),
    sellPriceByTagId: new Map([["t-tea", 2]]),
  });
  assert.equal(data.sellable, true);
  assert.equal(data.sellablePrice, 6);
});

test("one crate on your back, three with a Cart on — and a Cart in the pocket doesn't count", () => {
  const crate = (id) => ({ tagId: id, quantity: 1, tag: { slug: `custom-crate-${id}` } });
  const cartOn = { tag: { slug: "cart" }, equipped: true };
  const cartStowed = { tag: { slug: "cart" }, equipped: false };
  assert.equal(crateHoldLimit([]), 1);
  assert.equal(crateHoldLimit([cartOn]), 3);
  assert.equal(crateHoldLimit([cartStowed]), 1);
  assert.equal(cratesHeld([crate("a"), crate("b"), cartOn]), 2);

  assert.equal(holdLimitRefusal([], [{ slug: "custom-crate-a", quantity: 1 }]), null);
  assert.match(holdLimitRefusal([crate("a")], [{ slug: "custom-crate-b", quantity: 1 }]), /one crate/);
  assert.equal(holdLimitRefusal([crate("a"), cartOn], [{ slug: "custom-crate-b", quantity: 2 }]), null);
  assert.match(holdLimitRefusal([crate("a"), cartOn], [{ slug: "custom-crate-b", quantity: 3 }]), /three with a Cart/);
});

test("dismounting the Cart with three crates on it sets two of them down", () => {
  const crate = (id, at) => ({ tagId: id, quantity: 1, acquiredAt: at, tag: { slug: `custom-crate-${id}` } });
  const held = [crate("a", "2026-01-01"), crate("b", "2026-01-02"), crate("c", "2026-01-03"), { tag: { slug: "cart" }, equipped: false }];
  const excess = holdLimitExcess(held);
  assert.equal(excess.length, 2);
  // The longest-held stays in hand; the newest go down (carry.js#drawDrops's rule).
  assert.deepEqual(excess.map((e) => e.row.tagId).sort(), ["b", "c"]);
});

test("Pack Mule and Strong haul for free; everybody else pays", () => {
  assert.equal(hauls([{ tag: { slug: "pack-mule" } }]), false);
  assert.equal(hauls([{ tag: { slug: "strong" } }]), false);
  assert.equal(hauls([{ tag: { slug: "soft-hands" } }]), true);
  assert.equal(hauls([]), true);
});

test("a crate never sinks under a floor, and nothing on the Railway or in the Cargo Bay does", () => {
  assert.equal(canSink({ category: "Items", slug: "custom-crate-x", custom: true, crateContents: [], weightLbs: 5 }), false);
  assert.equal(canSink({ category: "Items", slug: "cargo-crate", weightLbs: 6 }), false);
  assert.equal(canSink({ category: "Items", slug: "tea", weightLbs: 0.1 }), true);
  assert.ok(NEVER_SINKS_ROOM_SLUGS.has("undertown-5-1"));
  assert.ok(NEVER_SINKS_ROOM_SLUGS.has("undertown-6-3"));
});

// ---------------------------------------------------------------- the export

test("the train takes crates whatever is in them, and loose only what can't be crated but sells", () => {
  const prices = { sellPriceByTagId: new Map([["t-tea", 2]]), resourcePrice: 1 };
  // A crate goes at its own price, or its manifest's if it predates prices.
  assert.equal(exportValue({ slug: "custom-crate-a", custom: true, crateContents: [], sellablePrice: 30 }, 1, prices), 30);
  assert.equal(
    exportValue({ slug: "custom-crate-b", custom: true, crateContents: [{ tagId: "t-tea", quantity: 3 }], consumesIntoResources: 4, sellablePrice: null }, 1, prices),
    10,
  );
  // A crate of nothing the station buys still goes, for nothing.
  assert.equal(exportValue({ slug: "cargo-crate", sellablePrice: null }, 1, prices), 0);
  // A mount, and ⬢, go loose.
  assert.equal(exportValue({ slug: "arelitz", tradeable: true, equipSlot: "MOUNT", sellablePrice: 81 }, 1, prices), 81);
  assert.equal(exportValue({ slug: "resources", tradeable: true, sellablePrice: 3 }, 10, prices), 30);
  // An ordinary loose item has to be crated first; stays on the platform.
  assert.equal(exportValue({ slug: "tea", tradeable: true, sellablePrice: 2 }, 5, prices), null);
  // And something the station doesn't buy that can't be crated stays too.
  assert.equal(exportValue({ slug: "hatchling", tradeable: true, equipSlot: "MOUNT", sellablePrice: null }, 1, prices), null);
});

// ---------------------------------------------------------------- the catalog

test("every ware the terminal sells is bought back at no more than it costs", () => {
  const tags = yaml.load(fs.readFileSync(path.join(__dirname, "..", "..", "docs", "tags.yaml"), "utf8")).tags;
  for (const [slug, t] of Object.entries(tags)) {
    if (t?.depotPrice == null || t.manifest === "black-market") continue;
    if (t.sellablePrice != null) assert.ok(t.sellablePrice <= t.depotPrice, `${slug} sells above its price`);
  }
});

test("the Merchant can buy neither Pack Mule nor Strong, and starts with Soft Hands; Dockers start with Pack Mule", () => {
  const tags = yaml.load(fs.readFileSync(path.join(__dirname, "..", "..", "docs", "tags.yaml"), "utf8")).tags;
  assert.ok(tags["pack-mule"].excludedRoles.includes("merchant"));
  assert.ok(tags.strong.excludedRoles.includes("merchant"));
  const roles = yaml.load(fs.readFileSync(path.join(__dirname, "..", "..", "docs", "roles.yaml"), "utf8"));
  const business = roles.groups.business;
  assert.ok(business.merchant.starting_tags.includes("Soft Hands"));
  assert.ok(business.docker.starting_tags.includes("Pack Mule"));
});
