// The Meister's Terminal, on the wall of the Meister's Study (fortress-5-2).
// Built from Bascinet's own design document, E:\Bascinet\V3\Fates\Meistery.docx —
// see docs/systemdocs/MEISTERY.md.
//
// It lists every treasury account, and whoever works it may:
//
//   - set the tax on the train's imports and exports (it fills the Vault);
//   - set any account's balance, or close the account outright;
//   - set a daily wage for a fate or for one character (db/lib/wagePass.js pays it);
//   - connect a ring in their hands to an account, if it has none yet
//     (db/lib/ringRegistry.js).
//
// THE GATE is standing in the Tower with a key to the Study, and the Study's
// keys are the Meister's, the Hand's and the Baron's rings ("gated behind
// meister/hand/baron ring access"). They are read off the Room's own
// accessTagSlugs rather than named here, so re-keying the Study in
// docs/zones.yaml moves the gate with it. A guest pass into the Study opens
// the door but not the terminal.
//
// THE BARON'S ACCOUNT can't be edited, closed or paid a wage: it is the
// treasury itself — the Crown account (class CROWN, db/lib/bankAccounts.js),
// whose balance is whatever the Vault holds.
//
// Returns `{ ok: true, … }` or `{ ok: false, error }`, the db/lib/blackMarket.js
// convention, so a refusal reads the same on the web dialog and the Discord
// panel. Takes `prisma` as a parameter and stays off the @lifeweb/db barrel.

const { MEISTERS_OFFICE_ROOM_SLUG } = require("./depot");
const { loadDepot } = require("./depotState");
const { bumpBankAccount, vaultObols, isCrown, TREASURY } = require("./bankAccounts");
const { turnStamp } = require("./economyLedger");
const { heldTagSlugs } = require("./roomAccess");
const { blockerFor, ACT } = require("./incapacitation");
const { groupRoles } = require("./roleGroups");
const { logAudit } = require("./auditLog");
const { connectableRingsHeld, ringSeats, connectRing: connectRingInDb } = require("./ringRegistry");
const {
  BARON_ROLE_SLUG,
  MAX_BALANCE,
  MAX_WAGE,
  MEISTER_TERMINAL_TEXT: T,
  fillMeisterText,
} = require("./meisterTerminalText");

function fail(error) {
  return { ok: false, error };
}

// ─── Pure rules ───────────────────────────────────────────────────────────────

/** Whether the terminal leaves this account alone: the Crown's, which is the Vault. */
function isLockedAccount(account) {
  return isCrown(account);
}

/** What the terminal shows as an account's balance: the Vault's coin for the Crown's. */
function displayBalance(account, vault) {
  return isLockedAccount(account) ? vault : (account?.balanceObols ?? 0);
}

/** A character's daily wage: their own if set (0 exempts them), else their fate's, else nothing. */
function wageFor({ characterWage = null, roleWage = null } = {}) {
  if (characterWage != null) return { amount: characterWage, source: "character" };
  if (roleWage != null) return { amount: roleWage, source: "fate" };
  return { amount: 0, source: null };
}

/** A whole number within ±bound, or null. `min` defaults to -bound. */
function wholeWithin(raw, bound, min = -bound) {
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > bound) return null;
  return n;
}

// ─── The gate ─────────────────────────────────────────────────────────────────

/**
 * Alive, standing in the Tower, holding or wearing one of the Study's keys,
 * and — for a write — able to act. Re-read on every press: a web dialog and a
 * Discord panel both outlive somebody walking out of the room.
 */
