// Escort, the bodyguard verb (docs/systemdocs/ATTACK.md §6a, MAP.md §3d): the pure rule and the words.
// The database half — following through performLocationMove, stepping into a fight, the endings — is
// exercised end to end against a real Postgres (the harness in the PR's verification), the combat.test.js
// posture: its guarantees are real moves, real claims and real rows.
const test = require("node:test");
const assert = require("node:assert/strict");

const { guardBlock, escortSide, GUARD_LINES } = require("../lib/guard");
const { actionFor } = require("../lib/actionCatalog");

const alert = (extra = {}) => ({ id: "g", locationId: "loc-1", combatModeSinceTurn: 3, tags: [], ...extra });
const charge = (extra = {}) => ({ id: "c", status: "ALIVE", locationId: "loc-1", ...extra });

test("an alert escort may guard somebody standing with them", () => {
  assert.equal(guardBlock(alert()), null);
  assert.equal(guardBlock(alert(), charge()), null);
});

test("escorting needs combat mode (Bascinet, 2026-09-30)", () => {
  assert.equal(guardBlock(alert({ combatModeSinceTurn: null })), GUARD_LINES.NEEDS_COMBAT_MODE);
  assert.equal(guardBlock(alert({ combatModeSinceTurn: null }), charge()), GUARD_LINES.NEEDS_COMBAT_MODE);
});

test("somebody who can't act can't start escorting", () => {
  const bound = alert({ tags: [{ tag: { slug: "bound", name: "Bound" } }] });
  assert.match(guardBlock(bound, charge()), /You're Bound\.$/);
});

test("the charge has to be somebody else, alive, and here", () => {
  assert.equal(guardBlock(alert(), charge({ id: "g" })), GUARD_LINES.NOT_YOURSELF);
  assert.equal(guardBlock(alert(), charge({ locationId: "loc-2" })), GUARD_LINES.NOT_HERE);
  assert.equal(guardBlock(alert(), charge({ status: "DEAD" })), GUARD_LINES.NOT_HERE);
  assert.equal(guardBlock(alert({ locationId: null }), charge()), GUARD_LINES.NOT_HERE);
});

test("the refusal about the charge never tells a dead body from an absent one", () => {
  // A picker offered a hood by token; "not here" and "dead" must read the same, or the sentence is a probe.
  assert.equal(guardBlock(alert(), charge({ status: "DEAD" })), guardBlock(alert(), charge({ locationId: "x" })));
});

test("the follow lines name the place, and the Move only when it was spent", () => {
  assert.equal(GUARD_LINES.FOLLOWED("Ada", "the Square"), "You followed Ada to the Square.");
  assert.equal(GUARD_LINES.LOST("a young man"), "A young man left, and you couldn't follow.");
});

test("both faces offer it: Escort to set, Stop escorting only while escorting", () => {
  const set = actionFor("guard");
  assert.equal(set.label, "Escort");
  assert.equal(set.command, "escort");
  assert.ok(set.web);
  const stop = actionFor("guardstop");
  assert.equal(stop.show, "isGuarding");
});

test("an escort defends by default and stays out of their charge's attacks (Bascinet, 2026-10-04)", () => {
  assert.equal(escortSide({}, "DEFENDER"), "DEFENDER");
  assert.equal(escortSide({}, "ATTACKER"), null);
  assert.equal(escortSide({ guardDefends: true, guardAttacks: false }, "ATTACKER"), null);
});

test("the two boxes decide which of the charge's fights the escort joins, always on the charge's side", () => {
  const cases = [
    [{ guardDefends: true, guardAttacks: true }, "DEFENDER", "DEFENDER"],
    [{ guardDefends: true, guardAttacks: true }, "ATTACKER", "ATTACKER"],
    [{ guardDefends: false, guardAttacks: true }, "DEFENDER", null],
    [{ guardDefends: false, guardAttacks: true }, "ATTACKER", "ATTACKER"],
    [{ guardDefends: false, guardAttacks: false }, "DEFENDER", null],
    [{ guardDefends: false, guardAttacks: false }, "ATTACKER", null],
  ];
  for (const [guard, side, want] of cases) assert.equal(escortSide(guard, side), want, `${JSON.stringify(guard)} ${side}`);
  // Not in the fight, or no escort: nobody joins.
  assert.equal(escortSide({ guardDefends: true }, undefined), null);
  assert.equal(escortSide(null, "DEFENDER"), null);
});

test("the confirm line says what the escort will step into", () => {
  assert.equal(
    GUARD_LINES.STARTED("Ada"),
    "You're escorting Ada. You'll follow them when they travel, and step in if they're attacked.",
  );
  assert.equal(
    GUARD_LINES.STARTED("Ada", { defends: true, attacks: true }),
    "You're escorting Ada. You'll follow them when they travel, step in if they're attacked, and join them if they attack someone.",
  );
  assert.equal(
    GUARD_LINES.STARTED("Ada", { defends: false, attacks: true }),
    "You're escorting Ada. You'll follow them when they travel, and join them if they attack someone.",
  );
  assert.equal(GUARD_LINES.STARTED("Ada", { defends: false, attacks: false }), "You're escorting Ada. You'll follow them when they travel.");
  assert.equal(GUARD_LINES.STEP_IN_ATTACK("a young man"), "You join a young man's attack.");
});
