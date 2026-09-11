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
// The MODULE, not a destructured `sendDm`: db/test/stagedDelivery.test.js
// swaps the transport out to assert what actually reached Discord, and a
// destructured binding captured at load time would ignore the swap.
const dm = require("./dm");
const { DM_KIND } = require("./dmKinds");
const { dedupeKey, describeFailure } = require("./dmPolicy");
// The MODULE, for the reason the `dm` require above gives. This was a
// destructured `postMessageBatched` for a long time, which is why the public
// half of this file had no tests: the swap the DM tests do through the require
// cache could not reach a binding captured at load time.
const discordRest = require("./discordRest");
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

// A PRIVATE message's key names the RECIPIENT — the character, not their
// Discord account. A staged message is addressed to characters, and a character
// who has never linked Discord has a null id, so keying on that id gave every
// such recipient the same tail; `createMany({ skipDuplicates: true })` then
// wrote one row for the lot of them and the rest were never delivered and never
// even listed as failing. It also collided with the PUBLIC key, which is why
// that one is now the literal word "public" rather than a shared empty tail.
//
// A PUBLIC message may now have SEVERAL rows — one per channel it posts into,
// which underground is one per Location (db/lib/publicPostTargets.js). Those
// carry their own `publicKey`, and the summary target's is the bare word
// "public", so a surface zone's key comes out byte-identical to the one this
// produced when a public row was always a single null recipient. That equality
// is load-bearing: production is full of `staged:<id>:public` rows, and a
// changed tail would write a second row on every already-pushed declaration
// and invite Resend to post it again. db/test/stagedDelivery.test.js asserts
// it so nobody tidies the tail into something prettier.
function deliveryKeyFor(stagedMessageId, recipient = null) {
  const recipientKey = recipient
    ? (recipient.publicKey ?? recipient.characterId ?? recipient.discordUserId ?? null)
    : "public";
  return dedupeKey({ scope: "staged", subjectId: stagedMessageId, recipientKey });
}

// Is this row something an attempt may take? PENDING and FAILED plainly are.
// So is an IN_FLIGHT row whose claim has gone stale — a process killed mid-send
// leaves one behind, and without this it would sit there looking busy forever
// and the Resend button would tell the GM nothing had failed.
function isRetryable(delivery, now = Date.now()) {
  if (delivery.state === "PENDING" || delivery.state === "FAILED") return true;
  if (delivery.state !== "IN_FLIGHT") return false;
  return !delivery.claimedAt || delivery.claimedAt.getTime() < now - STALE_CLAIM_MS;
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
    dedupeKey: deliveryKeyFor(stagedMessage.id, r ?? null),
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
    (recipients ?? []).map((r) => [deliveryKeyFor(stagedMessage.id, r), r]),
  );

  const sent = [];
  const failed = [];
  const skipped = [];

  for (const delivery of deliveries) {
    if (delivery.state === "SENT") continue;
    // Resend wants the bounces — and the rows a killed push stranded IN_FLIGHT,
    // which are bounces that never got to say so. Not the ones a push running
    // right now is holding: those are still someone else's, and the claim below
    // refuses them anyway.
    if (onlyFailed && !(delivery.state === "FAILED" || (delivery.state === "IN_FLIGHT" && isRetryable(delivery))))
      continue;
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

    let message;
    try {
      message = await dm.sendDm(prisma, recipient.discordUserId, stagedMessage.content, {
        authorDiscordUserId: stagedMessage.createdByDiscordUserId ?? null,
        source: "staged_push",
        // A turn result is GM-authored prose, just delivered in bulk.
        kind: DM_KIND.CONVERSATION,
      });
    } catch (err) {
      const failure = describeFailure(err);
      await prisma.delivery
        .update({
          where: { id: delivery.id },
          data: { state: "FAILED", claimedAt: null, lastError: failure },
        })
        .catch((markErr) => console.error(`Failed to mark delivery ${delivery.id}:`, markErr));
      failed.push({ characterId: recipient.characterId, name: recipient.name, ...failure });
      continue;
    }

    // THE SEND HAPPENED. Stamping it is a separate try on purpose: this used to
    // sit inside the one above, so a database hiccup on the stamp marked the row
    // FAILED for a DM the player had already read, and the next attempt sent it
    // again. A stamp that fails leaves the row IN_FLIGHT — claimed, so nothing
    // touches it until the stale window expires, by which time a human can look.
    try {
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
    } catch (markErr) {
      console.error(
        `DELIVERY SENT BUT NOT STAMPED — delivery ${delivery.id} (staged message ${stagedMessage.id}) reached ${recipient.name ?? recipient.discordUserId} and the row is still IN_FLIGHT:`,
        markErr,
      );
    }
    sent.push({ characterId: recipient.characterId, name: recipient.name });
  }

  return { sent, failed, skipped };
}

