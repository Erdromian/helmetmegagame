// The Meister's Terminal and the daily wages (docs/systemdocs/MEISTERY.md,
// E:\Bascinet\V3\Fates\Meistery.docx): the rules on their own, the gate
// against a hand-made Prisma, and the writes end to end against Postgres. The
// last test skips unless DATABASE_URL is a local one (db/lib/localDatabase.js),
// makes its own characters, and deletes them after.
process.env.LOCAL_MODE = "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isLocalDatabase } = require("../lib/localDatabase");
const { isLockedAccount, displayBalance, wageFor, wholeWithin, meisterActor } = require("../lib/meisterTerminal");
const { wageDaysDue, wageLines } = require("../lib/wagePass");
const { MAX_BALANCE, MAX_WAGE } = require("../lib/meisterTerminalText");

const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

// ─── The rules ───────────────────────────────────────────────────────────

test("only the Crown's account, the Baron's, is locked", () => {
  assert.equal(isLockedAccount({ class: "CROWN" }), true);
  assert.equal(isLockedAccount({ class: "TREASURY" }), false);
  assert.equal(isLockedAccount({ class: "OFFSHORE" }), false);
  assert.equal(isLockedAccount(null), false);
});

test("the Crown's account shows the Vault; everybody else's shows their balance", () => {
  assert.equal(displayBalance({ class: "CROWN", balanceObols: 36 }, 250), 250);
  assert.equal(displayBalance({ class: "TREASURY", balanceObols: 36 }, 250), 36);
});

test("a character's own wage beats their fate's, and 0 exempts them", () => {
  assert.deepEqual(wageFor({ characterWage: 5, roleWage: 2 }), { amount: 5, source: "character" });
  assert.deepEqual(wageFor({ characterWage: 0, roleWage: 2 }), { amount: 0, source: "character" });
  assert.deepEqual(wageFor({ characterWage: null, roleWage: -3 }), { amount: -3, source: "fate" });
  assert.deepEqual(wageFor({}), { amount: 0, source: null });
});

test("balances and wages are whole numbers within their bounds", () => {
  assert.equal(wholeWithin("12", MAX_BALANCE), 12);
  assert.equal(wholeWithin("-4", MAX_WAGE), -4);
  assert.equal(wholeWithin("1.5", MAX_WAGE), null);
  assert.equal(wholeWithin("", MAX_WAGE), null);
  assert.equal(wholeWithin(MAX_WAGE + 1, MAX_WAGE), null);
  assert.equal(wholeWithin("abc", MAX_BALANCE), null);
});

// ─── When wages are paid ─────────────────────────────────────────────────

test("a close pays its day only when the next turn opens on a new one", () => {
  assert.deepEqual(wageDaysDue({ turnDay: 4, nextDay: 4, knownDays: new Set([3]), paid: new Set([3]) }), []);
  assert.deepEqual(wageDaysDue({ turnDay: 4, nextDay: 5, knownDays: new Set([3]), paid: new Set([3]) }), [4]);
  // Already paid: a resumed close pays nothing twice.
  assert.deepEqual(wageDaysDue({ turnDay: 4, nextDay: 5, knownDays: new Set([3]), paid: new Set([3, 4]) }), []);
});

test("yesterday is paid late if a close missed it", () => {
  // The day rolled between one turn closing and the next opening.
  assert.deepEqual(wageDaysDue({ turnDay: 5, nextDay: 5, knownDays: new Set([4]), paid: new Set() }), [4]);
  assert.deepEqual(wageDaysDue({ turnDay: 5, nextDay: 6, knownDays: new Set([4]), paid: new Set() }), [4, 5]);
  // A day no turn ever sat on is never back-paid, and day 1 has no yesterday.
  assert.deepEqual(wageDaysDue({ turnDay: 5, nextDay: 5, knownDays: new Set(), paid: new Set() }), []);
  assert.deepEqual(wageDaysDue({ turnDay: 1, nextDay: 1, knownDays: new Set([0]), paid: new Set() }), []);
});

