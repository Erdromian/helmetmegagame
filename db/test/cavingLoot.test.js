// node --test over the pure half of db/lib/cavingLoot.js — the weight columns and
// the two draws. Run with `npm test --workspace=db`. validateCavingLoot's OTHER
// job, checking every slug against the live Tag catalog, needs a database and runs
// at process startup instead (bot/src/index.js, web's instrumentation hook).
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PROSPECTING_TABLE,
  PROSPECTING_WEIGHTS_BY_ZONE,
  PROSPECTING_SKILLED_WEIGHTS_BY_ZONE,
  GATHERING_TABLE,
  GATHERING_WEIGHTS_BY_ZONE,
  drawProspectingLoot,
  validateCavingLoot,
} = require("../lib/cavingLoot");
const { GATHERING_ZONE_SLUGS } = require("../lib/gathering");
const { describeMoveEffects } = require("../lib/moveEffects");

const TIERS = ["ultracommon", "common", "uncommon", "rare", "extremely-rare", "nearly-impossible"];

// The same check validateCavingLoot makes at boot, run here so a bad column fails
// `npm test` rather than waiting for somebody to start the web app.
for (const [name, map] of Object.entries({
  PROSPECTING_WEIGHTS_BY_ZONE,
  PROSPECTING_SKILLED_WEIGHTS_BY_ZONE,
  GATHERING_WEIGHTS_BY_ZONE,
})) {
  for (const [zoneSlug, weights] of Object.entries(map)) {
    test(`${name}["${zoneSlug}"] sums to 1`, () => {
      const sum = TIERS.reduce((total, tier) => total + (weights[tier] ?? 0), 0);
      assert.ok(Math.abs(sum - 1) < 1e-6, `sums to ${sum}`);
    });
  }
}

// What the skill actually buys on the loot side. Weight at or above `rare` is the
// honest measure — "better" means the good tiers get likelier, not that ultracommon
// merely gets rarer.
test("the skilled column is richer at every good tier, in both zones", () => {
  for (const zone of ["caves", "depths"]) {
    const plain = PROSPECTING_WEIGHTS_BY_ZONE[zone];
    const skilled = PROSPECTING_SKILLED_WEIGHTS_BY_ZONE[zone];
    for (const tier of ["uncommon", "rare", "extremely-rare", "nearly-impossible"]) {
      assert.ok(skilled[tier] > plain[tier], `${zone} ${tier}: ${skilled[tier]} > ${plain[tier]}`);
    }
    assert.ok(skilled.ultracommon < plain.ultracommon, `${zone} ultracommon falls`);
  }
});

test("every tier the weights name has something in it to draw", () => {
  for (const tier of TIERS) {
    assert.ok(Array.isArray(PROSPECTING_TABLE[tier]), `${tier} is a list`);
    assert.ok(PROSPECTING_TABLE[tier].length > 0, `${tier} is not empty`);
  }
});

// The absence IS the rule (see the file header): a zone on neither table draws
// nothing, and the skill does not buy a column where there is none. Null rather
// than a throw, unlike drawLoot's own zone miss.
test("a zone with no column draws nothing rather than throwing, skilled or not", () => {
  assert.equal(drawProspectingLoot("town"), null);
  assert.equal(drawProspectingLoot("town", { prospecting: true }), null);
  assert.equal(drawProspectingLoot("forest"), null);
});

// The gathering table (MINING.md §3c). Every gathering zone has a column, and
// every column names a gathering zone — a column for a zone that mines would
// quietly turn its ore into onions.
test("the gathering columns and the gathering zones are the same list", () => {
  assert.deepEqual(Object.keys(GATHERING_WEIGHTS_BY_ZONE).sort(), [...GATHERING_ZONE_SLUGS].sort());
});

