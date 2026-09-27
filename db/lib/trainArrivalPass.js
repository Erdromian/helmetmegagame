// The train comes in, and the Merchant's Terminal pays for it.
//
// Since the Depot Overhaul (Depot Overhaul.docx, DEPOT.md §0c) an order is a
// line on the terminal's pending list, not a payment. This pass is when it is
// paid: every pending MerchantOrder the terminal can afford, oldest first, is
// charged in ONE sum out of Depot.terminalObols, with the Meister's tax levied
// once on that sum and paid into the Keep's Vault as coin. What it bought is
// set down in the Railway — packed into crates by db/lib/depotCrates.js, one
// stack of crates per order, and anything that can't go in a crate (a mount,
// ⬢; db/lib/crates.js#packRefusal) set down loose beside them.
//
// An order the terminal can't cover — the tax rate rose, say — waits for the
// next train rather than half-arriving. The terminal refuses an order it can't
// cover when it is placed, so this is the edge, not the rule.
//
// Orders placed at the old counter before the overhaul (DepotOrder) were paid
// for when they were placed; they still land here, as they always did.
//
// Runs every OTHER turn (db/lib/train.js). Parity decides whether the pass runs
// at all; what it delivers is decided by `deliveredAt: null`, claimed inside the
// transaction, so a resumed or doubled advance costs a turn of flavour and
// never a shipment. Returns its side effects rather than making a network call
// (TURN-ENGINE.md §3).

const { splitIntoCrates, crateTagData, shipmentId } = require("./depotCrates");
const { canPack } = require("./crates");
const { addToRoomStack } = require("./tagWrites");
const { isArrivalTurn, RAILYARD_ROOM_SLUG } = require("./train");
const { record, roomParty, COMPANY, turnStamp } = require("./economyLedger");
const { loadDepot } = require("./depotState");
const { vaultAndCoin } = require("./bankAccounts");
const { TERMINAL_PARTY } = require("./merchantTerminal");
const { taxOn, withTax } = require("./merchantTerminalText");

const TRAIN_ARRIVED_LINE = {
  text: "You hear the train arrive.",
  signed: false,
};

// The stamp on an old counter order's crates. A terminal order carries none:
// everything on it is the Merchant's business.
function stampFor(order) {
  if (order.label) return order.label;
  return order.anonymous ? "ANONYMOUS" : `${order.holderName} · ${order.fingerprint}`;
}

// Which pending orders the terminal can pay for, oldest first, stopping at the
// first it can't — so a later, cheaper order never jumps the queue. Pure.
function affordablePrefix(orders, holds, rate) {
  const chosen = [];
  let subtotal = 0;
  for (const order of orders ?? []) {
    const next = subtotal + Math.max(0, order.totalObols ?? 0);
    if (withTax(next, rate) > holds) break;
    chosen.push(order);
    subtotal = next;
  }
  return { chosen, subtotal, tax: taxOn(subtotal, rate) };
}

async function catalogFor(prisma, lines) {
  const tagIds = [...new Set(lines.map((l) => l?.tagId).filter(Boolean))];
  const tags = await prisma.tag.findMany({
    where: { id: { in: tagIds } },
    select: {
      id: true,
      slug: true,
      tradeable: true,
      equipSlot: true,
      custom: true,
      crateContents: true,
      weightLbs: true,
      sellablePrice: true,
    },
  });
  return new Map(tags.map((t) => [t.id, t]));
}