async function meisterActor(prisma, discordUserId, { acting = false } = {}) {
  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      locationId: true,
      tags: { select: { tagId: true, quantity: true, equipped: true, tag: true } },
    },
  });
  if (!character) return fail(T.noCharacter);

  const room = await prisma.room.findUnique({
    where: { slug: MEISTERS_OFFICE_ROOM_SLUG },
    select: { id: true, name: true, locationId: true, accessTagSlugs: true },
  });
  if (!room) return fail(T.noStudy);
  if (character.locationId !== room.locationId) return fail(T.notHere);

  if (acting) {
    const blocker = blockerFor(character.tags, ACT);
    if (blocker) return fail(fillMeisterText("cantAct", { state: blocker.name }));
  }

  const held = await heldTagSlugs(prisma, character.id);
  if (!(room.accessTagSlugs ?? []).some((slug) => held.has(slug))) return fail(T.accessDenied);

  return { ok: true, character, room, heldSlugs: held };
}

// ─── The books ────────────────────────────────────────────────────────────────

/**
 * Everything the terminal lists. No gate: the terminal calls it behind
 * meisterActor, and the GM's read-only copy on /gm/dev calls it bare.
 */
async function meisterBooks(prisma) {
  const [depot, vault, accountRows, staged, wageRows, roleRows] = await Promise.all([
    loadDepot(prisma),
    vaultObols(prisma),
    prisma.bankAccount.findMany({
      orderBy: { balanceObols: "desc" },
      select: {
        id: true,
        fingerprint: true,
        holderName: true,
        class: true,
        balanceObols: true,
        characterId: true,
        character: {
          select: { id: true, name: true, status: true, roleId: true, role: { select: { slug: true, name: true } } },
        },
        _count: { select: { rings: true } },
      },
    }),
    // What the next train will bring in and tax: the Merchant's Terminal's pending list.
    prisma.merchantOrder.findMany({ where: { deliveredAt: null }, select: { totalObols: true } }),
    prisma.wage.findMany({ select: { roleId: true, characterId: true, amountObols: true } }),
    prisma.role.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, slug: true, name: true, groupSlug: true },
    }),
  ]);

  const roleWage = new Map(wageRows.filter((w) => w.roleId).map((w) => [w.roleId, w.amountObols]));
  const characterWage = new Map(wageRows.filter((w) => w.characterId).map((w) => [w.characterId, w.amountObols]));

  const accounts = accountRows.map((a) => {
    const shape = {
      class: a.class,
      balanceObols: a.balanceObols,
      roleSlug: a.character?.role?.slug ?? null,
      status: a.character?.status ?? null,
    };
    const locked = isLockedAccount(shape);
    const wage = locked
      ? { amount: 0, source: null }
      : wageFor({
          characterWage: characterWage.get(a.characterId) ?? null,
          roleWage: a.character?.roleId ? (roleWage.get(a.character.roleId) ?? null) : null,
        });
    return {
      id: a.id,
      fingerprint: a.fingerprint,
      holderName: a.holderName,
      class: a.class,
      balanceObols: a.balanceObols,
      balance: displayBalance(shape, vault),
      locked,
      characterId: a.characterId,
      characterName: a.character?.name ?? a.holderName,
      status: a.character?.status ?? "",
      roleId: a.character?.roleId ?? null,
      roleSlug: shape.roleSlug ?? "",
      roleName: a.character?.role?.name ?? "",
      rings: a._count?.rings ?? 0,
      wage,
    };
  });

  // The claims the Vault backs. A Crown account is the Vault rather than a
  // claim on it, so its class keeps it out (and the Baron's stored balance,
  // before the Crown lands, is still a claim like any other).
  const claims = accounts.filter((a) => a.class === TREASURY).reduce((sum, a) => sum + a.balanceObols, 0);
  const onOrder = staged.reduce((sum, o) => sum + o.totalObols, 0);

  // What tonight's wages come to, as set — before the floor at 0 trims a
  // deduction nobody can pay.
  const dailyBill = { credit: 0, debit: 0 };
  for (const a of accounts) {
    if (a.status !== "ALIVE" || a.locked || !a.wage.amount) continue;
    if (a.wage.amount > 0) dailyBill.credit += a.wage.amount;
    else dailyBill.debit += -a.wage.amount;
  }

  // Every fate but the Baron's, in the picker's own order (court, clergy,
  // cerberon…), with how many living account holders it has right now.
  const holders = new Map();
  for (const a of accounts) {
    if (a.status === "ALIVE" && a.roleId) holders.set(a.roleId, (holders.get(a.roleId) ?? 0) + 1);
  }
  const fates = groupRoles(roleRows.filter((r) => r.slug !== BARON_ROLE_SLUG))
    .flatMap((g) => g.roles.map((r) => ({ ...r, groupName: g.name })))
    .map((r) => ({
      roleId: r.id,
      slug: r.slug,
      name: r.name,
      groupName: r.groupName,
      amount: roleWage.get(r.id) ?? null,
      holders: holders.get(r.id) ?? 0,
    }));

  const characterWages = accounts
    .filter((a) => characterWage.has(a.characterId))
    .map((a) => ({
      characterId: a.characterId,
      name: a.characterName,
      roleName: a.roleName,
      amount: characterWage.get(a.characterId),
    }));

  return {
    taxRate: depot.sellTaxRate ?? 0,
    vault,
    claims,
    onOrder,
    short: vault < claims,
    accounts,
    fates,
    characterWages,
    dailyBill,
    bounds: { maxBalance: MAX_BALANCE, maxWage: MAX_WAGE },
  };
}

