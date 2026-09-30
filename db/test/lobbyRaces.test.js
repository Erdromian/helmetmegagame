// node --test over the lobby's writes that race a player: Decline, the
// creation-window sweep, the assignment-DM claim, and Start Game's commit.
// Run with `npm test --workspace=db`.
//
// Each of these used to read a LobbyEntry, decide, then write it back by id
// with no condition — so a character finished between the read and the write
// had its CREATED row overwritten, and Start 500'd when somebody unreadied
// mid-commit. The fake below lets a test move the row "concurrently", right
// after the read, which is exactly the window those bugs lived in.
//
// Like riteSweep.test.js, Prisma is faked with just the queries these paths
// make. When a test needs another query, teach the fake that one query.
const test = require("node:test");
const assert = require("node:assert/strict");

const { declineAssignment, claimNotification, commitAssignment, startProblems } = require("../lib/lobby");
const { runLobbySweep } = require("../lib/lobbySweep");

// ---- the fake ---------------------------------------------------------------

function matches(row, where = {}) {
  for (const [key, cond] of Object.entries(where)) {
    const value = row[key];
    if (cond instanceof Date) {
      if (value?.getTime() !== cond.getTime()) return false;
    } else if (cond && typeof cond === "object") {
      if ("in" in cond && !cond.in.includes(value)) return false;
      if ("not" in cond && value === cond.not) return false;
      if ("gt" in cond && !(value > cond.gt)) return false;
      if ("lte" in cond && !(value <= cond.lte)) return false;
    } else if (value !== cond) return false;
  }
  return true;
}

// `onRead` runs once, after the first read of lobbyEntry — the other writer
// landing between this code's read and its write.
function makeDb({ entries, roles = [], phase = "CLOSED", onRead = null }) {
  const audit = [];
  let pending = onRead;
  const afterRead = () => {
    const hook = pending;
    pending = null;
    if (hook) hook(entries);
  };
  const copy = (row) => (row ? { ...row } : null);
  const lobbyEntry = {
    async findUnique({ where }) {
      const row = copy(entries.find((e) => matches(e, where)));
      afterRead();
      return row;
    },
    async findMany({ where }) {
      const rows = entries.filter((e) => matches(e, where)).map(copy);
      if (rows.length) afterRead();
      return rows;
    },
    async updateMany({ where, data }) {
      const rows = entries.filter((e) => matches(e, where));
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
    async update({ where, data }) {
      const row = entries.find((e) => matches(e, where));
      if (!row) throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
      return copy(Object.assign(row, data));
    },
    async groupBy() {
      return [];
    },
  };
  const db = {
    lobbyEntry,
    auditLog: {
      async create({ data }) {
        audit.push(data);
        return data;
      },
    },
    role: {
      async findMany() {
        return roles.map((r) => ({ ...r, startingLocation: null }));
      },
    },
    character: { groupBy: async () => [] },
    roleReservation: { groupBy: async () => [] },
    gameState: {
      async findUnique() {
        return { id: 1, phase };
      },
    },
    // The first read of the commit's own rows happens inside validateDraft;
    // this is the next query after it, the moment an unready lands.
    gameConfig: {
      async upsert() {
        afterRead();
        return { id: 1 };
      },
    },
    async $queryRaw() {
      return [];
    },
    async $transaction(fn) {
      return fn(db);
    },
  };
  return { db, audit };
}

const HOUR = 3600 * 1000;

function assigned(overrides = {}) {
  return {
    id: "e1",
    discordUserId: "u1",
    status: "ASSIGNED",
    assignedRoleId: "r1",
    assignedRole: { name: "Sheriff" },
    assignedAt: new Date(Date.now() - 2 * HOUR),
    expiresAt: new Date(Date.now() + 10 * HOUR),
    notifiedAt: new Date(Date.now() - 2 * HOUR),
    reminderSentAt: null,
    ...overrides,
  };
}

// ---- Decline ----------------------------------------------------------------

test("Decline frees an assigned seat", async () => {
  const entries = [assigned()];
  const { db } = makeDb({ entries });
  const result = await declineAssignment(db, "e1", "u1");
  assert.equal(result.ok, true);
  assert.equal(entries[0].status, "DECLINED");
});

test("Decline does not overwrite a character finished after the read", async () => {
  const entries = [assigned()];
  const { db, audit } = makeDb({
    entries,
    onRead: (rows) => Object.assign(rows[0], { status: "CREATED", characterId: "c1" }),
  });
  const result = await declineAssignment(db, "e1", "u1");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "You already built the character.");
  assert.equal(entries[0].status, "CREATED");
  assert.equal(audit.length, 0);
});

