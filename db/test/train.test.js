// node --test over the cargo train's clock and the Depot's shelves — the two
// pure pieces of the counter rework. Run with `npm test --workspace=db`.
//
// Nothing here touches Prisma. The point is the property that makes the train
// safe to resume a half-finished turn advance against: PARITY DECIDES WHICH
// HALF RUNS, AND NOTHING ELSE. What actually moves is decided by rows
// (`deliveredAt: null`, `settledAt: null`) inside the passes, so a doubled or
// skipped advance costs a turn of flavour and never a shipment — which is the
// thing that would otherwise be very expensive to find out in a live game.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isArrivalTurn, isDepartureTurn, trainHere, trainState } = require("../lib/train");
const { stampFor } = require("../lib/trainArrivalPass");
const { locationAffordances, roomAffordances } = require("../lib/placeAffordances");
const { crateTagData, splitIntoCrates } = require("../lib/depotCrates");
const {
  MANIFESTS,
  MANIFEST_IDS,
  MANIFEST_MERCHANT,
  MANIFEST_BLACK_MARKET,
  manifestOf,
  isManifestId,
} = require("../lib/depotManifests");
const { normalizeQuantity, DEPOT_MAX_QUANTITY } = require("../lib/depot");

test("turn 1 is a departure close with nothing to load — turn 2's close brings down what was ordered on turn 1", () => {
  assert.equal(isDepartureTurn(1), true);
  assert.equal(isArrivalTurn(1), false);
  assert.equal(isArrivalTurn(2), true);
});

test("the platform is EMPTY on an arrival turn, because the train comes in at the END of it", () => {
  // The bug this pins: reading "at the platform" off isArrivalTurn told
  // everybody the train was in on the one turn it demonstrably was not.
  assert.equal(trainHere(2), false, "turn 2 is when it arrives, not when it is here");
  assert.equal(trainHere(4), false);
  assert.equal(trainState(2).here, false);
});

test("it stands at the platform for the length of the odd turn after it lands", () => {
  assert.equal(trainHere(3), true);
  assert.equal(trainHere(5), true);
  assert.equal(trainState(3).here, true);
});

test("turn 1 is the one exception — nothing has arrived yet, so the rails are bare", () => {
  assert.equal(trainHere(1), false);
  assert.equal(trainState(1).here, false);
  assert.match(trainState(1).nextLabel, /next turn/);
});

test("exactly one half of the cycle runs on any turn, for a long stretch of them", () => {
  for (let n = 0; n <= 60; n += 1) {
    assert.equal(
      isArrivalTurn(n) !== isDepartureTurn(n),
      true,
      `turn ${n} ran both halves or neither`,
    );
  }
});

test("a turn number that is missing reads as the resting state rather than throwing", () => {
  // resolveNeeds and the Railyard's starter post both reach this with whatever
  // the open turn happened to be, which on a fresh database is nothing.
  assert.equal(isArrivalTurn(undefined), true);
  assert.equal(isArrivalTurn(null), true);
  assert.equal(typeof trainState(null).label, "string");
});

test("every manifest in the catalog has an id and a name, and carries no blurb", () => {
  // The counter's shelves, plus the Black Market, which is a valid manifest id
  // and no shelf at the counter (DEPOT.md §0n).
  assert.equal(MANIFESTS.length + 1, MANIFEST_IDS.length);
  assert.equal(isManifestId(MANIFEST_BLACK_MARKET), true);
  assert.equal(MANIFESTS.some((m) => m.id === MANIFEST_BLACK_MARKET), false);
  for (const m of MANIFESTS) {
    assert.equal(typeof m.id, "string");
    assert.ok(m.name.length > 0, `${m.id} has no name`);
    // A shelf is named and either open to you or not. The one-line descriptions
    // were cut on purpose — do not put one back.
    assert.equal("blurb" in m, false, `${m.id} has a blurb`);
    assert.equal(isManifestId(m.id), true);
  }
});

test("a ware naming no manifest is the Merchant's, which is the strictest default", () => {
  assert.equal(manifestOf({}), MANIFEST_MERCHANT);
  assert.equal(manifestOf({ manifest: null }), MANIFEST_MERCHANT);
  // A typo must not quietly open a shelf it was never meant to. syncTags.js
  // refuses one outright; this is the runtime half of the same rule.
  assert.equal(manifestOf({ manifest: "not-a-shelf" }), MANIFEST_MERCHANT);
});

test("a crate says whose it is, between the shipment id and the contents", () => {
  const order = { holderName: "Ada Voss", fingerprint: "AV-2017", anonymous: false };
  const crates = splitIntoCrates([{ tagId: "t1", name: "Coal", quantity: 4, sealed: false }]);
  const [data] = crateTagData("RV-4471-K", crates, { weightByTagId: new Map([["t1", 7]]) });
  const stamped = data.description.replace("]:", `] · ${stampFor(order)}:`);
  assert.equal(stamped, "[SHIPMENT ID RV-4471-K] · Ada Voss · AV-2017: Coal x 4");
});

