// What the Meister's Terminal (db/lib/meisterTerminal.js) can see of the
// bank's history: every claim moving on an account, the tax the train paid into
// the Vault, and the old counter's General orders and settled sales.
//
// The Black Market and the Merchant's shelves are not the Keep's business, so
// an old counter order with even one line from them is left out whole, and so
// is a sale into the Merchant's books. See docs/systemdocs/MEISTERY.md §7.
//
// A day's wages would be a row per account per day, and would bury everything
// else inside a week, so the whole-bank view folds each payout into one row;
// filtered to one account, its own wage rows show one by one.
//
// Built at read time, because no one table knows both the money and the
// manifest. Takes `prisma` as a parameter, the db/lib/dm.js convention.

const { manifestOf, MANIFEST_GENERAL } = require("./depotManifests");
const { readGameState } = require("./gameState");
const { VAULT_ROOM_SLUG } = require("./bankAccounts");
const { BANK_CLEARING } = require("./economyLedger");
const { MEISTER_LEDGER_KINDS: KINDS, MEISTER_TERMINAL_TEXT: T, fillMeisterText } = require("./meisterTerminalText");

const LIMIT = 500;

// The claim legs the ledger shows, by EconomyEntry reason.
const ACCOUNT_REASONS = [
  "BANK_DEPOSIT",
  "BANK_WITHDRAWAL",
  "CHARACTER_START",
  "BANK_TRANSFER",
  // The Town Gatehouse (docs/systemdocs/GATEHOUSE.md): a documented account
  // opens owing its processing fee.
  "DOCUMENTS_FEE",
  // The Meister's own hand (MEISTERY.md).
  "ACCOUNT_CLOSED",
  "MEISTER_CREDIT",
  "MEISTER_DEBIT",
  "WAGE",
  "WAGE_DEDUCTION",
];
const WAGE_REASONS = ["WAGE", "WAGE_DEDUCTION"];
// Coin the train paid into the Vault (DEPOT.md §0f).
const TAX_REASONS = ["IMPORT_TAX", "EXPORT_TAX", "SELL_TAX"];

function linesOf(order) {
  return Array.isArray(order.lines) ? order.lines : [];
}

// A Resources line carries no tagId (depot/actions.js packs it by hand) and is
// on the General manifest. Never trust `order.manifestId`: it records the LAST
// ware carted, so a mixed cart can read "general".
function isGeneralOrder(order, tagsById) {
  return linesOf(order).every((line) => {
    if (!line?.tagId) return true;
    const tag = tagsById.get(line.tagId);
    return Boolean(tag) && manifestOf(tag) === MANIFEST_GENERAL;
  });
}

