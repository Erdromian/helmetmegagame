// The pure half of kissing (db/lib/kiss.js): who may kiss whom. Three things
// worth pinning: ACT implies KISS (db/lib/incapacitation.js#expandCaps), so
// the helpless are refused with no second list to maintain; mute keeps it
// (TAGS.md §5f); a covered face is DERIVED from concealsIdentity, never a
// slug list, so a new helmet is covered automatically.
const test = require("node:test");
const assert = require("node:assert/strict");
const { kissAuthority, kissBlock, KISS_SELECT, KISS_COOLDOWN_MS } = require("../lib/kiss");
const { blockerFor, KISS, ACT, INCAPACITATING_SLUGS } = require("../lib/incapacitation");
const { KISS_BLOCKING_SLUGS } = require("../lib/secretSlugs");

const HERE = "loc-1";

const tag = (slug, over = {}) => ({
  equipped: false,
  tag: { slug, name: slug, concealsIdentity: false, concealSprite: null, forcesConceal: false, equipLayer: null, ...over },
});
const hood = (slug = "hood", over = {}) => ({
  equipped: true,
  tag: {
    slug,
    name: "Hood",
    concealsIdentity: true,
    concealSprite: "hood",
    forcesConceal: true,
    equipLayer: 3,
    ...over,
  },
});

const person = (over = {}) => ({
  id: "A",
  name: "Ada",
  status: "ALIVE",
  locationId: HERE,
  concealed: false,
  buriedAt: null,
  discordUserId: "1",
  tags: [],
  ...over,
});
const other = (over = {}) => person({ id: "B", name: "Bo", discordUserId: "2", ...over });

test("two ordinary people standing together may kiss", () => {
  assert.equal(kissAuthority(person(), other()), null);
});

test("every helpless state refuses, through ACT rather than a second list", () => {
  for (const slug of INCAPACITATING_SLUGS) {
    assert.ok(blockerFor([tag(slug)], ACT), `${slug} should block ACT`);
    assert.ok(blockerFor([tag(slug)], KISS), `${slug} should block KISS`);
    assert.ok(kissAuthority(person(), other({ tags: [tag(slug)] })), `${slug} target should refuse`);
    assert.ok(kissAuthority(person({ tags: [tag(slug)] }), other()), `${slug} actor should refuse`);
  }
});

test("mute keeps the button — it takes the yell, not the mouth", () => {
  assert.equal(blockerFor([tag("mute")], KISS), null);
  assert.equal(kissAuthority(person(), other({ tags: [tag("mute")] })), null);
});

test("the mouth injuries refuse without touching ACT", () => {
  for (const slug of ["broken-jaw", "wired-jaw", "choking", "vomiting"]) {
    assert.equal(blockerFor([tag(slug)], ACT), null, `${slug} must not block ACT`);
    assert.ok(kissAuthority(person(), other({ tags: [tag(slug)] })), `${slug} should refuse a kiss`);
  }
});

test("the states with nobody home refuse", () => {
  for (const slug of ["asleep", "hallucinating", "madness", "sepsis", "pain-shock", "stupid"]) {
    assert.ok(kissAuthority(person(), other({ tags: [tag(slug)] })), `${slug} should refuse`);
  }
});

test("every fiction blocker refuses, from either side", () => {
  for (const slug of KISS_BLOCKING_SLUGS) {
    assert.ok(kissAuthority(person(), other({ tags: [tag(slug)] })), `${slug} target should refuse`);
    assert.ok(kissAuthority(person({ tags: [tag(slug)] }), other()), `${slug} actor should refuse`);
  }
});

test("taste, belief and appearance keep the button", () => {
  for (const slug of ["prudish", "eunuch", "pacifist", "saint", "chaplain", "pious", "ugly", "unhygienic", "disfigured", "leper", "pox", "consumptive", "demoness"]) {
    assert.equal(kissAuthority(person(), other({ tags: [tag(slug)] })), null, `${slug} should be allowed`);
  }
});

