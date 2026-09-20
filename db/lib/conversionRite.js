// The Rite of Conversion's handshake (docs/systemdocs/THANATI.md). The rite no
// longer converts anybody outright: it puts the vision in front of them and
// they answer it. An Offer of kind CONVERSION, the same consent row Lesson,
// Bind, Confession, Escort, Kiss, Search and Collar all use, so the DM buttons,
// the web card and db/lib/dmAnswer.js's routing come for free.
//
// TWO THINGS MAKE THIS KIND ODD, and both are the point of the feature.
//
// 1. REFUSING COSTS SOMETHING. Every other offer declines for free. This one
//    floors the mood and hands over Depressed, which is what the Grimoire
//    promises the cult ("severely weakened and distraught, allowing you to
//    finish them off"). So a decline cannot go through the generic
//    declineOffer() in db/lib/lessons.js, which applies no effects at all —
//    dmAnswer.js routes CONVERSION to refuseConversion() below instead.
// 2. IT HAS A CLOCK. Three hours, on Offer.expiresAt, swept by
//    db/lib/riteSweep.js. Going to bed is not a way to dodge the question; it
//    is a way to answer no. The cult may simply chant it again, so an
//    unlucky AFK costs a turn of misery rather than the character.
//
// NOBODY IS EVER NAMED. Not in the vision, not in the room lines, not on the
// web card. A player who wakes up Thanati should not be handed the roster of
// who did it to them, and the DM Bascinet wrote names no one on purpose. Keep
// it that way — web/app/(app)/character/page.js drops the initiator's name
// before it reaches the client for exactly this reason.
//
// Takes `prisma` first and is deliberately NOT on the @lifeweb/db barrel —
// require it by path (db/lib/dm.js convention).
const { sendDm } = require("./dm");
const { offerButtonRow } = require("./offerRow");
const { DM_ACTION, dmAction } = require("./dmActions");
const { roomLine } = require("./placeLine");
const { aliasSubject } = require("./concealedIdentity");
const { grantTagSlugs, dropCharacterTag } = require("./tagWrites");
const { resolveSeatConflicts, describeSeatConflicts } = require("./seatConflicts");
const { fulfillObjectives } = require("./objectives");
const { logSystemTagChange, mapGrantedTags } = require("./tagAudit");
const { applyMood, setMood } = require("./mood");
const { THANATI_SLUG } = require("./thanati");
const { SFX } = require("./sfx");

// Three hours. Long enough that somebody at work still gets to answer, short
// enough that the cult is not left holding a rite overnight.
const CONVERSION_WINDOW_MS = 3 * 60 * 60 * 1000;

const PIOUS_SLUG = "pious";
const DEPRESSED_SLUG = "depressed";

// Where a refuser lands on the way back up, if the cult ever talks them round:
// the FLOOR of Pleased (db/lib/mood.js#MOOD_BANDS), not its middle. Accepting
// after a refusal is a rescue, not a reward.
const CONVERTED_MOOD = 28;

// Bascinet's words, verbatim.
const VISION_DM = [
  "You see a horrifying vision, but it brings you clarity: reality is doomed, a cruel and inhospitable place.",
  "Do you wish to accept the truth and become a follower of the dark god, unceasingly dedicating your life to bringing about a new world?",
].join(" ");
const ACCEPTED_DM =
  "This reality is cursed! You are now loyal to the Thanati and must follow the cult's orders. Read your Documents for more information.";
const REFUSED_DM = "The reality is too much! You are shocked and traumatized.";
const DISMISSED_DM =
  "You see a strange vision: reality is doomed. You quickly dismiss it, knowing it as nothing but a hallucination.";
const REFUSED_LINE = "The target shakes awake, a fearful look in their eyes. They denied the ritual.";

function log(what) {
  return (err) => console.error(`Conversion rite: ${what} failed:`, err?.message ?? err);
}

