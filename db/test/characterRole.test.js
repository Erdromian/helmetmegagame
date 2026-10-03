// Every living character's name token, playing on Discord or not.
//
// WHAT A FAILURE HERE MEANS. /add, /remove, /heal and an @ on Discord pick a
// character by their personal role, so a character with no role cannot be
// named from Discord at all. From 2026-09-15 to 2026-10-03 only characters
// playing on Discord got one, and a Discord player could not /add anybody who
// played from the web. These pin that the role is minted regardless of the
// switch, and that two writers racing (a Bio save and the channel doctor)
// leave one role behind, not two.
const test = require("node:test");
const assert = require("node:assert/strict");

// Stub the REST layer before characterRole.js destructures it.
const calls = [];
const restPath = require.resolve("../lib/discordRest");
require.cache[restPath] = {
  id: restPath,
  filename: restPath,
  loaded: true,
  exports: {
    createGuildRole: async (body) => {
      calls.push(["create", body]);
      return { id: `new-${calls.length}` };
    },
    patchGuildRole: async (roleId, body) => {
      calls.push(["patch", roleId, body]);
      return {};
    },
    deleteGuildRole: async (roleId) => {
      calls.push(["delete", roleId]);
      return null;
    },
  },
};

const { mintCharacterRole, ensureCharacterRole } = require("../lib/characterRole");
const { hashNameToColor } = require("../lib/roleColor");

function fakePrisma({ winner = null } = {}) {
  const writes = [];
  return {
    writes,
    characterTag: { findMany: async () => [] },
    character: {
      // `winner` set: somebody else recorded a role first, so the conditional write misses.
      updateMany: async (args) => {
        writes.push(args);
        return { count: winner ? 0 : 1 };
      },
      findUnique: async () => ({ discordRoleId: winner }),
    },
  };
}

const webOnly = { id: "c1", firstName: "Ada", lastName: "Vane", discordRoleId: null, discordMirrored: false };

test.beforeEach(() => {
  calls.length = 0;
  process.env.DISCORD_GUILD_ID = "guild";
  process.env.DISCORD_TOKEN = "token";
});

test("a web-only character gets a role", async () => {
  const prisma = fakePrisma();
  const id = await ensureCharacterRole(prisma, webOnly);

  assert.equal(id, "new-1");
  assert.deepEqual(calls, [
    ["create", { name: "Ada Vane", color: hashNameToColor("Ada Vane"), hoist: false, mentionable: true, permissions: "0" }],
  ]);
  assert.deepEqual(prisma.writes, [{ where: { id: "c1", discordRoleId: null }, data: { discordRoleId: "new-1" } }]);
});

test("a recorded role is repainted, not replaced", async () => {
  const id = await ensureCharacterRole(fakePrisma(), { ...webOnly, discordRoleId: "r1" });
  assert.equal(id, "r1");
  assert.deepEqual(calls, [["patch", "r1", { name: "Ada Vane", color: hashNameToColor("Ada Vane") }]]);
});

test("losing a race deletes the spare role and answers the winner's", async () => {
  const id = await mintCharacterRole(fakePrisma({ winner: "theirs" }), webOnly);
  assert.equal(id, "theirs");
  assert.deepEqual(
    calls.map((c) => c.slice(0, 2)),
    [["create", calls[0][1]], ["delete", "new-1"]],
  );
});

test("a deleted role is replaced only if the row still holds the dead id", async () => {
  const prisma = fakePrisma();
  await mintCharacterRole(prisma, { ...webOnly, discordRoleId: "gone" });
  assert.deepEqual(prisma.writes[0].where, { id: "c1", discordRoleId: "gone" });
});

test("no Discord configured: nothing is minted", async () => {
  delete process.env.DISCORD_TOKEN;
  assert.equal(await ensureCharacterRole(fakePrisma(), webOnly), null);
  assert.deepEqual(calls, []);
});
