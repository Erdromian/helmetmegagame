// The Black Market terminal, in the Exactor's Office (docs/zones.yaml,
// undertown-9-3). Built from Bascinet's own design document,
// E:\Bascinet\V3\Den\Black Market.docx — see docs/systemdocs/DEPOT.md §0n.
//
// The Black Market used to be a shelf at the Depot's counter, opened by a
// Silver Chip, paid from a bank account and delivered by train in crates. None
// of that is true any more:
//
//   - It is a terminal on a wall, and only a ring carrying the
//     `black-market-key` token works it — the Exactor's and the Pusher's
//     (their `ring:` blocks in docs/roles.yaml). The ring is read, never a held
//     tag, the way the collar remote reads it (db/lib/collar.js).
//   - You feed it physical obols and it keeps them as CREDIT. The credit is
//     one number on the room (Room.blackMarketObols), shared by everybody whose
//     ring works it, and there is no way to take it back out. The coin left
//     Ravenheart when it went into the slot, so it books to the Company and
//     cannot be robbed back.
//   - An order spends that credit and the goods are in the buyer's hands at
//     once. No crate, no train, no bank account.
//
// The Depot's counter stocks none of these wares any more
// (db/lib/merchantTerminal.js#terminalShelf lists everything but these).
//
// Returns `{ ok: false, error }` rather than throwing, the db/lib/depotCounter.js
// convention, so a refusal reads the same on both faces. Takes `prisma` as a
// parameter and stays off the @lifeweb/db barrel (db/lib/dm.js); require by path.

const { MANIFEST_BLACK_MARKET } = require("./depotManifests");
const { normalizeQuantity } = require("./depot");
const { wornRingAccess } = require("./rings");
const { roomAccessKeys, accessibleRooms } = require("./roomAccess");
const { blockerFor, ACT } = require("./incapacitation");
const { addToStack, dropCharacterTag, lockRoom } = require("./tagWrites");
const { COMPANY, characterParty, turnStamp } = require("./economyLedger");
const { carryAdmits } = require("./carry");
const { holdLimitRefusal } = require("./mounts");
const { rowWeight } = require("./tagWeight");
const { SFX } = require("./sfx");
const { BLACK_MARKET_ROOM_SLUG, BLACK_MARKET_TEXT: T } = require("./blackMarketText");
const { logAudit } = require("./auditLog");

// The ring token that works the terminal, and opens the office door for the
// Pusher. A tag row in docs/tags.yaml that is never an item (RINGS.md §3).
const BLACK_MARKET_TOKEN = "black-market-key";

const OBOL_SLUG = "obol";

// So a fat-fingered cart can't file for ten thousand vials — the Depot's cap.
const MAX_ORDER_LINES = 40;

function fail(error) {
  return { ok: false, error };
}

/** Whether the worn ring's tokens work the terminal. */
function ringWorksTerminal(ringTokens) {
  return [...(ringTokens ?? [])].includes(BLACK_MARKET_TOKEN);
}

/** What the terminal lists: every priced ware on the black-market manifest. */
async function blackMarketShelf(prisma) {
  return prisma.tag.findMany({
    where: { manifest: MANIFEST_BLACK_MARKET, depotPrice: { not: null } },
    orderBy: { name: "asc" },
  });
}

/**
 * Price a cart against the shelf, before anything is charged. Pure.
 *
 * `shelf` is the Tag rows blackMarketShelf returns; `items` is
 * [{ tagId, quantity }] off the client, trusted for nothing; `held` is the
 * buyer's CharacterTag rows with `tag`. Resolves to { ok, lines, total } or a
 * refusal. Duplicate lines are merged BEFORE the clamp, so two lines of 99
 * cannot slip 198 through.
 */
