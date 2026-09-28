// Daily wages (Meistery.docx, docs/systemdocs/MEISTERY.md §4): "daily
// increases (or decreases if the wage is set as a negative) to a character's
// balance that occur at the end of each in game day (not necessarily each
// turn)". The Meister sets them at his terminal (db/lib/meisterTerminal.js);
// this pays them.
//
// WHEN. A turn close pays the day it belongs to if the NEXT turn opens on a
// new day — nextDayFor in db/index.js, the same measure the floor settle
// uses. That is exact when GameConfig.turnsPerDay counts the days, and nearly
// so on the midnight clock: a turn that closes before midnight whose successor
// opens after it rolls the day without this close seeing it. So every close
// also pays YESTERDAY if yesterday is still unpaid — the backstop, which also
// covers a wages pass that threw on the last close of a day.
//
// ONCE. WagePayout(dayNumber) is the claim, inserted in the same transaction
// as the credits, so no re-run — a resumed advance, a lost resolvedPasses
// write, two advances racing — pays a day twice.
//
// WHO. Every living character with an account, at their own wage if the
// Meister set one (0 exempts them), else their fate's. The Baron's account is
// the treasury itself and is never paid (meisterTerminal.js#isLockedAccount).
// A deduction floors at 0, or at the balance if it is already under zero
// (bankAccounts.js#bumpBankAccount): a wage never puts anybody into debt.
// Claim legs only, against the bank clearing: no coin moves, so every wage
// paid widens the gap between the claims and the Vault. No DMs.
//
// Takes `prisma` as a parameter and stays off the barrel.

const { bumpBankAccount } = require("./bankAccounts");
const { turnStamp } = require("./economyLedger");
const { isLockedAccount, wageFor } = require("./meisterTerminal");

/**
 * The days a close should pay, oldest first. Pure. `paid` is the WagePayout
 * days already claimed; `knownDays` the days any turn has carried (a day no
 * turn ever sat on is never back-paid).
 */
function wageDaysDue({ turnDay, nextDay, paid = new Set(), knownDays = new Set() }) {
  const due = [];
  const day = Number.isInteger(turnDay) && turnDay >= 1 ? turnDay : 1;
  const yesterday = day - 1;
  if (yesterday >= 1 && knownDays.has(yesterday) && !paid.has(yesterday)) due.push(yesterday);
  if (nextDay != null && nextDay !== day && !paid.has(day)) due.push(day);
  return due;
}

/** Who is owed what, as set now. Pure over the rows payDailyWages loads. */
function wageLines(people, wages) {
  const roleWage = new Map(wages.filter((w) => w.roleId).map((w) => [w.roleId, w.amountObols]));
  const characterWage = new Map(wages.filter((w) => w.characterId).map((w) => [w.characterId, w.amountObols]));
  const lines = [];
  for (const person of people) {
    const account = person.bankAccount;
    if (!account) continue;
    const shape = { class: account.class, roleSlug: person.role?.slug ?? null, status: person.status };
    if (isLockedAccount(shape)) continue;
    const { amount } = wageFor({
      characterWage: characterWage.get(person.id) ?? null,
      roleWage: person.roleId ? (roleWage.get(person.roleId) ?? null) : null,
    });
    if (!amount) continue;
    lines.push({ characterId: person.id, accountId: account.id, holderName: account.holderName, amount });
  }
  // Account-id order, the order db/lib/depotCounter.js#bankSend locks in, so a
  // payout can never deadlock against a transfer.
  return lines.sort((a, b) => (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0));
}

// `characterIds` narrows who is looked at — for a test, which must never pay
// anybody but its own characters in a database somebody is playing in.
async function payDailyWages(prisma, { dayNumber, turn = null, characterIds = null }) {
  const [people, wages] = await Promise.all([
    prisma.character.findMany({
      where: { status: "ALIVE", bankAccount: { isNot: null }, ...(characterIds ? { id: { in: characterIds } } : {}) },
      select: {
        id: true,
        status: true,
        roleId: true,
        role: { select: { slug: true } },
        bankAccount: { select: { id: true, class: true, holderName: true } },
      },
    }),
    prisma.wage.findMany({ select: { roleId: true, characterId: true, amountObols: true } }),
  ]);
  const lines = wageLines(people, wages);

  try {
    return await prisma.$transaction(
      async (tx) => {
        // The claim first. A day already claimed pays nothing.
        if (await tx.wagePayout.findUnique({ where: { dayNumber }, select: { dayNumber: true } })) {
          return { already: true, dayNumber, characters: 0, credited: 0, debited: 0 };
        }
        await tx.wagePayout.create({ data: { dayNumber, turnNumber: turn?.number ?? null } });

        let characters = 0;
        let credited = 0;
        let debited = 0;
        for (const line of lines) {
          const moved = await bumpBankAccount(tx, line.accountId, line.amount, {
            holderName: line.holderName,
            econ: { reason: line.amount > 0 ? "WAGE" : "WAGE_DEDUCTION", ...turnStamp(turn) },
          });
          if (!moved.delta) continue;
          characters += 1;
          if (moved.delta > 0) credited += moved.delta;
          else debited += -moved.delta;
        }
        await tx.wagePayout.update({
          where: { dayNumber },
          data: { characters, creditedObols: credited, debitedObols: debited },
        });
        return { already: false, dayNumber, characters, credited, debited };
      },
      { timeout: 60_000 },
    );
  } catch (err) {
    // Two closes racing for one day: the loser's insert hits the key.
    if (err?.code === "P2002") return { already: true, dayNumber, characters: 0, credited: 0, debited: 0 };
    throw err;
  }
}

/**
 * The turn pass. `nextDay` is the day the next turn will open on. Always
 * answers an object, so runPass records the pass even on a close that pays
 * nothing.
 */
async function runWagePass(prisma, turn, { nextDay = null } = {}) {
  const turnDay = turn?.dayNumber ?? 1;
  const [paidRows, yesterdayTurns] = await Promise.all([
    prisma.wagePayout.findMany({ where: { dayNumber: { in: [turnDay - 1, turnDay] } }, select: { dayNumber: true } }),
    turnDay > 1 ? prisma.turn.count({ where: { dayNumber: turnDay - 1 } }) : 0,
  ]);
  const due = wageDaysDue({
    turnDay,
    nextDay,
    paid: new Set(paidRows.map((r) => r.dayNumber)),
    knownDays: new Set(yesterdayTurns ? [turnDay - 1] : []),
  });

  const summary = { paidDays: [], characters: 0, credited: 0, debited: 0 };
  for (const dayNumber of due) {
    const paid = await payDailyWages(prisma, { dayNumber, turn });
    if (paid.already) continue;
    summary.paidDays.push(dayNumber);
    summary.characters += paid.characters;
    summary.credited += paid.credited;
    summary.debited += paid.debited;
  }
  return summary;
}

module.exports = { wageDaysDue, wageLines, payDailyWages, runWagePass };
