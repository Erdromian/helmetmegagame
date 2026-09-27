// Combat mode (docs/systemdocs/COMBAT-MODE.md): the state the button draws, the timing rule that
// refuses turning it off on the turn it went on, the Exhausted refusal, and the two gates it opens.
// A fake database, the shape db/lib/verbs/combatMode.js and db/lib/combatGate.js actually touch.
const test = require("node:test");
const assert = require("node:assert/strict");

const { EXHAUSTED_SLUG } = require("../lib/constants");
const {
  combatModeState,
  lockedOn,
  inCombatMode,
  LOCKED_ON,
  TOO_EXHAUSTED,
  NEEDS_COMBAT_MODE_ATTACK,
  NEEDS_COMBAT_MODE_INTERCEPT,
} = require("../lib/combatMode");
const { setCombatMode } = require("../lib/verbs/combatMode");
const { attackBlock, interceptBlock } = require("../lib/combatGate");

const turn = (number) => ({
  id: `turn-${number}`,
  number,
  status: "OPEN",
  startedAt: new Date(Date.now() - 3_600_000),
  endsAt: new Date(Date.now() + 3_600_000),
  turnLengthHours: 24,
});

// One character, one open turn, and the handful of calls the verb and the gates make.
function fakeDb({ since = null, slugs = [], openTurn = turn(5), action = null, phase = "RUNNING" } = {}) {
  const row = { id: "ada", combatModeSinceTurn: since };
  const audits = [];
  const db = {
    row,
    audits,
    turn: { findFirst: async () => openTurn },
    gameConfig: { findUnique: async () => ({ gameMode: "PERSISTENT", autoTurnAdvanceDisabled: false }) },
    gameState: { findUnique: async () => ({ phase, sessionOpenedAt: null }) },
    action: { findFirst: async () => action },
    auditLog: { create: async ({ data }) => audits.push(data) },
    character: {
      findUnique: async () => ({
        combatModeSinceTurn: row.combatModeSinceTurn,
        tags: slugs.map((slug) => ({ tag: { slug, name: slug[0].toUpperCase() + slug.slice(1) } })),
      }),
      // Just enough of Prisma's where to judge the two conditional writes.
      updateMany: async ({ where, data }) => {
        const cond = where.combatModeSinceTurn;
        const v = row.combatModeSinceTurn;
        const ok =
          cond === null
            ? v === null
            : v !== null && !(cond.notIn ?? []).includes(v);
        if (!ok) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };
  return db;
}

test("the button's state: off, on, locked on the turn it went on, and Exhausted", () => {
  const open = { number: 5 };
  assert.deepEqual(combatModeState({ combatModeSinceTurn: null }, open, []), { on: false, locked: false, onBlock: null });
  assert.deepEqual(combatModeState({ combatModeSinceTurn: 5 }, open, []), { on: true, locked: true, onBlock: null });
  assert.deepEqual(combatModeState({ combatModeSinceTurn: 4 }, open, []), { on: true, locked: false, onBlock: null });
  assert.deepEqual(
    combatModeState({ combatModeSinceTurn: null }, open, [{ tag: { slug: EXHAUSTED_SLUG } }]),
    { on: false, locked: false, onBlock: TOO_EXHAUSTED },
  );
});

test("a number left by Restart Game never locks anyone for good", () => {
  // Turn 57 of the old game, Turn 1 of the new one: it is on, and it can come off.
  assert.equal(lockedOn({ combatModeSinceTurn: 57 }, { number: 1 }), false);
  assert.equal(inCombatMode({ combatModeSinceTurn: 57 }), true);
});

test("the import-free copy of the Exhausted slug is the catalog's", () => {
  assert.equal(combatModeState({ combatModeSinceTurn: null }, { number: 1 }, [{ slug: EXHAUSTED_SLUG }]).onBlock, TOO_EXHAUSTED);
});

test("turning it on stamps the open turn and writes an audit row", async () => {
  const db = fakeDb();
  const res = await setCombatMode(db, { character: { id: "ada" }, discordUserId: "u1", on: true });
  assert.equal(res.ok, true);
  assert.equal(res.on, true);
  assert.equal(db.row.combatModeSinceTurn, 5);
  assert.equal(db.audits.length, 1);
  assert.equal(db.audits[0].actionType, "character_combat_mode_set");
  assert.deepEqual(db.audits[0].details, { on: true, turnNumber: 5 });
});

test("it cannot come off on the turn it went on, and can on the next", async () => {
  const same = fakeDb({ since: 5 });
  const refused = await setCombatMode(same, { character: { id: "ada" }, discordUserId: "u1", on: false });
  assert.deepEqual(refused, { ok: false, error: LOCKED_ON });
  assert.equal(same.row.combatModeSinceTurn, 5);

  const next = fakeDb({ since: 5, openTurn: turn(6) });
  const off = await setCombatMode(next, { character: { id: "ada" }, discordUserId: "u1", on: false });
  assert.equal(off.ok, true);
  assert.equal(off.on, false);
  assert.equal(next.row.combatModeSinceTurn, null);
});

test("Exhausted refuses turning it on", async () => {
  const db = fakeDb({ slugs: [EXHAUSTED_SLUG] });
  const res = await setCombatMode(db, { character: { id: "ada" }, discordUserId: "u1", on: true });
  assert.deepEqual(res, { ok: false, error: TOO_EXHAUSTED });
  assert.equal(db.row.combatModeSinceTurn, null);
});

test("a bound character can't turn it on, but can always turn it off", async () => {
  const on = await setCombatMode(fakeDb({ slugs: ["bound"] }), { character: { id: "ada" }, on: true });
  assert.equal(on.ok, false);
  assert.match(on.error, /can't do that right now/);

  const db = fakeDb({ since: 3, slugs: ["bound"] });
  const off = await setCombatMode(db, { character: { id: "ada" }, on: false });
  assert.equal(off.ok, true);
  assert.equal(db.row.combatModeSinceTurn, null);
});

test("no open turn, or a game not running, refuses", async () => {
  const none = await setCombatMode(fakeDb({ openTurn: null }), { character: { id: "ada" }, on: true });
  assert.equal(none.ok, false);
  const stopped = await setCombatMode(fakeDb({ phase: "LOBBY" }), { character: { id: "ada" }, on: true });
  assert.equal(stopped.ok, false);
});

test("pressing the state it is already in changes nothing and audits nothing", async () => {
  const db = fakeDb({ since: 4 });
  const res = await setCombatMode(db, { character: { id: "ada" }, on: true });
  assert.equal(res.ok, true);
  assert.equal(res.changed, false);
  assert.equal(db.row.combatModeSinceTurn, 4);
  assert.equal(db.audits.length, 0);
});

test("Attack needs combat mode, and a spent Move is named first", async () => {
  assert.equal(await attackBlock(fakeDb(), "ada", "turn-5"), NEEDS_COMBAT_MODE_ATTACK);
  assert.equal(await attackBlock(fakeDb({ since: 5 }), "ada", "turn-5"), null);
  // Out of combat mode AND a Routine filed: the Move is the one to hear about, since turning combat
  // mode on would not help and could not be undone.
  const spent = await attackBlock(fakeDb({ action: { moveKind: "ROUTINE" } }), "ada", "turn-5");
  assert.match(spent, /already used your Move/);
  // A Gambit is still the exception, and then combat mode is what refuses.
  assert.equal(await attackBlock(fakeDb({ action: { moveKind: "GAMBIT" } }), "ada", "turn-5"), NEEDS_COMBAT_MODE_ATTACK);
});

test("Intercept needs combat mode", async () => {
  assert.equal(await interceptBlock(fakeDb(), "ada"), NEEDS_COMBAT_MODE_INTERCEPT);
  assert.equal(await interceptBlock(fakeDb({ since: 2 }), "ada"), null);
});