function priceOrder(shelf, items, held = []) {
  if (!Array.isArray(items) || items.length === 0) return fail(T.nothingPicked);
  if (items.length > MAX_ORDER_LINES) return fail(T.tooManyLines(MAX_ORDER_LINES));

  const wanted = new Map();
  for (const item of items) {
    const quantity = normalizeQuantity(item?.quantity);
    if (quantity == null) return fail(T.notAQuantity);
    const id = String(item?.tagId ?? "");
    wanted.set(id, (wanted.get(id) ?? 0) + quantity);
  }

  const byId = new Map((shelf ?? []).map((tag) => [tag.id, tag]));
  const heldIds = new Set((held ?? []).filter((ct) => (ct.quantity ?? 1) > 0).map((ct) => ct.tagId ?? ct.tag?.id));

  const lines = [];
  let total = 0;
  for (const [tagId, quantity] of wanted) {
    const tag = byId.get(tagId);
    if (!tag || tag.depotPrice == null) return fail(T.notStocked);
    if (normalizeQuantity(quantity) == null) return fail(T.notAQuantity);
    // Non-stackable wares are unique per character (CharacterTag), and
    // addToStack leaves an already-held one alone and records nothing — so
    // both are refused here, before the credit is touched.
    if (!tag.stackable && quantity > 1) return fail(T.onlyOne(tag.name));
    if (!tag.stackable && heldIds.has(tag.id)) return fail(T.alreadyHave(tag.name));
    total += tag.depotPrice * quantity;
    lines.push({ tagId: tag.id, slug: tag.slug, name: tag.name, quantity, unitPrice: tag.depotPrice, tag });
  }

  // One mount, up to 3 unruly or young arelitz (db/lib/mounts.js).
  const tooMany = holdLimitRefusal(held, lines.map((l) => ({ slug: l.slug, quantity: l.quantity })));
  if (tooMany) return fail(tooMany);

  return { ok: true, lines, total };
}

/** "Heroin x 2, Machete" — what the buyer is told they got. */
function orderSummary(lines) {
  return (lines ?? []).map((l) => (l.quantity > 1 ? `${l.name} x ${l.quantity}` : l.name)).join(", ");
}

// Alive, able to act, standing at the Den Interior with a way into the office,
// and wearing a ring the terminal answers to. Re-loaded on every press — a web
// dialog and a Discord button both outlive somebody walking out of the room.
async function blackMarketActor(prisma, discordUserId) {
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
    where: { slug: BLACK_MARKET_ROOM_SLUG },
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
      locationId: true,
      accessTagSlugs: true,
      blackMarketObols: true,
    },
  });
  if (!room) return fail(T.noTerminal);
  if (character.locationId !== room.locationId) return fail(T.notHere);

  const blocker = blockerFor(character.tags, ACT);
  if (blocker) return fail(T.cantAct(blocker.name));

  const keys = await roomAccessKeys(prisma, character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    return fail(T.noDoor);
  }

  // Getting into the office is not enough: somebody let in, or holding a key,
  // is still refused. The ring on the finger is the whole gate.
  if (!ringWorksTerminal(wornRingAccess(character.tags))) return fail(T.notYourRing);

  return { ok: true, character, room };
}

function coinHeld(character, coinId) {
  return (character.tags ?? []).find((ct) => ct.tagId === coinId)?.quantity ?? 0;
}

/**
 * What the terminal shows: the credit, the coin in your hand, and the shelf.
 * A read, so it answers between sittings too; the two writes below do not.
 */
async function blackMarketState(prisma, discordUserId) {
  const actor = await blackMarketActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character, room } = actor;

  const [shelf, coin] = await Promise.all([
    blackMarketShelf(prisma),
    prisma.tag.findUnique({ where: { slug: OBOL_SLUG }, select: { id: true } }),
  ]);
  const heldIds = new Set((character.tags ?? []).filter((ct) => (ct.quantity ?? 1) > 0).map((ct) => ct.tagId));

  return {
    ok: true,
    roomId: room.id,
    credit: room.blackMarketObols ?? 0,
    carrying: coin ? coinHeld(character, coin.id) : 0,
    wares: shelf.map((tag) => ({
      id: tag.id,
      name: tag.name,
      description: tag.description ?? "",
      price: tag.depotPrice,
      stackable: Boolean(tag.stackable),
      // A non-stackable ware you already hold can't be bought again.
      owned: !tag.stackable && heldIds.has(tag.id),
    })),
  };
}

/**
 * Feed obols into the slot. They leave the hand and Ravenheart at once, and
 * become credit. There is no withdraw, on purpose (the design doc).
 */
