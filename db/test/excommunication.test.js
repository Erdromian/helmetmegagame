// node --test over the Bishop's Excommunicate verb. Run with
// `npm test --workspace=db`. Nothing here touches Prisma — the cap and the
// target rule are both pure, which is why they live in db/lib and not in the
// server action.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isBishop,
  excommunicationCap,
  excommunicateTarget,
} = require("../lib/excommunication");

// A candidate as the action selects one: the post-christian tag narrowed to
// presence-or-absence, plus whether somebody already holds a mark on them.
function person(id, first, last, { faithful = true, marked = false } = {}) {
  return {
    id,
    name: `${first} ${last}`,
    firstName: first,
    lastName: last,
    tags: faithful ? [{ tagId: "post-christian" }] : [],
    excommunicationBorne: marked ? { id: "x" } : null,
  };
}

test("only the bishop tag is a Bishop", () => {
  assert.equal(isBishop(["bishop", "chaplain"]), true);
  assert.equal(isBishop(new Set(["bishop"])), true);
  // The role grants Chaplain too, and a Chaplain is not a Bishop.
  assert.equal(isBishop(["chaplain", "pious"]), false);
  assert.equal(isBishop([]), false);
  assert.equal(isBishop(undefined), false);
});

test("Depriver is the only thing that raises the cap", () => {
  assert.equal(excommunicationCap(["bishop"]), 1);
  assert.equal(excommunicationCap(["bishop", "depriver"]), 2);
  assert.equal(excommunicationCap(new Set(["depriver"])), 2);
  // No stacking: one Depriver is all there is, and a tag is held or not.
  assert.equal(excommunicationCap(["bishop", "depriver", "chaplain"]), 2);
});

test("a name lands on exactly one living Post-Christian", () => {
  const roster = [person("a", "Ada", "Kell"), person("b", "Jorren", "Vasse")];
  const { target, reason } = excommunicateTarget(roster, "Ada Kell");
  assert.equal(reason, null);
  assert.equal(target.id, "a");
});

test("nobody, two people, or yourself is not a valid person", () => {
  const roster = [
    person("a", "Jorren", "Vasse"),
    person("b", "Jorren", "Vasse"),
    person("me", "Cass", "Orrin"),
  ];
  // Nobody by that name.
  assert.equal(excommunicateTarget(roster, "Ada Kell").reason, "invalid");
  // Two men answer to it. A warrant marks both (db/lib/wanted.js); this
  // refuses, because the cap makes each mark precious and there is no undo
  // that does not spend the Bishop's afternoon.
  assert.equal(excommunicateTarget(roster, "Jorren Vasse").reason, "invalid");
  // Yourself.
  assert.equal(
    excommunicateTarget(roster, "Cass Orrin", { selfId: "me" }).reason,
    "invalid",
  );
  // Empty roster, empty name.
  assert.equal(excommunicateTarget([], "Ada Kell").reason, "invalid");
});

test("somebody already excommunicated is not a valid person either", () => {
  const roster = [person("a", "Ada", "Kell", { marked: true })];
  assert.equal(excommunicateTarget(roster, "Ada Kell").reason, "invalid");
});

test("a valid person who is not Post-Christian says so", () => {
  const roster = [person("a", "Ada", "Kell", { faithful: false })];
  const { target, reason } = excommunicateTarget(roster, "Ada Kell");
  assert.equal(target, null);
  // Distinct from "invalid": the Bishop found the right person and may not
  // touch them, which is a different sentence.
  assert.equal(reason, "not-post-christian");
});

test("an already-marked heathen reads as invalid, not as a faith problem", () => {
  // Order matters: the mark is checked before the belief, so the Bishop is
  // never told what somebody believes by a name that was going to be refused
  // anyway.
  const roster = [person("a", "Ada", "Kell", { faithful: false, marked: true })];
  assert.equal(excommunicateTarget(roster, "Ada Kell").reason, "invalid");
});
