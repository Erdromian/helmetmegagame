// The canary. Zzyzx Quorble is standing right there with his face showing, and
// the reader has no Friends entry for him (docs/systemdocs/STRANGERS.md), so
// every line that reaches the reader must call him what he looks like — "a
// young man" — and never let slip "Zzyzx" or "Quorble". The name is chosen so
// that a leak cannot hide inside another word.
//
// Each test runs a real message builder from db/lib, pure where it is pure and
// against a fake database where it is not, and checks EVERYTHING it hands back:
// the DM, the refusal, the returned line, the stored Move description. A new
// builder that names somebody belongs here too.
const test = require("node:test");
const assert = require("node:assert/strict");

const HERE = "loc-1";

const zzyzx = (over = {}) => ({
  id: "Z",
  name: "Zzyzx Quorble",
  firstName: "Zzyzx",
  lastName: "Quorble",
  age: 20,
  gender: "MAN",
  concealed: false,
  status: "ALIVE",
  locationId: HERE,
  zoneId: "zone-1",
  buriedAt: null,
  discordUserId: "u-Z",
  discordRoleId: "900000000000000001",
  escortedById: null,
  updatedAt: new Date(0),
  tags: [],
  ...over,
});
const reader = (over = {}) =>
  zzyzx({
    id: "R",
    name: "Rhea Reed",
    firstName: "Rhea",
    lastName: "Reed",
    gender: "WOMAN",
    discordUserId: "u-R",
    discordRoleId: "900000000000000002",
    ...over,
  });

function assertUnnamed(value, what) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert.doesNotMatch(text ?? "", /Zzyzx|Quorble/, `${what} named the stranger: ${text}`);
}