/** The terminal's read: the books, plus the rings the person at it could connect. */
async function meisterTerminalState(prisma, discordUserId) {
  const actor = await meisterActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const [books, rings, seats] = await Promise.all([
    meisterBooks(prisma),
    connectableRingsHeld(prisma, actor.character.id),
    ringSeats(prisma, actor.heldSlugs),
  ]);
  return { ok: true, ...books, rings, seats };
}

// ─── Writes ───────────────────────────────────────────────────────────────────

// Loads one account with what the lock rule needs, inside `tx`, row-locked so
// a balance edit and a close cannot interleave with a withdrawal.
async function lockedAccountRow(tx, accountId) {
  const rows = await tx.$queryRaw`SELECT "id" FROM "BankAccount" WHERE "id" = ${accountId} FOR UPDATE`;
  if (!rows.length) return null;
  return tx.bankAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      fingerprint: true,
      holderName: true,
      class: true,
      balanceObols: true,
      characterId: true,
      character: { select: { status: true, role: { select: { slug: true } } } },
    },
  });
}

function lockShape(row) {
  return { class: row.class, roleSlug: row.character?.role?.slug ?? null, status: row.character?.status ?? null };
}

function userError(message) {
  return Object.assign(new Error(message), { userMessage: message });
}

async function inTransaction(prisma, fn) {
  try {
    return await prisma.$transaction(fn);
  } catch (err) {
    if (err?.userMessage) return fail(err.userMessage);
    throw err;
  }
}

/**
 * The tax on the train's imports and exports (Depot Overhaul.docx): one rate,
 * a whole percent. The same audit row the old /treasury page wrote.
 */
async function setTaxRate(prisma, discordUserId, { rate: rawRate, turn = null } = {}) {
  const actor = await meisterActor(prisma, discordUserId, { acting: true });
  if (!actor.ok) return actor;
  const rate = Number(rawRate);
  if (!Number.isInteger(rate) || rate < 0 || rate > 100) return fail(T.taxBounds);
  const before = (await loadDepot(prisma)).sellTaxRate ?? 0;
  await prisma.$transaction(async (tx) => {
    await tx.depot.upsert({ where: { id: 1 }, update: { sellTaxRate: rate }, create: { id: 1, sellTaxRate: rate } });
    await logAudit(tx, {
      actorDiscordUserId: discordUserId,
      actionType: "sell_tax_rate_set",
      targetCharacterId: actor.character.id,
      turnId: turn?.id ?? null,
      details: { before, after: rate },
    });
  });
  return { ok: true, rate, before, line: fillMeisterText("taxDone", { rate }) };
}

/**
 * Sets an account to an exact figure. The difference is booked as one claim
 * leg against the bank clearing (MEISTER_CREDIT / MEISTER_DEBIT), so the
 * books still close; nothing physical moves, which is why raising a balance
 * deepens the gap the terminal warns about.
 */