test("every gathering tier has something in it, and every entry is a stack of at least one", () => {
  for (const tier of TIERS) {
    assert.ok(Array.isArray(GATHERING_TABLE[tier]) && GATHERING_TABLE[tier].length > 0, `${tier} is not empty`);
    for (const entry of GATHERING_TABLE[tier]) {
      assert.equal(typeof entry.slug, "string", `${tier} entry names a slug`);
      assert.ok(Number.isInteger(entry.quantity) && entry.quantity >= 1, `${tier} ${entry.slug} quantity`);
    }
  }
});

// What the Black Hills give up is food, and Prospecting reads ore: the skill
// changes nothing up there, and no draw ever reaches the stone table.
test("a gathering zone draws food off the gathering table, skilled or not, with its stack size", () => {
  const stoneSlugs = new Set(Object.values(PROSPECTING_TABLE).flat());
  for (const prospecting of [false, true]) {
    for (let i = 0; i < 300; i++) {
      const drawn = drawProspectingLoot("hills", { prospecting });
      assert.ok(TIERS.includes(drawn.tier), `tier ${drawn.tier}`);
      const entry = GATHERING_TABLE[drawn.tier].find((e) => e.slug === drawn.slug && e.quantity === drawn.quantity);
      assert.ok(entry, `${drawn.slug} ×${drawn.quantity} is on the ${drawn.tier} rung`);
      assert.ok(!stoneSlugs.has(drawn.slug), `${drawn.slug} is not a stone`);
    }
  }
});

test("a stone table draw is always a single unit", () => {
  for (let i = 0; i < 100; i++) {
    assert.equal(drawProspectingLoot("caves").quantity, 1);
    assert.equal(drawProspectingLoot("depths", { prospecting: true }).quantity, 1);
  }
});

test("a draw always lands on a real tier and a real slug", () => {
  for (const zone of ["caves", "depths"]) {
    for (const prospecting of [false, true]) {
      for (let i = 0; i < 200; i++) {
        const drawn = drawProspectingLoot(zone, { prospecting });
        assert.ok(TIERS.includes(drawn.tier), `tier ${drawn.tier}`);
        assert.ok(PROSPECTING_TABLE[drawn.tier].includes(drawn.slug), `slug ${drawn.slug}`);
      }
    }
  }
});

test("an unskilled draw defaults to the plain column", () => {
  // Same shape either way — the point of the assertion is that the argument is
  // optional, since moveEffects.js is not the only caller shape this has had.
  const drawn = drawProspectingLoot("caves");
  assert.ok(TIERS.includes(drawn.tier));
});

// Lucky's two draws (MINING.md §3b). Math.random is fed by hand, two numbers a
// draw: the first lands the tier, the second picks inside it.
function withRandoms(values, fn) {
  const real = Math.random;
  const queue = [...values];
  Math.random = () => {
    assert.ok(queue.length > 0, "drew more often than expected");
    return queue.shift();
  };
  try {
    return fn();
  } finally {
    Math.random = real;
    assert.equal(queue.length, 0, "drew fewer times than expected");
  }
}

test("a Lucky draw keeps the rarer of two, whichever came first", () => {
  // 0.0 lands ultracommon, 0.999 lands nearly-impossible, on any column.
  assert.equal(withRandoms([0, 0, 0.999, 0], () => drawProspectingLoot("depths", { lucky: true })).tier, "nearly-impossible");
  assert.equal(withRandoms([0.999, 0, 0, 0], () => drawProspectingLoot("depths", { lucky: true })).tier, "nearly-impossible");
  assert.equal(withRandoms([0, 0, 0.999, 0], () => drawProspectingLoot("hills", { lucky: true })).tier, "nearly-impossible");
});

test("a Lucky tie keeps the first draw", () => {
  const drawn = withRandoms([0, 0, 0, 0.99], () => drawProspectingLoot("caves", { lucky: true }));
  assert.equal(drawn.slug, PROSPECTING_TABLE.ultracommon[0]);
});

test("without Lucky there is one draw, and a zone with no column draws none", () => {
  withRandoms([0.999, 0], () => drawProspectingLoot("depths"));
  withRandoms([], () => drawProspectingLoot("town", { lucky: true }));
});

