// An ambush ends with the fight it sprang (docs/systemdocs/ATTACK.md §9, Bascinet 2026-09-27): whichever way
// that fight ends — a GM, a call-off, a side emptying, the push — the owner's Ambush watch is deleted and the
// owner is told. Plus the two sentences both faces share for joining a side and being invited. Fake databases,
// only the calls each path makes; the row locks are exercised against a real Postgres elsewhere.
const test = require("node:test");
const assert = require("node:assert/strict");

const { endCombatAsGm, closeCombatsAtPush } = require("../lib/combat");
const { AMBUSH_ENDED, joinSideLine, invitedLine, invitedShortLine, listNames } = require("../lib/combatMode");

const TURN = { id: "t1" };

function fakeDb({ fromAmbush }) {
  const deleted = [];
  const fight = { id: "c1", fromAmbush, ambushOwnerId: fromAmbush ? "ada" : null, locationId: "gate" };
  const people = [
    { id: "p1", characterId: "ada", side: "ATTACKER", status: "JOINED", character: { id: "ada", discordUserId: "u-ada" } },
    { id: "p2", characterId: "bo", side: "DEFENDER", status: "JOINED", character: { id: "bo", discordUserId: "u-bo" } },
  ];
  return {
    deleted,
    combat: {
      updateMany: async () => ({ count: 1 }),
      findMany: async ({ where }) => {
        if (where.fromAmbush) return fight.fromAmbush ? [{ ambushOwnerId: fight.ambushOwnerId, locationId: fight.locationId }] : [];
        return [{ id: fight.id }];
      },
    },
    combatParticipant: {
      findMany: async () => people,
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => null,
    },
    character: {
      updateMany: async () => ({ count: 1 }),
      findMany: async ({ where }) => people.filter((p) => where.id.in.includes(p.characterId)).map((p) => p.character),
    },
    interceptWatch: {
      deleteMany: async ({ where }) => {
        deleted.push(where);
        return { count: 1 };
      },
    },
  };
}

test("a GM ending an ambush's fight cancels the ambush and tells its owner", async () => {
  const db = fakeDb({ fromAmbush: true });
  const out = await endCombatAsGm(db, { combatId: "c1", turn: TURN });
  assert.equal(out.ok, true);
  assert.deepEqual(db.deleted, [{ characterId: "ada", mode: "AMBUSH", locationId: "gate" }]);
  const ada = out.dms.find((d) => d.discordUserId === "u-ada");
  const bo = out.dms.find((d) => d.discordUserId === "u-bo");
  assert.equal(ada.content, `The fight is over. You can move again.\n${AMBUSH_ENDED}`);
  assert.equal(bo.content, "The fight is over. You can move again.");
});

test("an ordinary fight ending touches no watch", async () => {
  const db = fakeDb({ fromAmbush: false });
  const out = await endCombatAsGm(db, { combatId: "c1", turn: TURN });
  assert.deepEqual(db.deleted, []);
  assert.ok(out.dms.every((d) => d.content === "The fight is over. You can move again."));
});

test("the push cancels the ambush behind a fight it closes, and tells only its owner", async () => {
  const db = fakeDb({ fromAmbush: true });
  const out = await closeCombatsAtPush(db, TURN);
  assert.equal(out.closed, 1);
  assert.deepEqual(db.deleted, [{ characterId: "ada", mode: "AMBUSH", locationId: "gate" }]);
  assert.deepEqual(out.notices, [{ discordUserId: "u-ada", content: AMBUSH_ENDED }]);
});

test("joining a side names who you'd fight beside and against", () => {
  const fight = { attackers: ["Ada", "a young man"], defenders: ["Bo"] };
  assert.match(joinSideLine(fight, "ATTACKER"), /^You'll fight alongside Ada and a young man against Bo\. /);
  assert.match(joinSideLine(fight, "DEFENDER"), /^You'll fight alongside Bo against Ada and a young man\. /);
  assert.equal(listNames(["Ada", "Bo", "Cy"]), "Ada, Bo and Cy");
});

test("an invitation names who asked, as the reader knows them, and falls back when nobody can be named", () => {
  assert.equal(invitedLine("a young man"), "A young man has asked you to join the attack. You can't leave until you answer.");
  assert.equal(invitedLine(null), "You've been asked to join the attack. You can't leave until you answer.");
  assert.equal(invitedShortLine("Ada"), "Ada has asked you to join a fight.");
  assert.equal(invitedShortLine(null), "You've been asked to join a fight.");
});