async function setAccountBalance(prisma, discordUserId, { accountId, balance: rawBalance, turn = null } = {}) {
  const actor = await meisterActor(prisma, discordUserId, { acting: true });
  if (!actor.ok) return actor;
  const target = wholeWithin(rawBalance, MAX_BALANCE);
  if (target == null) return fail(fillMeisterText("balanceBounds", { min: -MAX_BALANCE, max: MAX_BALANCE }));
  const id = String(accountId ?? "");

  return inTransaction(prisma, async (tx) => {
    const row = await lockedAccountRow(tx, id);
    if (!row) throw userError(T.noAccount);
    if (isLockedAccount(lockShape(row))) throw userError(T.balanceLocked);
    const before = row.balanceObols;
    if (before === target) {
      return { ok: true, line: fillMeisterText("balanceSame", { name: row.holderName, balance: target }) };
    }
    const delta = target - before;
    // A figure under zero needs the floor lowered to it; bumpBankAccount's own
    // floor is never above where the account already stands.
    const moved = await bumpBankAccount(
      tx,
      row.id,
      delta,
      {
        holderName: row.holderName,
        econ: { reason: delta > 0 ? "MEISTER_CREDIT" : "MEISTER_DEBIT", ...turnStamp(turn) },
      },
      { floor: Math.min(0, target) },
    );
    if (moved.after !== target) throw userError(T.noAccount);
    await logAudit(tx, {
      actorDiscordUserId: discordUserId,
      actionType: "meister_balance_set",
      targetCharacterId: row.characterId,
      turnId: turn?.id ?? null,
      details: {
        accountId: row.id,
        fingerprint: row.fingerprint,
        holderName: row.holderName,
        before,
        after: target,
        setBy: actor.character.id,
      },
    });
    return { ok: true, line: fillMeisterText("balanceDone", { name: row.holderName, balance: target }) };
  });
}

/**
 * Closes an account (Meistery.docx: "outright delete accounts at will"; Incarn
 * and gates.docx: the way a character is documented afresh). Whatever it held
 * or owed is written off first (ACCOUNT_CLOSED), so its ledger legs close at
 * zero; then the row goes. A ring linked to it keeps its doors and loses its
 * account (Tag.ringBankAccountId is SET NULL), so it can be connected again.
 *
 * Refused while the account has goods on order from the old counter
 * (DepotOrder cascades with the account, so they would never arrive) or a
 * sale still waiting to settle into it.
 */
async function closeAccount(prisma, discordUserId, { accountId, turn = null } = {}) {
  const actor = await meisterActor(prisma, discordUserId, { acting: true });
  if (!actor.ok) return actor;
  const id = String(accountId ?? "");

  return inTransaction(prisma, async (tx) => {
    const row = await lockedAccountRow(tx, id);
    if (!row) throw userError(T.deleteGone);
    if (isLockedAccount(lockShape(row))) throw userError(T.deleteLocked);
    const [orders, sales] = await Promise.all([
      tx.depotOrder.count({ where: { accountId: row.id, deliveredAt: null } }),
      tx.depotSale.count({ where: { accountId: row.id, settledAt: null } }),
    ]);
    if (orders || sales) throw userError(fillMeisterText("deletePending", { name: row.holderName }));

    if (row.balanceObols !== 0) {
      await bumpBankAccount(
        tx,
        row.id,
        -row.balanceObols,
        { holderName: row.holderName, econ: { reason: "ACCOUNT_CLOSED", ...turnStamp(turn) } },
        { floor: Math.min(0, row.balanceObols) },
      );
    }
    const rings = await tx.tag.count({ where: { ringBankAccountId: row.id } });
    await tx.bankAccount.delete({ where: { id: row.id } });
    await logAudit(tx, {
      actorDiscordUserId: discordUserId,
      actionType: "treasury_account_closed",
      targetCharacterId: row.characterId,
      turnId: turn?.id ?? null,
      details: {
        fingerprint: row.fingerprint,
        holderName: row.holderName,
        balanceObols: row.balanceObols,
        ringsUnlinked: rings,
        closedBy: actor.character.id,
      },
    });
    return { ok: true, line: fillMeisterText("deleteDone", { name: row.holderName }) };
  });
}

