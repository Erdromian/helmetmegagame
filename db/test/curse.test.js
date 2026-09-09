// node --test over the one rule the curse is made of: db/lib/curse.js decides
// who may only come back as a Migrant or a Bum, and at six fewer points.
//
// This is worth a test where most of the codebase isn't, because the rule used
// to be "does this Discord account wear a role", and the whole point of moving
// it into the database was that the old answer could be wrong without anything
// noticing. A wrong answer here is a player handed a free unrestricted re-roll
// — the exact bug this replaced.
//
// The rule is pure over rows, so there is no database here and no stub either.
//
// Run with: npm test --workspace=db
const test = require("node:test");
const assert = require("node:assert/strict");
const { isCursedIn, cursedUserIds, isPlayerCursed, CURSE_SELECT } = require("../lib/curse");

const BURIED = new Date("2026-09-08T12:00:00Z");

let clock = 0;
// Rows come back from Prisma in no guaranteed order, so every helper here
// stamps an increasing createdAt and the tests pass them in deliberately odd
// orders — the rule sorts, it must not trust the array.
const row = (status, { buriedAt = null, cursedOverride = null, user = "u", at = null } = {}) => ({
  discordUserId: user,
  status,
  buriedAt,
  cursedOverride,
  createdAt: at ?? new Date(2026, 0, 1, 0, 0, (clock += 1)),
});

test("a living character is never cursed", () => {
  assert.equal(isCursedIn([row("ALIVE")]), false);
});

test("a body nobody has buried curses its player", () => {
  assert.equal(isCursedIn([row("DEAD")]), true);
});

test("burying the body lifts it", () => {
  assert.equal(isCursedIn([row("DEAD", { buriedAt: BURIED })]), false);
});

test("rolling a new character ends it, buried or not", () => {
  // The curse must not outlast the Bum or Migrant it forced.
  assert.equal(isCursedIn([row("DEAD"), row("ALIVE")]), false);
});

test("only the most recent body counts", () => {
  // Died once and the body was destroyed, re-rolled, died again, and somebody
  // buried THAT one. Clean — otherwise the first corpse locks them out of a
  // full re-roll for the rest of the game.
  const lost = row("DEAD");
  const buried = row("DEAD", { buriedAt: BURIED });
  assert.equal(isCursedIn([lost, buried]), false);
});

test("...and the most recent body still counts when it is the unburied one", () => {
  const buried = row("DEAD", { buriedAt: BURIED });
  const lost = row("DEAD");
  assert.equal(isCursedIn([buried, lost]), true);
});

test("row order in the array does not decide the answer", () => {
  const older = row("DEAD", { at: new Date("2026-01-01") });
  const newer = row("DEAD", { buriedAt: BURIED, at: new Date("2026-02-01") });
  assert.equal(isCursedIn([older, newer]), false);
  assert.equal(isCursedIn([newer, older]), false);
});

test("a GM override of false lifts a curse the rule would apply", () => {
  assert.equal(isCursedIn([row("DEAD", { cursedOverride: false })]), false);
});

test("a GM override of true curses a living player", () => {
  // The narrative curse a GM used to lay by adding the Discord role by hand.
  assert.equal(isCursedIn([row("ALIVE", { cursedOverride: true })]), true);
});

test("the most recently decided override wins", () => {
  const first = row("DEAD", { cursedOverride: true, at: new Date("2026-01-01") });
  const second = row("DEAD", { cursedOverride: false, at: new Date("2026-02-01") });
  assert.equal(isCursedIn([first, second]), false);
});

test("the dead CURSED enum value counts as not-ALIVE", () => {
  // Nothing writes it any more, but it is still in the Postgres enum
  // (docs/systemdocs/CHARACTERS.md), so the rule must not read it as living.
  assert.equal(isCursedIn([row("CURSED")]), true);
});

test("a player with no characters at all is not cursed", () => {
  assert.equal(isCursedIn([]), false);
  assert.equal(isCursedIn(undefined), false);
});

test("a missing buriedAt reads as still lying there, not as buried", () => {
  // The safe direction. A caller that forgets the column in its select costs
  // someone a ghost role the doctor takes back; the other way round would hand
  // out full-points re-rolls silently.
  assert.equal(isCursedIn([{ discordUserId: "u", status: "DEAD", createdAt: new Date() }]), true);
});

test("the bulk form separates players", () => {
  const rows = [
    row("DEAD", { user: "a" }),
    row("ALIVE", { user: "b" }),
    row("DEAD", { buriedAt: BURIED, user: "c" }),
  ];
  assert.deepEqual([...cursedUserIds(rows)], ["a"]);
});

test("the bulk form applies the latest-body rule per player, not globally", () => {
  const rows = [
    row("DEAD", { user: "a", at: new Date("2026-01-01") }),
    row("DEAD", { user: "a", buriedAt: BURIED, at: new Date("2026-02-01") }),
    row("DEAD", { user: "b", buriedAt: BURIED, at: new Date("2026-01-01") }),
    row("DEAD", { user: "b", at: new Date("2026-02-01") }),
  ];
  assert.deepEqual([...cursedUserIds(rows)], ["b"]);
});

test("rows with no discordUserId are skipped, not counted", () => {
  assert.equal(cursedUserIds([row("DEAD", { user: null })]).size, 0);
  assert.equal(cursedUserIds(undefined).size, 0);
});

test("the query wrapper asks for every field the rule reads", async () => {
  // The select is the trap this guards: omit buriedAt or cursedOverride and
  // the rule answers from undefined.
  let asked = null;
  const prisma = { character: { findMany: async (args) => ((asked = args), [row("DEAD")]) } };
  assert.equal(await isPlayerCursed(prisma, "u"), true);
  assert.deepEqual(asked.select, CURSE_SELECT);
  assert.deepEqual(Object.keys(CURSE_SELECT).sort(), [
    "buriedAt",
    "createdAt",
    "cursedOverride",
    "discordUserId",
    "status",
  ]);
});

test("the query wrapper asks the database nothing without a user id", async () => {
  let called = false;
  const prisma = { character: { findMany: async () => ((called = true), []) } };
  assert.equal(await isPlayerCursed(prisma, null), false);
  assert.equal(called, false);
});
