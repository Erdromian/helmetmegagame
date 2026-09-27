// Every verb one character does to another names the other the way the reader
// knows them (intercept.js#seenBy, STRANGERS.md §6): a hood, or a face with no
// Friends entry, is "a young man". Kiss has its own file (kiss.test.js); this
// holds the rest of the handshakes to the same rule — Bind, Collar, Escort and
// a declined offer — plus the two lookups they share.
const test = require("node:test");
const assert = require("node:assert/strict");
const { seenById, seenByPlace } = require("../lib/intercept");

const HERE = "loc-1";

const tag = (slug, over = {}) => ({
  equipped: false,
  tag: { slug, name: slug, concealsIdentity: false, concealSprite: null, forcesConceal: false, equipLayer: null, ...over },
});
const hood = () => ({
  equipped: true,
  tag: { slug: "hood", name: "Hood", concealsIdentity: true, concealSprite: "hood", forcesConceal: true, equipLayer: 3 },
});

// Ada (A) is a young woman, Bo (B) a young man.
const ada = (over = {}) => ({
  id: "A",
  name: "Ada",
  firstName: "Ada",
  lastName: null,
  age: 20,
  gender: "WOMAN",
  status: "ALIVE",
  locationId: HERE,
  concealed: false,
  buriedAt: null,
  discordUserId: "1",
  escortedById: null,
  tags: [],
  ...over,
});
const bo = (over = {}) =>
  ada({ id: "B", name: "Bo", firstName: "Bo", gender: "MAN", discordUserId: "2", ...over });

// `known` is each one's Friends list, which is all seenBy reads; `rows` are
// the characters a lookup by id finds.
function fakeDb({ known = {}, rows = {}, turn = { id: "turn-1", number: 3 } } = {}) {
  const offer = {
    findFirst: async () => null,
    create: async ({ data }) => ({ id: "offer-1", ...data }),
    updateMany: async () => ({ count: 1 }),
    update: async () => ({}),
  };
  const auditLog = { create: async () => ({}) };
  const character = {
    findUnique: async ({ where }) => rows[where.id] ?? null,
    update: async () => ({}),
    updateMany: async () => ({ count: 0 }),
  };
  return {
    acquaintance: {
      findMany: async ({ where }) =>
        (known[where.ownerId] ?? []).filter((id) => where.subjectId.in.includes(id)).map((subjectId) => ({ subjectId })),
    },
    gameConfig: { findUnique: async () => ({ anonymizeStrangers: true }) },
    turn: { findFirst: async () => turn },
    character,
    offer,
    auditLog,
    $transaction: async (fn) => fn({ offer, auditLog, character }),
  };
}

const OFFER = { id: "offer-1", turnId: "turn-1", initiatorId: "A", responderId: "B" };

// ─── The lookups ─────────────────────────────────────────────────────────────

test("seenById: a stranger is what they look like, a friend is their name", async () => {
  const rows = { B: bo() };
  assert.equal(await seenById(fakeDb({ rows }), "A", "B"), "a young man");
  assert.equal(await seenById(fakeDb({ rows, known: { A: ["B"] } }), "A", "B"), "Bo");
  assert.equal(await seenById(fakeDb({ rows }), "A", "gone"), "somebody");
});

test("seenById: a hood is its alias even to a friend", async () => {
  const rows = { B: bo({ tags: [hood()] }) };
  assert.equal(await seenById(fakeDb({ rows, known: { A: ["B"] } }), "A", "B"), "a young man");
});

test("seenByPlace: a room names a bare face and never a hood", async () => {
  assert.equal(await seenByPlace(fakeDb({ rows: { B: bo() } }), "B"), "Bo");
  assert.equal(await seenByPlace(fakeDb({ rows: { B: bo({ tags: [hood()] }) } }), "B"), "a young man");
});

// ─── Bind ────────────────────────────────────────────────────────────────────

test("a bind ask names a stranger by what they look like", async () => {
  const { createBindOffer } = require("../lib/bind");
  const db = fakeDb({ rows: { A: ada(), B: bo() } });
  const out = await createBindOffer(db, { actor: ada(), target: bo(), turn: { id: "turn-1" } });
  assert.equal(out.dm.content, "*A young woman* wants to bind you. Accept?");
});