// One order's goods into the Railway: crates for what packs, loose for what
// doesn't. `econ` books the goods leg of whatever is priced.
async function setDown(tx, room, order, { tagById, groupId, stamp, econ }) {
  const lines = Array.isArray(order.lines) ? order.lines : [];
  const crated = [];
  const loose = [];
  for (const line of lines) {
    const tag = line.tagId ? tagById.get(line.tagId) : null;
    // A line with no tagId is ⬢ off an old counter order, which rode in a crate.
    if (!line.tagId || (tag && canPack(tag))) crated.push(line);
    else if (tag) loose.push(line);
  }

  const weightByTagId = new Map([...tagById.values()].map((t) => [t.id, t.weightLbs ?? 0]));
  const sellPriceByTagId = new Map([...tagById.values()].map((t) => [t.id, t.sellablePrice ?? 0]));
  const shipment = shipmentId();
  const crates = splitIntoCrates(crated, { weightByTagId });

  let crateCount = 0;
  let resourcesLanded = 0;
  for (const data of crateTagData(shipment, crates, { groupId, weightByTagId, sellPriceByTagId })) {
    const { crateContents, description, ...tagFields } = data;
    const tag = await tx.tag.create({
      data: {
        ...tagFields,
        // `[SHIPMENT ID RV-4471-K] · ADA VOSS: Coal x 4 | Bandage x 6` for an
        // old counter order; a terminal order's crate carries no stamp.
        description: stamp ? description.replace("]:", `] · ${stamp}:`) : description,
        crateContents,
      },
    });
    await addToRoomStack(tx, room.id, tag.id, 1, { econ });
    resourcesLanded += tagFields.consumesIntoResources ?? 0;
    crateCount += 1;
  }
  for (const line of loose) {
    await addToRoomStack(tx, room.id, line.tagId, Math.max(1, Math.trunc(line.quantity ?? 1)), { econ });
  }
  return { crates: crateCount, loose: loose.length, resourcesLanded };
}

// Counter orders from before the overhaul: already paid, still owed.
async function deliverCounterOrders(prisma, turn, room, { groupId, railyard }) {
  const orders = await prisma.depotOrder.findMany({ where: { deliveredAt: null }, orderBy: { createdAt: "asc" } });
  let delivered = 0;
  let crates = 0;
  for (const order of orders) {
    const tagById = await catalogFor(prisma, Array.isArray(order.lines) ? order.lines : []);
    try {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.depotOrder.updateMany({
          where: { id: order.id, deliveredAt: null },
          data: { deliveredAt: new Date(), deliveredTurn: turn.number },
        });
        if (!count) return;
        const out = await setDown(tx, room, order, { tagById, groupId, stamp: stampFor(order) });
        // A crate is booked by nothing, but ⬢ riding inside one are real money arriving in the world.
        if (out.resourcesLanded > 0) {
          await record(
            tx,
            { from: COMPANY, to: railyard, form: "BALANCE", amount: out.resourcesLanded },
            { reason: "TRAIN_DELIVERY", roomId: room.id, locationId: room.location?.id ?? null, ...turnStamp(turn) },
          );
        }
        crates += out.crates;
        delivered += 1;
      });
    } catch (err) {
      // One bad order must not strand the rest of the train.
      console.error(`Train delivery failed for order ${order.id}:`, err?.message ?? err);
    }
  }
  return { delivered, crates };
}

