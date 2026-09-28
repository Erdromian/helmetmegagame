// The Merchant's Terminal, at the Depot. Built from Bascinet's own design
// document, E:\Bascinet\V3\Merchant\Depot Overhaul.docx — see
// docs/systemdocs/DEPOT.md §0c.
//
// It replaced the Depot's counter page (/depot) and its drop box:
//
//   - Anybody standing at the Depot can open it, and it asks to be unlocked.
//     The Merchant's License in hand, or the Merchant's ring on the finger
//     (its `merchants-terminal-key` token), unlocks it. Nothing else does.
//   - It keeps its own coin, Depot.terminalObols, apart from the treasury and
//     every bank account. Physical obols go in and come out; a balance never
//     does.
//   - An order is a line on its pending list, not a payment. The train pays for
//     every pending order when it comes in, out of the terminal, with the
//     Meister's tax on the sum (db/lib/trainArrivalPass.js). So an order may be
//     changed or taken back until then, and nothing may be ordered — or
//     withdrawn — that would leave the terminal short of what is promised.
//   - What the Railway sends up on the departing train is paid into the
//     terminal, less the Meister's tax (db/lib/trainDeparturePass.js).
//
// Returns `{ ok: false, error }` rather than throwing, the db/lib/depotCounter.js
// convention, so a refusal reads the same on both faces. Takes `prisma` as a
// parameter and stays off the @lifeweb/db barrel; require it by path.

const { MANIFEST_BLACK_MARKET } = require("./depotManifests");
const { DEPOT_LOCATION_SLUG, MERCHANT_LICENSE_SLUG, normalizeQuantity } = require("./depot");
const { OBOL_SLUG, loadDepot } = require("./depotState");
const { accessSlugsOf, wornRingAccess } = require("./rings");
const { blockerFor, ACT } = require("./incapacitation");
const { addToStack, dropCharacterTag } = require("./tagWrites");
const { characterParty, machineParty, turnStamp } = require("./economyLedger");
const { holdLimitRefusal } = require("./mounts");
const { SFX } = require("./sfx");
const { logAudit } = require("./auditLog");
const {
  MERCHANT_TERMINAL_TOKEN,
  MERCHANT_TERMINAL_TEXT: T,
  withTax,
} = require("./merchantTerminalText");

// The terminal's coin as a ledger party: one box, like a vending machine's.
const TERMINAL_PARTY = machineParty({ id: "merchant-terminal", name: "The Merchant's Terminal" });

// So a fat-fingered cart can't file for ten thousand vials — the Depot's cap.
const MAX_ORDER_LINES = 40;

const UNGROUPED = "Other";

function fail(error) {
  return { ok: false, error };
}

/** Whether these tags unlock the terminal: the License held, or the Merchant's ring worn. */
function unlocksTerminal(characterTags) {
  if (accessSlugsOf(characterTags).has(MERCHANT_LICENSE_SLUG)) return true;
  return wornRingAccess(characterTags).includes(MERCHANT_TERMINAL_TOKEN);
}

