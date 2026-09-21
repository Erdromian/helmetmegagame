// db/lib/curse.js decides who may not come back at all until their body is
// buried or their name carved. A wrong answer here is either a player locked
// out of the game or one handed a free re-roll over an unburied corpse. Pure
// over rows, so no database and no stub.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isCursedIn, cursedUserIds, isPlayerCursed, CURSE_SELECT } = require("../lib/curse");

const BURIED = new Date("2026-09-08T12:00:00Z");

let clock = 0; // rows come back from Prisma in no guaranteed order; stamps an increasing createdAt
const row = (status, { buriedAt = null, cursedOverride = null, user = "u", at = null, deathTurn = null } = {}) => ({
  discordUserId: user,
  status,
  buriedAt,
  cursedOverride,
  deathTurn,
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
  assert.equal(isCursedIn([row("DEAD"), row("ALIVE")]), false);
});

test("only the most recent body counts", () => {
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
  assert.equal(isCursedIn([row("ALIVE", { cursedOverride: true })]), true);
});

test("the most recently decided override wins", () => {
  const first = row("DEAD", { cursedOverride: true, at: new Date("2026-01-01") });
  const second = row("DEAD", { cursedOverride: false, at: new Date("2026-02-01") });
  assert.equal(isCursedIn([first, second]), false);
});

test("the dead CURSED enum value counts as not-ALIVE", () => {
  assert.equal(isCursedIn([row("CURSED")]), true);
});

test("a player with no characters at all is not cursed", () => {
  assert.equal(isCursedIn([]), false);
  assert.equal(isCursedIn(undefined), false);
});

test("a missing buriedAt reads as still lying there, not as buried", () => {
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
  let asked = null;
  const prisma = {
    character: { findMany: async (args) => ((asked = args), [row("DEAD")]) },
    turn: { findFirst: async () => ({ number: 4 }) },
  };
  assert.equal(await isPlayerCursed(prisma, "u"), true);
  assert.deepEqual(asked.select, CURSE_SELECT);
  assert.deepEqual(Object.keys(CURSE_SELECT).sort(), [
    "buriedAt",
    "createdAt",
    "cursedOverride",
    "deathTurn",
    "discordUserId",
    "status",
  ]);
});

test("the query wrapper asks the database nothing without a user id", async () => {
  let called = false;
  const prisma = {
    character: { findMany: async () => ((called = true), []) },
    turn: { findFirst: async () => ((called = true), null) },
  };
  assert.equal(await isPlayerCursed(prisma, null), false);
  assert.equal(called, false);
});

// The Charon's sleepers (docs/systemdocs/CHARON.md). ASLEEP is out of play with
// nothing left lying anywhere, so it must not curse: the whole point of the
// button is that you get to roll again.
test("an asleep character leaves nothing to bury, so nobody is cursed", () => {
  assert.equal(isCursedIn([row("ASLEEP")]), false);
});

test("going to sleep does not hide an unburied body under it", () => {
  const body = row("DEAD");
  const sleeper = row("ASLEEP"); // newer than the body
  assert.equal(isCursedIn([body, sleeper]), true);
});

test("a buried body plus a sleeper is still lifted", () => {
  assert.equal(isCursedIn([row("DEAD", { buriedAt: BURIED }), row("ASLEEP")]), false);
});

test("a living character still wins over a sleeper", () => {
  assert.equal(isCursedIn([row("ASLEEP"), row("ALIVE")]), false);
});

// The lapse (db/lib/curse.js, CURSE_TURNS). Nothing anywhere shows this to
// anybody: a player past the count simply finds creation open again with the
// body still lying where it fell.
test("a body four turns old still curses", () => {
  assert.equal(isCursedIn([row("DEAD", { deathTurn: 1 })], 4), true);
});

test("a body five turns old does not", () => {
  assert.equal(isCursedIn([row("DEAD", { deathTurn: 1 })], 6), false);
});

test("the turn of the death itself is turn zero of the count", () => {
  assert.equal(isCursedIn([row("DEAD", { deathTurn: 3 })], 3), true);
  assert.equal(isCursedIn([row("DEAD", { deathTurn: 3 })], 7), true);
  assert.equal(isCursedIn([row("DEAD", { deathTurn: 3 })], 8), false);
});

test("a body with no death turn never lapses", () => {
  assert.equal(isCursedIn([row("DEAD")], 900), true);
});

test("no turn number in hand never lapses either", () => {
  assert.equal(isCursedIn([row("DEAD", { deathTurn: 1 })]), true);
  assert.equal(isCursedIn([row("DEAD", { deathTurn: 1 })], null), true);
});

test("burying still lifts it long before the count is up", () => {
  assert.equal(isCursedIn([row("DEAD", { deathTurn: 9, buriedAt: BURIED })], 10), false);
});

test("a GM override of true outlasts the lapse", () => {
  assert.equal(isCursedIn([row("DEAD", { deathTurn: 1, cursedOverride: true })], 50), true);
});

test("only the most recent body's clock counts", () => {
  const old = row("DEAD", { deathTurn: 1, at: new Date("2026-01-01") });
  const fresh = row("DEAD", { deathTurn: 9, at: new Date("2026-02-01") });
  assert.equal(isCursedIn([old, fresh], 10), true);
});

test("the bulk form carries the turn number to each player", () => {
  const rows = [
    row("DEAD", { user: "a", deathTurn: 1 }), // lapsed
    row("DEAD", { user: "b", deathTurn: 9 }), // fresh
  ];
  assert.deepEqual([...cursedUserIds(rows, 10)], ["b"]);
});

test("the query wrapper reads the OPEN turn and lets a lapsed curse go", async () => {
  let where = null;
  const prisma = {
    character: { findMany: async () => [row("DEAD", { deathTurn: 1 })] },
    turn: { findFirst: async (args) => ((where = args.where), { number: 20 }) },
  };
  assert.equal(await isPlayerCursed(prisma, "u"), false);
  assert.deepEqual(where, { status: "OPEN" });
});

test("no open turn leaves the curse standing", async () => {
  const prisma = {
    character: { findMany: async () => [row("DEAD", { deathTurn: 1 })] },
    turn: { findFirst: async () => null },
  };
  assert.equal(await isPlayerCursed(prisma, "u"), true);
});
