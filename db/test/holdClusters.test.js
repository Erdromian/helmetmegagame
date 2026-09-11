// The Other lens's clustering (docs/systemdocs/ATTACK.md §7).
//
// WHAT A FAILURE HERE MEANS. A GM reads this lens to find out who cannot
// leave, and both ways of getting it wrong are quiet.
//
// Cluster too WIDE and two unrelated scraps in two rooms merge into one row
// that names people who never met — and the ✕ beside one of them calls off a
// fight in a different room. Cluster too NARROW and a group ambush is back to
// being twelve rows a GM reads as twelve unrelated events, which is the whole
// thing this replaced.
//
// The id is the third silent one. It comes off the OLDEST edge on purpose: an
// id derived from the member set is a NEW id the moment a fourth person
// joins, which drops the GM's keyboard cursor mid-read.
const test = require("node:test");
const assert = require("node:assert/strict");

const { otherHoldRows } = require("../../web/lib/holdClusters.js");

let seq = 0;
function who(id) {
  return { id, name: id, discordUserId: `u-${id}`, updatedAt: new Date(0), roleTitle: "", zone: { name: "Town" } };
}
// `at` orders the edges; everything else is what ATTACK_INCLUDE selects.
function attack(attackerId, targetId, { at = ++seq, locationId = "loc-gate", fromAmbush = false, cancelledAt = null } = {}) {
  return {
    id: `atk-${attackerId}-${targetId}`,
    attackerId,
    targetCharacterId: targetId,
    attacker: who(attackerId),
    targetCharacter: who(targetId),
    locationId,
    location: { name: "Gatehouse", zone: { name: "Town" } },
    fromAmbush,
    cancelledAt,
    createdAt: new Date(at * 1000),
  };
}

const CTX = { usernameById: new Map(), catatonicIds: new Set(), movesByCharacterId: new Map() };
const rows = (attacks, hits = []) => otherHoldRows(attacks, hits, CTX);

test("one fight is one row, however many pairings it holds", () => {
  seq = 0;
  const out = rows([attack("ada", "bram"), attack("ada", "cade"), attack("dell", "bram")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].holds.length, 3);
  assert.deepEqual(
    out[0].people.map((p) => p.characterId).sort(),
    ["ada", "bram", "cade", "dell"],
  );
});

test("two scraps in two rooms stay two rows", () => {
  seq = 0;
  const out = rows([
    attack("ada", "bram", { locationId: "loc-gate" }),
    attack("cade", "dell", { locationId: "loc-docks" }),
  ]);
  assert.equal(out.length, 2);
});

test("unconnected people in ONE room stay two rows", () => {
  seq = 0;
  const out = rows([attack("ada", "bram"), attack("cade", "dell")]);
  assert.equal(out.length, 2);
});

test("the row's id comes off the oldest edge, so a latecomer does not remint it", () => {
  seq = 0;
  const first = attack("ada", "bram", { at: 1 });
  const before = rows([first])[0].id;
  const after = rows([attack("dell", "cade", { at: 9 }), first, attack("ada", "cade", { at: 5 })])[0].id;
  assert.equal(before, after);
  assert.equal(before, "hold:atk-ada-bram");
});

test("any ambush in the cluster makes the whole row an Ambush", () => {
  seq = 0;
  const out = rows([attack("ada", "bram"), attack("dell", "bram", { fromAmbush: true })]);
  assert.equal(out[0].kindLabel, "Ambush");
  assert.equal(out[0].kind, "AMBUSH");
});

test("a cancelled edge stays in the row, and the row is Holding while one is live", () => {
  seq = 0;
  const out = rows([
    attack("ada", "bram", { cancelledAt: new Date() }),
    attack("dell", "bram"),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].statusLabel, "Holding");
  assert.equal(out[0].holds.filter((h) => h.cancelled).length, 1);
});

test("every edge called off turns the row Called off", () => {
  seq = 0;
  const out = rows([attack("ada", "bram", { cancelledAt: new Date() })]);
  assert.equal(out[0].statusLabel, "Called off");
});

// Being jumped outranks doing the jumping — the settleHold rule in
// db/lib/attack.js. The row must not disagree with the sentence that person
// reads off every shut way.
test("somebody on both ends reads as held", () => {
  seq = 0;
  const out = rows([attack("ada", "bram"), attack("bram", "cade")]);
  const bram = out[0].people.find((p) => p.characterId === "bram");
  assert.equal(bram.role, "held");
  assert.equal(out[0].people.find((p) => p.characterId === "ada").role, "attacking");
});

test("each person carries what they filed, so the Gambit is one click away", () => {
  seq = 0;
  const ctx = {
    ...CTX,
    movesByCharacterId: new Map([["bram", [{ id: "mv-1", kindLabel: "Gambit" }]]]),
  };
  const out = otherHoldRows([attack("ada", "bram")], [], ctx);
  assert.deepEqual(out[0].people.find((p) => p.characterId === "bram").moves, [
    { id: "mv-1", kindLabel: "Gambit" },
  ]);
  assert.deepEqual(out[0].people.find((p) => p.characterId === "ada").moves, []);
});

test("a Safe stop is its own row, with both people and nothing to call off", () => {
  seq = 0;
  const hit = {
    id: "hit-1",
    interceptorId: "ada",
    targetCharacterId: "bram",
    interceptor: who("ada"),
    targetCharacter: who("bram"),
    createdAt: new Date(1000),
  };
  const out = rows([], [hit]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kindLabel, "Intercept");
  assert.equal(out[0].statusLabel, "Stopped");
  assert.deepEqual(out[0].people.map((p) => p.role), ["stopping", "stopped"]);
  assert.deepEqual(out[0].holds, []);
});

test("the search text names everybody, not only the two on the title", () => {
  seq = 0;
  const out = rows([attack("ada", "bram"), attack("ada", "cade")]);
  for (const name of ["ada", "bram", "cade"]) assert.ok(out[0].searchText.includes(name));
});
