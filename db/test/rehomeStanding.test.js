// db/lib/locationMove.js#rehomeStandingCharacters — the Discord half of moving
// a Location into another zone from /gm/dev/zones. Its query used to filter
// `discordUserId: { not: null }`, which Prisma refuses for a required column,
// so on live (where DISCORD_TOKEN is always set) the Zone control threw after
// its database write had already landed. Skips itself unless DATABASE_URL is
// local; a location nobody stands in means no Discord call is ever made.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isLocalDatabase } = require("../lib/localDatabase");

const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

test("re-homing an empty location runs its query and does nothing", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const token = process.env.DISCORD_TOKEN;
  // The function returns before querying without a token, which is how this
  // bug hid from every local run.
  process.env.DISCORD_TOKEN = "test-token-never-used";
  t.after(async () => {
    if (token === undefined) delete process.env.DISCORD_TOKEN;
    else process.env.DISCORD_TOKEN = token;
    await prisma.$disconnect();
  });
  const { rehomeStandingCharacters } = require("../lib/locationMove");
  await assert.doesNotReject(() =>
    rehomeStandingCharacters(prisma, { locationId: "no-such-location", fromRoleId: null, toRoleId: null }),
  );
});
