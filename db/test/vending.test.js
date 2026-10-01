// node --test over db/lib/vending.js and db/lib/vendingText.js — the Merchant's
// vending machine (docs/systemdocs/VENDING.md). Run with `npm test --workspace=db`.
//
// Nothing here touches Prisma, the db/test/phone.test.js posture: the hold's
// clock and the price guard are pure, and everything that moves money is behind
// them. What a database has to answer instead — that two people cannot hold the
// same machine — is answered by a unique index and a conditional update, so it
// is the migration's job and an end-to-end check's, not a unit test's.
const test = require("node:test");
const assert = require("node:assert/strict");
const { heldBy, secondsLeftOn, unlockedNow, validPrice, timeLeftLine, countOf, oneOf } = require("../lib/vending");
const { roomAffordances } = require("../lib/placeAffordances");
const { VENDING_HOLD_MS, VENDING_MAX_PRICE, VENDING_TEXT } = require("../lib/vendingText");

const NOW = 1_700_000_000_000;
const at = (msAgo) => ({ holderId: "ada", holderSince: new Date(NOW - msAgo), unlocked: false });

// --- the hold is derived, never stored ----------------------------------

test("a hold is live until five minutes have passed, and then it is not", () => {
  assert.equal(heldBy(at(0), NOW), "ada", "just taken");
  assert.equal(heldBy(at(VENDING_HOLD_MS - 1), NOW), "ada", "a millisecond to spare");
  assert.equal(heldBy(at(VENDING_HOLD_MS), NOW), null, "the boundary is exclusive");
  assert.equal(heldBy(at(VENDING_HOLD_MS * 2), NOW), null, "long gone");
});

test("a machine nobody has taken is free, and a half-written row is too", () => {
  assert.equal(heldBy({ holderId: null, holderSince: null }, NOW), null);
  assert.equal(heldBy({ holderId: "ada", holderSince: null }, NOW), null, "no clock, no hold");
  assert.equal(heldBy({ holderId: null, holderSince: new Date(NOW) }, NOW), null, "no holder, no hold");
  assert.equal(heldBy(null, NOW), null);
  assert.equal(heldBy(undefined, NOW), null);
});

// This is the property the whole feature leans on: the bot being down for six
// minutes must not hand somebody an extra six. Nothing increments, so nothing
// can fall behind.
test("the clock runs off holderSince alone, so a sweep that never ran costs nobody time", () => {
  const stale = at(VENDING_HOLD_MS + 60_000);
  assert.equal(heldBy(stale, NOW), null, "free the instant it expired, swept or not");
  assert.equal(secondsLeftOn(stale, NOW), 0);
});

test("the countdown falls to zero and never below it", () => {
  assert.equal(secondsLeftOn(at(0), NOW), VENDING_HOLD_MS / 1000);
  assert.equal(secondsLeftOn(at(60_000), NOW), 240);
  assert.equal(secondsLeftOn(at(VENDING_HOLD_MS), NOW), 0);
  assert.equal(secondsLeftOn(at(VENDING_HOLD_MS * 10), NOW), 0);
  assert.equal(secondsLeftOn({ holderId: null, holderSince: null }, NOW), 0);
});

test("the countdown reads in minutes while there are minutes left", () => {
  assert.equal(timeLeftLine(at(0), NOW), VENDING_TEXT.timeLeftLong(5));
  assert.equal(timeLeftLine(at(4 * 60_000 + 30_000), NOW), VENDING_TEXT.timeLeft(30));
  assert.equal(timeLeftLine(at(VENDING_HOLD_MS), NOW), VENDING_TEXT.timeLeft(0));
});

// --- unlocked is never a column on its own ------------------------------

// The rule that stops a crashed process, a dead merchant or a run-out clock
// leaving the shop standing open. No sweep has to run for the front to be shut.
test("the front is shut the moment the hold dies, whatever the column says", () => {
  const open = { holderId: "ada", holderSince: new Date(NOW), unlocked: true };
  const expired = { holderId: "ada", holderSince: new Date(NOW - VENDING_HOLD_MS), unlocked: true };
  const abandoned = { holderId: null, holderSince: null, unlocked: true };

  assert.equal(unlockedNow(open, NOW), true);
  assert.equal(unlockedNow(expired, NOW), false, "an expired hold cannot hold the shop open");
  assert.equal(unlockedNow(abandoned, NOW), false, "nor can a stranded unlocked flag");
  assert.equal(unlockedNow({ ...open, unlocked: false }, NOW), false);
});

// --- prices --------------------------------------------------------------

test("a price is a whole number of obols from 0 to the cap, and 0 means free", () => {
  assert.equal(validPrice(0), 0, "free is a price, not a refusal");
  assert.equal(validPrice(1), 1);
  assert.equal(validPrice(VENDING_MAX_PRICE), VENDING_MAX_PRICE);
  assert.equal(validPrice("7"), 7, "a Discord modal hands over a string");
  assert.equal(validPrice(7.8), 7, "truncated, not rounded up — nobody is overcharged by a decimal");
});