test("a covered face refuses both ways, derived from concealsIdentity", () => {
  assert.ok(kissAuthority(person({ tags: [hood()] }), other()));
  assert.ok(kissAuthority(person(), other({ tags: [hood()] })));
  assert.ok(kissAuthority(person(), other({ tags: [hood("brand-new-helm", { name: "Brand New Helm" })] })));
});

test("a hood in the pack is not a hood on the face", () => {
  const stowed = { ...hood(), equipped: false };
  assert.equal(kissAuthority(person(), other({ tags: [stowed] })), null);
});

test("the refusal names the tag rather than saying no", () => {
  const bound = kissBlock(person({ tags: [tag("bound", { name: "Bound" })] }), { self: true });
  assert.match(bound, /Bound/);
  assert.match(kissBlock(person({ tags: [hood()] }), { self: true }), /Hood/);
});

test("nobody kisses themselves, the dead, or somebody across the map", () => {
  const me = person();
  assert.ok(kissAuthority(me, me));
  assert.ok(kissAuthority(person(), other({ status: "DEAD" })));
  assert.ok(kissAuthority(person(), other({ locationId: "loc-2" })));
  assert.ok(kissAuthority(person({ locationId: null }), other()));
});

// The /conceal COLUMN is only a wish (PROXYING.md §5): concealment is what is
// over the face, derived at read time, so a row left `concealed: true` after the
// mask came off is an ordinary bare-faced person. Co-presence no longer refuses
// on the column either — every people-picker reaches a hood now, and the rule
// about mouths is what says no. The mask case is covered above.
test("the conceal column alone is not a covered face", () => {
  assert.equal(kissAuthority(person(), other({ concealed: true })), null);
});

// A refusal must never be an unmasking, so a hooded subject is "They" and the
// helmet is not named back at you.
test("a refusal about somebody hooded never names them", () => {
  const masked = other({ name: "Sir Alder", tags: [hood(), tag("bound", { name: "Bound" })] });
  const refusal = kissAuthority(person(), masked);
  assert.ok(refusal);
  assert.doesNotMatch(refusal, /Alder/);
  assert.match(kissBlock(other({ name: "Sir Alder", tags: [hood()] }), { self: false }), /face covered/);
});

// A bare face can still be a stranger (STRANGERS.md), so a refusal about the
// other person names them only by what the caller says the asker calls them.
test("a refusal about somebody bare-faced names them only as the asker knows them", () => {
  const bound = other({ name: "Bo", tags: [tag("bound", { name: "Bound" })] });
  assert.equal(kissAuthority(person(), bound), "They're Bound.");
  assert.equal(kissAuthority(person(), bound, { seen: "a young man" }), "A young man is Bound.");
  assert.equal(kissAuthority(person(), bound, { seen: "Bo" }), "Bo is Bound.");
});

test("KISS_SELECT carries what the rules actually read", () => {
  for (const field of ["id", "name", "status", "locationId", "concealed", "buriedAt", "discordUserId", "tags", "age", "gender"]) {
    assert.ok(KISS_SELECT[field], `KISS_SELECT is missing ${field}`);
  }
  assert.equal(KISS_SELECT.tags.select.equipped, true);
  for (const field of ["slug", "name", "forcedName", "concealsIdentity", "concealSprite", "forcesConceal", "equipLayer"]) {
    assert.ok(KISS_SELECT.tags.select.tag.select[field], `KISS_SELECT tags missing ${field}`);
  }
});