/** Every ware the terminal lists: priced, and not the Black Market's. */
async function terminalShelf(prisma) {
  return prisma.tag.findMany({
    where: {
      depotPrice: { not: null },
      OR: [{ manifest: null }, { manifest: { not: MANIFEST_BLACK_MARKET } }],
    },
    include: { group: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
}

/**
 * Price a cart against the shelf. Pure. `items` is [{ tagId, quantity }] off
 * the client, trusted for nothing; duplicate lines merge BEFORE the clamp.
 * Resolves to { ok, lines, subtotal } or a refusal. `allowEmpty` lets an edit
 * price down to nothing (which removes the order).
 */
function priceCart(shelf, items, { allowEmpty = false } = {}) {
  if (!Array.isArray(items)) return fail(T.nothingPicked);
  if (items.length > MAX_ORDER_LINES) return fail(T.tooManyLines(MAX_ORDER_LINES));

  const wanted = new Map();
  for (const item of items) {
    const raw = Number(item?.quantity);
    if (raw === 0 && allowEmpty) continue;
    const quantity = normalizeQuantity(item?.quantity);
    if (quantity == null) return fail(T.notAQuantity);
    const id = String(item?.tagId ?? "");
    wanted.set(id, (wanted.get(id) ?? 0) + quantity);
  }
  if (wanted.size === 0 && !allowEmpty) return fail(T.nothingPicked);

  const byId = new Map((shelf ?? []).map((tag) => [tag.id, tag]));
  const lines = [];
  let subtotal = 0;
  for (const [tagId, quantity] of wanted) {
    const tag = byId.get(tagId);
    if (!tag || tag.depotPrice == null) return fail(T.notStocked);
    if (normalizeQuantity(quantity) == null) return fail(T.notAQuantity);
    // A non-stackable ware is one to a character (CharacterTag), and a crate
    // opens into one hand — two in one order would charge for two and hand
    // over one.
    if (!tag.stackable && quantity > 1) return fail(T.onlyOne(tag.name));
    subtotal += tag.depotPrice * quantity;
    lines.push({
      tagId: tag.id,
      slug: tag.slug,
      name: tag.name,
      quantity,
      unitPrice: tag.depotPrice,
      sealed: Boolean(tag.sealedShipping),
    });
  }

  // One mount to an order (db/lib/mounts.js): nobody stands at the Railway to
  // take two.
  const tooMany = holdLimitRefusal([], lines.map((l) => ({ slug: l.slug, quantity: l.quantity })));
  if (tooMany) return fail(tooMany);

  return { ok: true, lines, subtotal };
}

/** "Tea x 2, ML-23, 5 ⬢" — what an order is, in one line. The glyph replaces the word for ⬢. */
function orderSummary(lines) {
  return (lines ?? [])
    .map((l) => (l.slug === "resources" ? `${l.quantity} ⬢` : l.quantity > 1 ? `${l.name} x ${l.quantity}` : l.name))
    .join(", ");
}

function linesOf(order) {
  return Array.isArray(order?.lines) ? order.lines : [];
}

function pendingSubtotal(orders, { except = null } = {}) {
  return (orders ?? []).filter((o) => o.id !== except).reduce((sum, o) => sum + (o.totalObols ?? 0), 0);
}

// Alive, able to act, standing at the Depot. Re-loaded on every press: a web
// dialog and a Discord button both outlive somebody walking off.
async function terminalActor(prisma, discordUserId, { needsUnlock = true } = {}) {
  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      zoneId: true,
      locationId: true,
      location: { select: { slug: true } },
      tags: { select: { tagId: true, quantity: true, equipped: true, tag: true } },
    },
  });
  if (!character) return fail(T.noCharacter);
  if (character.location?.slug !== DEPOT_LOCATION_SLUG) return fail(T.notHere);

  const blocker = blockerFor(character.tags, ACT);
  if (blocker) return fail(T.cantAct(blocker.name));

  // Unlocking is re-checked on every write, never remembered: a dialog left
  // open after the License changed hands must not keep ordering.
  if (needsUnlock && !unlocksTerminal(character.tags)) return fail(T.refused);
  return { ok: true, character };
}

async function obolTag(prisma) {
  return prisma.tag.findUnique({ where: { slug: OBOL_SLUG }, select: { id: true } });
}

function coinHeld(character, coinId) {
  return (character.tags ?? []).find((ct) => ct.tagId === coinId)?.quantity ?? 0;
}

async function pendingOrders(tx) {
  return tx.merchantOrder.findMany({ where: { deliveredAt: null }, orderBy: { createdAt: "asc" } });
}

// The Depot row, locked for the rest of the transaction, so two people working
// the terminal at once queue rather than both spend the same obols.
async function lockDepot(tx) {
  await loadDepot(tx);
  const rows = await tx.$queryRaw`SELECT "terminalObols", "sellTaxRate" FROM "Depot" WHERE "id" = 1 FOR UPDATE`;
  return { terminalObols: rows[0]?.terminalObols ?? 0, sellTaxRate: rows[0]?.sellTaxRate ?? 0 };
}

function userError(message) {
  const err = new Error(message);
  err.userMessage = message;
  return err;
}

async function run(prisma, fn, fallback = T.jammed) {
  try {
    return await prisma.$transaction(fn);
  } catch (err) {
    if (err?.userMessage) return fail(err.userMessage);
    console.error("Merchant's Terminal:", err);
    return fail(fallback);
  }
}

/**
 * What the terminal shows. Locked until asked to unlock (`unlock: true`), and
 * then only for somebody who can. A read, so it answers between sittings too;
 * every write below is shut then (the caller's acting() gate).
 */