// ---- the sweep --------------------------------------------------------------

test("the sweep does not expire a seat whose character was just built", async () => {
  const entries = [assigned({ expiresAt: new Date(Date.now() - 60_000), reminderSentAt: new Date() })];
  const { db, audit } = makeDb({
    entries,
    onRead: (rows) => Object.assign(rows[0], { status: "CREATED", characterId: "c1" }),
  });
  const result = await runLobbySweep(db);
  assert.equal(result.expired, 0);
  assert.equal(entries[0].status, "CREATED");
  assert.equal(audit.length, 0);
});

test("the sweep sends no reminder for a seat taken since the read", async () => {
  const entries = [assigned({ expiresAt: new Date(Date.now() + HOUR) })];
  const { db } = makeDb({
    entries,
    onRead: (rows) => Object.assign(rows[0], { status: "CREATED", characterId: "c1" }),
  });
  const result = await runLobbySweep(db);
  assert.equal(result.reminded, 0);
  assert.equal(entries[0].reminderSentAt, null);
});

// ---- the assignment DM ------------------------------------------------------

test("only one sender claims an assignment DM", async () => {
  const entries = [assigned({ notifiedAt: null })];
  const { db } = makeDb({ entries });
  assert.equal(await claimNotification(db, "e1"), true);
  assert.equal(await claimNotification(db, "e1"), false);
});

test("a resend that fails hands its claim back, so the next sweep tries again", async () => {
  const entries = [assigned({ notifiedAt: null })];
  const { db } = makeDb({ entries });
  const refused = async () => {
    throw new Error("Cannot send messages to this user");
  };
  const first = await runLobbySweep(db, { send: refused });
  assert.equal(first.resent, 0);
  assert.equal(entries[0].notifiedAt, null);

  const sent = [];
  const second = await runLobbySweep(db, { send: async (_db, userId) => sent.push(userId) });
  assert.equal(second.resent, 1);
  assert.deepEqual(sent, ["u1"]);
  assert.ok(entries[0].notifiedAt instanceof Date);
});

test("a settled seat is never claimed for an assignment DM", async () => {
  const entries = [assigned({ notifiedAt: null, status: "CREATED" })];
  const { db } = makeDb({ entries });
  assert.equal(await claimNotification(db, "e1"), false);
});

// ---- Start Game -------------------------------------------------------------

test("an unready mid-commit is 'the lobby changed', not a crash", async () => {
  const entries = [
    { id: "e1", discordUserId: "u1", status: "READY" },
    { id: "e2", discordUserId: "u2", status: "READY" },
  ];
  const roles = [{ id: "r1", slug: "sheriff", name: "Sheriff", isUnique: true, unlimited: false, weight: null }];
  const draft = {
    seed: "s",
    playerCount: 3,
    rows: [
      { discordUserId: "u1", roleSlug: "sheriff", source: "HIGH" },
      { discordUserId: "u2", roleSlug: null, source: "FALLBACK" },
    ],
  };
  const { db } = makeDb({
    entries,
    roles,
    // u2 unreadies after validateDraft has passed.
    onRead: (rows) => rows.splice(rows.findIndex((r) => r.discordUserId === "u2"), 1),
  });
  await assert.rejects(commitAssignment(db, draft), (err) => {
    assert.equal(err.message, "DRAFT_STALE");
    assert.deepEqual(err.problems, ["Somebody in the preview is no longer ready."]);
    return true;
  });
});

test("Start's best-effort steps report what they could not do", () => {
  assert.deepEqual(startProblems({ zonesSynced: { created: 0, changed: 2 }, worldSeeded: { structures: {}, stashes: {}, unknown: [] } }), []);
  const problems = startProblems({
    zonesSynced: { error: "connection reset" },
    worldSeeded: {
      structures: { error: "no such tag" },
      stashes: { rooms: 3 },
      unknown: ["town-1-2: lantern"],
    },
  });
  assert.equal(problems.length, 3);
  assert.match(problems[0], /connection reset/);
  assert.match(problems[1], /structures could not be raised: no such tag/);
  assert.match(problems[2], /town-1-2: lantern/);
});