test("a price that is not one is refused rather than clamped", () => {
  assert.equal(validPrice(-1), null);
  assert.equal(validPrice(VENDING_MAX_PRICE + 1), null, "the cap keeps a typo off the ledger's int4");
  assert.equal(validPrice("abc"), null);
  assert.equal(validPrice(Infinity), null);
  assert.equal(validPrice(NaN), null);
});

// Number(null), Number("") and Number(false) are all 0, so a naive guard reads
// an empty modal field as "free" and gives the merchant's stock away. A missing
// price is a refusal; a caller that means free passes 0 itself.
test("a missing price is refused, not read as free", () => {
  assert.equal(validPrice(null), null);
  assert.equal(validPrice(undefined), null);
  assert.equal(validPrice(""), null);
  assert.equal(validPrice("   "), null);
  assert.equal(validPrice(false), null);
  assert.equal(validPrice(true), null);
});

// --- the button ----------------------------------------------------------

test("the Machine button is on a room with a machine and nowhere else", () => {
  const labels = (room) => roomAffordances(room).map((a) => a.label);
  assert.ok(labels({ id: "r", slug: "undertown-6-1", vendingMachine: true }).includes(VENDING_TEXT.btnOpen));
  assert.equal(labels({ id: "r", slug: "undertown-6-1" }).includes(VENDING_TEXT.btnOpen), false);
  // Resolved off the COLUMN, never the slug — so moving the shop is a YAML edit.
  assert.ok(labels({ id: "r", slug: "anywhere-else", vendingMachine: true }).includes(VENDING_TEXT.btnOpen));
});

test("the machine's custom id carries the room, so one handler serves every machine", () => {
  const [entry] = roomAffordances({ id: "room123", slug: "x", vendingMachine: true }).filter(
    (a) => a.id === "vending",
  );
  assert.equal(entry.customId, "room:vending:room123");
});

// --- the ledger ----------------------------------------------------------

// Caught against a real database: insertCoins, withdrawCoins and collectTill
// each called record() BESIDE a tagWrites primitive, and the primitive's hook
// already books the whole from -> to row off the `econ` option. The machine's
// ledger read exactly double its live balance. A full end-to-end check needs
// Postgres, so what is pinned here is the shape that caused it.
test("the engine books money through the tag hook alone, never a second record()", () => {
  const src = require("node:fs").readFileSync(require.resolve("../lib/vending"), "utf8");
  // The one line that would have to change for the bug to come back: the
  // destructure off economyLedger. `record` not being in scope is what makes a
  // stray call impossible rather than merely absent.
  const importLine = src.split(/\r?\n/).find((l) => l.includes('require("./economyLedger")'));
  assert.ok(importLine, "vending.js should still import from economyLedger");
  assert.equal(
    /\brecord\b/.test(importLine),
    false,
    `record must not be imported into vending.js — calling it beside a tagWrites primitive books the same money twice. Line was: ${importLine}`,
  );
});

// --- the words -----------------------------------------------------------

// The copy has to be importable from a client component, which is the whole
// reason it lives in its own file (db/lib/slotText.js says the same).
// In a CHILD process, because this file has already required db/lib/vending.js
// and pulled Prisma in with it — asking the live require.cache would always
// fail, and asking it before that require would always pass by accident.
test("the text module drags no Prisma in behind it", () => {
  const { execFileSync } = require("node:child_process");
  const probe =
    "require('./db/lib/vendingText');" +
    "const bad = Object.keys(require.cache).filter((k) => /[\\\\/]@prisma[\\\\/]/.test(k));" +
    "console.log(bad.length);";
  const out = execFileSync(process.execPath, ["-e", probe], {
    cwd: require("node:path").join(__dirname, "..", ".."),
    encoding: "utf8",
  });
  assert.equal(out.trim(), "0", "vendingText.js must stay zero-require, or /chat crashes on open");
});

test("every price and pool is written in coin, never in Resources", () => {
  // ¢ is the money and ⬢ is the material, and swapping them is quiet (CLAUDE.md).
  const moneyLines = [
    VENDING_TEXT.floatLine(8),
    VENDING_TEXT.tillLine(12),
    VENDING_TEXT.slotRow("Bone Saw", 40, 2),
    VENDING_TEXT.notEnough(40, 8),
    VENDING_TEXT.youInserted(5, 13),
    VENDING_TEXT.youWithdrew(8),
    VENDING_TEXT.youBought("A Bone Saw", 40, 3),
    VENDING_TEXT.youBoughtFree("A Tea", 8),
    VENDING_TEXT.youCollected(12),
    VENDING_TEXT.youStockedIn("2 × Tea", 6),
  ];
  for (const line of moneyLines) {
    assert.ok(line.includes("¢"), `"${line}" should price in ¢`);
    assert.equal(line.includes("⬢"), false, `"${line}" must not use the Resources glyph`);
  }
});