test("who is owed what: the Baron and the exempt are skipped, the order is the lock order", () => {
  const people = [
    { id: "c-b", status: "ALIVE", roleId: "r-guard", role: { slug: "cerberus" }, bankAccount: { id: "acc-2", class: "TREASURY", holderName: "B" } },
    { id: "c-a", status: "ALIVE", roleId: "r-guard", role: { slug: "cerberus" }, bankAccount: { id: "acc-1", class: "TREASURY", holderName: "A" } },
    { id: "c-x", status: "ALIVE", roleId: "r-guard", role: { slug: "cerberus" }, bankAccount: { id: "acc-3", class: "TREASURY", holderName: "X" } },
    { id: "c-baron", status: "ALIVE", roleId: "r-baron", role: { slug: "baron" }, bankAccount: { id: "acc-0", class: "CROWN", holderName: "Baron" } },
    { id: "c-none", status: "ALIVE", roleId: "r-guard", role: { slug: "cerberus" }, bankAccount: null },
  ];
  const wages = [
    { roleId: "r-guard", characterId: null, amountObols: 3 },
    { roleId: "r-baron", characterId: null, amountObols: 50 },
    { roleId: null, characterId: "c-x", amountObols: 0 },
    { roleId: null, characterId: "c-b", amountObols: -2 },
  ];
  assert.deepEqual(
    wageLines(people, wages).map((l) => [l.accountId, l.amount]),
    [
      ["acc-1", 3],
      ["acc-2", -2],
    ],
  );
});

// ─── The gate, against a hand-made Prisma ────────────────────────────────

const STUDY = { id: "room-study", name: "Meister's Study", locationId: "loc-tower", accessTagSlugs: ["meisters-key", "hands-key", "barons-key"] };

function ringOn(tokens) {
  return {
    equipped: true,
    tag: { slug: "ring-x", ringOfCharacterId: "c1", ringRegisteredAt: new Date(), ringAccessSlugs: tokens },
  };
}

function fakePrisma({ locationId = "loc-tower", tags = [], alive = true }) {
  return {
    character: {
      async findFirst() {
        return alive ? { id: "c1", name: "Aurel", locationId, tags } : null;
      },
    },
    room: {
      async findUnique() {
        return STUDY;
      },
    },
    characterTag: {
      async findMany() {
        return tags;
      },
    },
  };
}

test("the Meister's, the Hand's and the Baron's rings work the terminal", async () => {
  for (const token of ["meisters-key", "hands-key", "barons-key"]) {
    const out = await meisterActor(fakePrisma({ tags: [ringOn([token, "tower-key"])] }), "u1");
    assert.equal(out.ok, true, token);
  }
});

test("the Censor's ring gets into the Tower but not the terminal", async () => {
  const out = await meisterActor(fakePrisma({ tags: [ringOn(["censors-key", "tower-key"])] }), "u1");
  assert.equal(out.ok, false);
});

test("a ring in a pocket opens nothing", async () => {
  const pocketed = { ...ringOn(["meisters-key"]), equipped: false };
  const out = await meisterActor(fakePrisma({ tags: [pocketed] }), "u1");
  assert.equal(out.ok, false);
});

test("the right ring in the wrong place is refused", async () => {
  const out = await meisterActor(fakePrisma({ locationId: "loc-depot", tags: [ringOn(["meisters-key"])] }), "u1");
  assert.equal(out.ok, false);
  assert.match(out.error, /Study/);
});

test("a write is refused to somebody who cannot act; a read is not", async () => {
  const tags = [ringOn(["meisters-key"]), { equipped: false, tag: { slug: "bound", name: "Bound" } }];
  assert.equal((await meisterActor(fakePrisma({ tags }), "u1")).ok, true);
  const out = await meisterActor(fakePrisma({ tags }), "u1", { acting: true });
  assert.equal(out.ok, false);
  assert.match(out.error, /Bound/);
});

test("no living character is refused", async () => {
  assert.equal((await meisterActor(fakePrisma({ alive: false }), "u1")).ok, false);
});

// ─── The writes, against Postgres ────────────────────────────────────────

