// The train leaves, and takes the Railway's cargo with it.
//
// Since the Depot Overhaul (Depot Overhaul.docx, DEPOT.md §0c) there is no drop
// box. Selling to the station is loading the train: every crate standing in the
// Railway when it leaves goes, contents and all, and so does anything that
// can't be crated but has a sell value (a mount, ⬢; db/lib/crates.js). What it
// was all worth — a crate is worth the sum of what is in it — is paid in ONE
// sum into the Merchant's Terminal, less the Meister's tax, levied once on that
// sum, rounded to a whole obol, and paid into the Keep's Vault as coin.
//
// Anything else left loose on the platform stays: an ordinary item has to be
// crated to ship. Anything under the floor stays too; it isn't on the platform.
//
// Drops made into the old box before the overhaul (DepotSale) still settle
// here as they always did: each at its frozen price, less the tax, into the
// account it named.
//
// Runs every OTHER turn (db/lib/train.js). Parity decides whether the pass runs;
// the export is one transaction, so a failure ships nothing and the cargo waits.

const { addToRoomStack, dropRoomTag } = require("./tagWrites");
const { isDepartureTurn, RAILYARD_ROOM_SLUG } = require("./train");
const { loadDepot } = require("./depotState");
const { bumpBankAccount, vaultAndCoin, isCrown, TREASURY } = require("./bankAccounts");
const { record, roomParty, COMPANY, turnStamp } = require("./economyLedger");
const { MERCHANT_LICENSE_SLUG } = require("./depot");
const { isCrateTag, canPack, crateValue } = require("./crates");
const { TERMINAL_PARTY } = require("./merchantTerminal");
const { taxOn } = require("./merchantTerminalText");

const TRAIN_DEPARTED_LINE = {
  text: "You hear the train leave.",
  signed: false,
};

// Whose account an old MERCHANT drop pays into. The licence, never the role.
async function merchantAccount(prisma) {
  const holder = await prisma.character.findFirst({
    where: { status: "ALIVE", tags: { some: { tag: { slug: MERCHANT_LICENSE_SLUG } } } },
    orderBy: { createdAt: "asc" },
    select: { bankAccount: true },
  });
  return holder?.bankAccount ?? null;
}

// Drops into the old box, from before the overhaul.
async function settleBoxSales(prisma, turn, { depot, vault, coin, stamp }) {
  const sales = await prisma.depotSale.findMany({
    where: { settledAt: null },
    orderBy: { createdAt: "asc" },
    include: { account: true },
  });
  if (!sales.length) return { settled: 0, paid: 0, taxed: 0 };

  const merchant = await merchantAccount(prisma);
  const vaultParty = vault ? roomParty({ ...vault, zoneId: vault.location?.zoneId ?? null }) : null;
  let settled = 0;
  let paid = 0;
  let taxed = 0;

  for (const sale of sales) {
    const gross = Math.max(0, Math.trunc(sale.unitPrice) * Math.trunc(sale.quantity));
    const tax = taxOn(gross, depot?.sellTaxRate);
    const net = gross - tax;
    const target =
      sale.destination === "MERCHANT" ? (merchant ?? sale.account) : sale.destination === "SELF" ? sale.account : null;
    // Paying the Baron's CROWN account IS paying the Vault: its balance is the
    // pile (db/lib/bankAccounts.js), so the coin goes on the pile and no claim
    // is booked. Crediting the account would land on a balance nothing reads.
    const toVault = sale.destination === "TREASURY" || isCrown(target);

    try {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.depotSale.updateMany({
          where: { id: sale.id, settledAt: null },
          data: { settledAt: new Date(), settledTurn: turn.number, grossObols: gross, taxObols: tax, netObols: net },
        });
        if (!count) return;
        if (tax > 0 && vault && coin) {
          await addToRoomStack(tx, vault.id, coin.id, tax, {
            econ: { from: COMPANY, to: vaultParty, reason: "SELL_TAX", roomId: vault.id, ...stamp },
          });
        }
        if (net > 0 && toVault && vault && coin) {
          await addToRoomStack(tx, vault.id, coin.id, net, {
            econ: { from: COMPANY, to: vaultParty, reason: "DEPOT_SALE", roomId: vault.id, ...stamp },
          });
          paid += net;
        } else if (net > 0 && target) {
          await bumpBankAccount(tx, target.id, net, {
            holderName: target.holderName,
            reason: "DEPOT_SALE",
            econ: { other: COMPANY, reason: "DEPOT_SALE", ...stamp },
          });
          // A TREASURY claim is only worth the coin behind it.
          if (target.class === TREASURY && vault && coin) {
            await addToRoomStack(tx, vault.id, coin.id, net, {
              econ: { from: COMPANY, to: vaultParty, reason: "DEPOT_SALE", roomId: vault.id, ...stamp },
            });
          }
          paid += net;
        }
        taxed += tax;
        settled += 1;
      });
    } catch (err) {
      console.error(`Train settlement failed for sale ${sale.id}:`, err?.message ?? err);
    }
  }
  return { settled, paid, taxed };
}

// What one stack on the platform is worth to the train, or null if it stays.
// A crate goes whatever it holds; a thing that can't be crated goes if the
// station buys it; everything else has to be crated first. Pure.
function exportValue(tag, quantity, { sellPriceByTagId = new Map(), resourcePrice = 0 } = {}) {
  const n = Math.max(0, Math.trunc(quantity ?? 0));
  if (!tag || n === 0) return null;
  if (isCrateTag(tag)) {
    // A crate packed before crates carried a price is valued off its manifest.
    const each =
      tag.sellablePrice ??
      crateValue(Array.isArray(tag.crateContents) ? tag.crateContents : [], sellPriceByTagId, {
        resources: tag.consumesIntoResources ?? 0,
        resourcePrice,
      });
    return Math.max(0, each) * n;
  }
  if (tag.tradeable && !canPack(tag) && (tag.sellablePrice ?? 0) > 0) return tag.sellablePrice * n;
  return null;
}