test("Lucky makes the good tiers likelier", () => {
  const N = 20000;
  const rareOrBetter = (lucky) => {
    let hits = 0;
    for (let i = 0; i < N; i++) {
      if (TIERS.indexOf(drawProspectingLoot("depths", { prospecting: true, lucky }).tier) >= TIERS.indexOf("rare")) hits++;
    }
    return hits / N;
  };
  // 38% plain against 1 − 0.62² ≈ 61.6% Lucky; the margins are many standard errors wide.
  const plain = rareOrBetter(false);
  const lucky = rareOrBetter(true);
  assert.ok(plain > 0.34 && plain < 0.42, `plain ${plain}`);
  assert.ok(lucky > 0.57 && lucky < 0.66, `lucky ${lucky}`);
});

// gathering.js is what says a zone gathers; the draw asks it rather than reading
// the weight map's keys. A gathering zone somebody forgot to weight draws
// nothing (never a stone), and the boot check refuses it outright.
test("a gathering zone with no column draws nothing and fails the boot check", async () => {
  GATHERING_ZONE_SLUGS.push("marsh");
  try {
    for (const prospecting of [false, true]) assert.equal(drawProspectingLoot("marsh", { prospecting }), null);
    const allSlugs = (table) => Object.values(table).flat().map((e) => (typeof e === "string" ? e : e.slug));
    const prisma = {
      tag: {
        findMany: async () =>
          [...allSlugs(PROSPECTING_TABLE), ...allSlugs(GATHERING_TABLE), ...allSlugs(require("../lib/cavingLoot").LOOT_TABLE)].map((slug) => ({ slug })),
      },
    };
    await assert.rejects(validateCavingLoot(prisma), /marsh/);
  } finally {
    GATHERING_ZONE_SLUGS.pop();
  }
});

// The desk and the sheet print the stack a gathering press actually granted.
test("a gathered stack prints its size on the desk; a single find does not", () => {
  assert.equal(describeMoveEffects({ miningDrop: { kind: "TAG", tagName: "Onion", quantity: 2 } }), "found Onion ×2");
  assert.equal(describeMoveEffects({ miningDrop: { kind: "TAG", tagName: "Honey", quantity: 1 } }), "found Honey");
  assert.equal(describeMoveEffects({ miningDrop: { kind: "TAG", tagName: "Opal" } }), "found Opal");
});

// The Mine press reads Lucky off the character and hands it to the draw. A fake
// tx is enough: the found tag is non-stackable and already held, so addToStack
// returns before it writes anything.
test("a Mine press draws twice for a Lucky holder and once for anybody else", async () => {
  const { MOVE_EFFECTS } = require("../lib/moveEffects");
  const fakeTx = (heldSlugs) => ({
    zone: { findUnique: async () => ({ slug: "depths" }) },
    characterTag: {
      findMany: async ({ where }) => heldSlugs.filter((s) => where.tag.slug.in.includes(s)).map((slug) => ({ tag: { slug } })),
      findUnique: async () => ({ id: "held" }),
    },
    tag: { findUnique: async ({ where }) => ({ id: where.slug, slug: where.slug, name: where.slug, stackable: false, defaultDurationTurns: null }) },
  });
  const action = { zoneId: "z", characterId: "c", turnId: "t" };
  // withRandoms is synchronous, and apply awaits before it draws, so the queue is fed by hand here.
  const press = async (heldSlugs, randoms) => {
    const real = Math.random;
    const queue = [...randoms];
    Math.random = () => queue.shift();
    try {
      return await MOVE_EFFECTS.miningDrop.apply(fakeTx(heldSlugs), action);
    } finally {
      Math.random = real;
      assert.equal(queue.length, 0, "drew a different number of times than expected");
    }
  };

  const lucky = await press(["lucky"], [0, 0, 0.999, 0]);
  assert.equal(lucky.tier, "nearly-impossible");
  const plain = await press(["prospecting"], [0, 0]);
  assert.equal(plain.tier, "ultracommon");
});
