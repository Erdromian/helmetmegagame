// The push's half of combat mode (db/lib/combatModePass.js, COMBAT-MODE.md §4): Tired, then
// Exhausted and switched off. A fake database holding characters and their fatigue rows.
const test = require("node:test");
const assert = require("node:assert/strict");

const { TIRED_SLUG, EXHAUSTED_SLUG } = require("../lib/constants");
const { runCombatModeFatiguePass, COMBAT_MODE_NOTICE } = require("../lib/combatModePass");

const TAGS = {
  [TIRED_SLUG]: { id: "t-tired", defaultDurationTurns: 1 },
  [EXHAUSTED_SLUG]: { id: "t-exhausted", defaultDurationTurns: 1 },
};
const SLUG_OF = { "t-tired": TIRED_SLUG, "t-exhausted": EXHAUSTED_SLUG };

function fakeDb(characters) {
  // characters: [{ id, since, held: [slug] }]
  const people = new Map(characters.map((c) => [c.id, { ...c, rows: (c.held ?? []).map((slug, i) => ({ id: `${c.id}-${i}`, slug })) }]));
  let next = 0;
  const db = {
    people,
    tag: { findUnique: async ({ where }) => TAGS[where.slug] ?? null },
    character: {
      findMany: async ({ where }) =>
        [...people.values()]
          .filter((p) => (where.combatModeSinceTurn ? p.since != null : true))
          .map((p) => ({ id: p.id, discordUserId: `u-${p.id}`, tags: p.rows.map((r) => ({ id: r.id, tag: { slug: r.slug } })) })),
      update: async ({ where, data }) => Object.assign(people.get(where.id), { since: data.combatModeSinceTurn }),
    },
    characterTag: {
      delete: async ({ where }) => {
        for (const p of people.values()) p.rows = p.rows.filter((r) => r.id !== where.id);
      },
      createMany: async ({ data }) => {
        for (const d of data) {
          const p = people.get(d.characterId);
          const slug = SLUG_OF[d.tagId];
          if (p.rows.some((r) => r.slug === slug)) continue;
          p.rows.push({ id: `new-${next++}`, slug, expiresTurn: d.expiresTurn });
        }
        return { count: data.length };
      },
    },
    $transaction: async (fn) => fn(db),
  };
  return db;
}

const slugs = (db, id) => db.people.get(id).rows.map((r) => r.slug).sort();

test("a push in combat mode makes you Tired and leaves it on", async () => {
  const db = fakeDb([{ id: "ada", since: 4 }]);
  const out = await runCombatModeFatiguePass(db, { number: 5 });
  assert.deepEqual(slugs(db, "ada"), [TIRED_SLUG]);
  assert.equal(db.people.get("ada").since, 4);
  // Granted to outlast this push's sweep: expires at the NEXT push.
  assert.equal(db.people.get("ada").rows[0].expiresTurn, 6);
  assert.deepEqual(out.notices, [{ discordUserId: "u-ada", content: COMBAT_MODE_NOTICE[TIRED_SLUG] }]);
  assert.equal(out.tired, 1);
  assert.equal(out.switchedOff, 0);
});

test("already Tired steps up to Exhausted, and combat mode turns off", async () => {
  const db = fakeDb([{ id: "ada", since: 4, held: [TIRED_SLUG] }]);
  const out = await runCombatModeFatiguePass(db, { number: 5 });
  assert.deepEqual(slugs(db, "ada"), [EXHAUSTED_SLUG], "the Tired row is consumed by the step");
  assert.equal(db.people.get("ada").since, null);
  assert.equal(out.exhausted, 1);
  assert.equal(out.switchedOff, 1);
  assert.equal(out.notices[0].content, COMBAT_MODE_NOTICE[EXHAUSTED_SLUG]);
});

test("already Exhausted grants nothing more, but still turns it off", async () => {
  const db = fakeDb([{ id: "ada", since: 4, held: [EXHAUSTED_SLUG] }]);
  const out = await runCombatModeFatiguePass(db, { number: 5 });
  assert.deepEqual(slugs(db, "ada"), [EXHAUSTED_SLUG]);
  assert.equal(db.people.get("ada").since, null);
  assert.equal(out.switchedOff, 1);
  assert.equal(out.notices[0].content, COMBAT_MODE_NOTICE.already);
});

test("nobody out of combat mode is touched", async () => {
  const db = fakeDb([{ id: "bob", since: null, held: [TIRED_SLUG] }]);
  const out = await runCombatModeFatiguePass(db, { number: 5 });
  assert.deepEqual(slugs(db, "bob"), [TIRED_SLUG]);
  assert.deepEqual(out.notices, []);
});

test("two pushes in a row: Tired, then Exhausted and off", async () => {
  const db = fakeDb([{ id: "ada", since: 4 }]);
  await runCombatModeFatiguePass(db, { number: 5 });
  await runCombatModeFatiguePass(db, { number: 6 });
  assert.deepEqual(slugs(db, "ada"), [EXHAUSTED_SLUG]);
  assert.equal(db.people.get("ada").since, null);
});

test("a missing catalog tag bails without touching anyone", async () => {
  const db = fakeDb([{ id: "ada", since: 4 }]);
  db.tag.findUnique = async () => null;
  const original = console.error;
  console.error = () => {};
  try {
    const out = await runCombatModeFatiguePass(db, { number: 5 });
    assert.deepEqual(out.notices, []);
  } finally {
    console.error = original;
  }
  assert.deepEqual(slugs(db, "ada"), []);
});

test("a Bloodcrazed or Wight Vampire is never tired by it: the query leaves them out", async () => {
  let asked = null;
  const db = fakeDb([{ id: "ada", since: 4 }]);
  const realMany = db.character.findMany;
  db.character.findMany = async (args) => {
    asked = args;
    return realMany(args);
  };
  await runCombatModeFatiguePass(db, { number: 5 });
  assert.deepEqual([...asked.where.tags.none.tag.slug.in].sort(), ["bloodcrazed", "wight"]);
  assert.deepEqual(asked.where.tags.none.quantity, { gt: 0 });
});