test("a bind ask to somebody unreachable does not name them", async () => {
  const { createBindOffer } = require("../lib/bind");
  const db = fakeDb({ rows: { A: ada(), B: bo({ discordUserId: null }) } });
  const out = await createBindOffer(db, { actor: ada(), target: bo({ discordUserId: null }), turn: { id: "turn-1" } });
  assert.deepEqual(out, { ok: false, reason: "A young man can't be reached." });
});

test("a bind that falls through at Accept tells each side from where they stand", async () => {
  const { acceptBind } = require("../lib/bind");
  const rows = { A: ada(), B: bo({ tags: [tag("bound")] }) };
  const out = await acceptBind(fakeDb({ rows }), OFFER, { id: "B" });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "You're already bound.");
  assert.deepEqual(out.dms, [{ discordUserId: "1", content: "Your offer fell through: A young man is already bound." }]);
});

// ─── Collar ──────────────────────────────────────────────────────────────────

test("a collar ask names a hooded asker by their alias", async () => {
  const { createCollarOffer } = require("../lib/collar");
  const asker = ada({ tags: [hood()] });
  const db = fakeDb({ rows: { A: asker, B: bo() }, known: { B: ["A"] } });
  const out = await createCollarOffer(db, { actor: asker, target: bo(), turn: { id: "turn-1" } });
  assert.equal(out.dm.content, "*A young woman* wants to put a shock collar on you. Accept?");
});

test("a collar that falls through at Accept tells each side from where they stand", async () => {
  const { acceptCollar } = require("../lib/collar");
  const locked = { equipped: false, quantity: 1, tag: { slug: "bomb-collar-locked", name: "Bomb Collar" } };
  const rows = { A: ada(), B: bo({ tags: [locked] }) };
  const out = await acceptCollar(fakeDb({ rows }), OFFER, { id: "B" });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "You already have a collar on.");
  assert.deepEqual(out.dms, [{ discordUserId: "1", content: "Your offer fell through: A young man already has a collar on." }]);
});

// ─── Escort ──────────────────────────────────────────────────────────────────

test("an escort ask names a stranger by what they look like, a hood as somebody", async () => {
  const { createEscortOffer } = require("../lib/escort");
  const turn = { id: "turn-1" };
  const stranger = await createEscortOffer(fakeDb({ rows: { A: ada() } }), { actor: ada(), target: bo(), turn });
  assert.equal(stranger.dm.content, "*A young woman* wants to take you along.");
  const hooded = ada({ tags: [hood()] });
  const masked = await createEscortOffer(fakeDb({ rows: { A: hooded } }), { actor: hooded, target: bo(), turn });
  assert.equal(masked.dm.content, "*Somebody* wants to take you along.");
});

test("an accepted escort names each side as the other knows them", async () => {
  const { acceptEscort } = require("../lib/escort");
  const rows = { A: ada(), B: bo() };
  const strangers = await acceptEscort(fakeDb({ rows }), OFFER, { id: "B" });
  assert.equal(strangers.line, "You're with a young woman now.");
  assert.deepEqual(strangers.dms, [{ discordUserId: "1", content: "A young man is with you." }]);
  const friends = await acceptEscort(fakeDb({ rows, known: { A: ["B"], B: ["A"] } }), OFFER, { id: "B" });
  assert.equal(friends.line, "You're with Ada now.");
  assert.deepEqual(friends.dms, [{ discordUserId: "1", content: "Bo is with you." }]);
});

// ─── A declined offer ────────────────────────────────────────────────────────

test("a declined bind names a hooded responder by their alias, even to a friend", async () => {
  const { declineOffer } = require("../lib/lessons");
  const rows = { A: ada(), B: bo({ tags: [hood()] }) };
  const out = await declineOffer(fakeDb({ rows, known: { A: ["B"] } }), { ...OFFER, kind: "BIND" }, rows.B);
  assert.equal(out.ok, true);
  assert.equal(out.dms.length, 1);
  assert.doesNotMatch(out.dms[0].content, /Bo/);
  assert.match(out.dms[0].content, /^A young man /);
});