// ─── The DMs, through a fake database ────────────────────────────────────────
//
// Ada (A) is a young woman, Bo (B) a young man. `known` is each one's Friends
// list, which is all intercept.js#seenBy reads. The transaction's own
// character lookup answers nothing, so applyKissMood moves no dial and the test
// is only about the words.
function fakeDb({ known = {}, rows = {} } = {}) {
  const sent = { audit: [] };
  const offer = {
    findFirst: async () => null,
    create: async ({ data }) => ({ id: "offer-1", ...data }),
    updateMany: async () => ({ count: 1 }),
    update: async () => ({}),
  };
  const auditLog = {
    findFirst: async () => null,
    count: async () => 0,
    create: async ({ data }) => sent.audit.push(data),
    createMany: async ({ data }) => sent.audit.push(...data),
  };
  const tx = { offer, auditLog, character: { findUnique: async () => null } };
  return {
    sent,
    acquaintance: {
      findMany: async ({ where }) =>
        (known[where.ownerId] ?? []).filter((id) => where.subjectId.in.includes(id)).map((subjectId) => ({ subjectId })),
    },
    gameConfig: { findUnique: async () => ({ anonymizeStrangers: true }) },
    turn: { findFirst: async () => null },
    character: { findUnique: async ({ where }) => rows[where.id] ?? null },
    offer,
    auditLog,
    $transaction: async (fn) => fn(tx),
  };
}

const ada = (over = {}) => person({ age: 20, gender: "WOMAN", ...over });
const bo = (over = {}) => other({ age: 20, gender: "MAN", ...over });
const TURN = { id: "turn-1" };
const OFFER = { id: "offer-1", initiatorId: "A", responderId: "B" };

test("the ask names a stranger by what they look like", async () => {
  const { createKissOffer } = require("../lib/kiss");
  const out = await createKissOffer(fakeDb(), { actor: ada(), target: bo(), turn: TURN });
  assert.equal(out.ok, true);
  assert.equal(out.dm.content, "*A young woman* would like to kiss you.");
});

test("the ask names somebody by name once they are on your Friends list", async () => {
  const { createKissOffer } = require("../lib/kiss");
  const out = await createKissOffer(fakeDb({ known: { B: ["A"] } }), { actor: ada(), target: bo(), turn: TURN });
  assert.equal(out.dm.content, "*Ada* would like to kiss you.");
});

test("a refused ask names a stranger by what they look like", async () => {
  const { createKissOffer } = require("../lib/kiss");
  const target = bo({ tags: [tag("bound", { name: "Bound" })] });
  const out = await createKissOffer(fakeDb(), { actor: ada(), target, turn: TURN });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "A young man is Bound.");
});

test("a kiss between strangers names neither of them", async () => {
  const { acceptKiss } = require("../lib/kiss");
  const db = fakeDb({ rows: { A: ada(), B: bo() } });
  const out = await acceptKiss(db, OFFER, { id: "B" });
  assert.equal(out.ok, true);
  // The line is for Bo, who pressed Accept; the DM is for Ada, who asked.
  assert.equal(out.line, "You kissed a young woman.");
  assert.deepEqual(out.dms, [{ discordUserId: "1", content: "A young man kissed you back." }]);
});

test("a kiss between friends names each of them to the other", async () => {
  const { acceptKiss } = require("../lib/kiss");
  const db = fakeDb({ rows: { A: ada(), B: bo() }, known: { A: ["B"], B: ["A"] } });
  const out = await acceptKiss(db, OFFER, { id: "B" });
  assert.equal(out.line, "You kissed Ada.");
  assert.deepEqual(out.dms, [{ discordUserId: "1", content: "Bo kissed you back." }]);
});

test("a kiss that fell through tells each side from where they stand", async () => {
  const { acceptKiss } = require("../lib/kiss");
  const db = fakeDb({ rows: { A: ada(), B: bo({ tags: [tag("bound", { name: "Bound" })] }) } });
  const out = await acceptKiss(db, OFFER, { id: "B" });
  assert.equal(out.ok, false);
  // Bo is the one who is Bound, and Bo is the one reading this line.
  assert.equal(out.reason, "You're Bound.");
  assert.deepEqual(out.dms, [{ discordUserId: "1", content: "Your offer fell through: A young man is Bound." }]);
});

test("the cooldown is two hours", () => {
  assert.equal(KISS_COOLDOWN_MS, 2 * 60 * 60 * 1000);
});
