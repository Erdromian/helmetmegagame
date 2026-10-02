// node --test over who is told their Gambit's die at the push
// (db/lib/stagedPush.js#gambitRollNoticesFor). The desk's "Roll to player" switch
// writes Action.revealRoll; Withhold must stop the DM and nothing else. Nothing here
// touches the database.
const test = require("node:test");
const assert = require("node:assert/strict");

const { gambitRollNoticesFor } = require("../lib/stagedPush");

const turn = { number: 7 };

function gambit(overrides = {}) {
  return {
    moveKind: "GAMBIT",
    diceRoll: 4,
    diceModifier: 1,
    revealRoll: true,
    gmNotes: null,
    character: { discordUserId: "u1" },
    ...overrides,
  };
}

test("a Gambit left on Send gets its die", () => {
  const notices = gambitRollNoticesFor(turn, [gambit()]);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].discordUserId, "u1");
  assert.equal(notices[0].content, "🎲 Your Gambit for turn 7: **4** (+1) → **5**.");
});

test("a Gambit filed before the column existed reads as Send", () => {
  const { revealRoll, ...old } = gambit();
  assert.equal(revealRoll, true);
  assert.equal(gambitRollNoticesFor(turn, [old]).length, 1);
});

test("Withhold sends nothing, and only for that Move", () => {
  const notices = gambitRollNoticesFor(turn, [
    gambit({ revealRoll: false }),
    gambit({ character: { discordUserId: "u2" } }),
  ]);
  assert.deepEqual(notices.map((n) => n.discordUserId), ["u2"]);
});

test("a Routine, an unrolled Gambit and a self-settling Gambit get no notice", () => {
  const marker = "auto:heal_gambit";
  const notices = gambitRollNoticesFor(turn, [
    gambit({ moveKind: "ROUTINE", diceRoll: null }),
    gambit({ diceRoll: null }),
    gambit({ gmNotes: marker }),
  ]);
  assert.equal(notices.length, 0);
});
