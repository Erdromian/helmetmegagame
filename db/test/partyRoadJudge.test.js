// node --test over db/lib/locationTravel.js#partyRoadJudge — who a road would
// leave behind, judged once for every way out (MAP.md §3a). This is the one
// list the move acts on AND every picker warns from, so what it must get
// right is: a follower refused by the way, the leader's lent key, the key that
// is a skill and is NOT lent, a hold, the Caving Die's hold, and a walk judged
// hop by hop. And leftBehindText.js, which puts the answer into the sentence.
//
// No database. `prisma` is a handful of stubs returning literal rows, the way
// the rest of db/test/ fakes the few queries a rule reads.
const test = require("node:test");
const assert = require("node:assert/strict");
const { partyRoadJudge, partyWarningFor } = require("../lib/locationTravel");
const { leftBehindWarning } = require("../lib/leftBehindText");

const HERE = "loc-here";

// Every field crossingCheck reads, defaulted to a plain open way.
function way(extra = {}) {
  return {
    id: "w",
    aId: HERE,
    bId: "loc-there",
    hidden: false,
    requiredTagSlug: null,
    modular: false,
    isOpen: true,
    keyed: false,
    onFoot: false,
    tightSqueeze: false,
    openUntil: null,
    ...extra,
  };
}

function person(id, slugs = [], extra = {}) {
  return {
    id,
    name: id,
    status: "ALIVE",
    locationId: HERE,
    zoneId: "z",
    buriedAt: null,
    escortedById: id === "leader" ? null : "leader",
    heldUntil: null,
    heldById: null,
    heldReason: null,
    discordUserId: null,
    tags: slugs.map((slug) => ({ equipped: true, tag: { slug, name: slug } })),
    ...extra,
  };
}

// `items` — which slugs the catalog files under Items (a lendable key);
// `trouble` — caving TROUBLE rows this turn, by character id.
function fakePrisma({ items = [], trouble = [] } = {}) {
  return {
    tag: { findMany: async ({ where }) => where.slug.in.filter((s) => items.includes(s)).map((slug) => ({ slug })) },
    characterTag: { findFirst: async () => null },
    cavingRoll: { findMany: async () => trouble.map((characterId) => ({ characterId })) },
  };
}

test("a follower the way refuses is left behind, as `edge`, and the rest come", async () => {
  const leader = person("leader", ["caving"]);
  const party = [person("ada", ["caving"]), person("bo")];
  const judge = await partyRoadJudge(fakePrisma(), { mover: leader, party });
  const { coming, leftBehind } = judge.leftBehind([way({ requiredTagSlug: "caving" })], "SURFACE");
  assert.deepEqual(coming.map((r) => r.id), ["ada"]);
  assert.deepEqual(leftBehind.map((e) => [e.row.id, e.reason]), [["bo", "edge"]]);
});

test("the leader lends a KEY, never a skill", async () => {
  const leader = person("leader", ["brass-key", "climbing"]);
  const party = [person("bo")];
  const judge = await partyRoadJudge(fakePrisma({ items: ["brass-key"] }), { mover: leader, party });
  assert.equal(judge.leftBehind([way({ requiredTagSlug: "brass-key" })], "SURFACE").leftBehind.length, 0);
  assert.equal(judge.leftBehind([way({ requiredTagSlug: "climbing" })], "SURFACE").leftBehind[0]?.reason, "edge");
});

test("a Giant at a squeeze and a mount at an on-foot way are left behind; nobody is, on an open road", async () => {
  const leader = person("leader");
  const party = [person("giant", ["giant"]), person("rider", ["arelitz"]), person("walker")];
  const judge = await partyRoadJudge(fakePrisma(), { mover: leader, party });
  assert.deepEqual(judge.leftBehind([way({ tightSqueeze: true })], "SURFACE").leftBehind.map((e) => e.row.id), ["giant"]);
  assert.deepEqual(judge.leftBehind([way({ onFoot: true })], "SURFACE").leftBehind.map((e) => e.row.id), ["rider"]);
  assert.deepEqual(judge.leftBehind([way()], "SURFACE").leftBehind, []);
});

