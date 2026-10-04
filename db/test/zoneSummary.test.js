// Which zones own a #summary channel, and where a public declaration goes when
// one does not. Pure: fixture rows, no guild and no database.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DISCORD_GUILD_ID ||= "guild-1";

const { zoneHasSummary, zoneFansOutToLocations } = require("../lib/zoneSummary");
const { publicTargetsFor, placeTargetsFor } = require("../lib/publicPostTargets");
const { zoneChannelSpec } = require("../lib/zoneChannelSpec");

const zone = (over = {}) => ({ id: "z1", slug: "town", name: "Town", kind: "SURFACE", ...over });

test("a surface zone has a #summary; the caves and Space do not", () => {
  assert.equal(zoneHasSummary(zone()), true);
  assert.equal(zoneHasSummary(zone({ slug: "underground", kind: "CAVE_GROUP" })), false);
  assert.equal(zoneHasSummary(zone({ slug: "caves", kind: "CAVE_LEVEL" })), false);
  assert.equal(zoneHasSummary(zone({ slug: "space" })), false);
});

test("the spec gives Space a category and no summary channel", () => {
  assert.ok(zoneChannelSpec(zone()).summary, "Town still has one");
  const spec = zoneChannelSpec(zone({ id: "zs", slug: "space", name: "Space" }));
  assert.ok(spec.category);
  assert.equal(spec.summary, undefined);
});

test("a declaration in Space reaches the Charon's Location channel, as in a cave", () => {
  const locations = [{ id: "ls", name: "Charon (Space)", discordChannelId: "chan-space" }];
  const targets = publicTargetsFor({ zone: zone({ slug: "space", discordSummaryChannelId: null }), locations });
  assert.deepEqual(targets, [{ publicKey: "public:loc:ls", channelId: "chan-space", name: "Charon (Space)" }]);
});

test("a CAVE_GROUP is nowhere — no summary and no fan-out", () => {
  const group = zone({ slug: "underground", kind: "CAVE_GROUP", discordSummaryChannelId: null });
  assert.equal(zoneFansOutToLocations(group), false);
  assert.deepEqual(publicTargetsFor({ zone: group, locations: [] }), []);
});

// A declaration staged for one place goes there alone, keyed by the place so a
// reprovisioned channel never orphans a SENT row (ADJUDICATION.md §1, §1a).
test("a place post targets that Room's thread or that Location's channel", () => {
  assert.deepEqual(placeTargetsFor({ room: { id: "r1", name: "Pub — Cellar", discordThreadId: "t1" } }), [
    { publicKey: "public:room:r1", channelId: "t1", name: "Pub — Cellar" },
  ]);
  assert.deepEqual(placeTargetsFor({ location: { id: "l1", name: "Pub", discordChannelId: "c1" } }), [
    { publicKey: "public:loc:l1", channelId: "c1", name: "Pub" },
  ]);
  // Not provisioned yet: nowhere to post, which the push records as a failure rather than going elsewhere.
  assert.deepEqual(placeTargetsFor({ room: { id: "r1", name: "Cellar", discordThreadId: null } }), []);
  assert.deepEqual(placeTargetsFor({ location: { id: "l1", name: "Pub", discordChannelId: null } }), []);
  assert.deepEqual(placeTargetsFor({}), []);
});