// The PUBLIC half: a post into every channel the declaration reaches, plus the
// Hall's own row.
//
// It used to be exactly one channel — the zone's #summary — because for a
// SURFACE zone that is still the whole answer. Underground there is no
// #summary at all, so a cave declaration posts into every Location channel in
// the level instead (db/lib/publicPostTargets.js). `targets` is that list, and
// a SURFACE zone simply hands over a list of one.
//
// ONE DELIVERY ROW PER CHANNEL, which is what §1a asks for in the first place
// ("every send a staged message makes has its own row"). A fan-out recorded as
// a single row would have to choose between marking itself SENT with two of
// seven channels delivered, or FAILED and re-posting to the five that already
// have it. That is exactly the bug the table was built to kill, and seven
// channels is seven chances to hit it.
//
// `writeSceneLine` is the resend's one real decision. A resend after a post
// that SUCCEEDED must not write a second /play row — the first one stands —
// but a resend after one that FAILED must write the row, because there is
// none. So the caller passes `!priorPostSucceeded`, which for the push is
// always true and for Resend is read off the Delivery rows' states.
async function deliverPublic(
  prisma,
  { stagedMessage, targets = [], zone = null, zoneId, writeSceneLine = true },
) {
  const rows = await ensureDeliveries(prisma, { stagedMessage, recipients: targets });
  const placeholderKey = deliveryKeyFor(stagedMessage.id, null);

  // Nowhere to post. For a surface zone that is an unprovisioned #summary — a
  // real fault, and the sentence is unchanged so an old lastError blob and a
  // new one read the same. For a cave level it means the Locations have no
  // channels yet, which is a different fault and says so.
  if (!targets.length) {
    const failure = {
      error:
        zone?.kind === "CAVE_LEVEL"
          ? "no location channels in this cave"
          : "no summary channel configured",
      status: null,
    };
    // Guarded, not a blind update: a row that is already SENT, or IN_FLIGHT
    // under somebody else's claim, must not be flipped to FAILED by a caller
    // that merely could not find a channel. Doing so told the tray a post that
    // had gone out had bounced, and invited a GM to send it twice.
    //
    // BY KEY, not by position. This used to take rows[0], which was safe while
    // a public message had exactly one row and is not any more: a cave message
    // that fanned out and later lost its channels has N rows, and the oldest of
    // them may well be a SENT Location. The placeholder is the only row this
    // branch owns.
    const marked = await prisma.delivery.updateMany({
      where: {
        stagedMessageId: stagedMessage.id,
        dedupeKey: placeholderKey,
        state: { notIn: ["SENT", "IN_FLIGHT"] },
      },
      data: { state: "FAILED", claimedAt: null, lastError: failure },
    });
    if (!marked.count) return { sent: 0, failed: [], skipped: 1, attempted: 0 };
    return { sent: 0, failed: [failure], skipped: 0, attempted: 0 };
  }

  // The "nowhere to post" row a previous attempt left behind, now that there IS
  // somewhere. Without this it stays FAILED forever: nothing will ever send it,
  // so the tray reads "Sent · 1 failed" for good and the Resend button stays lit
  // with nothing left to retry.
  //
  // Never a surface zone's real row — for a surface zone the summary target's
  // own key IS the placeholder key, so the guard below excludes it. SENT and
  // IN_FLIGHT are never touched either way: the rows are the record.
  const targetKeys = new Set(targets.map((t) => deliveryKeyFor(stagedMessage.id, t)));
  if (!targetKeys.has(placeholderKey)) {
    await prisma.delivery
      .deleteMany({
        where: {
          stagedMessageId: stagedMessage.id,
          dedupeKey: placeholderKey,
          state: { notIn: ["SENT", "IN_FLIGHT"] },
        },
      })
      .catch((err) =>
        console.error(`Pruning the placeholder delivery for ${stagedMessage.id} failed:`, err),
      );
  }

  const byKey = new Map(rows.map((row) => [row.dedupeKey, row]));
  let sent = 0;
  let skipped = 0;
  const failed = [];

  // Sequential, one channel at a time, never Promise.all. A burst of parallel
  // posts is how an integration earns a 429 and then an IP ban — the same
  // discipline db/lib/worldBroadcast.js keeps, and for the same reason.
  for (const target of targets) {
    const delivery = byKey.get(deliveryKeyFor(stagedMessage.id, target));
    // A row that could not be written. Nothing to claim, so nothing to send:
    // counted as held rather than sent or bounced, so the caller's numbers add up.
    if (!delivery) {
      skipped += 1;
      continue;
    }
    if (delivery.state === "SENT") {
      skipped += 1;
      continue;
    }
    // Somebody else holds it — a concurrent push, or a GM's Resend.
    if (!(await claimDelivery(prisma, delivery))) {
      skipped += 1;
      continue;
    }

    try {
      // Batched: a declaration over 2000 characters posts as several messages in
      // order rather than being rejected. See ADJUDICATION.md §1.
      await discordRest.postMessageBatched(target.channelId, stagedMessage.content);
    } catch (err) {
      const failure = describeFailure(err);
      await prisma.delivery
        .update({
          where: { id: delivery.id },
          data: { state: "FAILED", claimedAt: null, lastError: failure },
        })
        .catch((markErr) => console.error(`Failed to mark delivery ${delivery.id}:`, markErr));
      failed.push({ name: target.name ?? null, ...failure });
      continue;
    }

    // THE POST HAPPENED. Everything below is bookkeeping, and none of it may turn
    // a delivered post back into a failure — a FAILED row here is an invitation to
    // post the declaration a second time. The stamp gets its own try and its own
    // loud log instead, per channel: a fan-out has one of these pairs each.
    try {
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: { state: "SENT", sentAt: new Date(), claimedAt: null, lastError: null },
      });
    } catch (markErr) {
      console.error(
        `POST SENT BUT NOT STAMPED — delivery ${delivery.id} (staged message ${stagedMessage.id}) reached ${target.name ?? "the summary channel"} and the row is still IN_FLIGHT:`,
        markErr,
      );
    }
    sent += 1;
  }

  // ONE row per message, never one per channel. The Hall row is the ZONE's —
  // /play gives a cave character their zone's feed already
  // (db/lib/feedAccess.js), so seven copies of the same declaration is exactly
  // what a fan-out must not become.
  //
  // Gated on `sent` so the old semantics survive intact: a declaration that
  // reached nobody writes no row, and the later Resend writes it because
  // `posted` is still false. Any SENT row implies a run where `sent` was above
  // zero, which implies this was attempted — which is what makes the caller's
  // `writeSceneLine: !posted` still correct now that a run can land partly.
  if (writeSceneLine && zoneId && sent > 0) {
    // The declaration is GM-authored and already signed, so it is not signed
    // again. Its failure costs the web feed one row; it does not cost Discord
    // a second post.
    await sceneLineAt(prisma, { zoneId, text: stagedMessage.content, signed: false }).catch((err) =>
      console.error(`Hall row for staged message ${stagedMessage.id} failed:`, err),
    );
  }

  return { sent, failed, skipped, attempted: targets.length };
}

