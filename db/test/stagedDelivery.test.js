// The Delivery table's one promise: a staged message reaches each recipient
// once (db/lib/stagedDelivery.js, docs/systemdocs/ADJUDICATION.md §1a).
//
// WHAT A FAILURE HERE MEANS. Before this table, the push recorded its progress
// as a step key on the Turn and swallowed each bounce inside the step — so a
// bounced recipient was recorded as done and no resume ever retried them, and
// the Resend button ran a second, slightly different copy of the send. The
// claim below is what replaced both. If it stops holding, a resumed push and a
// GM pressing Resend can each send the same DM, and a player reads their turn
// result twice.
//
// The claim needs a real Postgres (it is an UPDATE ... WHERE with a count),
// so those cases skip unless DATABASE_URL is a local one — the same allowlist
// db/lib/localDatabase.js uses everywhere else.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isLocalDatabase } = require("../lib/localDatabase");
const { deliveryKeyFor, STALE_CLAIM_MS } = require("../lib/stagedDelivery");

const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

test("a delivery key names the message and the recipient, never a loop index", () => {
  assert.equal(deliveryKeyFor("msg1", "u1"), "staged:msg1:u1");
  // A recipient removed between a crash and its resume must not shift anybody
  // else's key — which is exactly what an index-based key did.
  assert.equal(deliveryKeyFor("msg1", "u3"), "staged:msg1:u3");
  assert.equal(deliveryKeyFor("msg1", null), "staged:msg1:none");
});

test("a stale claim expires, so a killed process cannot strand a row", () => {
  // Five minutes, NOT the thirty Turn.sideEffectClaimedAt uses — that window
  // covers a whole side-effect thunk, this one covers a single DM. The
  // difference is the delay a player sits through after a crashed push.
  assert.equal(STALE_CLAIM_MS, 5 * 60 * 1000);
});

test("two claims on one delivery: exactly one wins", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const { claimDelivery, ensureDeliveries } = require("../lib/stagedDelivery");
  const prisma = new PrismaClient();

  // A StagedMessage needs a Turn, so borrow whichever one the local stack has
  // and skip cleanly rather than inventing a whole game.
  const turn = await prisma.turn.findFirst({ orderBy: { number: "desc" } });
  if (!turn) {
    await prisma.$disconnect();
    return t.skip("no Turn in the local database — run npm run dev:seed");
  }

  const message = await prisma.stagedMessage.create({
    data: {
      turnId: turn.id,
      kind: "PRIVATE",
      content: "test delivery claim",
      createdByDiscordUserId: "test-gm",
    },
  });
  t.after(async () => {
    await prisma.stagedMessage.delete({ where: { id: message.id } }).catch(() => {});
    await prisma.$disconnect();
  });

  const recipients = [{ characterId: null, name: "Ada", discordUserId: "test-u1" }];
  const rows = await ensureDeliveries(prisma, { stagedMessage: message, recipients });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "PENDING");
  assert.equal(rows[0].dedupeKey, deliveryKeyFor(message.id, "test-u1"));

  // Called again — a resumed push — and it adds nothing.
  const again = await ensureDeliveries(prisma, { stagedMessage: message, recipients });
  assert.equal(again.length, 1);

  // The whole guarantee: the second claimant gets count 0 and sends nothing.
  assert.equal(await claimDelivery(prisma, rows[0]), true);
  assert.equal(await claimDelivery(prisma, rows[0]), false);

  // A SENT row is claimable by nobody, ever.
  await prisma.delivery.update({
    where: { id: rows[0].id },
    data: { state: "SENT", sentAt: new Date(), claimedAt: null },
  });
  assert.equal(await claimDelivery(prisma, rows[0]), false);

  // A FAILED row is, which is what Resend rides on.
  await prisma.delivery.update({ where: { id: rows[0].id }, data: { state: "FAILED" } });
  assert.equal(await claimDelivery(prisma, rows[0]), true);

  // And an IN_FLIGHT row abandoned by a killed process comes back after the
  // stale window rather than being stuck forever.
  await prisma.delivery.update({
    where: { id: rows[0].id },
    data: { state: "IN_FLIGHT", claimedAt: new Date(Date.now() - STALE_CLAIM_MS - 1000) },
  });
  assert.equal(await claimDelivery(prisma, rows[0]), true);
});

test("the failure list is derived from the rows, not accumulated", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const { ensureDeliveries, failuresFor } = require("../lib/stagedDelivery");
  const prisma = new PrismaClient();

  const turn = await prisma.turn.findFirst({ orderBy: { number: "desc" } });
  if (!turn) {
    await prisma.$disconnect();
    return t.skip("no Turn in the local database — run npm run dev:seed");
  }
  const message = await prisma.stagedMessage.create({
    data: { turnId: turn.id, kind: "PRIVATE", content: "test failures", createdByDiscordUserId: "test-gm" },
  });
  t.after(async () => {
    await prisma.stagedMessage.delete({ where: { id: message.id } }).catch(() => {});
    await prisma.$disconnect();
  });

  const rows = await ensureDeliveries(prisma, {
    stagedMessage: message,
    recipients: [
      { characterId: null, name: "Ada", discordUserId: "test-u1" },
      { characterId: null, name: "Bram", discordUserId: "test-u2" },
    ],
  });
  await prisma.delivery.update({ where: { id: rows[0].id }, data: { state: "SENT", sentAt: new Date() } });
  await prisma.delivery.update({
    where: { id: rows[1].id },
    data: { state: "FAILED", lastError: { error: "DMs closed", status: 403 } },
  });

  const failures = await failuresFor(prisma, message.id);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].name, "Bram");
  assert.equal(failures[0].error, "DMs closed");

  // The retry lands, and the list empties itself — the blob and the rows
  // cannot drift, because the blob is only ever a copy of the rows.
  await prisma.delivery.update({ where: { id: rows[1].id }, data: { state: "SENT", sentAt: new Date() } });
  assert.deepEqual(await failuresFor(prisma, message.id), []);
});