async function terminalState(prisma, discordUserId, { unlock = false } = {}) {
  const actor = await terminalActor(prisma, discordUserId, { needsUnlock: false });
  if (!actor.ok) return actor;
  if (!unlock) return { ok: true, unlocked: false };
  if (!unlocksTerminal(actor.character.tags)) return fail(T.refused);

  const [depot, shelf, coin, orders] = await Promise.all([
    loadDepot(prisma),
    terminalShelf(prisma),
    obolTag(prisma),
    pendingOrders(prisma),
  ]);
  const rate = depot.sellTaxRate ?? 0;
  const committed = withTax(pendingSubtotal(orders), rate);
  const holds = depot.terminalObols ?? 0;

  const groups = new Map();
  for (const tag of shelf) {
    const name = tag.group?.name ?? UNGROUPED;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({
      id: tag.id,
      name: tag.name,
      description: tag.description ?? "",
      price: tag.depotPrice,
      // What one costs with the Meister's cut, to the nearest obol. The train
      // levies on the whole load, so the cart total is computed, not summed.
      priceWithTax: Math.round((tag.depotPrice * (100 + rate)) / 100),
      stackable: Boolean(tag.stackable),
    });
  }
  for (const list of groups.values()) list.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));

  return {
    ok: true,
    unlocked: true,
    holds,
    committed,
    free: Math.max(0, holds - committed),
    taxRate: rate,
    carrying: coin ? coinHeld(actor.character, coin.id) : 0,
    groups: [...groups.entries()]
      .sort(([a], [b]) => (a === UNGROUPED) - (b === UNGROUPED) || a.localeCompare(b))
      .map(([name, wares]) => ({ name, wares })),
    pending: orders.map((o) => ({
      id: o.id,
      lines: linesOf(o).map(({ tagId, slug, name, quantity, unitPrice }) => ({ tagId, slug, name, quantity, unitPrice })),
      total: o.totalObols,
      placedByName: o.placedByName,
      placedTurn: o.placedTurn,
    })),
  };
}

/** Physical obols out of the hand and into the terminal. */
async function insertObols(prisma, discordUserId, { amount, turn = null } = {}) {
  const actor = await terminalActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character } = actor;
  const coin = await obolTag(prisma);
  if (!coin) return fail(T.noCoin);

  const carried = coinHeld(character, coin.id);
  if (carried <= 0) return fail(T.noCoins);
  const n = Math.trunc(Number(amount));
  if (!Number.isFinite(n) || n <= 0 || n > carried) return fail(T.insertAmount(carried));

  let total = 0;
  const result = await run(prisma, async (tx) => {
    await lockDepot(tx);
    await dropCharacterTag(tx, character.id, coin.id, n, {
      econ: { from: characterParty(character), to: TERMINAL_PARTY, reason: "TERMINAL_INSERT", ...turnStamp(turn) },
    });
    const updated = await tx.depot.update({
      where: { id: 1 },
      data: { terminalObols: { increment: n } },
      select: { terminalObols: true },
    });
    total = updated.terminalObols;
    await logAudit(tx, {
      actorDiscordUserId: discordUserId,
      actionType: "merchant_terminal_insert",
      targetCharacterId: character.id,
      turnId: turn?.id ?? null,
      details: { amount: n, holdsAfter: total },
    });
    return { ok: true };
  });
  if (!result.ok) return result;
  return { ok: true, characterId: character.id, amount: n, holds: total, line: T.youInserted(n, total), sfx: SFX.COIN };
}

/** Obols out of the terminal and into the hand — only what no order is waiting on. */
async function withdrawObols(prisma, discordUserId, { amount, turn = null } = {}) {
  const actor = await terminalActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character } = actor;
  const coin = await obolTag(prisma);
  if (!coin) return fail(T.noCoin);

  const n = Math.trunc(Number(amount));
  let total = 0;
  const result = await run(prisma, async (tx) => {
    const depot = await lockDepot(tx);
    const committed = withTax(pendingSubtotal(await pendingOrders(tx)), depot.sellTaxRate);
    const free = Math.max(0, depot.terminalObols - committed);
    if (free <= 0) throw userError(T.nothingFree);
    if (!Number.isFinite(n) || n <= 0 || n > free) throw userError(T.withdrawAmount(free));
    const updated = await tx.depot.update({
      where: { id: 1 },
      data: { terminalObols: { decrement: n } },
      select: { terminalObols: true },
    });
    total = updated.terminalObols;
    await addToStack(tx, character.id, coin.id, n, {
      source: "EVENT",
      stackable: true,
      econ: { from: TERMINAL_PARTY, to: characterParty(character), reason: "TERMINAL_WITHDRAW", ...turnStamp(turn) },
    });
    await logAudit(tx, {
      actorDiscordUserId: discordUserId,
      actionType: "merchant_terminal_withdraw",
      targetCharacterId: character.id,
      turnId: turn?.id ?? null,
      details: { amount: n, holdsAfter: total },
    });
    return { ok: true };
  });
  if (!result.ok) return result;
  return { ok: true, characterId: character.id, amount: n, holds: total, line: T.youWithdrew(n, total), sfx: SFX.COIN };
}

