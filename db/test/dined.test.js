// node --test over db/lib/dined.js — Dined comes from a Lavish meal only, lasts one in-game day however many turns
// that is, and a second lavish meal restarts the day. A fake `tx` stands in for Prisma, so no database is needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { DINED_SLUG, earnsDined, grantDined } = require("../lib/dined");

const DINED_TAG = { id: "tag-dined", slug: DINED_SLUG, name: "Dined" };

// Just enough of a Prisma transaction for grantDined: one Tag lookup, one CharacterTag row per character, and the
// latest Turn for the between-turns fallback.
function fakeTx({ held = null, latestTurn = null, catalog = true } = {}) {
  const rows = held ? [{ id: "ct-1", characterId: "c1", tagId: DINED_TAG.id, ...held }] : [];
  return {
    rows,
    tag: { findUnique: async () => (catalog ? DINED_TAG : null) },
    turn: { findFirst: async () => latestTurn },
    auditLog: { create: async () => ({}) },
    characterTag: {
      findUnique: async ({ where }) =>
        rows.find(
          (r) => r.characterId === where.characterId_tagId.characterId && r.tagId === where.characterId_tagId.tagId,
        ) ?? null,
      create: async ({ data }) => rows.push({ id: `ct-${rows.length + 1}`, ...data }),
      update: async ({ where, data }) => Object.assign(rows.find((r) => r.id === where.id), data),
    },
  };
}

test("only a Lavish meal earns Dined, and never for the Hungerless", () => {
  assert.equal(earnsDined({ mealClass: "LAVISH" }), true);
  assert.equal(earnsDined({ mealClass: "SKILLED" }), false);
  assert.equal(earnsDined({ mealClass: "BASIC" }), false);
  assert.equal(earnsDined({ slug: "foodstuffs" }), false);
  assert.equal(earnsDined(null), false);
  assert.equal(earnsDined({ mealClass: "LAVISH" }, { hungerless: true }), false);
});

test("Dined lasts one in-game day: turnsPerDay turns, else the length's share of 24 hours", async () => {
  const cases = [
    [{ turnsPerDay: 0 }, 24, 10], // one turn a day: gone when this turn closes
    [{ turnsPerDay: 0 }, 6, 13], // four turns a day: this one and three more
    [{ turnsPerDay: 0 }, 12, 11],
    [{ turnsPerDay: 3 }, 24, 12], // the GM's count wins over the length
  ];
  for (const [config, turnLengthHours, expiresTurn] of cases) {
    const tx = fakeTx();
    const name = await grantDined(tx, "c1", { number: 10, turnLengthHours }, config);
    assert.equal(name, "Dined");
    assert.equal(tx.rows.length, 1);
    assert.equal(tx.rows[0].expiresTurn, expiresTurn, `${JSON.stringify(config)} at ${turnLengthHours}h`);
    assert.equal(tx.rows[0].source, "EVENT");
  }
});

test("a second lavish meal restarts the day instead of leaving the first clock running", async () => {
  const tx = fakeTx({ held: { expiresTurn: 13 } });
  await grantDined(tx, "c1", { number: 12, turnLengthHours: 6 }, { turnsPerDay: 0 });
  assert.equal(tx.rows.length, 1, "still one row");
  assert.equal(tx.rows[0].expiresTurn, 15);
});

test("a GM's untimed Dined is left untimed", async () => {
  const tx = fakeTx({ held: { expiresTurn: null } });
  await grantDined(tx, "c1", { number: 12, turnLengthHours: 24 }, { turnsPerDay: 0 });
  assert.equal(tx.rows[0].expiresTurn, null);
});

test("between turns, the day is counted from the turn about to open", async () => {
  const tx = fakeTx({ latestTurn: { number: 7 } });
  // No open turn, so the length comes off the config.
  await grantDined(tx, "c1", null, { turnsPerDay: 0, turnLengthHours: 8 });
  assert.equal(tx.rows[0].expiresTurn, 10); // turns 8, 9 and 10
});

test("no Dined in the catalog grants nothing rather than throwing", async () => {
  const tx = fakeTx({ catalog: false });
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(await grantDined(tx, "c1", { number: 1, turnLengthHours: 24 }, {}), null);
  } finally {
    console.error = quiet;
  }
  assert.equal(tx.rows.length, 0);
});

test("the catalog's Dined has no fixed duration and nothing grants it through consumesInto", () => {
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, "..", "..", "docs", "tags.yaml"), "utf8"));
  const tags = doc.tags ?? doc;
  const dined = tags[DINED_SLUG];
  assert.ok(dined, "docs/tags.yaml has a dined entry");
  assert.equal(dined.durationTurns, undefined, "the grant works out the day's length, so the YAML must not fix one");
  for (const [slug, t] of Object.entries(tags)) {
    if (!t || typeof t !== "object") continue;
    assert.ok(!(t.consumesInto ?? []).includes(DINED_SLUG), `${slug} grants dined through consumesInto`);
  }
});