// The terminal's pending list: paid now, in one sum, and set down.
async function deliverTerminalOrders(prisma, turn, room, { groupId, railyard }) {
  const orders = await prisma.merchantOrder.findMany({ where: { deliveredAt: null }, orderBy: { createdAt: "asc" } });
  if (!orders.length) return { delivered: 0, crates: 0, loose: 0, paid: 0, taxed: 0, waiting: 0 };

  const depot = await loadDepot(prisma);
  const rate = depot.sellTaxRate ?? 0;
  const { chosen, subtotal, tax } = affordablePrefix(orders, depot.terminalObols ?? 0, rate);
  const waiting = orders.length - chosen.length;
  if (!chosen.length) return { delivered: 0, crates: 0, loose: 0, paid: 0, taxed: 0, waiting };

  const [{ room: vault, coin }, tagById] = await Promise.all([
    vaultAndCoin(prisma),
    catalogFor(prisma, chosen.flatMap((o) => (Array.isArray(o.lines) ? o.lines : []))),
  ]);
  const stamp = turnStamp(turn);
  const cost = subtotal + tax;
  let crates = 0;
  let loose = 0;

  try {
    await prisma.$transaction(
      async (tx) => {
        // The terminal's row first, locked, and the money re-checked under the
        // lock: an insert or withdrawal can't slip between the sum and the charge.
        const [row] = await tx.$queryRaw`SELECT "terminalObols" FROM "Depot" WHERE "id" = 1 FOR UPDATE`;
        if ((row?.terminalObols ?? 0) < cost) throw new Error("the terminal no longer covers the order");

        const ids = chosen.map((o) => o.id);
        const { count } = await tx.merchantOrder.updateMany({
          where: { id: { in: ids }, deliveredAt: null },
          data: { deliveredAt: new Date(), deliveredTurn: turn.number },
        });
        // The claim IS the check: anything already claimed means another
        // advance is running this, and this one backs out whole.
        if (count !== ids.length) throw new Error("an order was already claimed");
        for (const order of chosen) {
          await tx.merchantOrder.update({ where: { id: order.id }, data: { paidObols: order.totalObols } });
        }

        await tx.depot.update({ where: { id: 1 }, data: { terminalObols: { decrement: cost } } });
        // The goods' price goes off-world; the Meister's cut into the Vault.
        await record(tx, { from: TERMINAL_PARTY, to: COMPANY, form: "COIN", amount: subtotal }, { reason: "TRAIN_IMPORT", ...stamp });
        if (tax > 0) {
          if (vault && coin) {
            const vaultParty = roomParty({ ...vault, zoneId: vault.location?.zoneId ?? null });
            await addToRoomStack(tx, vault.id, coin.id, tax, {
              econ: { from: TERMINAL_PARTY, to: vaultParty, reason: "IMPORT_TAX", roomId: vault.id, ...stamp },
            });
          } else {
            // No Vault in the database: the cut goes off-world rather than nowhere.
            await record(tx, { from: TERMINAL_PARTY, to: COMPANY, form: "COIN", amount: tax }, { reason: "IMPORT_TAX", ...stamp });
          }
        }

        const econ = { from: COMPANY, to: railyard, reason: "TRAIN_IMPORT", roomId: room.id, ...stamp };
        for (const order of chosen) {
          const out = await setDown(tx, room, order, { tagById, groupId, stamp: null, econ });
          crates += out.crates;
          loose += out.loose;
        }

        await tx.auditLog.create({
          data: {
            actorDiscordUserId: "system",
            actionType: "train_import",
            turnId: turn?.id ?? null,
            details: { orders: ids, subtotal, tax, taxRate: rate, cost, crates, loose, waiting },
          },
        });
      },
      { timeout: 60_000 },
    );
  } catch (err) {
    // The whole load stays pending and rides the next train.
    console.error("Train import failed:", err?.message ?? err);
    return { delivered: 0, crates: 0, loose: 0, paid: 0, taxed: 0, waiting: orders.length, failed: true };
  }

  return { delivered: chosen.length, crates, loose, paid: subtotal, taxed: tax, waiting };
}

async function runTrainArrivalPass(prisma, turn) {
  if (!isArrivalTurn(turn?.number)) return { ran: false, delivered: 0, crates: 0 };

  const room = await prisma.room.findUnique({
    where: { slug: RAILYARD_ROOM_SLUG },
    select: { id: true, name: true, location: { select: { id: true, zoneId: true } } },
  });
  // No Railway means the zone import has not been run. Say nothing and change
  // nothing — the orders stay queued and land on the next arrival.
  if (!room) return { ran: false, delivered: 0, crates: 0, missingRoom: true };

  // Crates need a group to render like any other item; "items-gear" is the
  // catalog's catch-all for carried objects.
  const group = await prisma.tagGroup.findUnique({ where: { slug: "items-gear" }, select: { id: true } });
  const ctx = { groupId: group?.id ?? null, railyard: roomParty({ ...room, zoneId: room.location?.zoneId ?? null }) };

  const counter = await deliverCounterOrders(prisma, turn, room, ctx);
  const terminal = await deliverTerminalOrders(prisma, turn, room, ctx);
  const delivered = counter.delivered + terminal.delivered;

  return {
    ran: true,
    delivered,
    crates: counter.crates + terminal.crates,
    loose: terminal.loose,
    paid: terminal.paid,
    taxed: terminal.taxed,
    waiting: terminal.waiting,
    roomId: room.id,
    locationId: room.location?.id ?? null,
    lines: delivered > 0 ? [TRAIN_ARRIVED_LINE] : [],
  };
}

module.exports = { runTrainArrivalPass, TRAIN_ARRIVED_LINE, stampFor, affordablePrefix };
