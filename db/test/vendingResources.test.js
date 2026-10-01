// ⬢ on the vending machine's shelf (docs/systemdocs/VENDING.md §6). They used to
// be refused alongside obols; now they stock, sell and come back out like any
// other ware, and only coin is turned away.
//
// Runs the real engine against a real Postgres, at the seeded machine on
// undertown-6-1. Skips unless DATABASE_URL is a local one
// (db/lib/localDatabase.js); makes its own two characters, and on the way out
// deletes them, the shelf line it added, and the rows they left behind, and puts
// the machine's coin back where it found it.
process.env.LOCAL_MODE = "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isLocalDatabase } = require("../lib/localDatabase");

const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

test("the merchant can stock ⬢ and a customer can buy them, but coin stays off the shelf", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const vending = require("../lib/vending");
  const { MERCHANT_LICENSE_SLUG } = require("../lib/depot");
  const { placeKeyForRoom } = require("../lib/placeKey");

  const room = await prisma.room.findFirst({
    where: { vendingMachine: true, retiredAt: null, kind: "PUBLIC", accessTagSlugs: { isEmpty: true } },
    select: { id: true, locationId: true, location: { select: { zoneId: true } } },
  });
  const tags = await prisma.tag.findMany({
    where: { slug: { in: ["resources", "obol", MERCHANT_LICENSE_SLUG] } },
    select: { id: true, slug: true },
  });
  const tagId = Object.fromEntries(tags.map((tg) => [tg.slug, tg.id]));
  if (!room || tags.length !== 3) {
    await prisma.$disconnect();
    return t.skip("the local database has no open vending room, or no resources/obol/licence tag — run npm run dev:setup");
  }
  const machine = await vending.ensureMachine(prisma, room.id);
  if (vending.heldBy(machine) || machine.slots.some((s) => s.tagId === tagId.resources)) {
    await prisma.$disconnect();
    return t.skip("somebody is at the local machine, or it already sells ⬢ — leaving it alone");
  }

  const startedAt = new Date();
  const run = Math.random().toString(36).slice(2, 8);
  const people = [];
  t.after(async () => {
    const ids = people.map((p) => p.id);
    await prisma.vendingMachine.update({
      where: { id: machine.id },
      data: { floatObols: machine.floatObols, tillObols: machine.tillObols, holderId: null, holderSince: null, unlocked: false },
    });
    await prisma.vendingSlot.deleteMany({ where: { machineId: machine.id, tagId: tagId.resources } });
    await prisma.economyEntry.deleteMany({
      where: { OR: [{ fromId: { in: ids } }, { toId: { in: ids } }], at: { gte: startedAt } },
    });
    await prisma.auditLog.deleteMany({ where: { targetCharacterId: { in: ids } } }).catch(() => {});
    await prisma.archiveEntry.deleteMany({ where: { placeKey: placeKeyForRoom(room.id), sentAt: { gte: startedAt } } });
    await prisma.characterTag.deleteMany({ where: { characterId: { in: ids } } });
    await prisma.character.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  async function person(key, holdings) {
    const c = await prisma.character.create({
      data: {
        discordUserId: `vr-test-${key}-${run}`,
        firstName: key,
        lastName: "Test",
        name: `${key} Test ${run}`,
        status: "ALIVE",
        zoneId: room.location.zoneId,
        locationId: room.locationId,
      },
    });
    people.push(c);
    for (const [slug, quantity] of Object.entries(holdings)) {
      await prisma.characterTag.create({ data: { characterId: c.id, tagId: tagId[slug], quantity, source: "GM_GRANT" } });
    }
    return c;
  }
  const held = async (c, slug) =>
    (await prisma.characterTag.findUnique({ where: { characterId_tagId: { characterId: c.id, tagId: tagId[slug] } } }))
      ?.quantity ?? 0;

  const merchant = await person("Merchant", { [MERCHANT_LICENSE_SLUG]: 1, resources: 10, obol: 5 });
  const buyer = await person("Buyer", { obol: 4 });
  const at = { roomId: room.id };

  // The merchant stocks five ⬢ at 2 ¢ each.
  assert.equal((await vending.takeMachine(prisma, merchant.discordUserId, at)).ok, true);
  assert.equal((await vending.unlockMachine(prisma, merchant.discordUserId, at)).ok, true);
  const stocked = await vending.stockMachine(prisma, merchant.discordUserId, {
    ...at,
    tagId: tagId.resources,
    quantity: 5,
    priceObols: 2,
  });
  assert.equal(stocked.ok, true, stocked.error);
  assert.equal(stocked.line, "5 ⬢ on the shelf, at 2 ¢ each.");
  assert.equal(await held(merchant, "resources"), 5, "five left the merchant's hands");

  // Coin is still refused, in the same words as ever.
  const coin = await vending.stockMachine(prisma, merchant.discordUserId, { ...at, tagId: tagId.obol, quantity: 1, priceObols: 1 });
  assert.equal(coin.ok, false);
  assert.equal(coin.error, vending.VENDING_TEXT.noMoneyOnShelf);
  assert.equal(await held(merchant, "obol"), 5, "no coin left the merchant's hands");

  assert.equal((await vending.releaseMachine(prisma, merchant.discordUserId, at)).ok, true);

  // A customer buys one.
  assert.equal((await vending.takeMachine(prisma, buyer.discordUserId, at)).ok, true);
  assert.equal((await vending.insertCoins(prisma, buyer.discordUserId, { ...at, amount: 2 })).ok, true);
  const bought = await vending.buySlot(prisma, buyer.discordUserId, { ...at, tagId: tagId.resources });
  assert.equal(bought.ok, true, bought.error);
  assert.equal(bought.line, "1 ⬢, for 2 ¢. 0 ¢ left.");
  assert.match(bought.text, /takes 1 ⬢ out of the vendor\.$/);
  assert.equal(await held(buyer, "resources"), 1);
  assert.equal(await held(buyer, "obol"), 2);
  assert.equal((await vending.releaseMachine(prisma, buyer.discordUserId, at)).ok, true);

  const after = await prisma.vendingMachine.findUnique({ where: { id: machine.id }, include: { slots: true } });
  assert.equal(after.slots.find((s) => s.tagId === tagId.resources)?.quantity, 4, "four left on the shelf");
  assert.equal(after.tillObols, machine.tillObols + 2, "the 2 ¢ is in the till");

  // The ⬢ legs are BALANCE at par, between a character and the machine — one
  // row each way, so neither character's books drift (ECONOMY.md §3).
  const game = await prisma.gameState.findFirst({ select: { gameId: true } });
  if (game?.gameId) {
    const legs = await prisma.economyEntry.findMany({
      where: { tagSlug: "resources", at: { gte: startedAt }, OR: [{ fromId: machine.id }, { toId: machine.id }] },
      select: { fromId: true, toId: true, form: true, amount: true, reason: true },
    });
    assert.deepEqual(
      legs.map((l) => [l.fromId, l.toId, l.form, l.amount, l.reason]).sort(),
      [
        [merchant.id, machine.id, "BALANCE", 5, "VENDING_STOCK"],
        [machine.id, buyer.id, "BALANCE", 1, "VENDING_SALE"],
      ].sort(),
    );
  }

  // And the merchant can take what is left back out.
  assert.equal((await vending.takeMachine(prisma, merchant.discordUserId, at)).ok, true);
  assert.equal((await vending.unlockMachine(prisma, merchant.discordUserId, at)).ok, true);
  const out = await vending.unstockMachine(prisma, merchant.discordUserId, { ...at, tagId: tagId.resources, quantity: 4 });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.line, "4 ⬢ back in your hands.");
  assert.equal(await held(merchant, "resources"), 9);
});