async function loadTreasuryTransactions(prisma, { accountId = null } = {}) {
  const state = await readGameState(prisma, { gameId: true });
  const gameId = state?.gameId ?? null;
  const whole = !accountId;

  const bankEnd = accountId
    ? [
        { fromKind: "bank", fromId: accountId },
        { toKind: "bank", toId: accountId },
      ]
    : [{ fromKind: "bank" }, { toKind: "bank" }];

  const vault = whole ? await prisma.room.findUnique({ where: { slug: VAULT_ROOM_SLUG }, select: { id: true } }) : null;

  const [entries, wageGroups, taxes, orders, sales, accounts] = await Promise.all([
    gameId
      ? prisma.economyEntry.findMany({
          where: {
            gameId,
            form: "ACCOUNT",
            reason: { in: whole ? ACCOUNT_REASONS.filter((r) => !WAGE_REASONS.includes(r)) : ACCOUNT_REASONS },
            OR: bankEnd,
          },
          orderBy: { at: "desc" },
          take: LIMIT,
        })
      : [],
    // One row per payout: every wage leg a turn's close wrote, summed.
    gameId && whole
      ? prisma.economyEntry.groupBy({
          by: ["turnNumber", "reason"],
          where: { gameId, form: "ACCOUNT", reason: { in: WAGE_REASONS } },
          _sum: { amount: true },
          _count: { _all: true },
          _max: { at: true },
        })
      : [],
    gameId && vault
      ? prisma.economyEntry.findMany({
          where: { gameId, reason: { in: TAX_REASONS }, toKind: "room", toId: vault.id },
          orderBy: { at: "desc" },
          take: LIMIT,
        })
      : [],
    prisma.depotOrder.findMany({
      // An anonymous order stays out of its own account's view: the account
      // table names every fingerprint, so showing it there would unmask it.
      // A custom label hides the name the same way, so it stays out too.
      where: accountId ? { accountId, anonymous: false, label: null } : {},
      orderBy: { createdAt: "desc" },
      take: LIMIT,
    }),
    prisma.depotSale.findMany({
      where: { settledAt: { not: null }, destination: { not: "MERCHANT" }, ...(accountId ? { accountId } : {}) },
      orderBy: { settledAt: "desc" },
      take: LIMIT,
    }),
    prisma.bankAccount.findMany({ select: { id: true, class: true, fingerprint: true, holderName: true } }),
  ]);

  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const tagIds = [...new Set(orders.flatMap((o) => linesOf(o).map((l) => l?.tagId).filter(Boolean)))];
  const tags = tagIds.length
    ? await prisma.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true, manifest: true } })
    : [];
  const tagsById = new Map(tags.map((t) => [t.id, t]));

  const rows = [];

  // One entry can have a bank on BOTH ends — an account paying another
  // account — and that is two rows, one per book, not one. Filtered to a
  // single account, it is whichever end that account is standing on.
  function bankRow(e, id, signed, otherName) {
    const account = accountsById.get(id);
    return {
      id: `e:${e.id}:${id}`,
      kind: KINDS[e.reason] ?? e.reason,
      turn: e.turnNumber,
      at: e.at,
      accountId: id,
      accountClass: account?.class ?? "",
      fingerprint: account?.fingerprint ?? "",
      holderName: account?.holderName ?? (signed > 0 ? e.toName : e.fromName) ?? "",
      amount: signed,
      detail: otherName ? fillMeisterText(signed > 0 ? "ledgerFrom" : "ledgerTo", { name: otherName }) : "",
    };
  }

  for (const e of entries) {
    // The bank clearing wears the bank kind too (economyLedger.js#BANK_CLEARING),
    // but it is the books' counterparty, not somebody's account: a deposit is one
    // row against the account, never a second against the clearing.
    const fromBank = e.fromKind === "bank" && e.fromId !== BANK_CLEARING.id ? e.fromId : null;
    const toBank = e.toKind === "bank" && e.toId !== BANK_CLEARING.id ? e.toId : null;
    // The treasury is a room, so a surrendered claim has one bank end and
    // names the Vault on the other.
    const outsideName = e.reason === "BANK_TRANSFER" && !(fromBank && toBank) ? T.ledgerTheTreasury : "";

    if (fromBank && toBank) {
      const fromName = accountsById.get(fromBank)?.holderName ?? e.fromName ?? "";
      const toName = accountsById.get(toBank)?.holderName ?? e.toName ?? "";
      if (!accountId || accountId === fromBank) rows.push(bankRow(e, fromBank, -e.amount, toName));
      if (!accountId || accountId === toBank) rows.push(bankRow(e, toBank, e.amount, fromName));
      continue;
    }

    const credit = Boolean(toBank);
    // Every leg is booked with a positive amount; which end the bank is on
    // says which way it went — a wage deduction is a leg FROM the account.
    rows.push(bankRow(e, credit ? toBank : fromBank, credit ? e.amount : -e.amount, outsideName));
  }

  for (const g of wageGroups) {
    const credit = g.reason === "WAGE";
    const total = g._sum?.amount ?? 0;
    rows.push({
      id: `w:${g.turnNumber ?? "none"}:${g.reason}`,
      kind: KINDS[g.reason],
      turn: g.turnNumber,
      at: g._max?.at ?? null,
      accountId: null,
      accountClass: "",
      fingerprint: "",
      holderName: "",
      amount: credit ? total : -total,
      detail: fillMeisterText("ledgerWageDay", { count: g._count?._all ?? 0 }),
    });
  }

  for (const e of taxes) {
    rows.push({
      id: `t:${e.id}`,
      kind: KINDS[e.reason] ?? e.reason,
      turn: e.turnNumber,
      at: e.at,
      accountId: null,
      accountClass: "",
      fingerprint: "",
      holderName: T.ledgerTheTreasury,
      amount: e.amount,
      detail: "",
    });
  }

  for (const o of orders) {
    if (!isGeneralOrder(o, tagsById)) continue;
    const hidden = o.anonymous || Boolean(o.label);
    rows.push({
      id: `o:${o.id}`,
      kind: KINDS.ORDER,
      turn: o.placedTurn,
      at: o.createdAt,
      accountId: hidden ? null : o.accountId,
      accountClass: hidden ? "" : (accountsById.get(o.accountId)?.class ?? ""),
      fingerprint: hidden ? "" : o.fingerprint,
      holderName: o.label ? `"${o.label}"` : o.anonymous ? T.ledgerAnonymous : o.holderName,
      amount: -o.totalObols,
      detail: linesOf(o)
        .map((l) => `${l.quantity} × ${l.name}`)
        .join(", "),
    });
  }

  for (const s of sales) {
    const toVault = s.destination === "TREASURY";
    rows.push({
      id: `s:${s.id}`,
      kind: KINDS.SALE,
      turn: s.settledTurn,
      at: s.settledAt,
      accountId: s.accountId,
      accountClass: accountsById.get(s.accountId)?.class ?? "",
      fingerprint: s.fingerprint,
      holderName: s.holderName,
      amount: s.netObols ?? 0,
      detail:
        fillMeisterText("ledgerSale", {
          quantity: s.quantity,
          name: s.tagName,
          gross: s.grossObols ?? 0,
          tax: s.taxObols ?? 0,
        }) + (toVault ? T.ledgerSaleToTreasury : ""),
    });
  }

  rows.sort((a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0));
  return rows.slice(0, LIMIT).map((r) => ({ ...r, at: r.at ? new Date(r.at).toISOString() : null }));
}

module.exports = { loadTreasuryTransactions };
