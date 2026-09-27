// A bird letter arrives unsigned (docs/systemdocs/BIRD.md §8). Every line the
// Bird writes to the person receiving a letter, or answering one, names the
// paper and never who sent it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { deliveryDm, replyDm, waitingLetter, withoutDeskSender } = require("../lib/bird");

test("the delivery DM names the letter and nobody else", () => {
  const dm = deliveryDm({ letterName: "Terms of Surrender", senderName: "Zzyzx Quorble" });
  assert.match(dm, /A bird finds you, and there is a letter tied to its leg\./);
  assert.match(dm, /\*\*Terms of Surrender\*\*/);
  assert.doesNotMatch(dm, /Zzyzx|Quorble|It is from/);
});

test("the reply comes back unsigned too", () => {
  const dm = replyDm({ letterName: "A Note", replierName: "Zzyzx Quorble" });
  assert.match(dm, /Your bird's returned, and it is carrying an answer\./);
  assert.match(dm, /\*\*A Note\*\*/);
  assert.doesNotMatch(dm, /Zzyzx|Quorble|answer from/);
});

test("a waiting letter is named by its paper and the turn it arrived", () => {
  const row = { id: "b1", tagName: "Sealed Letter (Three Cups)", replyDeadlineTurn: 8, senderName: "Zzyzx Quorble" };
  assert.deepEqual(waitingLetter(row), { id: "b1", letterName: "Sealed Letter (Three Cups)", arrivedTurn: 7 });
  assert.doesNotMatch(JSON.stringify(waitingLetter(row)), /Zzyzx|Quorble/);
});

test("a waiting letter from before the paperwork rework still has a name", () => {
  assert.deepEqual(waitingLetter({ id: "b2", tagName: null, replyDeadlineTurn: null }), {
    id: "b2",
    letterName: "A letter",
    arrivedTurn: null,
  });
});

// A GM letter's meta carries the name the GM signed it under, for the desk's
// card. The player's copy of the row leaves without it (web/lib/dmThread.js#playerDmRow).
test("the player's copy of a GM letter's meta drops the desk's sender name", () => {
  const meta = { birdMessageId: "b1", senderName: "God-King Enoch II", letterName: "A Note", sealed: false };
  assert.deepEqual(withoutDeskSender(meta), { birdMessageId: "b1", letterName: "A Note", sealed: false });
  assert.equal(meta.senderName, "God-King Enoch II", "the stored meta is not touched");
});

test("meta without a sender name passes through as it was", () => {
  const meta = { kind: "bird", birdMessageId: "b2", letterName: "A Note" };
  assert.equal(withoutDeskSender(meta), meta);
  assert.equal(withoutDeskSender(null), null);
  assert.equal(withoutDeskSender(undefined), null);
});
