// Coming into a fight, and leaving one (docs/systemdocs/ATTACK.md §6, §6a, §7): the rules this file pins.
//
// - Arriving somewhere never throws you out of the fight AT that place — an escort who walked in behind their
//   charge, or somebody who walked into an ambush, was put in it by the walk and must stay in it.
// - Nobody can intervene once Moves lock, by any way in: Join, an escort stepping in, coming back into a fight.
// - Somebody who left a fight may come back into it, on either side; a decliner still only on the defenders.
// - Somebody coming into a fight a GM already solved takes the Solved stamp off it (Bascinet, 2026-10-03).
// - An escort beside their charge steps in from no distance, and their row says whose escort they are.
// - When the last attacker who hadn't pressed Call off leaves, the call-off they were waiting on is complete.
//
// An in-memory database holding real rows, so each rule runs against state rather than canned answers. The
// row locks and the unique claims are Postgres's, exercised against a real database elsewhere.
const test = require("node:test");
const assert = require("node:assert/strict");

const { intervene, leaveCombatsFor, answerInvite, escortsStepIn } = require("../lib/combat");
const { ATTACK_LOCKED, DECLINED_ATTACKERS, ALREADY_FIGHTING } = require("../lib/combatMode");

const HOUR = 60 * 60 * 1000;

// A turn well inside its Move window, and one a minute from its end — inside the lock.
const OPEN_TURN = { id: "t1", number: 2, dayNumber: 2, startedAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() + 20 * HOUR), turnLengthHours: 24, status: "OPEN" };
const LOCKED_TURN = { ...OPEN_TURN, startedAt: new Date(Date.now() - 23 * HOUR), endsAt: new Date(Date.now() + 60 * 1000) };

function person(id, over = {}) {
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    status: "ALIVE",
    locationId: "gate",
    zoneId: "town",
    combatModeSinceTurn: 1,
    mood: 0,
    heldUntil: null,
    heldById: null,
    heldReason: null,
    guardingId: null,
    discordUserId: null,
    appearance: null,
    tags: [],
    ...over,
  };
}

// Does `row` satisfy a Prisma-shaped `where`? Only the shapes combat.js asks.
function matches(row, where = {}) {
  for (const [key, want] of Object.entries(where)) {
    const have = row[key];
    if (want === null) {
      if (have != null) return false;
    } else if (want && typeof want === "object" && !(want instanceof Date)) {
      if ("not" in want && (want.not === null ? have == null : have === want.not)) return false;
      if ("in" in want && !want.in.includes(have)) return false;
    } else if (have !== want) return false;
  }
  return true;
}

let seq = 0;
function fakeDb({ turn = OPEN_TURN, people = [], combat = {}, participants = [] } = {}) {
  const chars = new Map(people.map((p) => [p.id, { ...p }]));
  const fight = {
    id: "c1",
    turnId: turn.id,
    locationId: "gate",
    endedAt: null,
    endReason: null,
    resolvedAt: null,
    resolvedByDiscordUserId: null,
    reopenedAt: null,
    distances: {},
    ...combat,
  };
  const rows = participants.map((p) => ({
    id: `p${++seq}`,
    combatId: "c1",
    activeTurnId: null,
    alert: true,
    callOffAt: null,
    compelled: false,
    description: null,
    leftAt: null,
    leftReason: null,
    answeredAt: null,
    joinedAt: new Date(Date.now() - HOUR),
    ...p,
  }));
  const withJoins = (r) => ({ ...r, combat: fight, character: chars.get(r.characterId) });
  const db = {
    rows,
    fight,
    chars,
    gameConfig: { findUnique: async () => ({}), findFirst: async () => ({}) },
    gameState: { findUnique: async () => ({ phase: "RUNNING", sessionOpenedAt: null }), findFirst: async () => ({ phase: "RUNNING" }) },
    turn: { findFirst: async () => turn },
    location: { findUnique: async ({ where }) => ({ id: where.id, name: `Place ${where.id}` }) },
    character: {
      findUnique: async ({ where }) => chars.get(where.id) ?? null,
      findMany: async ({ where }) => [...chars.values()].filter((c) => matches(c, where)),
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const c of chars.values()) {
          if (!matches(c, where)) continue;
          Object.assign(c, data);
          count++;
        }
        return { count };
      },
    },
    combat: {
      findUnique: async () => fight,
      findFirst: async () => fight,
      updateMany: async ({ where, data }) => {
        const resolvedWanted = where.resolvedAt && where.resolvedAt.not === null;
        if (where.id !== fight.id) return { count: 0 };
        if ("endedAt" in where && where.endedAt === null && fight.endedAt) return { count: 0 };
        if (resolvedWanted && !fight.resolvedAt) return { count: 0 };
        Object.assign(fight, data);
        return { count: 1 };
      },
    },
    combatParticipant: {
      findFirst: async ({ where }) => {
        const r = rows.find((x) => matches(x, where));
        return r ? withJoins(r) : null;
      },
      findUnique: async ({ where }) => {
        const r = rows.find((x) => x.id === where.id);
        return r ? withJoins(r) : null;
      },
      findMany: async ({ where }) => rows.filter((x) => matches(x, where)).map(withJoins),
      count: async ({ where }) => rows.filter((x) => matches(x, where)).length,
      update: async ({ where, data }) => Object.assign(rows.find((x) => x.id === where.id), data),
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const r of rows) {
          if (!matches(r, where)) continue;
          Object.assign(r, data);
          count++;
        }
        return { count };
      },
      createMany: async ({ data }) => {
        for (const d of data) rows.push({ id: `p${++seq}`, callOffAt: null, leftAt: null, leftReason: null, description: null, ...d });
        return { count: data.length };
      },
    },
  };
  return db;
}

