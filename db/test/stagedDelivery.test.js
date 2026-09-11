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
const { deliveryKeyFor, isRetryable, STALE_CLAIM_MS } = require("../lib/stagedDelivery");

const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

test("a delivery key names the message and the recipient, never a loop index", () => {
  assert.equal(deliveryKeyFor("msg1", { characterId: "c1", discordUserId: "u1" }), "staged:msg1:c1");
  // A recipient removed between a crash and its resume must not shift anybody
  // else's key — which is exactly what an index-based key did.
  assert.equal(deliveryKeyFor("msg1", { characterId: "c3", discordUserId: "u3" }), "staged:msg1:c3");
  // THE CHARACTER, not the Discord account. Two characters who never linked
  // Discord both have a null id, and keying on it gave them one shared key —
  // which createMany's skipDuplicates then collapsed into a single row, so one
  // of them was never delivered to and never even listed as failing.
  assert.notEqual(
    deliveryKeyFor("msg1", { characterId: "c1", discordUserId: null }),
    deliveryKeyFor("msg1", { characterId: "c2", discordUserId: null }),
  );
  // And a PUBLIC post's row cannot collide with any of them.
  assert.equal(deliveryKeyFor("msg1", null), "staged:msg1:public");
  assert.notEqual(
    deliveryKeyFor("msg1", null),
    deliveryKeyFor("msg1", { characterId: null, discordUserId: null }),
  );

  // THE PRODUCTION GUARD. A surface zone's #summary target must produce the
  // exact key a public row has always had. Production is full of
  // `staged:<id>:public` rows; tidy this tail into something prettier and every
  // already-pushed declaration grows a second row, which reads as never
  // attempted — so one GM pressing Resend re-posts a declaration that is
  // already sitting in the channel.
  assert.equal(deliveryKeyFor("msg1", { publicKey: "public" }), "staged:msg1:public");
  assert.equal(deliveryKeyFor("msg1", { publicKey: "public" }), deliveryKeyFor("msg1", null));

  // A cave declaration fans out to one row per Location, keyed by the LOCATION
  // rather than its channel id — the channel id gets rewritten on
  // re-provisioning and would orphan a SENT row.
  assert.equal(deliveryKeyFor("msg1", { publicKey: "public:loc:L1" }), "staged:msg1:public:loc:L1");
  assert.notEqual(
    deliveryKeyFor("msg1", { publicKey: "public:loc:L1" }),
    deliveryKeyFor("msg1", null),
  );
  assert.notEqual(
    deliveryKeyFor("msg1", { publicKey: "public:loc:L1" }),
    deliveryKeyFor("msg1", { publicKey: "public:loc:L2" }),
  );
});

// P0. Where a public declaration goes. No database: this is the mapping alone.
test("a cave level posts to every Location; a surface zone to its #summary", () => {
  const { publicTargetsFor } = require("../lib/publicPostTargets");

  const surface = { kind: "SURFACE", discordSummaryChannelId: "chan-summary" };
  assert.deepEqual(publicTargetsFor({ zone: surface }), [
    // `name` stays null so the tray goes on saying "the channel" for every
    // surface message exactly as it does today.
    { publicKey: "public", channelId: "chan-summary", name: null },
  ]);

  // An unprovisioned surface zone is a real fault and still reports as one —
  // the fan-out is keyed on the cave KIND, not on "has no summary channel".
  assert.deepEqual(publicTargetsFor({ zone: { kind: "SURFACE", discordSummaryChannelId: null } }), []);

  // "Underground" is a category and a GM seat, never a place.
  assert.deepEqual(publicTargetsFor({ zone: { kind: "CAVE_GROUP", discordSummaryChannelId: null } }), []);

  const cave = { kind: "CAVE_LEVEL", discordSummaryChannelId: null };
  const locations = [
    { id: "L1", name: "Customs", discordChannelId: "chan-1" },
    { id: "L2", name: "Depot", discordChannelId: "chan-2" },
    // Not provisioned yet — no channel, so nothing to post into.
    { id: "L3", name: "Walkways", discordChannelId: null },
  ];
  assert.deepEqual(publicTargetsFor({ zone: cave, locations }), [
    { publicKey: "public:loc:L1", channelId: "chan-1", name: "Customs" },
    { publicKey: "public:loc:L2", channelId: "chan-2", name: "Depot" },
  ]);

  // A cave whose Locations have no channels, and a message whose zone was
  // deleted (StagedMessage.zoneId is SetNull), are both "nowhere to post".
  assert.deepEqual(publicTargetsFor({ zone: cave, locations: [] }), []);
  assert.deepEqual(publicTargetsFor({ zone: null }), []);
});