async function insertObols(prisma, discordUserId, { amount, turn = null } = {}) {
  const actor = await blackMarketActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character, room } = actor;

  const coin = await prisma.tag.findUnique({ where: { slug: OBOL_SLUG }, select: { id: true } });
  if (!coin) return fail(T.noCoin);

  const carried = coinHeld(character, coin.id);
  if (carried <= 0) return fail(T.noCoins);
  const n = Math.trunc(Number(amount));
  if (!Number.isFinite(n) || n <= 0 || n > carried) return fail(T.insertAmount(carried));

  const econ = { reason: "BLACK_MARKET_INSERT", ...turnStamp(turn) };
  let total = 0;
  try {
    await prisma.$transaction(async (tx) => {
      // Room lock first, always (db/lib/tagWrites.js), then the hand.
      await lockRoom(tx, room.id);
      // One call books the whole movement: the coin goes off-world.
      await dropCharacterTag(tx, character.id, coin.id, n, {
        econ: { from: characterParty(character), to: COMPANY, ...econ },
      });
      const updated = await tx.room.update({
        where: { id: room.id },
        data: { blackMarketObols: { increment: n } },
        select: { blackMarketObols: true },
      });
      total = updated.blackMarketObols;
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "black_market_insert",
        targetCharacterId: character.id,
        turnId: turn?.id ?? null,
        details: { amount: n, creditAfter: total },
        place: { locationId: null, roomId: room.id },
      });
    });
  } catch {
    return fail(T.jammed);
  }

  return { ok: true, characterId: character.id, amount: n, credit: total, line: T.youInserted(n, total), sfx: SFX.COIN };
}

/**
 * Order off the terminal. `items` is [{ tagId, quantity }]. Spends the credit
 * and hands the goods over on the spot.
 */
async function blackMarketOrder(prisma, discordUserId, { items, turn = null } = {}) {
  const actor = await blackMarketActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character, room } = actor;

  const priced = priceOrder(await blackMarketShelf(prisma), items, character.tags);
  if (!priced.ok) return priced;
  const { lines, total } = priced;

  const credit = room.blackMarketObols ?? 0;
  if (total > credit) return fail(T.notEnough(total, credit));

  // The ceiling, exactly as a Transfer applies it: goods land in a hand.
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { carryWeightLbs: true } });
  const weightLbs = lines.reduce((sum, l) => sum + rowWeight({ tag: l.tag, quantity: l.quantity }), 0);
  const verdict = carryAdmits(character, config, { weightLbs });
  if (!verdict.ok) return fail(T.noRoom(verdict.reason));

  const me = characterParty(character);
  const econ = { reason: "BLACK_MARKET_ORDER", ...turnStamp(turn) };
  const snapshot = lines.map(({ tagId, name, quantity, unitPrice }) => ({ tagId, name, quantity, unitPrice }));
  let left = 0;
  try {
    await prisma.$transaction(async (tx) => {
      await lockRoom(tx, room.id);
      // The decrement IS the check: two buyers spending the same credit at
      // once cannot both pass it.
      const paid = await tx.room.updateMany({
        where: { id: room.id, blackMarketObols: { gte: total } },
        data: { blackMarketObols: { decrement: total } },
      });
      if (paid.count !== 1) {
        const now = await tx.room.findUnique({ where: { id: room.id }, select: { blackMarketObols: true } });
        const err = new Error(T.notEnough(total, now?.blackMarketObols ?? 0));
        err.userMessage = err.message;
        throw err;
      }
      for (const line of lines) {
        await addToStack(tx, character.id, line.tagId, line.quantity, {
          source: "EVENT",
          stackable: Boolean(line.tag.stackable),
          // The goods leg: from off-world, into the buyer's hands.
          econ: { from: COMPANY, to: me, ...econ },
        });
      }
      const after = await tx.room.findUnique({ where: { id: room.id }, select: { blackMarketObols: true } });
      left = after?.blackMarketObols ?? 0;
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "black_market_order",
        targetCharacterId: character.id,
        turnId: turn?.id ?? null,
        details: { lines: snapshot, total, creditAfter: left },
        place: { locationId: null, roomId: room.id },
      });
    });
  } catch (err) {
    return fail(err?.userMessage ?? T.jammed);
  }

  return {
    ok: true,
    characterId: character.id,
    lines: snapshot,
    total,
    credit: left,
    line: T.youBought(orderSummary(snapshot), total, left),
    sfx: SFX.COIN,
  };
}

module.exports = {
  BLACK_MARKET_ROOM_SLUG,
  BLACK_MARKET_TOKEN,
  MAX_ORDER_LINES,
  ringWorksTerminal,
  priceOrder,
  orderSummary,
  blackMarketShelf,
  blackMarketState,
  insertObols,
  blackMarketOrder,
};
