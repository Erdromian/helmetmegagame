// node --test over db/lib/corpseSense.js#corpseSenseLine — the four things a
// nose can say. Pure, so none of this needs a database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { corpseSenseLine, CORPSE_SENSE_HOPS, CORPSE_SENSE_INTERVAL_MS } = require("../lib/corpseSense");

test("a body in a room you can get into is named", () => {
  assert.equal(
    corpseSenseLine({ here: { roomName: "the Cellar" } }),
    "You smell a corpse in the Cellar.",
  );
});

test("a body behind a door you have no key to is not", () => {
  assert.equal(
    corpseSenseLine({ here: { hidden: true } }),
    "You smell a corpse nearby, but you don't know where.",
  );
});

test("a body further off names YOUR OWN neighbour, never its Location", () => {
  assert.equal(
    corpseSenseLine({ viaName: "the Gate" }),
    "You smell a corpse in the direction of the Gate.",
  );
});

test("a way that runs through a hidden link gives no direction at all", () => {
  // soundRange returns viaName null across a hidden edge, and naming it would
  // punch a hole in the thing that makes the edge hidden.
  assert.equal(corpseSenseLine({ viaName: null }), "You smell a corpse somewhere nearby.");
  assert.equal(corpseSenseLine({}), "You smell a corpse somewhere nearby.");
});

test("the two numbers are the ones the doc promises", () => {
  assert.equal(CORPSE_SENSE_HOPS, 7);
  assert.equal(CORPSE_SENSE_INTERVAL_MS, 20 * 60_000);
});

// The sweep's query itself, against a real Postgres. It used to filter
// `discordUserId: { not: null }`, which Prisma refuses outright for a required
// column, so every minute's sweep threw and nobody holding the salts ever
// smelled anything. Skips itself unless DATABASE_URL is local.
test("the minute sweep's query is one Prisma accepts", { skip: !require("../lib/localDatabase").isLocalDatabase() && "point DATABASE_URL at a local Postgres" }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { runCorpseSenseSweep } = require("../lib/corpseSense");
  // Nobody holds the salts on a fresh CI database, so this is the one query and out.
  const holders = await prisma.characterTag.count({ where: { tag: { slug: "corpse-sense" } } });
  if (holders) t.skip("somebody holds corpse sense here; the sweep would DM them");
  else await assert.doesNotReject(() => runCorpseSenseSweep(prisma));
});