test("balances, closing, wages and rings, end to end", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const M = require("../lib/meisterTerminal");
  const { payDailyWages } = require("../lib/wagePass");
  const { createRingRow } = require("../lib/ringMint");
  const { openAccount } = require("../lib/bankAccounts");

  const [tower, study, meisterRole, baronRole, cerberusRole] = await Promise.all([
    prisma.location.findUnique({ where: { slug: "fortress-5" } }),
    prisma.room.findUnique({ where: { slug: "fortress-5-2" } }),
    prisma.role.findUnique({ where: { slug: "meister" } }),
    prisma.role.findUnique({ where: { slug: "baron" } }),
    prisma.role.findUnique({ where: { slug: "cerberus" } }),
  ]);
  const wageTable = await prisma.wage.count().then(() => true).catch(() => false);
  if (!tower || !study?.accessTagSlugs?.includes("hands-key") || !meisterRole || !baronRole || !cerberusRole || !wageTable) {
    await prisma.$disconnect();
    return t.skip("the local database has not had the meistery migration — run npm run dev:setup");
  }

  const run = Math.random().toString(36).slice(2, 8);
  const made = [];
  const mintedTags = [];
  const closed = []; // accounts the test closes, whose ledger rows outlive them
  const day = 900000 + Math.floor(Math.random() * 90000);
  t.after(async () => {
    // The ledger rows this run wrote, before the accounts they name go.
    const accounts = (await prisma.bankAccount.findMany({ where: { characterId: { in: made } }, select: { id: true } })).map((a) => a.id);
    await prisma.economyEntry
      .deleteMany({ where: { OR: [{ fromId: { in: [...accounts, ...closed] } }, { toId: { in: [...accounts, ...closed] } }] } })
      .catch(() => {});
    await prisma.characterTag.deleteMany({ where: { characterId: { in: made } } });
    await prisma.tag.deleteMany({ where: { id: { in: mintedTags } } });
    await prisma.character.deleteMany({ where: { id: { in: made } } }); // accounts and wages cascade
    await prisma.wagePayout.deleteMany({ where: { dayNumber: { in: [day, day + 1] } } });
    await prisma.auditLog.deleteMany({ where: { actorDiscordUserId: { startsWith: `mst-test-${run}` } } }).catch(() => {});
    await prisma.$disconnect();
  });

  async function person(key, roleId) {
    const row = await prisma.character.create({
      data: {
        discordUserId: `mst-test-${run}-${key}`,
        firstName: key,
        lastName: "Test",
        name: `${key} Test`,
        status: "ALIVE",
        zoneId: tower.zoneId,
        locationId: tower.id,
        roleId,
      },
    });
    made.push(row.id);
    return row;
  }

  const meister = await person("Meister", meisterRole.id);
  const ring = await createRingRow(prisma, meister, { name: "Meister's Ring" });
  mintedTags.push(ring.id);
  await prisma.tag.update({
    where: { id: ring.id },
    data: { ringRegisteredAt: new Date(), ringAccessSlugs: ["meisters-key", "tower-key"], ringRoleSlugs: ["meister"] },
  });
  await prisma.characterTag.create({ data: { characterId: meister.id, tagId: ring.id, quantity: 1, equipped: true, source: "EVENT" } });
  const uid = meister.discordUserId;

  const guard = await person("Guard", cerberusRole.id);
  const guardAccount = await openAccount(prisma, guard);
  const baron = await person("Baron", baronRole.id);
  const baronAccount = await openAccount(prisma, baron, { accountClass: "CROWN" });

  // ── Balances ──
  let out = await M.setAccountBalance(prisma, uid, { accountId: guardAccount.id, balance: 40 });
  assert.equal(out.ok, true, out.error);
  assert.equal((await prisma.bankAccount.findUnique({ where: { id: guardAccount.id } })).balanceObols, 40);
  out = await M.setAccountBalance(prisma, uid, { accountId: guardAccount.id, balance: -5 });
  assert.equal(out.ok, true, out.error);
  assert.equal((await prisma.bankAccount.findUnique({ where: { id: guardAccount.id } })).balanceObols, -5);
  out = await M.setAccountBalance(prisma, uid, { accountId: guardAccount.id, balance: 10 });
  assert.equal((await prisma.bankAccount.findUnique({ where: { id: guardAccount.id } })).balanceObols, 10);
  // The Baron's is the treasury itself.
  out = await M.setAccountBalance(prisma, uid, { accountId: baronAccount.id, balance: 999 });
  assert.equal(out.ok, false);
  assert.equal((await M.closeAccount(prisma, uid, { accountId: baronAccount.id })).ok, false);
  // A stranger to the terminal is refused before anything moves.
  assert.equal((await M.setAccountBalance(prisma, guard.discordUserId, { accountId: guardAccount.id, balance: 1 })).ok, false);

  // ── Wages ──
  assert.equal((await M.setWage(prisma, uid, { roleId: baronRole.id, amount: 5 })).ok, false);
  assert.equal((await M.setWage(prisma, uid, { characterId: baron.id, amount: 5 })).ok, false);
  out = await M.setWage(prisma, uid, { characterId: guard.id, amount: 7 });
  assert.equal(out.ok, true, out.error);
  let paid = await payDailyWages(prisma, { dayNumber: day, characterIds: made });
  assert.equal(paid.already, false);
  assert.equal(paid.credited, 7);
  assert.equal((await prisma.bankAccount.findUnique({ where: { id: guardAccount.id } })).balanceObols, 17);
  // The same day again pays nothing.
  paid = await payDailyWages(prisma, { dayNumber: day, characterIds: made });
  assert.equal(paid.already, true);
  assert.equal((await prisma.bankAccount.findUnique({ where: { id: guardAccount.id } })).balanceObols, 17);
  // A deduction floors at 0.
  await M.setWage(prisma, uid, { characterId: guard.id, amount: -50 });
  paid = await payDailyWages(prisma, { dayNumber: day + 1, characterIds: made });
  assert.equal(paid.debited, 17);
  assert.equal((await prisma.bankAccount.findUnique({ where: { id: guardAccount.id } })).balanceObols, 0);
  assert.equal((await M.setWage(prisma, uid, { characterId: guard.id, amount: null })).ok, true);
  assert.equal(await prisma.wage.count({ where: { characterId: guard.id } }), 0);

  // ── Closing, and the ring coming back ──
  const guardRing = await createRingRow(prisma, guard, {});
  mintedTags.push(guardRing.id);
  await prisma.tag.update({
    where: { id: guardRing.id },
    data: {
      ringRegisteredAt: new Date(),
      ringRoleSlugs: ["cerberus"],
      ringAccessSlugs: ["cerberus-key"],
      ringBankAccountId: guardAccount.id,
    },
  });
  closed.push(guardAccount.id);
  out = await M.closeAccount(prisma, uid, { accountId: guardAccount.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(await prisma.bankAccount.count({ where: { id: guardAccount.id } }), 0);
  const loose = await prisma.tag.findUnique({ where: { id: guardRing.id } });
  assert.equal(loose.ringBankAccountId, null);
  assert.deepEqual(loose.ringAccessSlugs, ["cerberus-key"]);

  // The Meister holds it and connects it again: the account comes back, the doors don't grow.
  await prisma.characterTag.create({ data: { characterId: meister.id, tagId: guardRing.id, quantity: 1, source: "EVENT" } });
  const books = await M.meisterTerminalState(prisma, uid);
  assert.ok(books.rings.some((r) => r.tagId === guardRing.id && r.registered));
  out = await M.connectRing(prisma, uid, { ringTagId: guardRing.id, roleSlugs: ["baron"], newAccount: true });
  assert.equal(out.ok, true, out.error);
  const back = await prisma.tag.findUnique({ where: { id: guardRing.id } });
  assert.ok(back.ringBankAccountId);
  assert.deepEqual(back.ringRoleSlugs, ["cerberus"]);
  // Connected once is connected: a second press is refused.
  assert.equal((await M.connectRing(prisma, uid, { ringTagId: guardRing.id, newAccount: true })).ok, false);
});