// Would the pending list, with this cart in it (and `except` out of it), come
// to more than the terminal holds? Throws the refusal inside the transaction.
async function assertAffordable(tx, subtotal, { except = null } = {}) {
  const depot = await lockDepot(tx);
  const orders = await pendingOrders(tx);
  const cost = withTax(pendingSubtotal(orders, { except }) + subtotal, depot.sellTaxRate);
  if (cost > depot.terminalObols) throw userError(T.notEnough(cost, depot.terminalObols));
}

/** Put an order on the pending list. `items` is [{ tagId, quantity }]. */
async function placeOrder(prisma, discordUserId, { items, turn = null } = {}) {
  const actor = await terminalActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character } = actor;

  const priced = priceCart(await terminalShelf(prisma), items);
  if (!priced.ok) return priced;
  const { lines, subtotal } = priced;

  const result = await run(prisma, async (tx) => {
    await assertAffordable(tx, subtotal);
    const order = await tx.merchantOrder.create({
      data: {
        lines,
        totalObols: subtotal,
        placedByCharacterId: character.id,
        placedByName: character.name,
        placedTurn: turn?.number ?? 0,
      },
    });
    await logAudit(tx, {
      actorDiscordUserId: discordUserId,
      actionType: "merchant_terminal_order",
      targetCharacterId: character.id,
      turnId: turn?.id ?? null,
      details: { orderId: order.id, lines, subtotal },
    });
    return { ok: true, id: order.id };
  });
  if (!result.ok) return result;
  return {
    ok: true,
    orderId: result.id,
    lines,
    subtotal,
    line: T.youOrdered(orderSummary(lines), subtotal),
    sfx: SFX.COIN,
  };
}

/**
 * Change a pending order. `items` is its whole new cart; a line at 0 is taken
 * out, and a cart of nothing removes the order. Prices are re-read, since a
 * pending order has not been charged yet.
 */
async function editOrder(prisma, discordUserId, { orderId, items, turn = null } = {}) {
  const actor = await terminalActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character } = actor;

  const priced = priceCart(await terminalShelf(prisma), items, { allowEmpty: true });
  if (!priced.ok) return priced;
  if (priced.lines.length === 0) return removeOrder(prisma, discordUserId, { orderId, turn });
  const { lines, subtotal } = priced;
  const id = String(orderId ?? "");

  const result = await run(prisma, async (tx) => {
    await assertAffordable(tx, subtotal, { except: id });
    // The WHERE is the pending check: a train that came in between the click
    // and here has already claimed it.
    const { count } = await tx.merchantOrder.updateMany({
      where: { id, deliveredAt: null },
      data: { lines, totalObols: subtotal },
    });
    if (count !== 1) throw userError(T.noOrder);
    await logAudit(tx, {
      actorDiscordUserId: discordUserId,
      actionType: "merchant_terminal_order_edit",
      targetCharacterId: character.id,
      turnId: turn?.id ?? null,
      details: { orderId: id, lines, subtotal },
    });
    return { ok: true };
  });
  if (!result.ok) return result;
  return { ok: true, orderId: id, lines, subtotal, line: T.orderSaved };
}

/** Take an order off the pending list. Nothing was paid, so nothing is refunded. */
async function removeOrder(prisma, discordUserId, { orderId, turn = null } = {}) {
  const actor = await terminalActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character } = actor;
  const id = String(orderId ?? "");

  const result = await run(prisma, async (tx) => {
    const order = await tx.merchantOrder.findFirst({ where: { id, deliveredAt: null } });
    if (!order) throw userError(T.noOrder);
    const { count } = await tx.merchantOrder.deleteMany({ where: { id, deliveredAt: null } });
    if (count !== 1) throw userError(T.noOrder);
    await logAudit(tx, {
      actorDiscordUserId: discordUserId,
      actionType: "merchant_terminal_order_remove",
      targetCharacterId: character.id,
      turnId: turn?.id ?? null,
      details: { orderId: id, lines: linesOf(order), subtotal: order.totalObols },
    });
    return { ok: true };
  });
  if (!result.ok) return result;
  return { ok: true, orderId: id, line: T.orderRemoved };
}

module.exports = {
  TERMINAL_PARTY,
  MAX_ORDER_LINES,
  unlocksTerminal,
  terminalShelf,
  priceCart,
  orderSummary,
  pendingSubtotal,
  terminalState,
  insertObols,
  withdrawObols,
  placeOrder,
  editOrder,
  removeOrder,
};
