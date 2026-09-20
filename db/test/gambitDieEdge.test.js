// db/lib/gambitDie.js — which traits pull the Gambit die, and which way.
// Lucky reaches every d6 a character throws; Misfortune reaches this one only,
// so the pair is named here rather than inside rollWithAdvantage. Prisma is
// faked: the only write is one GambitDie row.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { ensureGambitDie } = require("../lib/gambitDie");
const { rollWithAdvantage } = require("../lib/advantage");

const held = (...slugs) => slugs.map((slug) => ({ tag: { slug } }));

// Records the row it was handed, and always claims the throw.
function fakeTx() {
  const written = [];
  return {
    written,
    gambitDie: {
      createMany: async ({ data }) => {
        written.push(data[0]);
        return { count: 1 };
      },
      findUnique: async () => null,
    },
  };
}

async function throwDie(tags) {
  const tx = fakeTx();
  const result = await ensureGambitDie(tx, { turnId: "t1", character: { id: "c1", tags } });
  return { result, row: tx.written[0] };
}

test("no trait: one die, nobody named", async () => {
  for (let i = 0; i < 50; i++) {
    const { result, row } = await throwDie(held("brave"));
    assert.equal(result.rolls.length, 1);
    assert.equal(result.die, result.rolls[0]);
    assert.equal(result.source, null);
    assert.equal(row.advantageSource, null);
  }
});

test("Misfortune: two dice, the worse one counts", async () => {
  for (let i = 0; i < 100; i++) {
    const { result, row } = await throwDie(held("misfortune"));
    assert.equal(result.rolls.length, 2);
    assert.equal(result.die, Math.min(...result.rolls));
    assert.equal(result.source, "misfortune");
    assert.equal(row.advantageSource, "misfortune");
    assert.equal(row.die, result.die);
  }
});

test("Lucky still does what it did: two dice, the better one counts", async () => {
  for (let i = 0; i < 100; i++) {
    const { result, row } = await throwDie(held("lucky"));
    assert.equal(result.rolls.length, 2);
    assert.equal(result.die, Math.max(...result.rolls));
    assert.equal(result.source, "lucky");
    assert.equal(row.advantageSource, "lucky");
  }
});

test("Lucky and Misfortune together cancel to a plain single die", async () => {
  for (let i = 0; i < 100; i++) {
    const { result, row } = await throwDie(held("lucky", "misfortune"));
    assert.equal(result.rolls.length, 1);
    assert.equal(result.source, null);
    assert.equal(row.advantageSource, null);
  }
});

test("Misfortune reaches the Gambit die ALONE, not every other d6", () => {
  // rollWithAdvantage is what Search, Steal, Torture, Caving and the rest throw
  // through. Misfortune must be invisible to it, or the tag quietly becomes a
  // general curse and its own description stops being true.
  for (let i = 0; i < 100; i++) {
    const r = rollWithAdvantage(held("misfortune"), 6);
    assert.equal(r.rolls.length, 1);
    assert.equal(r.advantage, false);
    assert.equal(r.source, null);
  }
});

test("the Misfortune tag in the master says what the code does", () => {
  const tags = yaml.load(fs.readFileSync(path.join(__dirname, "../../docs/tags.yaml"), "utf8")).tags;
  const entry = tags.misfortune;
  assert.ok(entry, "misfortune is missing from docs/tags.yaml");
  assert.equal(entry.name, "Misfortune");
  assert.equal(entry.pointCost, -6);
  assert.match(entry.description, /Gambits/);
  // Lucky is the thing it is priced against; if Lucky moves, revisit TAGS.md 4a.
  assert.equal(tags.lucky.pointCost, 15);
});
