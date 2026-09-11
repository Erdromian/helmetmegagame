// The one code path that delivers a staged message — used by the turn-end
// push (db/lib/turnSideEffects.js) and by the Resend button on /gm/turns
// (web/app/(desk)/gm/turns/actions.js).
//
// It used to be two. The push DM'd every recipient and swallowed each failure
// inside its own step key, so a resume never retried a bounce; Resend read the
// deliveryFailures JSON blob, re-derived who to retry, and sent through a
// different transport — and forgot the Hall row a public post writes, so a
// resent declaration reached Discord and never reached /play. Two copies of a
// send is two chances to disagree about what already went out.
//
// So: one Delivery row per send (schema.prisma model Delivery), claimed before
// the send and stamped after it. The caller stamps the parent StagedMessage,
// because the push and the resend want to say slightly different things about
// a message as a whole, and neither wants the other's.
//
// Required BY PATH, not off the @lifeweb/db barrel — the db/lib/dm.js
// convention, and for the same reason: it takes `prisma` as a parameter
// because db/index.js imports the module that imports this one.
const { sendDm } = require("./dm");
const { DM_KIND } = require("./dmKinds");
const { dedupeKey, describeFailure } = require("./dmPolicy");
const { postMessageBatched } = require("./discordRest");
const { sceneLineAt } = require("./scene");

// How long a claim is honoured before another run may take the row back. A
// process killed mid-send leaves IN_FLIGHT behind and nothing else will ever
// clear it, so the claim has to expire, and the window is the whole trade: too
// short and a slow Discord call gets its DM sent twice underneath it, too long
// and a player waits that long for a message the crash stranded.
//
// FIVE MINUTES, not the thirty Turn.sideEffectClaimedAt uses. That window
// covers a whole side-effect thunk — a hundred DMs, every zone's banner, the
// message wipe — and half an hour is the right size for it. This one covers
// ONE DM: a single POST with a REST timeout measured in seconds. Anything
// still in flight five minutes later is a process that is not coming back.
const STALE_CLAIM_MS = 5 * 60 * 1000;

// A PRIVATE message's key names the recipient; a PUBLIC one has no recipient
// and its "none" tail is what keeps it one row rather than zero.
function deliveryKeyFor(stagedMessageId, discordUserId) {
  return dedupeKey({ scope: "staged", subjectId: stagedMessageId, discordUserId });
}

// Every row a staged message needs, written once. skipDuplicates on the unique
// dedupeKey is what makes this safe to call again on a resumed push: the rows
// that exist are left exactly as they are, mid-flight state and all.
async function ensureDeliveries(prisma, { stagedMessage, recipients }) {
  const rows = (recipients?.length ? recipients : [null]).map((r) => ({
    stagedMessageId: stagedMessage.id,
    characterId: r?.characterId ?? null,
    discordUserId: r?.discordUserId ?? null,
    name: r?.name ?? null,
    dedupeKey: deliveryKeyFor(stagedMessage.id, r?.discordUserId ?? null),
  }));
  await prisma.delivery.createMany({ data: rows, skipDuplicates: true });
  return prisma.delivery.findMany({
    where: { stagedMessageId: stagedMessage.id },
    orderBy: { createdAt: "asc" },
  });
}

// Take the row, or find out somebody else already has it.
//
// The whole guarantee lives in this updateMany's WHERE: a row that is SENT, or
// IN_FLIGHT and claimed recently, matches nothing and the count comes back 0.
// That is what stops a push resumed in a second process, or a GM's Resend
// pressed during a push, sending the same DM twice.
async function claimDelivery(prisma, delivery) {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
  const claimed = await prisma.delivery.updateMany({
    where: {
      id: delivery.id,
      OR: [
        { state: "PENDING" },
        { state: "FAILED" },
        { state: "IN_FLIGHT", claimedAt: { lt: staleBefore } },
        { state: "IN_FLIGHT", claimedAt: null },
      ],
    },
    data: { state: "IN_FLIGHT", claimedAt: new Date(), attempts: { increment: 1 } },
  });
  return claimed.count === 1;
}