// ⬢ go on the shelf like any ware, and the glyph replaces the word rather than
// sitting beside it (CLAUDE.md): "5 ⬢ on the shelf", never "5 × Resources".
test("a shelf of Resources is counted in ⬢ and priced in ¢", () => {
  const resources = { slug: "resources", name: "Resources" };
  const tea = { slug: "tea", name: "Tea" };
  assert.equal(countOf(resources, 5), "5 ⬢");
  assert.equal(countOf(tea, 2), "2 × Tea");
  assert.equal(oneOf(resources), "1 ⬢");
  assert.equal(oneOf(tea), "a Tea");
  assert.equal(VENDING_TEXT.youStockedIn(countOf(resources, 5), 2), "5 ⬢ on the shelf, at 2 ¢ each.");
  assert.equal(VENDING_TEXT.youStockedOut(countOf(resources, 3)), "3 ⬢ back in your hands.");
  assert.equal(VENDING_TEXT.youBought(oneOf(resources), 2, 0), "1 ⬢, for 2 ¢. 0 ¢ left.");
  assert.equal(VENDING_TEXT.roomBoughtNamed("Ada", oneOf(resources)), "Ada takes 1 ⬢ out of the vendor.");
  assert.equal(VENDING_TEXT.dontHave(countOf(resources, 3, { markdown: false })), "You're carrying 3 ⬢.");
  // Every other ware reads exactly as it did.
  assert.equal(VENDING_TEXT.roomBoughtNamed("Ada", oneOf(tea)), "Ada takes a Tea out of the vendor.");
  assert.equal(VENDING_TEXT.youStockedIn(countOf(tea, 2), 6), "2 × Tea on the shelf, at 6 ¢ each.");
});

// A refusal is drawn as plain text, so it keeps a Lavish name's asterisks raw;
// a line is Markdown, so it escapes them (db/lib/markdownName.js).
test("a refusal counts with the raw name and a line with the escaped one", () => {
  const caviar = { slug: "caviar", name: "*Caviar*" };
  assert.equal(countOf(caviar, 2, { markdown: false }), "2 × *Caviar*");
  assert.notEqual(countOf(caviar, 2), "2 × *Caviar*");
});

test("a free line says free rather than 0 ¢", () => {
  assert.ok(VENDING_TEXT.slotRowFree("Tea", 3).includes("free"));
  assert.ok(VENDING_TEXT.youBoughtFree("A Tea", 3).includes("free"));
  assert.ok(VENDING_TEXT.youStockedInFree("2 × Tea").includes("free"));
  assert.ok(VENDING_TEXT.youPricedFree("Tea").includes("free"));
});

// Bascinet's two calls on how loud the machine is, pinned here so a later
// "tidy-up" cannot quietly reverse either one.

// The expiry line NAMES the holder. The draft signed nobody, on the argument
// that being timed out in public is a humiliation; Bascinet overruled it, so
// the room hears whose time ran out.
test("the expiry line names who ran out of time", () => {
  assert.equal(typeof VENDING_TEXT.roomExpired, "function");
  assert.ok(VENDING_TEXT.roomExpired("Ada Vance").includes("Ada Vance"));
});

// It only ever fires on a real expiry — "their time is up" is a lie about a
// holder who died or walked off, so db/lib/vending.js#clearStaleHolds posts it
// for the clock and nothing else.
test("the expiry line is about the clock, so it says so", () => {
  assert.ok(/time is up/i.test(VENDING_TEXT.roomExpired("Ada Vance")));
});

test("the room IS told what was bought", () => {
  assert.ok(VENDING_TEXT.roomBoughtNamed("Ada", "a Bone Saw").includes("Bone Saw"));
  // The anonymous line is kept for if that is ever reversed, and must stay
  // anonymous while it sits there unused.
  assert.equal(VENDING_TEXT.roomBought("Ada").includes("Bone Saw"), false);
});

// Insert and Withdraw stay silent in the room — the other call. There is no
// string for either, and that absence is the decision.
test("feeding coins in posts nothing to the room", () => {
  const keys = Object.keys(VENDING_TEXT).filter((k) => k.startsWith("room"));
  assert.deepEqual(
    keys.sort(),
    [
      "roomBought",
      "roomBoughtNamed",
      "roomExpired",
      "roomLeft",
      "roomLocked",
      "roomOpened",
      "roomRestocked",
      "roomTill",
      "roomUnlocked",
    ],
    "a new room line means somebody reversed the silence on Insert/Withdraw",
  );
});
