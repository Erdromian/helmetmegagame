// The Vampire's compulsion (docs/systemdocs/VAMPIRE.md §4, db/lib/vampireCompulsion.js): a Bloodcrazed or
// Wight Vampire is held in combat mode and thrown at somebody to feed on — never another Vampire or a
// Thrall — retried on the next person until one fight starts, once a turn, and again on an arrival.
// A fake database that answers everything (the strangerNameCanary shape): reads come back empty unless a
// test says otherwise, writes come back as written.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  compelAttack,
  compelOnArrival,
  suitableTargets,
  runVampireCompulsion,
  holdsCompulsion,
  COMPULSION_SLUGS,
  UNSUITABLE_SLUGS,
} = require("../lib/vampireCompulsion");
const { BLOODCRAZED_SLUG, WIGHT_SLUG, VAMPIRE_SLUG, THRALL_SLUG } = require("../lib/secretSlugs");
const { COMPELLED_GM_LINE, COMPELLED_NO_CALL_OFF } = require("../lib/compulsionLines");

const HERE = "loc-1";
const TURN = { id: "turn-1", number: 3, startedAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() + 3_600_000), turnLengthHours: 24 };

const person = (id, over = {}) => ({
  id,
  name: `Person ${id}`,
  firstName: "Person",
  lastName: id,
  age: 30,
  gender: "MAN",
  concealed: false,
  status: "ALIVE",
  locationId: HERE,
  zoneId: "zone-1",
  discordUserId: null,
  updatedAt: new Date(0),
  combatModeSinceTurn: null,
  tags: [],
  ...over,
});
const tagged = (...slugs) => slugs.map((slug) => ({ equipped: false, quantity: 1, tag: { slug, name: slug } }));

