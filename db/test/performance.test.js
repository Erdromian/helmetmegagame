// Performances (docs/systemdocs/SOUND.md, "Performances"): who may start one, what stops
// one, and what the wire carries. A fake prisma records the writes; nothing here needs a
// database.
const test = require("node:test");
const assert = require("node:assert/strict");

const { INSTRUMENT_SONGS } = require("../lib/instrumentSongs");
const {
  equippedInstruments,
  holdsInstrument,
  startPerformance,
  stopPerformances,
  stopIfInstrumentGone,
} = require("../lib/performance");

const lute = { slug: "lute", name: "Lute", instrument: true };
const accordion = { slug: "accordion", name: "Accordion", instrument: true };
const held = (tag, extra = {}) => ({ quantity: 1, equipped: false, equippedQuantity: 0, ...extra, tag });
const worn = (tag) => held(tag, { equipped: true, equippedQuantity: 1 });
const aSong = (slug) => INSTRUMENT_SONGS[slug][0];

function fakePrisma({ live = [], rackHas = false } = {}) {
  const calls = { updateMany: [], create: [], notify: 0 };
  const performance = {
    findMany: async () => live,
    findFirst: async () => live[0] ?? null,
    updateMany: async (args) => {
      calls.updateMany.push(args);
      return { count: live.length };
    },
    create: async ({ data }) => {
      calls.create.push(data);
      return { id: "p1", ...data };
    },
  };
  const db = {
    performance,
    characterTag: { findFirst: async () => (rackHas ? { id: "ct" } : null) },
    $transaction: async (fn) => fn(db),
    $executeRaw: async () => {
      calls.notify += 1;
    },
  };
  return { db, calls };
}

const alive = (tags) => ({ id: "c1", status: "ALIVE", locationId: "loc1", tags });

test("only an instrument on the rack counts as equipped", () => {
  assert.deepEqual(equippedInstruments([held(lute), worn(accordion)]), ["accordion"]);
  assert.equal(holdsInstrument([held(lute)]), true);
  assert.equal(holdsInstrument([held({ slug: "sword" })]), false);
});

test("no instrument in hand is refused with the sheet's own sentence", async () => {
  const { db, calls } = fakePrisma();
  const res = await startPerformance(db, alive([held(lute)]), { songKey: aSong("lute").key });
  assert.equal(res.ok, false);
  assert.equal(res.error, "Equip an instrument first.");
  assert.equal(calls.create.length, 0);
});

test("a song from another instrument is refused", async () => {
  const { db, calls } = fakePrisma();
  const res = await startPerformance(db, alive([worn(lute)]), {
    instrumentSlug: "lute",
    songKey: "not-a-song",
  });
  assert.equal(res.ok, false);
  assert.equal(calls.create.length, 0);
});

test("a bound performer cannot start", async () => {
  const { db } = fakePrisma();
  const bound = held({ slug: "bound", name: "Bound" });
  const res = await startPerformance(db, alive([worn(lute), bound]), { songKey: aSong("lute").key });
  assert.equal(res.ok, false);
});

test("starting stops the old song first, then writes the new one and tells the place", async () => {
  const { db, calls } = fakePrisma();
  const song = aSong("lute");
  const res = await startPerformance(db, alive([worn(lute)]), { songKey: song.key, volume: 3 });
  assert.equal(res.ok, true);
  assert.equal(calls.updateMany.length, 1);
  assert.equal(calls.create[0].instrumentSlug, "lute");
  assert.equal(calls.create[0].volume, 1, "volume is clamped to 0-1");
  assert.equal(calls.create[0].endsAt - calls.create[0].startedAt, song.seconds * 1000);
  assert.ok(calls.notify >= 1);
});

test("with two in hand the performer must say which", async () => {
  const { db } = fakePrisma();
  const res = await startPerformance(db, alive([worn(lute), worn(accordion)]), { songKey: aSong("lute").key });
  assert.equal(res.ok, false);
});

test("stopping nothing writes nothing", async () => {
  const { db, calls } = fakePrisma();
  assert.equal(await stopPerformances(db, ["c1"], "attack"), 0);
  assert.equal(calls.updateMany.length, 0);
  assert.equal(calls.notify, 0);
});

test("stopping a live song stamps it and tells its place", async () => {
  const { db, calls } = fakePrisma({ live: [{ id: "p1", locationId: "loc1" }] });
  assert.equal(await stopPerformances(db, ["c1"], "moved"), 1);
  assert.equal(calls.updateMany[0].data.stoppedReason, "moved");
  assert.equal(calls.notify, 1);
});

test("an unequip stops the song only once its instrument has left the rack", async () => {
  const still = fakePrisma({ live: [{ id: "p1", locationId: "loc1", instrumentSlug: "lute" }], rackHas: true });
  assert.equal(await stopIfInstrumentGone(still.db, "c1"), 0);
  const gone = fakePrisma({ live: [{ id: "p1", locationId: "loc1", instrumentSlug: "lute" }], rackHas: false });
  assert.equal(await stopIfInstrumentGone(gone.db, "c1"), 1);
});
