// The spent-Move gate Attack and Intercept share (docs/systemdocs/ATTACK.md
// §5a). The pure half — no prisma, just the row.
const test = require("node:test");
const assert = require("node:assert");

const { spentBy } = require("../lib/combatGate");

test("nothing filed yet leaves both verbs open", () => {
  assert.equal(spentBy(null), false);
  assert.equal(spentBy(undefined), false);
});

test("a Routine or a Labor spends the turn", () => {
  assert.equal(spentBy({ moveKind: "ROUTINE" }), true);
  assert.equal(spentBy({ moveKind: "LABOR" }), true);
});

// The whole reason this reads the kind: writing the fight up first and
// pressing the button second is the right thing done in the other order.
test("a Gambit is the exception", () => {
  assert.equal(spentBy({ moveKind: "GAMBIT" }), false);
});

// db/lib/locationTravel.js files a paid zone crossing with no moveKind at all,
// and that crossing costs the whole turn. Reading a filed row as "hasn't
// acted" would let anybody who walked across a boundary pin somebody anyway.
test("a filed Move with no kind still spends the turn", () => {
  assert.equal(spentBy({ moveKind: null }), true);
  assert.equal(spentBy({}), true);
});