// `rows` by id; `here` is what a findMany by locationId returns (already filtered, as Postgres would);
// `busyIds` are in a fight; `racedIds` are pulled into one between the check and the claim (createMany short);
// `doneThisTurn` says a compelled fight already happened this turn.
function fakeDb({ rows = {}, here = [], holders = [], busyIds = [], racedIds = [], doneThisTurn = false } = {}) {
  const written = [];
  const asked = [];
  const tried = [];
  const updates = [];
  let combatCount = 0;
  const lastTargets = { ids: [] };
  const byId = (id) => rows[id] ?? null;
  const fallback = {
    findUnique: async () => null,
    findFirst: async () => null,
    findMany: async () => [],
    count: async () => 0,
    create: async ({ data } = {}) => {
      written.push(data);
      return { id: `row-${written.length}`, ...data };
    },
    createMany: async () => ({ count: 0 }),
    update: async ({ data } = {}) => data ?? {},
    updateMany: async () => ({ count: 1 }),
    upsert: async ({ create } = {}) => create ?? {},
    delete: async () => ({}),
    deleteMany: async () => ({ count: 0 }),
    aggregate: async () => ({ _max: {}, _sum: {} }),
  };
  const answers = {
    turn: { findFirst: async () => TURN },
    character: {
      findUnique: async ({ where }) => byId(where.id),
      findFirst: async () => null,
      findMany: async (args = {}) => {
        const { where } = args;
        asked.push(args);
        if (where?.id?.in) return where.id.in.map(byId).filter(Boolean);
        if (where?.tags?.some) return holders.filter((id) => id !== where.id?.not).map((id) => ({ id }));
        if (where?.locationId) return here.filter((id) => id !== where.id?.not).map(byId);
        return [];
      },
      updateMany: async ({ where, data }) => {
        updates.push({ where, data });
        const row = byId(where.id);
        if (!row) return { count: 0 };
        if (where.combatModeSinceTurn === null && row.combatModeSinceTurn != null) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      update: async ({ data }) => data,
    },
    combat: {
      create: async ({ data }) => {
        combatCount += 1;
        return { id: `c${combatCount}`, ...data };
      },
    },
    combatParticipant: {
      findFirst: async ({ where }) => {
        if (where?.compelled) return doneThisTurn ? { id: "old" } : null;
        if (where?.activeTurnId && busyIds.includes(where.characterId)) return { id: "busy" };
        return null;
      },
      findMany: async ({ where } = {}) => {
        if (where?.combatId) {
          const [initiator, ...targets] = lastTargets.ids;
          return [
            { id: "p1", characterId: initiator, side: "ATTACKER", role: "INITIATOR", status: "JOINED", alert: true, compelled: true },
            ...targets.map((id, i) => ({ id: `p${i + 2}`, characterId: id, side: "DEFENDER", role: "TARGET", status: "JOINED", alert: false })),
          ];
        }
        const ids = where?.characterId?.in ?? [];
        return ids.filter((id) => busyIds.includes(id)).map((characterId) => ({ characterId }));
      },
      createMany: async ({ data }) => {
        const target = data.find((d) => d.role === "TARGET")?.characterId;
        tried.push(target);
        written.push(...data);
        lastTargets.ids = data.map((d) => d.characterId);
        return { count: racedIds.includes(target) ? data.length - 1 : data.length };
      },
    },
    location: { findUnique: async () => ({ id: HERE, name: "Square", zoneId: "zone-1" }), findMany: async () => [] },
    locationLink: { findMany: async () => [] },
  };
  const model = (name) => new Proxy({}, { get: (_, method) => answers[name]?.[method] ?? fallback[method] });
  const db = new Proxy(
    { written, tried, updates, asked },
    {
      get: (target, prop) => {
        if (prop in target) return target[prop];
        if (prop === "then") return undefined;
        if (prop === "$transaction") return async (fn) => (typeof fn === "function" ? fn(db) : Promise.all(fn));
        if (prop === "$queryRaw" || prop === "$executeRaw") return async () => [];
        if (prop === "acquaintance") return { findMany: async () => [] };
        if (prop === "gameConfig") return { findUnique: async () => ({ anonymizeStrangers: true }) };
        return model(prop);
      },
    },
  );
  return db;
}

// ─── Who counts ──────────────────────────────────────────────────────────────

test("the compulsion is Bloodcrazed and Wight, and spares Vampires and Thralls", () => {
  assert.deepEqual([...COMPULSION_SLUGS].sort(), [BLOODCRAZED_SLUG, WIGHT_SLUG].sort());
  assert.deepEqual([...UNSUITABLE_SLUGS].sort(), [THRALL_SLUG, VAMPIRE_SLUG].sort());
  assert.equal(holdsCompulsion(tagged("bloodcrazed")), true);
  assert.equal(holdsCompulsion([{ slug: "wight" }]), true);
  assert.equal(holdsCompulsion(tagged("famished", "vampire")), false);
});

test("the picker asks Postgres for nobody holding Vampire or Thrall, and drops anyone already fighting", async () => {
  const db = fakeDb({ rows: { V: person("V"), A: person("A"), B: person("B") }, here: ["A", "B"], busyIds: ["A"] });
  const out = await suitableTargets(db, person("V"), TURN);
  assert.deepEqual(out.map((c) => c.id), ["B"]);
  const asked = db.asked.find((a) => a.where?.locationId);
  assert.equal(asked.where.locationId, HERE);
  assert.deepEqual(asked.where.id, { not: "V" });
  assert.deepEqual([...asked.where.tags.none.tag.slug.in].sort(), [THRALL_SLUG, VAMPIRE_SLUG].sort());
  assert.equal(asked.where.status, "ALIVE");
});

// ─── The attack ──────────────────────────────────────────────────────────────

test("a Bloodcrazed Vampire is put in combat mode — even Exhausted — and attacks, marked compelled, filing no Move", async () => {
  const rows = { V: person("V", { tags: tagged("bloodcrazed", "vampire", "exhausted") }), A: person("A") };
  const db = fakeDb({ rows, here: ["A"] });
  const out = await compelAttack(db, { characterId: "V", turn: TURN });
  assert.equal(out.started, true, out.reason);
  assert.equal(out.targetId, "A");
  assert.equal(rows.V.combatModeSinceTurn, TURN.number);
  const initiator = db.written.find((r) => r?.role === "INITIATOR");
  assert.equal(initiator.compelled, true);
  assert.equal(initiator.alert, true, "forced on before the snapshot, so they can write their attack");
  assert.ok(!db.written.find((r) => r?.role === "TARGET").compelled, "only the Vampire's own row is marked");
  assert.ok(!db.written.some((r) => r?.moveKind), "the feeding is the attack now, not a Move");
  const audit = db.written.find((r) => r?.actionType === "character_combat_mode_set");
  assert.equal(audit.details.forced, "compulsion");
});

test("a refused target is skipped for the next until a fight starts", async () => {
  const rows = () => ({ V: person("V", { tags: tagged("wight", "vampire") }), A: person("A"), B: person("B") });
  // A is pulled into another fight between the check and the claim: B must be tried, in either order.
  const raced = fakeDb({ rows: rows(), here: ["A", "B"], racedIds: ["A"] });
  const out = await compelAttack(raced, { characterId: "V", turn: TURN });
  assert.equal(out.started, true, out.reason);
  assert.equal(out.targetId, "B");
  assert.equal(raced.tried[raced.tried.length - 1], "B");

  // Everybody refuses: every one of them was tried, and nothing started.
  const all = fakeDb({ rows: rows(), here: ["A", "B"], racedIds: ["A", "B"] });
  const none = await compelAttack(all, { characterId: "V", turn: TURN });
  assert.deepEqual(none, { started: false, reason: "all-refused" });
  assert.deepEqual([...all.tried].sort(), ["A", "B"]);
});

test("nobody suitable here: no fight, but combat mode still goes on", async () => {
  const rows = { V: person("V", { tags: tagged("bloodcrazed", "vampire") }) };
  const db = fakeDb({ rows, here: [] });
  const out = await compelAttack(db, { characterId: "V", turn: TURN });
  assert.deepEqual(out, { started: false, reason: "nobody" });
  assert.equal(rows.V.combatModeSinceTurn, TURN.number);
  assert.equal(db.tried.length, 0);
});

test("once a compelled fight has started this turn there is no second, and none while already fighting", async () => {
  const rows = { V: person("V", { tags: tagged("bloodcrazed") }), A: person("A") };
  const done = await compelAttack(fakeDb({ rows, here: ["A"], doneThisTurn: true }), { characterId: "V", turn: TURN });
  assert.deepEqual(done, { started: false, reason: "done-this-turn" });
  const fighting = await compelAttack(fakeDb({ rows, here: ["A"], busyIds: ["V"] }), { characterId: "V", turn: TURN });
  assert.deepEqual(fighting, { started: false, reason: "fighting" });
});

test("nobody without the tag is compelled, and a Vampire who can't act doesn't attack", async () => {
  const calm = await compelAttack(fakeDb({ rows: { V: person("V", { tags: tagged("famished", "vampire") }), A: person("A") }, here: ["A"] }), {
    characterId: "V",
    turn: TURN,
  });
  assert.deepEqual(calm, { started: false, reason: "not-compelled" });
  const rows = { V: person("V", { tags: tagged("bloodcrazed", "unconscious") }), A: person("A") };
  const out = await compelAttack(fakeDb({ rows, here: ["A"] }), { characterId: "V", turn: TURN });
  assert.deepEqual(out, { started: false, reason: "cannot-act" });
  assert.equal(rows.V.combatModeSinceTurn, TURN.number, "still held in combat mode");
});

test("turn open compels every holder", async () => {
  const rows = { V: person("V", { tags: tagged("bloodcrazed") }), A: person("A") };
  const db = fakeDb({ rows, here: ["A"], holders: ["V"] });
  const out = await runVampireCompulsion(db, TURN);
  assert.deepEqual(out, { compelled: 1, holders: 1 });
  assert.ok(!db.written.some((r) => r?.moveKind), "no Move filed");
});

// ─── Arrivals ────────────────────────────────────────────────────────────────

test("arrivals: a compelled Vampire walking in attacks; a Thrall or Vampire walking in wakes nobody", async () => {
  const rows = { V: person("V", { tags: tagged("bloodcrazed", "vampire") }), A: person("A") };
  const walkedIn = await compelOnArrival(fakeDb({ rows, here: ["A"] }), { characterId: "V", locationId: HERE });
  assert.deepEqual(walkedIn, { compelled: 1 });

  for (const slug of [THRALL_SLUG, VAMPIRE_SLUG]) {
    const r = { V: person("V", { tags: tagged("bloodcrazed", "vampire") }), T: person("T", { tags: tagged(slug) }) };
    const db = fakeDb({ rows: r, here: ["V", "T"] });
    const out = await compelOnArrival(db, { characterId: "T", locationId: HERE });
    assert.deepEqual(out, { compelled: 0 }, `${slug} woke the Vampire`);
    assert.equal(db.tried.length, 0);
  }
});

test("arrivals: somebody suitable walking in on a compelled Vampire is attacked", async () => {
  const rows = { V: person("V", { tags: tagged("bloodcrazed", "vampire") }), A: person("A") };
  // The hunters query (tags: some compulsion) finds the Vampire; the picker query finds the arrival.
  const db = fakeDb({ rows, here: ["A"], holders: ["V"] });
  const out = await compelOnArrival(db, { characterId: "A", locationId: HERE });
  assert.deepEqual(out, { compelled: 1 });
  assert.deepEqual(db.tried, ["A"]);
});

test("an arrival that is somewhere else by now, or dead, compels nobody", async () => {
  const rows = { V: person("V", { tags: tagged("bloodcrazed") }), A: person("A", { status: "DEAD" }) };
  assert.deepEqual(await compelOnArrival(fakeDb({ rows }), { characterId: "A", locationId: HERE }), { compelled: 0 });
  assert.deepEqual(await compelOnArrival(fakeDb({ rows }), { characterId: "V", locationId: "elsewhere" }), { compelled: 0 });
});

// ─── No way out ──────────────────────────────────────────────────────────────

test("a compelled Vampire can't call the fight off", async () => {
  const { callOff } = require("../lib/combat");
  const db = {
    turn: { findFirst: async () => TURN },
    gameConfig: { findUnique: async () => ({ gameMode: "PERSISTENT", autoTurnAdvanceDisabled: false }) },
    gameState: { findUnique: async () => ({ phase: "RUNNING", sessionOpenedAt: null }) },
    combatParticipant: {
      findUnique: async ({ select }) =>
        select?.combatId && Object.keys(select).length === 1
          ? { combatId: "c1" }
          : { id: "p1", characterId: "V", side: "ATTACKER", status: "JOINED", activeTurnId: TURN.id, callOffAt: null, compelled: true },
      update: async () => assert.fail("a compelled call-off was recorded"),
    },
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    $transaction: async (fn) => fn(db),
  };
  const out = await callOff(db, { participantId: "p1", characterId: "V", turn: TURN });
  assert.equal(out.ok, false);
  assert.equal(out.error, COMPELLED_NO_CALL_OFF);
});

// ─── Secrets ─────────────────────────────────────────────────────────────────

test("the compulsion's words stay out of the file every browser loads", () => {
  // combatMode.js is imported by client components; the GM line and the Vampire's sentences live in
  // compulsionLines.js, which only the server reads.
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "combatMode.js"), "utf8");
  assert.doesNotMatch(src, /bloodcrazed|wight|hunger|compulsionLines|vampire/i);
  assert.equal(COMPELLED_GM_LINE, "This character is bloodcrazed and MUST feed this turn.");
  const { PUBLIC_PARTICIPANT_SELECT } = require("../lib/combat");
  assert.equal(PUBLIC_PARTICIPANT_SELECT.compelled, undefined, "nobody else's view may read it");
});