// Deliver one staged PRIVATE message to whichever of its recipients has not
// had it yet. Returns what happened; the CALLER stamps StagedMessage.
//
// `onlyFailed` is the Resend button: the push wants everything not yet SENT,
// a GM pressing Resend wants exactly the ones that bounced and nothing that is
// merely still pending from a push running right now.
async function deliverPrivate(prisma, { stagedMessage, recipients, onlyFailed = false }) {
  const deliveries = await ensureDeliveries(prisma, { stagedMessage, recipients });
  const byKey = new Map(
    (recipients ?? []).map((r) => [deliveryKeyFor(stagedMessage.id, r.discordUserId), r]),
  );

  const sent = [];
  const failed = [];
  const skipped = [];

  for (const delivery of deliveries) {
    if (delivery.state === "SENT") continue;
    if (onlyFailed && delivery.state !== "FAILED") continue;
    const recipient = byKey.get(delivery.dedupeKey) ?? {
      characterId: delivery.characterId,
      name: delivery.name,
      discordUserId: delivery.discordUserId,
    };
    // Somebody else holds it — a concurrent push, or a second Resend. Not a
    // failure and not a send: reported so the caller's count is honest.
    if (!(await claimDelivery(prisma, delivery))) {
      skipped.push({ characterId: recipient.characterId, name: recipient.name });
      continue;
    }

    try {
      const message = await sendDm(prisma, recipient.discordUserId, stagedMessage.content, {
        authorDiscordUserId: stagedMessage.createdByDiscordUserId ?? null,
        source: "staged_push",
        // A turn result is GM-authored prose, just delivered in bulk.
        kind: DM_KIND.CONVERSATION,
      });
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          state: "SENT",
          sentAt: new Date(),
          claimedAt: null,
          lastError: null,
          discordMessageId: message?.id ?? null,
        },
      });
      sent.push({ characterId: recipient.characterId, name: recipient.name });
    } catch (err) {
      const failure = describeFailure(err);
      await prisma.delivery
        .update({
          where: { id: delivery.id },
          data: { state: "FAILED", claimedAt: null, lastError: failure },
        })
        .catch((markErr) => console.error(`Failed to mark delivery ${delivery.id}:`, markErr));
      failed.push({ characterId: recipient.characterId, name: recipient.name, ...failure });
    }
  }

  return { sent, failed, skipped };
}

// The PUBLIC half: one post into the zone's #summary, plus the Hall's own row.
//
// `writeSceneLine` is the resend's one real decision. A resend after a post
// that SUCCEEDED must not write a second /play row — the first one stands —
// but a resend after one that FAILED must write the row, because there is
// none. So the caller passes `!priorPostSucceeded`, which for the push is
// always true and for Resend is read off the Delivery row's state.
async function deliverPublic(prisma, { stagedMessage, channelId, zoneId, writeSceneLine = true }) {
  const [delivery] = await ensureDeliveries(prisma, { stagedMessage, recipients: [] });

  if (!channelId) {
    const failure = { error: "no summary channel configured", status: null };
    await prisma.delivery.update({
      where: { id: delivery.id },
      data: { state: "FAILED", claimedAt: null, lastError: failure },
    });
    return { sent: 0, failed: [failure], skipped: false };
  }
  if (delivery.state === "SENT") return { sent: 0, failed: [], skipped: true };
  if (!(await claimDelivery(prisma, delivery))) return { sent: 0, failed: [], skipped: true };

  try {
    // Batched: a declaration over 2000 characters posts as several messages in
    // order rather than being rejected. See ADJUDICATION.md §1.
    await postMessageBatched(channelId, stagedMessage.content);
    if (writeSceneLine && zoneId) {
      // The Hall's half: one SYSTEM row in the zone's feed, beside the post.
      // The declaration is GM-authored and already signed, so it is not signed
      // again. The push always wrote this and Resend never did, which is how a
      // resent declaration used to reach Discord and never reach /play.
      await sceneLineAt(prisma, { zoneId, text: stagedMessage.content, signed: false });
    }
    await prisma.delivery.update({
      where: { id: delivery.id },
      data: { state: "SENT", sentAt: new Date(), claimedAt: null, lastError: null },
    });
    return { sent: 1, failed: [], skipped: false };
  } catch (err) {
    const failure = describeFailure(err);
    await prisma.delivery
      .update({
        where: { id: delivery.id },
        data: { state: "FAILED", claimedAt: null, lastError: failure },
      })
      .catch((markErr) => console.error(`Failed to mark delivery ${delivery.id}:`, markErr));
    return { sent: 0, failed: [failure], skipped: false };
  }
}

// What StagedMessage.deliveryFailures should say, given the rows. Derived
// rather than accumulated, so the blob and the rows cannot drift: a recipient
// whose retry finally lands leaves the list on the next stamp.
async function failuresFor(prisma, stagedMessageId) {
  const rows = await prisma.delivery.findMany({
    where: { stagedMessageId, state: "FAILED" },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    characterId: r.characterId,
    name: r.name,
    ...(r.lastError ?? { error: "unknown error" }),
  }));
}

module.exports = {
  deliverPrivate,
  deliverPublic,
  ensureDeliveries,
  claimDelivery,
  deliveryKeyFor,
  failuresFor,
  STALE_CLAIM_MS,
};
