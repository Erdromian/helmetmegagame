// Xom's table, and the one thing it is easy to get wrong.
//
// WHAT A FAILURE HERE MEANS. db/lib/xom.js holds the weights and
// db/lib/xomPass.js holds a switch that acts on them, and nothing but this
// file makes the two agree. A row added to the table with no arm in the switch
// falls through to `default` and does nothing — silently, once in a hundred
// closes, for one player, at four in the morning. The key-set assertion below
// is the whole reason this file exists; the boundary cases are the cheap part.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  XOM_OUTCOMES,
  XOM_TOTAL_WEIGHT,
  XOM_SHOUTS,
  pickXomOutcome,
  pickShout,
} = require("../lib/xom");

test("the weights are Bascinet's numbers, unnormalised", () => {
  assert.equal(XOM_TOTAL_WEIGHT, 101.5);
  // Half a unit is the row that cannot be expressed by repeating an entry the
  // way docs/labordrops.yaml does — it is why this table carries numbers.
  assert.equal(XOM_OUTCOMES.find((row) => row.id === "madness").weight, 0.5);
  assert.equal(XOM_OUTCOMES.find((row) => row.id === "nothing").weight, 50);
  assert.equal(
    XOM_OUTCOMES.every((row) => row.weight > 0),
    true,
    "a zero-weight row is unreachable and should be deleted rather than left in",
  );
});

test("every outcome is reachable, and only within its own band", () => {
  let floor = 0;
  for (const row of XOM_OUTCOMES) {
    const ceiling = floor + row.weight;
    // Just inside the bottom of the band, the middle, and just inside the top.
    for (const point of [floor + 1e-9, (floor + ceiling) / 2, ceiling - 1e-9]) {
      assert.equal(
        pickXomOutcome(() => point / XOM_TOTAL_WEIGHT),
        row.id,
        `${point} should land in ${row.id}`,
      );
    }
    floor = ceiling;
  }
  assert.equal(floor, XOM_TOTAL_WEIGHT);
});

test("a boundary belongs to the row after it, and 1 does not fall off the end", () => {
  // The first row's weight is 50; exactly 50/101.5 is the START of the second.
  const firstWeight = XOM_OUTCOMES[0].weight;
  assert.equal(pickXomOutcome(() => firstWeight / XOM_TOTAL_WEIGHT), XOM_OUTCOMES[1].id);
  // Math.random() never returns 1, but a stubbed rng might, and a turn close
  // must not die on it.
  assert.equal(pickXomOutcome(() => 1), XOM_OUTCOMES[XOM_OUTCOMES.length - 1].id);
  assert.equal(pickXomOutcome(() => 0), XOM_OUTCOMES[0].id);
});

test("every shout is reachable and the picker never falls off the end", () => {
  const seen = new Set();
  for (let i = 0; i < XOM_SHOUTS.length; i += 1) {
    seen.add(pickShout(() => (i + 0.5) / XOM_SHOUTS.length));
  }
  assert.equal(seen.size, XOM_SHOUTS.length);
  assert.equal(typeof pickShout(() => 1), "string");
});

// The one that matters. Read the pass's switch out of the source rather than
// running it: driving thirteen outcomes through a fake Prisma would test the
// fake, and what is actually at risk is a row and an arm drifting apart.
test("the pass has an arm for every row in the table", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "xomPass.js"), "utf8");
  const arms = new Set([...source.matchAll(/case "([a-z]+)":/g)].map((m) => m[1]));
  for (const row of XOM_OUTCOMES) {
    assert.equal(
      arms.has(row.id),
      true,
      `db/lib/xomPass.js has no "case ${row.id}" — that outcome would silently do nothing`,
    );
  }
  for (const arm of arms) {
    assert.equal(
      XOM_OUTCOMES.some((row) => row.id === arm),
      true,
      `db/lib/xomPass.js handles "${arm}", which is not in the table`,
    );
  }
});

test("the notices are keyed by outcome id, and the silent ones are silent on purpose", () => {
  const { NOTICES } = require("../lib/xomPass");
  const ids = new Set(XOM_OUTCOMES.map((row) => row.id));
  for (const key of Object.keys(NOTICES)) {
    assert.equal(ids.has(key), true, `NOTICES has "${key}", which is not an outcome`);
  }
  // "nothing" says nothing. The gib's letter is the shared death loop's, and
  // the mass madness reaches its victims rather than the roller — neither
  // belongs here.
  for (const silent of ["nothing", "gib", "madness"]) {
    assert.equal(NOTICES[silent], undefined, `"${silent}" must not DM the roller`);
  }
});

test("every notice the pass writes carries a draft mark", () => {
  // CLAUDE.md's prime directive: prose Claude wrote gets a trailing ‡ so the
  // rewrite pass can find it. Bascinet's own lines (the seven shouts, the
  // conversation opener, the feces line, the madness line) must NOT — they
  // come from db/lib/xom.js and are asserted the other way below.
  const { NOTICES, GIB_REASON } = require("../lib/xomPass");
  const { XOM_FECES_LINE } = require("../lib/xom");
  for (const [id, line] of Object.entries(NOTICES)) {
    if (line === XOM_FECES_LINE) continue; // Bascinet's words, no mark
    assert.equal(line.endsWith("‡"), true, `the "${id}" notice is unmarked drafted prose`);
  }
  assert.equal(GIB_REASON.endsWith("‡"), true);
});

test("Bascinet's own lines are left alone", () => {
  const { XOM_LONELY_LINE, XOM_FECES_LINE, XOM_MADNESS_LINE } = require("../lib/xom");
  for (const line of [XOM_LONELY_LINE, XOM_FECES_LINE, XOM_MADNESS_LINE, ...XOM_SHOUTS]) {
    assert.equal(line.includes("‡"), false, `"${line}" is Bascinet's and must carry no mark`);
  }
});
