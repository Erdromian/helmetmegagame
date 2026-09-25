// The Move ledger's pure half (db/lib/moveLedger.js, CRAFTING.md §2a). The
// arithmetic used to live in web/lib/craftBudget.js with no test of its own;
// moving it to db/ for the Discord face is the moment to pin it. Two things
// matter: that the shares add exactly (four quarters close a Move, no
// sliver), and that the refusal sentences say what is left.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  WHOLE_MOVE,
  MOVE_SPENT,
  addFractions,
  fitsInRemaining,
  unitsAffordable,
  ledgerRemaining,
  checkLedgerMove,
  craftLedgerDescription,
  isLedgerAction,
} = require("../lib/moveLedger");

const quarter = { num: 1, den: 4, family: "search" };
const ledgerAt = (num, den) => ({ gmNotes: "auto:craft auto:search", craftBudget: { usedNum: num, usedDen: den, entries: [] } });

test("four quarters close a Move exactly, and a fifth does not fit", () => {
  let used = { num: 0, den: 1 };
  for (let i = 0; i < 4; i += 1) used = addFractions(used, quarter);
  assert.deepEqual(used, { num: 1, den: 1 });
  assert.equal(fitsInRemaining(quarter, ledgerRemaining({ usedNum: used.num, usedDen: used.den })), false);
  assert.equal(unitsAffordable(ledgerRemaining({ usedNum: 1, usedDen: 2 }), 4), 2);
});

test("a quarter and an eighth add on the exact grid", () => {
  assert.deepEqual(addFractions({ num: 1, den: 4 }, { num: 1, den: 8 }), { num: 3, den: 8 });
  assert.deepEqual(ledgerRemaining({ usedNum: 3, usedDen: 8 }), { num: 5, den: 8 });
});

test("no Action yet: the share fits and there is no ledger to extend", () => {
  assert.deepEqual(checkLedgerMove(null, quarter), { ok: true, ledger: null });
  assert.equal(checkLedgerMove(null, { num: 5, den: 4, family: "search" }).ok, false);
});

test("a Gambit already filed refuses a share with the Move-spent sentence", () => {
  assert.deepEqual(checkLedgerMove({ gmNotes: null, craftBudget: null }, quarter), { ok: false, reason: MOVE_SPENT });
  assert.equal(isLedgerAction({ gmNotes: "auto:mine", craftBudget: null }), false);
});

test("the refusal says what is left, or that the Move is spent", () => {
  assert.equal(checkLedgerMove(ledgerAt(3, 4), quarter).ok, true);
  assert.equal(
    checkLedgerMove(ledgerAt(7, 8), quarter).reason,
    "That takes 0.25 of a Move, and you have 0.125 of this turn's Move left.",
  );
  assert.equal(checkLedgerMove(ledgerAt(1, 1), quarter).reason, "That takes 0.25 of a Move, and this turn's Move is spent.");
  assert.equal(checkLedgerMove(ledgerAt(1, 2), { ...WHOLE_MOVE, family: "burial" }).reason.startsWith("That takes a whole Move"), true);
  // A cost with no family cannot share a ledger at all — refused as a spent Move, whatever is left.
  assert.equal(checkLedgerMove(ledgerAt(1, 2), WHOLE_MOVE).reason, MOVE_SPENT);
});

test("the desk line groups by family with its own verb", () => {
  const entries = [
    { name: "Work Knife", family: "smithing", qty: 2 },
    { name: "Fishing Hut", family: "search", qty: 1 },
    { name: "Splint", family: "medical", qty: 1 },
  ];
  assert.equal(
    craftLedgerDescription(entries),
    "Crafting this turn: 2× Work Knife. Treating this turn: Splint. Searching this turn: Fishing Hut.",
  );
});