function heldSlugs(target) {
  if (target?.slugs instanceof Set) return target.slugs;
  return new Set((target?.tags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

/** Whether the vision simply bounces off this person. */
function dismisses(target) {
  return heldSlugs(target).has(PIOUS_SLUG);
}

// The room the rite fired in, so the later answer can speak into it. Parked on
// `outcome` rather than a new column: every kind but SEARCH leaves that JSON
// free until resolve time, and one nullable column for one kind's room id is a
// migration this does not need.
function roomFromOffer(offer) {
  const room = offer?.outcome?.room;
  return room?.id ? room : null;
}

// ---- The three roads out ---------------------------------------------------

/**
 * The Pious path. The vision arrives, means nothing, and leaves them surer of
 * themselves than before. No Offer row is ever written, so there is nothing to
 * answer and nothing to expire — the cult finds out it wasted the chant by
 * reading the room.
 */
async function dismissConversion(prisma, { target, room }) {
  if (target.discordUserId) {
    await sendDm(prisma, target.discordUserId, DISMISSED_DM, {
      source: "rite",
      sfx: SFX.CONVERT_ASK,
    }).catch(log(`dismissal DM to ${target.name}`));
  }
  await prisma
    .$transaction((tx) => applyMood(tx, target.id, { kind: "RITE_DISMISSED" }))
    .catch(log(`dismissal mood for ${target.name}`));
  await roomLine(prisma, room, `${aliasSubject(target)} refuses the ritual, a look of determination in their eyes!`).catch(
    log("dismissal room line"),
  );
  return { dismissed: target.name, characterId: target.id };
}

/**
 * Put the question. Returns `{ ok, offer }` or `{ ok: false, reason }`.
 * `participants` is the sweep's chanter list; the first of them is recorded as
 * the initiator because Offer.initiatorId is required, NOT because the rite is
 * theirs — every chanter paid for it equally, and no surface ever reads the
 * name back out.
 */
async function createConversionOffer(prisma, { target, room, participants = [], turn }) {
  // Offer.turnId is required and a rite fires off a minute cron, so it can land
  // between turns. Nothing to do then but let the cult chant again.
  if (!turn?.id) return { ok: false, reason: "no open turn" };
  if (!target.discordUserId) return { ok: false, reason: `${target.name} can't be reached.` };

  const initiatorId = participants[0]?.characterId ?? null;
  if (!initiatorId) return { ok: false, reason: "no chanters" };

  // One question at a time. A second rite while the first is unanswered would
  // put two visions in their DMs and, worse, let one Accept and one expiry both
  // land on the same person.
  const duplicate = await prisma.offer.findFirst({
    where: { kind: "CONVERSION", status: "PENDING", responderId: target.id },
    select: { id: true },
  });
  if (duplicate) return { ok: false, reason: "They're already being asked." };

  const offer = await prisma.offer.create({
    data: {
      kind: "CONVERSION",
      turnId: turn.id,
      initiatorId,
      responderId: target.id,
      expiresAt: new Date(Date.now() + CONVERSION_WINDOW_MS),
      outcome: { room: { id: room.id, name: room.name ?? null, discordThreadId: room.discordThreadId ?? null } },
    },
  });

  await sendDm(prisma, target.discordUserId, VISION_DM, {
    source: "rite",
    sfx: SFX.CONVERT_ASK,
    components: offerButtonRow(offer.id),
    meta: dmAction(DM_ACTION.OFFER, offer.id),
  }).catch(log(`vision DM to ${target.name}`));

  return { ok: true, offer };
}

/**
 * Yes. The old rite's whole body, now on the far side of a question — plus the
 * two lines that undo a previous refusal, so a cult that comes back for a
 * second try is rescuing somebody rather than leaving them wrecked AND
 * converted.
 *
 * Shaped like db/lib/kiss.js#acceptKiss: returns `{ ok, line, dms }`, which is
 * what db/lib/dmAnswer.js#answerOffer hands back to both faces.
 */
async function acceptConversion(prisma, offer, responder) {
  const target = await prisma.character.findUnique({
    where: { id: offer.responderId },
    select: {
      id: true,
      name: true,
      status: true,
      // age/gender are what aliasSubject() builds the room line out of -- the
      // room hears "A young woman's eyes widen", never a name. Selecting only
      // `name` here would have produced the alias for a person with no age and
      // no gender, which is a quietly wrong sentence rather than an error.
      age: true,
      gender: true,
      discordUserId: true,
      tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { id: true, slug: true, name: true } } } },
    },
  });
  // Three hours is long enough to die in, so the gate is re-run here and not
  // just at the chant.
  if (!target || target.status !== "ALIVE") {
    await prisma.offer.updateMany({
      where: { id: offer.id, status: "PENDING" },
      data: { status: "CANCELLED", respondedAt: new Date() },
    });
    return { ok: false, reason: "That offer's gone.", dms: [] };
  }

  const claim = await prisma.offer.updateMany({
    where: { id: offer.id, status: "PENDING" },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, reason: "That offer's gone.", dms: [] };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const thanati = await prisma.tag.findUnique({ where: { slug: THANATI_SLUG }, select: { id: true } });
  const depressed = target.tags.find((ct) => ct.tag.slug === DEPRESSED_SLUG)?.tag ?? null;

  let conflicts = null;
  await prisma.$transaction(async (tx) => {
    const granted = await grantTagSlugs(tx, target.id, [THANATI_SLUG], openTurn?.number ?? null);
    // An Assign by another road, so it gets the same clear-out (THREATS.md §3)
    // — and must TELL them, which describeSeatConflicts below does.
    if (thanati) conflicts = await resolveSeatConflicts(tx, target.id, [thanati.id]);
    await fulfillObjectives(tx, {
      partyKey: "thanati",
      kinds: ["convert-character", "convert-leader"],
      targetCharacterId: target.id,
    });
    // Undoing a previous refusal, in this order: the tag first, then the dial,
    // so the mood DM a player reads is about the sheet they now have.
    if (depressed) await dropCharacterTag(tx, target.id, depressed.id, 1);
    await setMood(tx, target.id, CONVERTED_MOOD);
    await logSystemTagChange(tx, {
      system: "rite",
      targetCharacterId: target.id,
      applied: mapGrantedTags(granted),
      extra: { rite: "conversion", accepted: true, liftedDepression: Boolean(depressed) },
    });
  });

  await sendDm(
    prisma,
    target.discordUserId,
    [ACCEPTED_DM, conflicts && describeSeatConflicts(conflicts)].filter(Boolean).join("\n"),
    { source: "rite" },
  ).catch(log(`acceptance DM to ${target.name}`));

  // Bascinet's call: the sound of somebody finding out what they have joined.
  const room = roomFromOffer(offer);
  if (room) {
    await roomLine(prisma, room, `${aliasSubject(target)}'s eyes widen as they begin to understand…`, {
      sfx: SFX.INITIATE,
    }).catch(log("acceptance room line"));
  }

  await prisma.offer.update({
    where: { id: offer.id },
    data: { status: "RESOLVED", resolvedAt: new Date(), outcome: { ...(offer.outcome ?? {}), converted: true } },
  });

  return { ok: true, line: "You accept the truth.", dms: [] };
}

/**
 * No — and the only decline in the game that costs the person declining.
 *
 * ONE function for all three roads to no: the Refuse button
 * (db/lib/dmAnswer.js), the three-hour sweep (db/lib/riteSweep.js) and the
 * turn-close pass (db/lib/offerExpiryPass.js). They must not disagree about
 * what refusing costs, and the guarded `updateMany` below is what stops two of
 * them charging it twice if they ever race.
 */
async function refuseConversion(prisma, offer, { responder = null } = {}) {
  const claim = await prisma.offer.updateMany({
    where: { id: offer.id, status: "PENDING" },
    data: { status: "DECLINED", respondedAt: new Date(), resolvedAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, reason: "That offer's gone.", dms: [] };

  const target =
    responder?.id === offer.responderId
      ? responder
      : await prisma.character.findUnique({
          where: { id: offer.responderId },
          select: { id: true, name: true, status: true, discordUserId: true },
        });

  // A dead refuser is still a refusal — the row closes — but there is nobody
  // left to make miserable and nothing for the room to watch wake up.
  if (target && target.status === "ALIVE") {
    await prisma
      .$transaction(async (tx) => {
        await applyMood(tx, target.id, { kind: "RITE_REFUSED" });
        await grantTagSlugs(tx, target.id, [DEPRESSED_SLUG], null);
      })
      .catch(log(`refusal effects for ${target.name}`));

    if (target.discordUserId) {
      await sendDm(prisma, target.discordUserId, REFUSED_DM, { source: "rite" }).catch(
        log(`refusal DM to ${target.name}`),
      );
    }

    const room = roomFromOffer(offer);
    if (room) {
      await roomLine(prisma, room, REFUSED_LINE, { sfx: SFX.CONVERT_ASK }).catch(log("refusal room line"));
    }
  }

  return { ok: true, line: "You refuse.", dms: [] };
}

/**
 * Every PENDING conversion whose three hours are up, refused. Called by the
 * minute sweep in db/lib/riteSweep.js. Returns how many it closed.
 */
async function expireConversionOffers(prisma, now = new Date()) {
  const due = await prisma.offer.findMany({
    where: { kind: "CONVERSION", status: "PENDING", expiresAt: { lte: now } },
    select: { id: true, responderId: true, outcome: true },
  });
  let refused = 0;
  for (const offer of due) {
    const out = await refuseConversion(prisma, offer).catch((err) => {
      console.error(`Conversion offer ${offer.id} failed to expire:`, err?.message ?? err);
      return { ok: false };
    });
    if (out.ok) refused += 1;
  }
  return refused;
}

module.exports = {
  CONVERSION_WINDOW_MS,
  CONVERTED_MOOD,
  VISION_DM,
  ACCEPTED_DM,
  REFUSED_DM,
  DISMISSED_DM,
  REFUSED_LINE,
  dismisses,
  dismissConversion,
  createConversionOffer,
  acceptConversion,
  refuseConversion,
  expireConversionOffers,
};