test("a sealed crate still says whose it is — the seal hides WHAT, not WHOSE", () => {
  const order = { holderName: "Ada Voss", fingerprint: "AV-2017", anonymous: false };
  const crates = splitIntoCrates([{ tagId: "t1", name: "ML-23", quantity: 1, sealed: true }]);
  const [data] = crateTagData("RV-4471-K", crates, { weightByTagId: new Map([["t1", 2]]) });
  const stamped = data.description.replace("]:", `] · ${stampFor(order)}:`);
  assert.equal(stamped, "[SHIPMENT ID RV-4471-K] · Ada Voss · AV-2017: SEALED");
  assert.equal(data.sealedShipping, true);
});

test("paying to keep your name off it replaces the stamp, and only this row remembers", () => {
  const order = { holderName: "Ada Voss", fingerprint: "AV-2017", anonymous: true };
  assert.equal(stampFor(order), "ANONYMOUS");
  assert.equal(stampFor(order).includes("Ada"), false);
  assert.equal(stampFor(order).includes("AV-2017"), false);
});

// --------------------------------------------------------------- the counter

const DEPOT_LOCATION = { id: "loc_depot", name: "Depot", attributes: { depot: true } };
const ELSEWHERE = { id: "loc_town", name: "Town", attributes: {} };

function labels(list) {
  return list.map((e) => e.label);
}

test("the Merchant's Terminal hangs off the Depot LOCATION, where the drop box used to", () => {
  assert.ok(labels(locationAffordances(DEPOT_LOCATION)).includes("Merchant's Terminal"));
  assert.equal(labels(locationAffordances(ELSEWHERE)).includes("Merchant's Terminal"), false);
  // The drop box is gone (Depot Overhaul.docx), on the Location and the Railway both.
  assert.equal(labels(locationAffordances(DEPOT_LOCATION)).includes("Dropbox"), false);
});

// Storage and Search sit on every room (CARRY.md §8, SEARCH.md §9), so they
// lead every list here. Send money is Discord's own button for what the web's
// infoterminal dialog does (db/test/placeButtons.test.js); the Merchant's
// credit line that sat beside it is gone.
test("the Railway carries the infoterminal and Send money, and no drop box", () => {
  assert.deepEqual(labels(roomAffordances({ id: "r", slug: "undertown-5-1" })), [
    "Storage",
    "Search (0.33 Move)",
    "Infoterminal",
    "Send money",
  ]);
});

test("the Merchant's Counter has a machine of its own, on the Storefront's side", () => {
  assert.deepEqual(labels(roomAffordances({ id: "r", slug: "undertown-6-1" })), ["Storage", "Search (0.33 Move)", "Infoterminal"]);
});

test("the Inn's bar has the second machine, and nothing else of the counter's", () => {
  assert.deepEqual(labels(roomAffordances({ id: "r", slug: "town-7-2" })), ["Storage", "Search (0.33 Move)", "Infoterminal"]);
});

test("an ordinary room has no machine on its wall", () => {
  assert.deepEqual(labels(roomAffordances({ id: "r", slug: "town-7-3" })), ["Storage", "Search (0.33 Move)"]);
});

test("the Merchant's gun is on his own office wall and nowhere else", () => {
  assert.ok(labels(roomAffordances({ id: "r", slug: "undertown-6-2" })).includes("Toggle Turret"));
  assert.equal(labels(roomAffordances({ id: "r", slug: "undertown-5-1" })).includes("Toggle Turret"), false);
});

test("the anchor's buttons still chunk under Discord's five-per-row cap", () => {
  // The Depot carries a noticeboard AND the Merchant's Terminal, which put it
  // past five. locationAnchorRows chunks; this is here so a seventh button
  // does not one day silently overflow a row instead.
  const { locationAnchorRows } = require("../lib/locationAnchorRow");
  const rows = locationAnchorRows({ ...DEPOT_LOCATION, attributes: { depot: true, noticeboard: true } });
  assert.ok(rows.length >= 2, "seven buttons should be more than one row");
  for (const row of rows) assert.ok(row.components.length <= 5, "a row is over Discord's cap");
});

// The per-train cap is a null, and the order action reads that null two ways on
// purpose: an over-cap WARE line is refused out loud, an over-cap ⬢ line is
// dropped silently and the rest of the cart still prices. Both readings depend
// on this returning null rather than clamping, so pin it.
test("the per-train cap refuses rather than clamps, and a legal quantity comes back unchanged", () => {
  assert.equal(normalizeQuantity(1), 1);
  assert.equal(normalizeQuantity(DEPOT_MAX_QUANTITY), DEPOT_MAX_QUANTITY);
  assert.equal(normalizeQuantity(DEPOT_MAX_QUANTITY + 1), null);
  assert.equal(normalizeQuantity(0), null);
  assert.equal(normalizeQuantity(-3), null);
  assert.equal(normalizeQuantity(2.5), null);
  assert.equal(normalizeQuantity("not a number"), null);
});