// A database that answers everything. Every model, every method: reads come
// back empty, writes come back as what was written. The builders under test
// only need a handful of real answers, passed in `rows`, `known` and `answers`;
// the rest is plumbing they touch on the way (an audit row, a mood, a hold).
function fakeDb({ rows = {}, known = {}, answers = {} } = {}) {
  const written = [];
  const byId = (where) => rows[where?.id] ?? null;
  const defaults = {
    findUnique: async ({ where } = {}) => byId(where),
    findFirst: async ({ where } = {}) => byId(where),
    findMany: async ({ where } = {}) =>
      where?.id?.in ? where.id.in.map((id) => rows[id]).filter(Boolean) : [],
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
  const model = (name) =>
    new Proxy(
      {},
      {
        get: (_, method) => answers[name]?.[method] ?? (name === "character" ? defaults[method] : fallback[method]),
      },
    );
  const fallback = {
    ...defaults,
    findUnique: async () => null,
    findFirst: async () => null,
  };
  const db = new Proxy(
    { written },
    {
      get: (target, prop) => {
        if (prop in target) return target[prop];
        if (prop === "then") return undefined;
        if (prop === "$transaction") return async (fn) => (typeof fn === "function" ? fn(db) : Promise.all(fn));
        if (prop === "$queryRaw" || prop === "$executeRaw") return async () => [];
        if (prop === "acquaintance") {
          return {
            findMany: async ({ where }) =>
              (known[where.ownerId] ?? []).filter((id) => where.subjectId.in.includes(id)).map((subjectId) => ({ subjectId })),
          };
        }
        if (prop === "gameConfig") return { findUnique: async () => ({ anonymizeStrangers: true }) };
        return model(prop);
      },
    },
  );
  return db;
}

const TURN = { id: "turn-1", number: 3 };

// ─── The one function everything goes through ────────────────────────────────

test("seenBy, seenById, seenByMany and seenByIdMany never name him", async () => {
  const { seenBy, seenById, seenByMany, seenByIdMany } = require("../lib/intercept");
  const db = fakeDb({ rows: { Z: zzyzx() } });
  assert.equal(await seenBy(db, "R", zzyzx()), "a young man");
  assert.equal(await seenById(db, "R", "Z"), "a young man");
  assert.deepEqual(await seenByMany(db, "R", [zzyzx()]), ["a young man"]);
  assert.deepEqual(await seenByIdMany(db, "R", ["Z"]), ["a young man"]);
});

// ─── Handshakes: the ask he sends the reader ──────────────────────────────────

test("a bind, collar, escort or kiss he asks for arrives unnamed", async () => {
  const db = fakeDb({ rows: { Z: zzyzx(), R: reader() } });
  const { createBindOffer } = require("../lib/bind");
  const { createCollarOffer } = require("../lib/collar");
  const { createEscortOffer } = require("../lib/escort");
  const { createKissOffer } = require("../lib/kiss");
  const collar = { id: "c1", slug: "bomb-collar", name: "Bomb Collar" };
  for (const [what, run] of [
    ["bind", () => createBindOffer(db, { actor: zzyzx(), target: reader(), turn: TURN })],
    ["collar", () => createCollarOffer(db, { actor: zzyzx(), target: reader(), turn: TURN, collar })],
    ["escort", () => createEscortOffer(db, { actor: zzyzx(), target: reader(), turn: TURN })],
    ["kiss", () => createKissOffer(db, { actor: zzyzx(), target: reader(), turn: TURN })],
  ]) {
    const out = await run();
    assert.ok(out.dm?.content, `${what}: no ask was built (${JSON.stringify(out)})`);
    assert.match(out.dm.content, /A young man/, what);
    assertUnnamed(out, what);
  }
});

// ─── The reader's own verbs, about him ───────────────────────────────────────

test("an ask the reader sends him that cannot reach him does not name him", async () => {
  const db = fakeDb({ rows: { Z: zzyzx({ discordUserId: null }), R: reader() } });
  const { createBindOffer } = require("../lib/bind");
  const out = await createBindOffer(db, { actor: reader(), target: zzyzx({ discordUserId: null }), turn: TURN });
  assert.equal(out.reason, "A young man can't be reached.");
});

test("his no, to any offer the reader made, arrives unnamed", async () => {
  const { declineOffer } = require("../lib/lessons");
  for (const kind of ["LESSON", "BIND", "ESCORT", "KISS", "SEARCH", "COLLAR", "CONFESSION", "SOMETHING_NEW"]) {
    const db = fakeDb({ rows: { Z: zzyzx(), R: reader() } });
    const out = await declineOffer(db, { id: "o1", kind, initiatorId: "R", responderId: "Z" }, zzyzx());
    assert.equal(out.ok, true, kind);
    assert.equal(out.dms.length, 1, kind);
    assert.match(out.dms[0].content, /^A young man /, kind);
    assertUnnamed(out, kind);
  }
});

test("a lesson a GM calls off names the teacher as the learner knows them", async () => {
  const { cancelOffersForAction } = require("../lib/lessons");
  const offer = {
    id: "o1",
    kind: "LESSON",
    teacherActionId: "act-1",
    learnerActionId: "act-2",
    teacherId: "Z",
    learnerId: "R",
  };
  const db = fakeDb({
    rows: { Z: zzyzx(), R: reader() },
    answers: { offer: { findMany: async () => [offer] } },
  });
  const dms = await cancelOffersForAction(db, "act-1");
  assert.deepEqual(dms, [
    { discordUserId: "u-R", content: "Your lesson with a young man was called off by a GM. Your Move wasn't spent." },
  ]);
});

test("the reader's fight list names him by what he looks like", async () => {
  const { attacksBy } = require("../lib/attack");
  const db = fakeDb({
    answers: { attack: { findMany: async () => [{ id: "a1", targetCharacter: zzyzx() }] } },
  });
  const fights = await attacksBy(db, "R", TURN.id);
  assert.equal(fights[0].name, "a young man");
  assertUnnamed(fights, "attacksBy");
});

// A Move description is stored on the Action row and shown to the vampire on
// their own sheet.
test("a bloodcrazed vampire's Move names the victim as the vampire knows them", async () => {
  const { runVampireCompulsion } = require("../lib/vampireCompulsion");
  const vampire = reader({ tags: [{ equipped: false, tag: { slug: "bloodcrazed", name: "Bloodcrazed" } }] });
  const db = fakeDb({
    rows: { Z: zzyzx(), R: vampire },
    answers: {
      tag: { findMany: async () => [{ id: "t-bc", slug: "bloodcrazed" }] },
      character: {
        findMany: async ({ where }) => (where.locationId ? [zzyzx()] : [vampire]),
        findUnique: async ({ where }) => ({ Z: zzyzx(), R: vampire })[where.id] ?? null,
        findFirst: async () => null,
        update: async () => ({}),
        updateMany: async () => ({ count: 1 }),
      },
    },
  });
  await runVampireCompulsion(db, TURN);
  const move = db.written.find((row) => typeof row?.description === "string" && row.description.startsWith("Blood-crazed"));
  assert.ok(move, "no Move was filed");
  assert.equal(move.description, "Blood-crazed, Rhea Reed ravenously feeds on a young man.");
});

// ─── What leaves for Discord and what is kept ────────────────────────────────

test("a chip frozen under his alias never goes to Discord as his role", async () => {
  const { tokensToRoles } = require("../lib/characterMentions");
  const db = { character: { findMany: async () => [zzyzx()] } };
  const hooded = await tokensToRoles(db, "watch {char:Z|Young Man} closely");
  assert.equal(hooded.content, "watch Young Man closely");
  assertUnnamed(hooded.content, "a hood's chip");
  assert.deepEqual(hooded.characters.map((c) => c.id), ["Z"], "the relay DM still knows who was named");
  const forced = await tokensToRoles(db, "{char:Z|Beast} growls");
  assert.equal(forced.content, "Beast growls");
  // Said openly, under his own name, it may go as the role: the speaker named him.
  const open = await tokensToRoles(db, "{char:Z|Zzyzx Quorble} is here");
  assert.equal(open.content, "<@&900000000000000001> is here");
});

test("a Highlight of his line keeps what the reader saw, not his name", async () => {
  const { createLens, keptSpeaker } = require("../lib/strangers");
  const { feedRowShape } = require("../lib/archive");
  const row = {
    seq: 41n,
    placeKey: `loc:${HERE}`,
    characterId: "Z",
    characterName: "Zzyzx Quorble",
    concealedAlias: null,
    presentedAvatarPath: null,
    content: "Nice weather.",
    sentAt: new Date(0),
    turnNumber: 3,
  };
  const db = fakeDb({
    rows: { Z: zzyzx() },
    answers: {
      voiceMemory: { findMany: async () => [] },
      character: { findMany: async () => [{ id: "Z", age: 20, gender: "MAN" }] },
    },
  });
  const [shown] = await createLens(db, { characterId: "R" }).all([feedRowShape(row)]);
  const kept = keptSpeaker(row, shown);
  assert.deepEqual(kept, { name: "Young Man", avatarPath: null });
  assertUnnamed(kept, "keptSpeaker");
});