async function exportRailway(prisma, turn, { depot, vault, coin, stamp }) {
  const room = await prisma.room.findUnique({
    where: { slug: RAILYARD_ROOM_SLUG },
    select: { id: true, name: true, location: { select: { id: true, zoneId: true } } },
  });
  if (!room) return { shipped: 0, value: 0, taxed: 0, net: 0 };

  const rows = await prisma.roomTag.findMany({
    where: { roomId: room.id, quantity: { gt: 0 } },
    include: { tag: true },
  });
  // The prices an old crate's manifest names, and ⬢'s own.
  const inner = [
    ...new Set(
      rows.flatMap((r) => (Array.isArray(r.tag.crateContents) ? r.tag.crateContents.map((c) => c?.tagId) : [])).filter(Boolean),
    ),
  ];
  const [priced, resources] = await Promise.all([
    inner.length ? prisma.tag.findMany({ where: { id: { in: inner } }, select: { id: true, sellablePrice: true } }) : [],
    prisma.tag.findUnique({ where: { slug: "resources" }, select: { sellablePrice: true } }),
  ]);
  const ctx = {
    sellPriceByTagId: new Map(priced.map((t) => [t.id, t.sellablePrice ?? 0])),
    resourcePrice: resources?.sellablePrice ?? 0,
  };

  const cargo = [];
  let value = 0;
  for (const row of rows) {
    const worth = exportValue(row.tag, row.quantity, ctx);
    if (worth == null) continue;
    cargo.push({ row, worth });
    value += worth;
  }
  if (!cargo.length) return { shipped: 0, value: 0, taxed: 0, net: 0 };

  const rate = depot?.sellTaxRate ?? 0;
  const tax = taxOn(value, rate);
  const net = value - tax;
  const railyard = roomParty({ ...room, zoneId: room.location?.zoneId ?? null });
  const vaultParty = vault ? roomParty({ ...vault, zoneId: vault.location?.zoneId ?? null }) : null;

  try {
    await prisma.$transaction(
      async (tx) => {
        const manifest = [];
        for (const { row, worth } of cargo) {
          // The whole visible stack, and only if it is still all there.
          const dropped = await dropRoomTag(tx, room.id, row.tagId, row.quantity, {
            econ: { from: railyard, to: COMPANY, reason: "TRAIN_EXPORT", roomId: room.id, ...stamp },
          });
          if (!dropped.ok) throw new Error(`${row.tag.name} moved while the train was loading`);
          manifest.push({ tagId: row.tagId, name: row.tag.name, quantity: row.quantity, value: worth });
          // A crate is a one-off row; gone from the platform, it is gone.
          if (row.tag.custom && isCrateTag(row.tag)) {
            const [held, stashed] = await Promise.all([
              tx.characterTag.count({ where: { tagId: row.tagId } }),
              tx.roomTag.count({ where: { tagId: row.tagId } }),
            ]);
            if (!held && !stashed) await tx.tag.delete({ where: { id: row.tagId } }).catch(() => {});
          }
        }

        await tx.$queryRaw`SELECT "id" FROM "Depot" WHERE "id" = 1 FOR UPDATE`;
        if (net > 0) {
          await tx.depot.update({ where: { id: 1 }, data: { terminalObols: { increment: net } } });
          await record(tx, { from: COMPANY, to: TERMINAL_PARTY, form: "COIN", amount: net }, { reason: "TRAIN_EXPORT", ...stamp });
        }
        if (tax > 0) {
          if (vault && coin) {
            await addToRoomStack(tx, vault.id, coin.id, tax, {
              econ: { from: COMPANY, to: vaultParty, reason: "EXPORT_TAX", roomId: vault.id, ...stamp },
            });
          }
        }

        await tx.auditLog.create({
          data: {
            actorDiscordUserId: "system",
            actionType: "train_export",
            turnId: turn?.id ?? null,
            details: { manifest, value, tax, taxRate: rate, net },
          },
        });
      },
      { timeout: 60_000 },
    );
  } catch (err) {
    // Nothing shipped; the cargo waits for the next train.
    console.error("Train export failed:", err?.message ?? err);
    return { shipped: 0, value: 0, taxed: 0, net: 0, failed: true };
  }

  return { shipped: cargo.length, value, taxed: tax, net };
}

async function runTrainDeparturePass(prisma, turn) {
  if (!isDepartureTurn(turn?.number)) return { ran: false, settled: 0, paid: 0, taxed: 0 };

  const [depot, { room: vault, coin }] = await Promise.all([loadDepot(prisma), vaultAndCoin(prisma)]);
  const ctx = { depot, vault, coin, stamp: turnStamp(turn) };

  const box = await settleBoxSales(prisma, turn, ctx);
  const exported = await exportRailway(prisma, turn, ctx);

  const moved = box.settled > 0 || exported.shipped > 0;
  return {
    ran: true,
    settled: box.settled,
    paid: box.paid + exported.net,
    taxed: box.taxed + exported.taxed,
    shipped: exported.shipped,
    exportValue: exported.value,
    lines: moved ? [TRAIN_DEPARTED_LINE] : [],
  };
}

module.exports = { runTrainDeparturePass, TRAIN_DEPARTED_LINE, taxOn, exportValue };
