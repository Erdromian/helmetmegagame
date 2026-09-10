// A GM picks a SEAT; the game stores places under LEVELS. This is the fold
// between the two.
//
// WHAT A FAILURE HERE MEANS. The zone picker can only ever offer a zone that
// has a gmRoleId, so the whole cave system is one tick — "Underground" — but
// Underground is a CAVE_GROUP: no Locations, no #summary channel, nothing
// standing in it. Caves and Depths hold all thirteen cave Locations, and
// their ids are never in GmZoneView. If visibleZoneIds stops expanding the
// seat, every id-side caller silently loses the cave system: /chat draws no
// cave places for a GM watching Underground, and the ambient line on /gm/dev
// refuses every cave Location. That is a bug this repo has already shipped
// once, on the NAME side, and web/lib/zones.js#inVisibleZones is the twin
// that has to keep saying the same thing.
//
// No database: visibleZoneIds takes its client as a parameter, so the stub
// below is the whole fixture.
const test = require("node:test");
const assert = require("node:assert/strict");
const { visibleZoneIds } = require("../lib/gmZoneView");

// The live shape, as of the Underground fix: three surface zones seated on
// themselves, one CAVE_GROUP, and two CAVE_LEVELs seated on the group.
const ZONES = [
  { id: "z-town", slug: "town", seatZoneId: "z-town", parentZoneId: null },
  { id: "z-fortress", slug: "fortress", seatZoneId: "z-fortress", parentZoneId: null },
  { id: "z-marshes", slug: "marshes", seatZoneId: "z-marshes", parentZoneId: null },
  { id: "z-underground", slug: "underground", seatZoneId: "z-underground", parentZoneId: null },
  { id: "z-caves", slug: "caves", seatZoneId: "z-underground", parentZoneId: "z-underground" },
  { id: "z-depths", slug: "depths", seatZoneId: "z-underground", parentZoneId: "z-underground" },
];

// Enough Prisma to answer the two queries the function makes, and no more.
// `zones` is the table; `views` is what one GM has ticked.
function stub(views, zones = ZONES) {
  return {
    gmZoneView: {
      findMany: async () => views.map((zoneId) => ({ zoneId })),
    },
    zone: {
      findMany: async ({ where }) => {
        const [bySeat, byParent] = where.OR;
        const seats = new Set(bySeat.seatZoneId.in);
        const parents = new Set(byParent.parentZoneId.in);
        return zones
          .filter((z) => seats.has(z.seatZoneId) || parents.has(z.parentZoneId))
          .map((z) => ({ id: z.id }));
      },
    },
  };
}

test("no rows means every zone, and says so as null", async () => {
  assert.equal(await visibleZoneIds(stub([]), "gm-1"), null);
});

test("no user is every zone too — a signed-out reader gates elsewhere", async () => {
  assert.equal(await visibleZoneIds(null, null), null);
});

test("Underground hands over the cave levels with it", async () => {
  const visible = await visibleZoneIds(stub(["z-underground"]), "gm-1");
  assert.ok(visible.has("z-caves"), "Caves is missing — a GM watching Underground reads no cave places");
  assert.ok(visible.has("z-depths"), "Depths is missing");
  assert.ok(visible.has("z-underground"), "the seat itself should stay in the set");
  assert.equal(visible.size, 3);
});

test("a surface zone brings nothing else with it", async () => {
  const visible = await visibleZoneIds(stub(["z-town"]), "gm-1");
  assert.deepEqual([...visible].sort(), ["z-town"]);
});

test("two picks stay two answers, folded independently", async () => {
  const visible = await visibleZoneIds(stub(["z-town", "z-underground"]), "gm-1");
  assert.deepEqual([...visible].sort(), ["z-caves", "z-depths", "z-town", "z-underground"]);
  assert.ok(!visible.has("z-fortress"), "an unticked zone must not arrive by the fold");
});

test("a zone the sync has not backfilled behaves as it did before the fold", async () => {
  // seatZoneId is nullable in the schema. A row with neither seat nor parent
  // matches nothing, so it is simply itself — never dropped.
  const zones = [...ZONES, { id: "z-new", slug: "new", seatZoneId: null, parentZoneId: null }];
  const visible = await visibleZoneIds(stub(["z-new"], zones), "gm-1");
  assert.deepEqual([...visible], ["z-new"]);
});

test("a level ticked directly does not drag its siblings in", async () => {
  // Nothing offers Caves today, but if something ever did, picking it should
  // mean Caves — not the whole seat.
  const visible = await visibleZoneIds(stub(["z-caves"]), "gm-1");
  assert.deepEqual([...visible], ["z-caves"]);
});