test("a hold is `held` with a holder and `stuck` without one, and is asked before the way", async () => {
  const leader = person("leader");
  const soon = new Date(Date.now() + 60_000);
  const party = [
    person("prisoner", [], { heldUntil: soon, heldById: "captor", heldReason: "ambush" }),
    person("thief", [], { heldUntil: soon, heldById: null, heldReason: "caught" }),
  ];
  const judge = await partyRoadJudge(fakePrisma(), { mover: leader, party });
  const { leftBehind } = judge.leftBehind([way({ tightSqueeze: true })], "SURFACE");
  assert.deepEqual(leftBehind.map((e) => [e.row.id, e.reason]), [["prisoner", "held"], ["thief", "stuck"]]);
});

test("the Caving Die's hold stops the way up and nothing else; its stop stops every way", async () => {
  const leader = person("leader");
  const party = [person("shaken"), person("stopped")];
  // One TROUBLE row holds; CAVING_TROUBLE_CAP of them stops. The cap is 10
  // (cavingPass.js); fake ten rows for the second caver.
  const trouble = ["shaken", ...Array(10).fill("stopped")];
  const judge = await partyRoadJudge(fakePrisma({ trouble }), { mover: leader, party, standingZoneKind: "CAVE_LEVEL" });
  assert.deepEqual(judge.leftBehind([way()], "SURFACE").leftBehind.map((e) => e.row.id), ["shaken", "stopped"]);
  assert.deepEqual(judge.leftBehind([way()], "CAVE_LEVEL").leftBehind.map((e) => e.row.id), ["stopped"]);
  assert.equal(judge.leftBehind([way()], "CAVE_LEVEL").leftBehind[0].reason, "caving");
  // On the surface the Die has nobody, whatever rows the table holds.
  const surface = await partyRoadJudge(fakePrisma({ trouble }), { mover: leader, party, standingZoneKind: "SURFACE" });
  assert.deepEqual(surface.leftBehind([way()], "SURFACE").leftBehind, []);
});

test("a walk is judged hop by hop: refused at any one of them is left behind", async () => {
  const leader = person("leader", ["caving"]);
  const party = [person("bo")];
  const judge = await partyRoadJudge(fakePrisma(), { mover: leader, party });
  const road = [way(), way({ id: "w2", requiredTagSlug: "caving" }), way({ id: "w3" })];
  assert.equal(judge.leftBehind(road, "SURFACE").leftBehind[0]?.reason, "edge");
  assert.deepEqual(judge.leftBehind([road[0], road[2]], "SURFACE").leftBehind, []);
  // A first placement has no road, and nobody is refused by nothing.
  assert.deepEqual(judge.leftBehind([], "SURFACE").leftBehind, []);
});

test("somebody who is no longer theirs to bring is `gone`", async () => {
  const leader = person("leader");
  const party = [person("wandered", [], { locationId: "elsewhere" }), person("dead", [], { status: "DEAD" })];
  const judge = await partyRoadJudge(fakePrisma(), { mover: leader, party });
  assert.deepEqual(judge.leftBehind([way()], "SURFACE").leftBehind.map((e) => e.reason), ["gone", "gone"]);
});

test("partyWarningFor with nobody to bring asks the database nothing and answers nobody", async () => {
  // No stubs at all: a query here would throw. The names half (seenByIdMany)
  // is the stranger lens's own business and tested with it.
  const none = await partyWarningFor({}, { mover: person("leader"), party: [] });
  assert.deepEqual(none([way()], "SURFACE"), []);
});

test("leftBehindWarning: who, never why, and null for nobody", () => {
  assert.equal(leftBehindWarning([]), null);
  assert.equal(leftBehindWarning(null), null);
  assert.equal(leftBehindWarning([{ name: "Ada", held: false }]), "Ada can't follow you this way. You would leave them behind.");
  assert.equal(
    leftBehindWarning([{ name: "Ada", held: false }, { name: "a young man", held: false }, { name: "Bo", held: false }]),
    "Ada, a young man and Bo can't follow you this way. You would leave them behind.",
  );
  assert.equal(leftBehindWarning([{ name: "Ada", held: true }]), "Somebody has hold of Ada. You would leave them behind.");
  assert.equal(
    leftBehindWarning([{ name: "a young man", held: false }, { name: "Bo", held: true }]),
    "A young man can't follow you this way, and somebody has hold of Bo. You would leave them behind.",
  );
});