const row = (db, characterId) => db.rows.find((r) => r.characterId === characterId);

// --- the arrival ------------------------------------------------------------------------------------------

test("arriving at a fight's own place never takes you out of it", async () => {
  const db = fakeDb({
    people: [person("ada"), person("bo")],
    participants: [
      { characterId: "ada", side: "ATTACKER", role: "INITIATOR", status: "JOINED", activeTurnId: "t1" },
      { characterId: "bo", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
    ],
  });
  // Bo walked into Ada's ambush at the gate: the arrival's side effects run after the walk put him in it.
  const out = await leaveCombatsFor(db, "bo", "moved", { unlessAt: "gate" });
  assert.equal(out.left, 0);
  assert.equal(row(db, "bo").status, "JOINED");
  assert.equal(row(db, "bo").activeTurnId, "t1");
  assert.equal(db.fight.endedAt, null, "the fight goes on");
});

test("being taken somewhere else still takes you out, and an emptied side still ends it", async () => {
  const db = fakeDb({
    people: [person("ada"), person("bo", { locationId: "keep" })],
    participants: [
      { characterId: "ada", side: "ATTACKER", role: "INITIATOR", status: "JOINED", activeTurnId: "t1" },
      { characterId: "bo", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
    ],
  });
  const out = await leaveCombatsFor(db, "bo", "moved", { unlessAt: "keep" });
  assert.equal(out.left, 1);
  assert.equal(row(db, "bo").status, "LEFT");
  assert.equal(db.fight.endReason, "SIDE_EMPTY");
});

test("death always takes you out, wherever the fight is", async () => {
  const db = fakeDb({
    people: [person("ada"), person("bo"), person("cy")],
    participants: [
      { characterId: "ada", side: "ATTACKER", role: "INITIATOR", status: "JOINED", activeTurnId: "t1" },
      { characterId: "bo", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
      { characterId: "cy", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
    ],
  });
  await leaveCombatsFor(db, "bo", "died");
  assert.equal(row(db, "bo").status, "LEFT");
  assert.equal(row(db, "bo").leftReason, "died");
  assert.equal(db.fight.endedAt, null, "Cy is still defending");
});

test("the last attacker who hadn't pressed Call off leaving completes the call-off", async () => {
  const db = fakeDb({
    people: [person("ada"), person("dee"), person("bo")],
    participants: [
      { characterId: "ada", side: "ATTACKER", role: "INITIATOR", status: "JOINED", activeTurnId: "t1", callOffAt: new Date() },
      { characterId: "dee", side: "ATTACKER", role: "COLLABORATOR", status: "JOINED", activeTurnId: "t1" },
      { characterId: "bo", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
    ],
  });
  await leaveCombatsFor(db, "dee", "died");
  assert.equal(db.fight.endReason, "CALLED_OFF");
  assert.equal(db.chars.get("ada").heldReason, "withdrawing", "the attackers wait their thirty minutes");
  assert.equal(db.chars.get("bo").heldReason, null, "the defenders go free");
});

// --- the lock -------------------------------------------------------------------------------------------

test("nobody can intervene once Moves lock", async () => {
  const db = fakeDb({
    turn: LOCKED_TURN,
    people: [person("ada"), person("bo"), person("cy")],
    combat: { distances: { cy: [0, "gate"] } },
    participants: [
      { characterId: "ada", side: "ATTACKER", role: "INITIATOR", status: "JOINED", activeTurnId: "t1" },
      { characterId: "bo", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
    ],
  });
  for (const side of ["ATTACKER", "DEFENDER"]) {
    const out = await intervene(db, { character: { id: "cy" }, combatId: "c1", side, turn: LOCKED_TURN });
    assert.equal(out.ok, false);
    assert.equal(out.error, ATTACK_LOCKED);
  }
  assert.equal(row(db, "cy"), undefined, "nothing written");
});

test("an escort does not step in once Moves lock either", async () => {
  const db = fakeDb({
    turn: LOCKED_TURN,
    people: [person("ada"), person("bo"), person("gus", { guardingId: "bo" })],
    participants: [
      { characterId: "ada", side: "ATTACKER", role: "INITIATOR", status: "JOINED", activeTurnId: "t1" },
      { characterId: "bo", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
    ],
  });
  await escortsStepIn(db, { combatId: "c1", turn: LOCKED_TURN });
  assert.equal(row(db, "gus"), undefined);
});

test("somebody who left can't come back into it once Moves lock", async () => {
  const db = fakeDb({
    turn: LOCKED_TURN,
    people: [person("ada"), person("bo"), person("cy")],
    participants: [
      { characterId: "ada", side: "ATTACKER", role: "INITIATOR", status: "JOINED", activeTurnId: "t1" },
      { characterId: "bo", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
      { characterId: "cy", side: "DEFENDER", role: "TARGET", status: "LEFT", leftReason: "moved" },
    ],
  });
  const out = await intervene(db, { character: { id: "cy" }, combatId: "c1", side: "DEFENDER", turn: LOCKED_TURN });
  assert.equal(out.error, ATTACK_LOCKED);
  assert.equal(row(db, "cy").status, "LEFT");
});

// --- coming back ----------------------------------------------------------------------------------------

test("somebody who left may come back in, on either side, as a new place in the fight", async () => {
  const db = fakeDb({
    people: [person("ada"), person("bo"), person("cy")],
    combat: { distances: { cy: [2, "keep"] } },
    participants: [
      { characterId: "ada", side: "ATTACKER", role: "INITIATOR", status: "JOINED", activeTurnId: "t1" },
      { characterId: "bo", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
      {
        characterId: "cy",
        side: "DEFENDER",
        role: "TARGET",
        status: "LEFT",
        leftAt: new Date(),
        leftReason: "moved",
        description: "I hold the line.",
      },
    ],
  });
  const out = await intervene(db, { character: { id: "cy" }, combatId: "c1", side: "ATTACKER", turn: OPEN_TURN });
  assert.equal(out.ok, true, out.error);
  const cy = row(db, "cy");
  assert.equal(db.rows.filter((r) => r.characterId === "cy").length, 1, "still one row");
  assert.equal(cy.status, "JOINED");
  assert.equal(cy.side, "ATTACKER");
  assert.equal(cy.role, "INTERVENER");
  assert.equal(cy.cameBackFrom, "LEFT");
  assert.equal(cy.activeTurnId, "t1");
  assert.equal(cy.leftAt, null);
  assert.equal(cy.leftReason, null);
  assert.equal(cy.description, null, "what they wrote before was for their old place");
  assert.equal(cy.distance, 2, "the usual distance rule");
});

test("a decliner coming back is still kept off the attackers, and marked on the defenders", async () => {
  const db = fakeDb({
    people: [person("ada"), person("bo"), person("dee")],
    combat: { distances: { dee: [0, "gate"] } },
    participants: [
      { characterId: "ada", side: "ATTACKER", role: "INITIATOR", status: "JOINED", activeTurnId: "t1" },
      { characterId: "bo", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
      { characterId: "dee", side: "ATTACKER", role: "COLLABORATOR", status: "DECLINED", answeredAt: new Date() },
    ],
  });
  assert.equal((await intervene(db, { character: { id: "dee" }, combatId: "c1", side: "ATTACKER", turn: OPEN_TURN })).error, DECLINED_ATTACKERS);
  const out = await intervene(db, { character: { id: "dee" }, combatId: "c1", side: "DEFENDER", turn: OPEN_TURN });
  assert.equal(out.ok, true, out.error);
  assert.equal(row(db, "dee").cameBackFrom, "DECLINED");
  assert.equal(row(db, "dee").side, "DEFENDER");
});

test("somebody still in the fight is told so, not let in twice", async () => {
  const db = fakeDb({
    people: [person("ada"), person("bo"), person("cy")],
    participants: [
      { characterId: "ada", side: "ATTACKER", role: "INITIATOR", status: "JOINED", activeTurnId: "t1" },
      { characterId: "bo", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
      { characterId: "cy", side: "ATTACKER", role: "COLLABORATOR", status: "INVITED", activeTurnId: "t1" },
    ],
  });
  const out = await intervene(db, { character: { id: "cy" }, combatId: "c1", side: "DEFENDER", turn: OPEN_TURN });
  assert.equal(out.error, ALREADY_FIGHTING);
});

// --- a solved fight -------------------------------------------------------------------------------------

test("somebody intervening in a solved fight takes the Solved stamp off it", async () => {
  const solvedAt = new Date(Date.now() - 5 * 60 * 1000);
  const db = fakeDb({
    people: [person("ada"), person("bo"), person("cy")],
    combat: { resolvedAt: solvedAt, resolvedByDiscordUserId: "gm-1", resultMessage: "Bo is wounded.", distances: { cy: [1, "keep"] } },
    participants: [
      { characterId: "ada", side: "ATTACKER", role: "INITIATOR", status: "JOINED", activeTurnId: "t1" },
      { characterId: "bo", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
    ],
  });
  const out = await intervene(db, { character: { id: "cy" }, combatId: "c1", side: "DEFENDER", turn: OPEN_TURN });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.reopened, true);
  assert.equal(db.fight.resolvedAt, null);
  assert.equal(db.fight.resolvedByDiscordUserId, null);
  assert.ok(db.fight.reopenedAt instanceof Date, "marked Reopened for the desk");
  assert.equal(db.fight.resultMessage, "Bo is wounded.", "the GM's ruling text is kept to work from");
});

test("an unsolved fight is not marked reopened", async () => {
  const db = fakeDb({
    people: [person("ada"), person("bo"), person("cy")],
    combat: { distances: { cy: [0, "gate"] } },
    participants: [
      { characterId: "ada", side: "ATTACKER", role: "INITIATOR", status: "JOINED", activeTurnId: "t1" },
      { characterId: "bo", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
    ],
  });
  const out = await intervene(db, { character: { id: "cy" }, combatId: "c1", side: "DEFENDER", turn: OPEN_TURN });
  assert.equal(out.reopened, false);
  assert.equal(db.fight.reopenedAt, null);
});

test("an invitee joining a solved fight reopens it too", async () => {
  const db = fakeDb({
    people: [person("ada"), person("bo"), person("dee")],
    combat: { resolvedAt: new Date(), resolvedByDiscordUserId: "gm-1" },
    participants: [
      { characterId: "ada", side: "ATTACKER", role: "INITIATOR", status: "JOINED", activeTurnId: "t1" },
      { characterId: "bo", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
      { characterId: "dee", side: "ATTACKER", role: "COLLABORATOR", status: "INVITED", activeTurnId: "t1" },
    ],
  });
  const out = await answerInvite(db, { participantId: row(db, "dee").id, characterId: "dee", join: true, turn: OPEN_TURN });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.reopened, true);
  assert.equal(db.fight.resolvedAt, null);
});

test("an invitee who has been tied up since can't join", async () => {
  const bound = { tagId: "bound", equipped: false, quantity: 1, tag: { slug: "bound", name: "Bound" } };
  const db = fakeDb({
    people: [person("ada"), person("bo"), person("dee", { tags: [bound] })],
    participants: [
      { characterId: "ada", side: "ATTACKER", role: "INITIATOR", status: "JOINED", activeTurnId: "t1" },
      { characterId: "bo", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
      { characterId: "dee", side: "ATTACKER", role: "COLLABORATOR", status: "INVITED", activeTurnId: "t1" },
    ],
  });
  const out = await answerInvite(db, { participantId: row(db, "dee").id, characterId: "dee", join: true, turn: OPEN_TURN });
  assert.equal(out.ok, false);
  assert.match(out.error, /Bound/);
  assert.equal(row(db, "dee").status, "INVITED");
});

// --- escorts --------------------------------------------------------------------------------------------

test("an escort beside their charge steps in from no distance, and their row names the charge", async () => {
  const db = fakeDb({
    people: [person("ada"), person("bo"), person("gus", { guardingId: "bo" })],
    // Far off when the fight first started — an ambush's later catch brought them in with their charge.
    combat: { distances: { gus: [3, "keep"] } },
    participants: [
      { characterId: "ada", side: "ATTACKER", role: "INITIATOR", status: "JOINED", activeTurnId: "t1" },
      { characterId: "bo", side: "DEFENDER", role: "TARGET", status: "JOINED", activeTurnId: "t1" },
    ],
  });
  await escortsStepIn(db, { combatId: "c1", turn: OPEN_TURN });
  const gus = row(db, "gus");
  assert.ok(gus, "the escort is in the fight");
  assert.equal(gus.side, "DEFENDER");
  assert.equal(gus.role, "INTERVENER");
  assert.equal(gus.escortOfId, "bo");
  assert.equal(gus.distance, 0);
  assert.equal(gus.fromLocationName, null);
  assert.ok(!gus.modifiers.some((m) => /late/i.test(m.label)), "no arrived-late penalty");
});