/**
 * Sets or clears a daily wage: `roleId` for a whole fate, or `characterId` for
 * one character. `amount` null (or "") clears it. The Baron takes none, as a
 * fate or as a character.
 */
async function setWage(prisma, discordUserId, { roleId = null, characterId = null, amount: rawAmount, turn = null } = {}) {
  const actor = await meisterActor(prisma, discordUserId, { acting: true });
  if (!actor.ok) return actor;
  const clearing = rawAmount === null || rawAmount === "" || rawAmount === undefined;
  const amount = clearing ? null : wholeWithin(rawAmount, MAX_WAGE);
  if (!clearing && amount == null) return fail(fillMeisterText("wageBounds", { min: -MAX_WAGE, max: MAX_WAGE }));

  let target;
  let name;
  if (roleId) {
    const role = await prisma.role.findUnique({ where: { id: String(roleId) }, select: { id: true, slug: true, name: true } });
    if (!role) return fail(T.wageNoFate);
    if (role.slug === BARON_ROLE_SLUG) return fail(T.wageBaron);
    target = { roleId: role.id };
    name = role.name;
  } else {
    const character = await prisma.character.findUnique({
      where: { id: String(characterId ?? "") },
      select: {
        id: true,
        name: true,
        status: true,
        role: { select: { slug: true } },
        bankAccount: { select: { class: true } },
      },
    });
    if (!character?.bankAccount) return fail(T.wageNoCharacter);
    const shape = { class: character.bankAccount.class, roleSlug: character.role?.slug ?? null, status: character.status };
    if (isLockedAccount(shape) || shape.roleSlug === BARON_ROLE_SLUG) return fail(T.wageBaron);
    target = { characterId: character.id };
    name = character.name;
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.wage.findFirst({ where: target, select: { id: true, amountObols: true } });
    if (clearing) {
      if (existing) await tx.wage.delete({ where: { id: existing.id } });
    } else {
      await tx.wage.upsert({
        where: target.roleId ? { roleId: target.roleId } : { characterId: target.characterId },
        update: { amountObols: amount, setByCharacterId: actor.character.id, setByName: actor.character.name },
        create: { ...target, amountObols: amount, setByCharacterId: actor.character.id, setByName: actor.character.name },
      });
    }
    await logAudit(tx, {
      actorDiscordUserId: discordUserId,
      actionType: "meister_wage_set",
      targetCharacterId: target.characterId ?? actor.character.id,
      turnId: turn?.id ?? null,
      details: {
        ...target,
        name,
        before: existing?.amountObols ?? null,
        after: amount,
        setBy: actor.character.id,
      },
    });
  });

  return {
    ok: true,
    line: clearing
      ? fillMeisterText("wageClearedDone", { name })
      : fillMeisterText("wageSetDone", { name, amount }),
  };
}

/**
 * Connects a ring in the worker's hands to an account (db/lib/ringRegistry.js
 * has the rules). `characterId` on the answer is whose ring doors may have
 * changed — the caller re-syncs their room access.
 */
async function connectRing(prisma, discordUserId, args = {}) {
  const actor = await meisterActor(prisma, discordUserId, { acting: true });
  if (!actor.ok) return actor;
  return connectRingInDb(prisma, {
    ...args,
    discordUserId,
    registrar: actor.character,
    heldSlugs: actor.heldSlugs,
  });
}

module.exports = {
  isLockedAccount,
  displayBalance,
  wageFor,
  wholeWithin,
  meisterActor,
  meisterBooks,
  meisterTerminalState,
  setTaxRate,
  setAccountBalance,
  closeAccount,
  setWage,
  connectRing,
};
