// node --test over db/lib/laborDrops.js's scopeFilters — the six-bucket
// combine rule LABORDROPS.md §2 promises — and passesRequiredTag, the
// seventh gate (LABORDROPS.md §2a). Nothing here touches Prisma;
// pickLaborDropOption itself is exercised against a real local database
// instead (see LABORDROPS.md's smoke-test note), the same split
// db/lib/cavingLoot.js's validateCavingLoot/LOOT_TABLE draws.
const test = require("node:test");
const assert = require("node:assert/strict");
const { scopeFilters, TIER_TO_LABOR_DROP_TYPE, passesRequiredTag } = require("../lib/laborDrops");

function sorted(filters) {
  return filters
    .map((f) => JSON.stringify([f.laborType, f.zoneId, f.locationId]))
    .sort();
}

test("global only: just the all-null bucket", () => {
  assert.deepEqual(scopeFilters(null, null, null), [{ laborType: null, zoneId: null, locationId: null }]);
});

test("labor type + zone: exactly the four buckets that can ever apply (never zone+location)", () => {
  const filters = scopeFilters("FARMING", "zone1", null);
  assert.equal(filters.length, 4);
  assert.deepEqual(
    sorted(filters),
    sorted([
      { laborType: null, zoneId: null, locationId: null }, // Global
      { laborType: "FARMING", zoneId: null, locationId: null }, // LaborType
      { laborType: null, zoneId: "zone1", locationId: null }, // Zone
      { laborType: "FARMING", zoneId: "zone1", locationId: null }, // LaborType+Zone
    ]),
  );
});

test("labor type + location: the location-side four, and location never mixes with zone", () => {
  const filters = scopeFilters("HUNTING", "zone1", "loc1");
  // Both zone and location are present (a real Action always carries both),
  // so all six buckets fire at once — zoneId and locationId are never
  // combined on the SAME bucket, but Zone and Location buckets both apply
  // independently against the same roll.
  assert.equal(filters.length, 6);
  for (const f of filters) {
    assert.ok(!(f.zoneId && f.locationId), "no bucket ever sets both zoneId and locationId");
  }
  assert.deepEqual(
    sorted(filters),
    sorted([
      { laborType: null, zoneId: null, locationId: null },
      { laborType: "HUNTING", zoneId: null, locationId: null },
      { laborType: null, zoneId: "zone1", locationId: null },
      { laborType: "HUNTING", zoneId: "zone1", locationId: null },
      { laborType: null, zoneId: null, locationId: "loc1" },
      { laborType: "HUNTING", zoneId: null, locationId: "loc1" },
    ]),
  );
});

test("every Labor tier that can actually pay ⬢ maps to a labor drop type", () => {
  for (const tier of ["basic", "skilled", "hunting", "farming", "fishing"]) {
    assert.ok(TIER_TO_LABOR_DROP_TYPE[tier], `${tier} should map to a LaborDropLaborType`);
  }
  // Refining pays in Squeeze, not ⬢, and never rolls the drop die at all
  // (db/lib/moveEffects.js's laborDrop effect checks for this by name).
  assert.equal(TIER_TO_LABOR_DROP_TYPE.refining, undefined);
});

test("passesRequiredTag: an ungated row always passes, regardless of what's held", () => {
  assert.equal(passesRequiredTag({ requiredTagId: null }), true);
  assert.equal(passesRequiredTag({ requiredTagId: null }, new Set()), true);
  assert.equal(passesRequiredTag({ requiredTagId: null }, new Set(["forester-id"])), true);
});

test("passesRequiredTag: a gated row needs the exact tag, and defaults closed", () => {
  const row = { requiredTagId: "forester-id" };
  // No heldTagIds argument at all — the default must exclude, not leak in.
  assert.equal(passesRequiredTag(row), false);
  assert.equal(passesRequiredTag(row, new Set()), false);
  assert.equal(passesRequiredTag(row, new Set(["butcher-id"])), false);
  assert.equal(passesRequiredTag(row, new Set(["forester-id"])), true);
  assert.equal(passesRequiredTag(row, new Set(["butcher-id", "forester-id"])), true);
});