test("a stranded IN_FLIGHT row is retryable; a fresh claim is not", () => {
  assert.equal(isRetryable({ state: "PENDING" }), true);
  assert.equal(isRetryable({ state: "FAILED" }), true);
  assert.equal(isRetryable({ state: "SENT" }), false);
  // Somebody is sending it right now. Leave it alone.
  assert.equal(isRetryable({ state: "IN_FLIGHT", claimedAt: new Date() }), false);
  // Nobody is. A process died holding this one, and without this the Resend
  // button would tell the GM nothing had failed while a player got nothing.
  assert.equal(
    isRetryable({ state: "IN_FLIGHT", claimedAt: new Date(Date.now() - STALE_CLAIM_MS - 1000) }),
    true,
  );
  assert.equal(isRetryable({ state: "IN_FLIGHT", claimedAt: null }), true);
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
  assert.equal(rows[0].dedupeKey, deliveryKeyFor(message.id, recipients[0]));

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

// ---------------------------------------------------------------------------
// The cases the review found. Each one is a way a player reads their turn
// result twice, or never reads it at all.
// ---------------------------------------------------------------------------

// A fake sendDm, swapped in per test. deliverPrivate requires ./dm at module
// load, so the swap goes through the require cache — the same trick the rest of
// db/test uses for the Discord transports.
function withFakeDm(t, impl) {
  const dm = require("../lib/dm");
  const real = dm.sendDm;
  dm.sendDm = impl;
  t.after(() => {
    dm.sendDm = real;
  });
}

// The same swap for the PUBLIC transport. This was impossible until
// stagedDelivery.js stopped destructuring postMessageBatched at load time,
// which is why the public half of that file had no tests at all.
function withFakePost(t, impl) {
  const discordRest = require("../lib/discordRest");
  const real = discordRest.postMessageBatched;
  discordRest.postMessageBatched = impl;
  t.after(() => {
    discordRest.postMessageBatched = real;
  });
}

// Real Character rows: Delivery.characterId is a foreign key, so a made-up id
// is rejected by the database rather than quietly stored. Three fields is the
// whole requirement.
async function scratchCharacters(prisma, t, names) {
  const made = [];
  for (const name of names) {
    made.push(
      await prisma.character.create({
        data: {
          discordUserId: `test-${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          firstName: name,
          name,
        },
      }),
    );
  }
  t.after(async () => {
    for (const c of made) await prisma.character.delete({ where: { id: c.id } }).catch(() => {});
  });
  return made;
}

async function scratchMessage(prisma, t, data = {}) {
  const turn = await prisma.turn.findFirst({ orderBy: { number: "desc" } });
  if (!turn) return null;
  const message = await prisma.stagedMessage.create({
    data: {
      turnId: turn.id,
      kind: "PRIVATE",
      content: "test",
      createdByDiscordUserId: "test-gm",
      ...data,
    },
  });
  t.after(async () => {
    await prisma.stagedMessage.delete({ where: { id: message.id } }).catch(() => {});
  });
  return message;
}

// S3. Two recipients with no Discord account are two people, not one.
test("two recipients without a Discord id get two rows", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const { ensureDeliveries } = require("../lib/stagedDelivery");
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());

  const message = await scratchMessage(prisma, t);
  if (!message) return t.skip("no Turn in the local database — run npm run dev:seed");

  const [ada, bram] = await scratchCharacters(prisma, t, ["Ada", "Bram"]);
  const rows = await ensureDeliveries(prisma, {
    stagedMessage: message,
    recipients: [
      { characterId: ada.id, name: "Ada", discordUserId: null },
      { characterId: bram.id, name: "Bram", discordUserId: null },
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.name).sort(), ["Ada", "Bram"]);
});

// S1. The urgent one. Production carries messages pushed before this table
// existed: a sentAt, no rows, and a blob naming the one recipient who bounced.
// Resend on one of those must reach that recipient and NOBODY else.
test("a legacy message resends only the recipient the blob named", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const { backfillLegacyDeliveries, deliverPrivate } = require("../lib/stagedDelivery");
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());

  const message = await scratchMessage(prisma, t, { sentAt: new Date() });
  if (!message) return t.skip("no Turn in the local database — run npm run dev:seed");

  const [ada, bram, cass] = await scratchCharacters(prisma, t, ["Ada", "Bram", "Cass"]);
  const recipients = [
    { characterId: ada.id, name: "Ada", discordUserId: "test-u1" },
    { characterId: bram.id, name: "Bram", discordUserId: "test-u2" },
    { characterId: cass.id, name: "Cass", discordUserId: "test-u3" },
  ];
  const done = await backfillLegacyDeliveries(prisma, {
    stagedMessage: message,
    recipients,
    priorFailures: [{ characterId: bram.id, name: "Bram", error: "DMs closed", status: 50007 }],
  });
  assert.equal(done, true);

  const rows = await prisma.delivery.findMany({ where: { stagedMessageId: message.id } });
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((r) => r.state === "SENT").length, 2);
  assert.deepEqual(
    rows.filter((r) => r.state === "FAILED").map((r) => r.name),
    ["Bram"],
  );

  // Called twice, it does nothing the second time — the table is the truth the
  // moment there is one row in it.
  assert.equal(
    await backfillLegacyDeliveries(prisma, { stagedMessage: message, recipients, priorFailures: [] }),
    false,
  );

  const reached = [];
  withFakeDm(t, async (_p, discordUserId) => {
    reached.push(discordUserId);
    return { id: "sent" };
  });
  const { sent, failed } = await deliverPrivate(prisma, {
    stagedMessage: message,
    recipients,
    onlyFailed: true,
  });
  // EXACTLY the one. Ada and Cass already read this message.
  assert.deepEqual(reached, ["test-u2"]);
  assert.deepEqual(sent.map((r) => r.name), ["Bram"]);
  assert.equal(failed.length, 0);
});

// S2. A send that landed is never written down as a failure — a FAILED row is
// an invitation to send it again, and the player has already read it.
test("a stamp that throws leaves the row IN_FLIGHT, not FAILED", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const { deliverPrivate } = require("../lib/stagedDelivery");
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());

  const message = await scratchMessage(prisma, t);
  if (!message) return t.skip("no Turn in the local database — run npm run dev:seed");

  withFakeDm(t, async () => ({ id: "sent" }));

  // One throw, on the SENT stamp only. The FAILED stamp below it must never be
  // reached — that is the whole assertion.
  const realUpdate = prisma.delivery.update.bind(prisma.delivery);
  let thrown = false;
  prisma.delivery.update = async (args) => {
    if (!thrown && args?.data?.state === "SENT") {
      thrown = true;
      throw new Error("database hiccup on the stamp");
    }
    return realUpdate(args);
  };
  t.after(() => {
    prisma.delivery.update = realUpdate;
  });

  const { sent, failed } = await deliverPrivate(prisma, {
    stagedMessage: message,
    recipients: [{ characterId: null, name: "Ada", discordUserId: "test-u1" }],
  });
  // The DM went. It is reported as sent, because it was.
  assert.equal(sent.length, 1);
  assert.equal(failed.length, 0);

  const [row] = await prisma.delivery.findMany({ where: { stagedMessageId: message.id } });
  assert.equal(row.state, "IN_FLIGHT");
  // Still claimed, so nothing touches it until a human could have looked.
  assert.ok(row.claimedAt);
});

// S4. A bounce is retried by the next attempt, not recorded as done.
test("a bounced recipient is retried; the ones who got it are not", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const { deliverPrivate } = require("../lib/stagedDelivery");
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());

  const message = await scratchMessage(prisma, t);
  if (!message) return t.skip("no Turn in the local database — run npm run dev:seed");

  const recipients = [
    { characterId: null, name: "Ada", discordUserId: "test-u1" },
    { characterId: null, name: "Bram", discordUserId: "test-u2" },
  ];

  const firstRun = [];
  withFakeDm(t, async (_p, discordUserId) => {
    firstRun.push(discordUserId);
    if (discordUserId === "test-u2") {
      const err = new Error("Cannot send messages to this user");
      err.code = 50007;
      throw err;
    }
    return { id: "sent" };
  });
  const first = await deliverPrivate(prisma, { stagedMessage: message, recipients });
  assert.deepEqual(firstRun.sort(), ["test-u1", "test-u2"]);
  assert.equal(first.sent.length, 1);
  assert.equal(first.failed.length, 1);

  // The resume. Ada is SENT and is not walked again; Bram is FAILED and is.
  const secondRun = [];
  withFakeDm(t, async (_p, discordUserId) => {
    secondRun.push(discordUserId);
    return { id: "sent" };
  });
  const second = await deliverPrivate(prisma, { stagedMessage: message, recipients });
  assert.deepEqual(secondRun, ["test-u2"]);
  assert.deepEqual(second.sent.map((r) => r.name), ["Bram"]);

  const rows = await prisma.delivery.findMany({ where: { stagedMessageId: message.id } });
  assert.deepEqual(rows.map((r) => r.state).sort(), ["SENT", "SENT"]);
});

// S10. A caller who wrote its own chevron gets one, not two — with or without
// the space after it, which is the shape that slipped through.
test("the DM prefix is idempotent even without the space", () => {
  const { applyDmPrefix } = require("../lib/dmPolicy");
  assert.equal(applyDmPrefix("hi"), "» hi");
  assert.equal(applyDmPrefix("» hi"), "» hi");
  assert.equal(applyDmPrefix("»hi"), "»hi");
});

// ---------------------------------------------------------------------------
// The public fan-out. A declaration in a cave level has no #summary to land in,
// so it posts into every Location channel down there — which means a public
// message now has SEVERAL sends, and every one of them needs its own row for
// the same reason every DM does. See docs/systemdocs/ADJUDICATION.md §1a.
// ---------------------------------------------------------------------------

const CAVE_TARGETS = [
  { publicKey: "public:loc:L1", channelId: "chan-1", name: "Customs" },
  { publicKey: "public:loc:L2", channelId: "chan-2", name: "Depot" },
  { publicKey: "public:loc:L3", channelId: "chan-3", name: "Walkways" },
];

// P1. Every channel gets the post, and every channel gets a row.
test("a cave declaration posts once per Location", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const { deliverPublic } = require("../lib/stagedDelivery");
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());

  const message = await scratchMessage(prisma, t, { kind: "PUBLIC", content: "the rope is cut" });
  if (!message) return t.skip("no Turn in the local database — run npm run dev:seed");

  const posted = [];
  withFakePost(t, async (channelId, content) => posted.push({ channelId, content }));

  const result = await deliverPublic(prisma, {
    stagedMessage: message,
    targets: CAVE_TARGETS,
    zone: { kind: "CAVE_LEVEL" },
    // No zoneId: the Hall row is covered by its own test below, and this one
    // should not depend on an ArchiveEntry write.
    zoneId: null,
  });

  assert.deepEqual(posted.map((p) => p.channelId), ["chan-1", "chan-2", "chan-3"]);
  assert.deepEqual([...new Set(posted.map((p) => p.content))], ["the rope is cut"]);
  assert.equal(result.sent, 3);
  assert.equal(result.attempted, 3);
  assert.deepEqual(result.failed, []);

  const rows = await prisma.delivery.findMany({ where: { stagedMessageId: message.id } });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.state), ["SENT", "SENT", "SENT"]);
  // The Location's name, so the tray can say which room bounced.
  assert.deepEqual(rows.map((r) => r.name).sort(), ["Customs", "Depot", "Walkways"]);
});

// P2. The whole reason for one row per channel. A fan-out recorded as a single
// row would have to call this either SENT (two channels never got it) or FAILED
// (and re-post to the two that did).
test("a partial fan-out retries only the channel that bounced", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const { deliverPublic, failuresFor } = require("../lib/stagedDelivery");
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());

  const message = await scratchMessage(prisma, t, { kind: "PUBLIC", content: "declaration" });
  if (!message) return t.skip("no Turn in the local database — run npm run dev:seed");

  const firstRun = [];
  withFakePost(t, async (channelId) => {
    firstRun.push(channelId);
    if (channelId === "chan-2") {
      const err = new Error("Missing Access");
      err.status = 403;
      throw err;
    }
  });

  const first = await deliverPublic(prisma, {
    stagedMessage: message,
    targets: CAVE_TARGETS,
    zone: { kind: "CAVE_LEVEL" },
    zoneId: null,
  });
  assert.deepEqual(firstRun, ["chan-1", "chan-2", "chan-3"]);
  assert.equal(first.sent, 2);
  assert.equal(first.failed.length, 1);
  // Named, so "Depot: Missing Access" is what the GM reads.
  assert.equal(first.failed[0].name, "Depot");

  // Derived from the rows, which is what the tray and deliveryFailures read.
  const blob = await failuresFor(prisma, message.id);
  assert.deepEqual(blob.map((f) => f.name), ["Depot"]);

  // The retry. Only the bounce is walked — the two that landed are not posted
  // to a second time, which is the promise the whole table exists for.
  const secondRun = [];
  withFakePost(t, async (channelId) => secondRun.push(channelId));
  const second = await deliverPublic(prisma, {
    stagedMessage: message,
    targets: CAVE_TARGETS,
    zone: { kind: "CAVE_LEVEL" },
    zoneId: null,
  });
  assert.deepEqual(secondRun, ["chan-2"]);
  assert.equal(second.sent, 1);
  assert.equal(second.skipped, 2);

  const rows = await prisma.delivery.findMany({ where: { stagedMessageId: message.id } });
  assert.deepEqual(rows.map((r) => r.state), ["SENT", "SENT", "SENT"]);
  assert.deepEqual(await failuresFor(prisma, message.id), []);
});

// P3. One Hall row per MESSAGE, never one per channel. /play gives a cave
// character their zone's feed already, so a fan-out must not put seven copies
// of the same declaration in it.
test("a fan-out writes one /play row, not one per channel", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const { deliverPublic } = require("../lib/stagedDelivery");
  const { placeKeyForZone } = require("../lib/placeKey");
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());

  const zone = await prisma.zone.findFirst({ where: { kind: "CAVE_LEVEL" } });
  if (!zone) return t.skip("no cave zone in the local database — run npm run dev:seed");
  const message = await scratchMessage(prisma, t, { kind: "PUBLIC", content: "one hall row" });
  if (!message) return t.skip("no Turn in the local database — run npm run dev:seed");

  const placeKey = placeKeyForZone(zone.id);
  const before = await prisma.archiveEntry.count({ where: { placeKey, content: "one hall row" } });

  withFakePost(t, async () => {});
  await deliverPublic(prisma, {
    stagedMessage: message,
    targets: CAVE_TARGETS,
    zone,
    zoneId: zone.id,
  });

  const after = await prisma.archiveEntry.count({ where: { placeKey, content: "one hall row" } });
  assert.equal(after - before, 1, "three channels, one Hall row");

  t.after(async () => {
    await prisma.archiveEntry
      .deleteMany({ where: { placeKey, content: "one hall row" } })
      .catch(() => {});
  });
});

// P4. THE PRODUCTION-SAFETY TEST. A surface declaration already pushed carries
// one row keyed `staged:<id>:public`. The new target must claim that exact row,
// find it SENT, and post nothing — not write a second row and send again.
test("a surface zone's already-sent row is claimed, not duplicated", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const { deliverPublic, deliveryKeyFor } = require("../lib/stagedDelivery");
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());

  const message = await scratchMessage(prisma, t, { kind: "PUBLIC", content: "already out" });
  if (!message) return t.skip("no Turn in the local database — run npm run dev:seed");

  // Exactly what the old code left behind.
  await prisma.delivery.create({
    data: {
      stagedMessageId: message.id,
      dedupeKey: deliveryKeyFor(message.id, null),
      state: "SENT",
      sentAt: new Date(),
      attempts: 1,
    },
  });

  const posted = [];
  withFakePost(t, async (channelId) => posted.push(channelId));
  const result = await deliverPublic(prisma, {
    stagedMessage: message,
    targets: [{ publicKey: "public", channelId: "chan-summary", name: null }],
    zone: { kind: "SURFACE" },
    zoneId: null,
  });

  assert.deepEqual(posted, [], "a declaration already in the channel must not post again");
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 1);
  assert.equal(await prisma.delivery.count({ where: { stagedMessageId: message.id } }), 1);
});

// P5. Nowhere to post. The placeholder row is picked BY KEY, not by position —
// a fan-out leaves several rows and the oldest may be a SENT Location, which a
// caller that merely could not find a channel must never flip to FAILED.
test("no targets marks the placeholder, and never a delivered row", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const { deliverPublic, deliveryKeyFor } = require("../lib/stagedDelivery");
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());

  const message = await scratchMessage(prisma, t, { kind: "PUBLIC", content: "nowhere" });
  if (!message) return t.skip("no Turn in the local database — run npm run dev:seed");

  // A Location that already got the declaration, older than the placeholder.
  const sentRow = await prisma.delivery.create({
    data: {
      stagedMessageId: message.id,
      dedupeKey: deliveryKeyFor(message.id, { publicKey: "public:loc:L1" }),
      name: "Customs",
      state: "SENT",
      sentAt: new Date(),
      attempts: 1,
    },
  });

  const result = await deliverPublic(prisma, {
    stagedMessage: message,
    targets: [],
    zone: { kind: "CAVE_LEVEL" },
    zoneId: null,
  });

  assert.equal(result.sent, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].error, "no location channels in this cave");

  // The delivered row is untouched; the placeholder carries the failure.
  const rows = await prisma.delivery.findMany({ where: { stagedMessageId: message.id } });
  assert.equal(rows.find((r) => r.id === sentRow.id).state, "SENT");
  const placeholder = rows.find((r) => r.dedupeKey === deliveryKeyFor(message.id, null));
  assert.equal(placeholder.state, "FAILED");
});

// P6. The mirror. Once an unprovisioned cave gets its channels, the old
// "nowhere to post" row must go — nothing will ever send it, so left alone the
// tray reads "Sent · 1 failed" forever and Resend stays lit with nothing to do.
test("a stale nowhere-to-post row is pruned once there is somewhere", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const { deliverPublic, deliveryKeyFor } = require("../lib/stagedDelivery");
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());

  const message = await scratchMessage(prisma, t, { kind: "PUBLIC", content: "at last" });
  if (!message) return t.skip("no Turn in the local database — run npm run dev:seed");

  await prisma.delivery.create({
    data: {
      stagedMessageId: message.id,
      dedupeKey: deliveryKeyFor(message.id, null),
      state: "FAILED",
      lastError: { error: "no location channels in this cave", status: null },
      attempts: 1,
    },
  });

  withFakePost(t, async () => {});
  await deliverPublic(prisma, {
    stagedMessage: message,
    targets: CAVE_TARGETS,
    zone: { kind: "CAVE_LEVEL" },
    zoneId: null,
  });

  const rows = await prisma.delivery.findMany({ where: { stagedMessageId: message.id } });
  assert.equal(rows.length, 3, "the placeholder is gone, the three Locations remain");
  assert.equal(
    rows.some((r) => r.dedupeKey === deliveryKeyFor(message.id, null)),
    false,
  );
  assert.deepEqual(rows.map((r) => r.state), ["SENT", "SENT", "SENT"]);
});