// The rows a message pushed BEFORE this table existed never got.
//
// Production carries StagedMessage rows with a sentAt and no Delivery rows at
// all. Left alone, the shared path writes them fresh as PENDING on first
// touch — and PENDING reads as "never attempted", so a GM pressing Resend on a
// message where one recipient bounced would re-DM every recipient who had
// already read it, and re-post a declaration that was already in the channel.
//
// So a legacy row is reconstructed from what the old code DID write down: the
// sentAt stamp says every recipient was attempted, and the deliveryFailures
// blob names the ones that bounced. Everybody else was delivered. Only ever
// called when the message has no rows whatsoever — the moment there is one,
// the table is the truth and this never runs again.
async function backfillLegacyDeliveries(prisma, { stagedMessage, recipients, priorFailures = [] }) {
  if (!stagedMessage?.sentAt) return false;
  const existing = await prisma.delivery.count({ where: { stagedMessageId: stagedMessage.id } });
  if (existing) return false;

  const failures = Array.isArray(priorFailures) ? priorFailures : [];
  const isPublic = stagedMessage.kind === "PUBLIC";
  // A PUBLIC message has one row and no recipients: it failed if the blob says
  // anything at all, and succeeded otherwise.
  //
  // Still `[null]` even though a public message can now fan out to several
  // channels, and deliberately so. This only ever runs on a message with a
  // sentAt and no rows — a message pushed before the Delivery table existed,
  // every one of which posted to a #summary, because a cave declaration has
  // never successfully posted anything. So the one legacy-keyed row it
  // reconstructs is the right row, and it is the one a surface target claims.
  const list = isPublic ? [null] : (recipients ?? []);

  const rows = list.map((r) => {
    const failure = isPublic
      ? (failures[0] ?? null)
      : (failures.find(
          (f) =>
            (f?.characterId && r?.characterId && f.characterId === r.characterId) ||
            (!f?.characterId && f?.name && r?.name && f.name === r.name),
        ) ?? null);
    return {
      stagedMessageId: stagedMessage.id,
      characterId: r?.characterId ?? null,
      discordUserId: r?.discordUserId ?? null,
      name: r?.name ?? null,
      dedupeKey: deliveryKeyFor(stagedMessage.id, r ?? null),
      state: failure ? "FAILED" : "SENT",
      sentAt: failure ? null : stagedMessage.sentAt,
      attempts: 1,
      lastError: failure ? { error: failure.error ?? "unknown error", status: failure.status ?? null } : undefined,
    };
  });
  if (!rows.length) return false;
  await prisma.delivery.createMany({ data: rows, skipDuplicates: true });
  return true;
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
  backfillLegacyDeliveries,
  claimDelivery,
  isRetryable,
  deliveryKeyFor,
  failuresFor,
  STALE_CLAIM_MS,
};
