// node --test over db/lib/partyChat.js — the party thread follows the escort
// rows, and every seat it hands out or takes away tells the web (a presence
// NOTIFY), because /chat only re-reads its place list when told to. Leave
// somebody and Bring somebody else used to leave /chat showing the first,
// deleted party and never the new one.
//
// Against a real Postgres, and only under LOCAL_MODE so no Discord call can
// leave the machine. Skips itself otherwise.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isLocalDatabase } = require("../lib/localDatabase");

const skip =
  (!isLocalDatabase() && "point DATABASE_URL at a local Postgres") ||
  (process.env.LOCAL_MODE !== "true" && "set LOCAL_MODE=true so no Discord call is real");

test("a party opens, closes and opens again, and the web hears each time", { skip }, async (t) => {
  // Catch the NOTIFYs. partyChat takes notifyPresence off the module when it
  // loads, so the spy goes in first.
  const told = [];
  require("../lib/presenceNotify").notifyPresence = async (_prisma, id) => {
    told.push(id);
    return true;
  };
  const { syncPartyMembership } = require("../lib/partyChat");
  const { attach, detach } = require("../lib/escort");
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  const location = await prisma.location.findFirst({ select: { id: true, zoneId: true } });
  if (!location) return t.skip("no Location in this database");

  // No #party channel, no thread at all (ensurePartyThreadFor), so lend one.
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { partyChannelId: true } });
  if (!config) return t.skip("no GameConfig row in this database");
  if (!config.partyChannelId) {
    await prisma.gameConfig.update({ where: { id: 1 }, data: { partyChannelId: "party-test-channel" } });
  }

  const stamp = Date.now().toString(36);
  const make = (first) =>
    prisma.character.create({
      data: {
        name: `${first} Partytest${stamp}`,
        firstName: first,
        lastName: `Partytest${stamp}`,
        status: "ALIVE",
        locationId: location.id,
        zoneId: location.zoneId,
        discordUserId: `party-test-${first}-${stamp}`,
      },
      select: { id: true },
    });
  const leader = await make("Leader");
  const first = await make("First");
  const second = await make("Second");
  const ids = [leader.id, first.id, second.id];

  t.after(async () => {
    await prisma.partyThread.deleteMany({ where: { creatorCharacterId: { in: ids } } });
    await prisma.character.updateMany({ where: { id: { in: ids } }, data: { escortedById: null } });
    await prisma.character.deleteMany({ where: { id: { in: ids } } });
    if (!config.partyChannelId) {
      await prisma.gameConfig.update({ where: { id: 1 }, data: { partyChannelId: null } });
    }
    await prisma.$disconnect();
  });

  const seats = async () => {
    const thread = await prisma.partyThread.findUnique({
      where: { creatorCharacterId: leader.id },
      select: { id: true, members: { select: { characterId: true } } },
    });
    return thread ? { id: thread.id, members: thread.members.map((m) => m.characterId).sort() } : null;
  };
  const step = async (fn) => {
    told.length = 0;
    await fn();
    return new Set(told);
  };

  // Bring the first one.
  let heard = await step(async () => {
    await attach(prisma, leader.id, first.id);
    await syncPartyMembership(prisma, leader.id);
  });
  const one = await seats();
  assert.deepEqual(one?.members, [leader.id, first.id].sort());
  assert.ok(heard.has(leader.id) && heard.has(first.id), "both new members are told");

  // Leave them: the party is gone, and both hear it.
  heard = await step(async () => {
    await detach(prisma, first.id);
    await syncPartyMembership(prisma, leader.id);
  });
  assert.equal(await seats(), null);
  assert.ok(heard.has(leader.id) && heard.has(first.id), "a teardown tells everyone who sat in it");

  // Bring somebody else: a NEW party, and the web is told about it.
  heard = await step(async () => {
    await attach(prisma, leader.id, second.id);
    await syncPartyMembership(prisma, leader.id);
  });
  const two = await seats();
  assert.deepEqual(two?.members, [leader.id, second.id].sort());
  assert.notEqual(two.id, one.id);
  assert.ok(heard.has(leader.id) && heard.has(second.id), "the second party is announced too");

  // The follower walks off under their own power. The move clears their
  // escortedById and syncs THEM (locationTravel.js, locationMove.js) — the
  // leader's thread must not keep their seat.
  heard = await step(async () => {
    await prisma.character.update({ where: { id: second.id }, data: { escortedById: null } });
    await syncPartyMembership(prisma, second.id);
  });
  assert.equal(await seats(), null, "the leader led nobody any more, so the party closed");
  assert.ok(heard.has(second.id), "the one who walked off is told");
});
