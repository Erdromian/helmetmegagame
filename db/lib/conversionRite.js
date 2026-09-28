// The Rite of Conversion's handshake (docs/systemdocs/THANATI.md). The rite no
// longer converts anybody outright: it puts the vision in front of them and
// they answer it. An Offer of kind CONVERSION, the same consent row Lesson,
// Bind, Confession, Escort, Kiss, Search and Collar all use, so the DM buttons,
// the web card and db/lib/dmAnswer.js's routing come for free.
//
// TWO THINGS MAKE THIS KIND ODD, and both are the point of the feature.
//
// 1. THE CULTIST CHOOSES, and the rite waits while they do. Every other rite
//    resolves its target itself. This one fires into RiteAttempt.AWAITING with
//    the eligible non-cultists snapshotted on the row, DMs the circle a picker,
//    and only writes the Offer once one of them answers
//    (db/lib/riteEffects.js#conversion, #answerConversionPick).
// 2. IT HAS A CLOCK. Three hours, on Offer.expiresAt, swept by
//    db/lib/riteSweep.js. Silence still resolves as a decline rather than
//    hanging, so there is one road out of a pending question and not two — it
//    simply costs nothing now, the way every other decline in the game does.
//
// REFUSING USED TO COST SOMETHING: -140 mood and the Depressed tag, which is
// what the old Grimoire meant by "severely weakened and distraught, allowing
// you to finish them off". That is gone. Conversion cannot be put to somebody
// who is bound or otherwise unable to act, so it is an invitation now, and an
// invitation that punishes "no" is not one. Do not reintroduce a price here
// without changing the rite's description in db/lib/rites.js to match.
//
// NOBODY IS EVER NAMED. Not in the vision, not in the room lines, not on the
// web card. A player who wakes up Thanati should not be handed the roster of
// who did it to them, and the DM Bascinet wrote names no one on purpose. Keep
// it that way — web/app/(app)/character/page.js drops the initiator's name
// before it reaches the client for exactly this reason.
//
// Takes `prisma` first and is deliberately NOT on the @lifeweb/db barrel —
// require it by path (db/lib/dm.js convention).
const crypto = require("node:crypto");
const { sendDm } = require("./dm");
const { offerButtonRow } = require("./offerRow");
const { DM_ACTION, dmAction } = require("./dmActions");
const { roomLine } = require("./placeLine");
const { aliasSubject } = require("./concealedIdentity");
const { grantTagSlugs } = require("./tagWrites");
const { resolveSeatConflicts, describeSeatConflicts } = require("./seatConflicts");
const { fulfillObjectives } = require("./objectives");
const { logSystemTagChange, mapGrantedTags } = require("./tagAudit");
const { applyMood } = require("./mood");
const { THANATI_SLUG } = require("./thanati");
const { convertCandidates } = require("./riteIngredients");
const { IDENTITY_SELECT, seenBy } = require("./intercept");
const { SFX } = require("./sfx");

// Three hours. Long enough that somebody at work still gets to answer, short
// enough that the cult is not left holding a rite overnight.
const CONVERSION_WINDOW_MS = 3 * 60 * 60 * 1000;

const PIOUS_SLUG = "pious";

// Bascinet's words, verbatim.
const VISION_DM = [
  "You see a horrifying vision, but it brings you clarity: reality is doomed, a cruel and inhospitable place.",
  "Do you wish to accept the truth and become a follower of the dark god, unceasingly dedicating your life to bringing about a new world?",
].join(" ");
const ACCEPTED_DM =
  "This reality is cursed! You are now loyal to the Thanati and must follow the cult's orders. Read your Documents for more information.";
const REFUSED_DM = "You cannot bring yourself to assent to such a reality!";
const DISMISSED_DM =
  "You see a strange vision: reality is doomed. You quickly dismiss it, knowing it as nothing but a hallucination.";
const REFUSED_LINE = "The target rises, resolute in their convictions. The rite has failed.";
// What the cultist who called them hears, which is the whole of what a refusal
// now does. Silence reaches this too, so it covers both a pressed Decline and
// somebody who never answered.
const ASK_REFUSED_DM =
  "They have renounced Tzchernobog, either through defiance against his will, or inability to accept his reality.";

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

// ---- Asking the circle who to call -----------------------------------------

// Where a pick comes back on, and Discord's cap on a string select's options.
const CONVERSION_PICK_PREFIX = "rite:convert:";
const PICK_OPTION_LIMIT = 25;

const PICK_DM = "Tzchernobog awaits a new minion, who shall see his truth?";

// Plain component JSON rather than discord.js: the web sends these too and only
// the bot has the library, so the shape lives where both can reach it.
function conversionPickRow(attemptId, options) {
  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `${CONVERSION_PICK_PREFIX}${attemptId}`,
          placeholder: "Who do you call?",
          options: options.slice(0, PICK_OPTION_LIMIT).map((o) => ({
            label: o.label.slice(0, 100),
            value: o.code,
          })),
        },
      ],
    },
  ];
}

/**
 * What an option posts back instead of a Character.id: an HMAC of the attempt,
 * the chanter reading the list and the candidate. The id used to be the value,
 * on the Discord select and in the DM's meta the web draws from, so every
 * chanter was handed the real id of every hood in the room — and shipping an
 * id IS the unmasking (PROXYING.md §5). A code means nothing outside this one
 * list: another chanter's code for the same person differs, and so does the
 * next rite's. answerConversionPick recomputes it over the rebuilt candidate
 * set rather than storing it. No AUTH_SECRET means no code, the hoodToken.js
 * rule: never an HMAC under an empty key.
 */
function pickCode(attemptId, readerId, candidateId) {
  if (!attemptId || !readerId || !candidateId || !process.env.AUTH_SECRET) return null;
  return crypto
    .createHmac("sha256", process.env.AUTH_SECRET)
    .update(`rite-pick:${attemptId}:${readerId}:${candidateId}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * One chanter's list: every candidate named the way THAT chanter knows them
 * (intercept.js#seenBy), so a hood or a face they have never met reads as "a
 * young woman" and a friend by name. Built per reader, because the list goes
 * out as one DM each, and each chanter's Friends list is their own.
 *
 * Two people who look alike get their presence label, the one every observer
 * shares (STRANGERS.md §3) — "a young woman, hunched" — so the circle can
 * still tell them apart and agree on which. Somebody with no label rolled yet
 * gets a number instead.
 *
 * `readerId` null gives the room's own labels and no codes, for the GM
 * panel's record of who was offered.
 */
async function pickOptions(prisma, candidates, { attemptId = null, readerId = null } = {}) {
  const rows = await prisma.character.findMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    select: { ...IDENTITY_SELECT, presenceLabel: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const options = await Promise.all(
    candidates.map(async (c) => {
      const row = byId.get(c.id);
      return {
        code: pickCode(attemptId, readerId, c.id),
        label: row ? await seenBy(prisma, readerId, row) : "somebody",
        presenceLabel: row?.presenceLabel ?? null,
      };
    }),
  );
  const count = new Map();
  for (const o of options) count.set(o.label, (count.get(o.label) ?? 0) + 1);
  const nth = new Map();
  return options.map(({ presenceLabel, ...o }) => {
    if (count.get(o.label) < 2) return o;
    const n = (nth.get(o.label) ?? 0) + 1;
    nth.set(o.label, n);
    return { ...o, label: presenceLabel ? `${o.label}, ${presenceLabel}` : `${o.label} (${n})` };
  });
}

/**
 * Put the list in front of the circle. EVERY chanter is asked and the first to
 * answer wins, which is how the Rite of Panic already treats an answer from a
 * participant — one nominated cultist who happened to be asleep would strand
 * the rite for its whole twelve hours.
 */
async function askCircleToPick(prisma, { attempt, participants = [], candidates = [] }) {
  for (const p of participants) {
    if (!p.discordUserId) continue;
    const options = (await pickOptions(prisma, candidates, { attemptId: attempt.id, readerId: p.characterId })).filter(
      (o) => o.code,
    );
    const components = conversionPickRow(attempt.id, options);
    await sendDm(prisma, p.discordUserId, PICK_DM, {
      source: "rite",
      sfx: SFX.CONVERT_ASK,
      components,
      // The list rides along on meta so the web can draw the same select off
      // the row, the way a letter carries its own body — `action` is a key
      // INSIDE meta, so this merges rather than replaces. It is a label cache
      // and never an authority: answerConversionPick rebuilds the eligible set
      // and will refuse a name that has gone stale since.
      meta: { ...dmAction(DM_ACTION.RITE_TARGET, attempt.id), riteTargets: options },
    }).catch(log(`pick DM to ${p.name}`));
  }
  // The room's labels, for the GM panel's record of who was offered.
  return pickOptions(prisma, candidates);
}

/**
 * A cultist picked somebody. Shared by both faces — the bot's select handler
 * and the web's.
 *
 * Nothing from the DM is trusted. The attempt must still be AWAITING, the
 * answerer must be one of its chanters, and the candidate list is REBUILT
 * rather than read off the snapshot: minutes pass between the chant and the
 * answer, and somebody bound, converted or killed in that gap must not still
 * be offerable.
 *
 * Takes the Discord user rather than a character id, the way
 * db/lib/dmAnswer.js does — the id on the wire is the ATTEMPT, and who is
 * answering is whoever holds the account, resolved here and never posted.
 * `pick` is the option's code (pickCode), matched against the rebuilt set
 * for THIS chanter, so a code copied from another chanter's list matches
 * nobody.
 */
async function answerConversionPick(prisma, { attemptId, discordUserId, pick }) {
  const attempt = await prisma.riteAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.riteKey !== "conversion" || attempt.status !== "AWAITING") {
    return { ok: false, reason: "That rite is over." };
  }

  const me = discordUserId
    ? await prisma.character.findFirst({
        where: { discordUserId, status: "ALIVE" },
        select: { id: true },
      })
    : null;
  const participants = Array.isArray(attempt.participants) ? attempt.participants : [];
  const asker = me ? participants.find((p) => p.characterId === me.id) : null;
  if (!asker) return { ok: false, reason: "You were not in that circle." };

  // Not ROOM_SELECT from riteChant.js: that module reaches riteEffects.js,
  // which reaches this one. These are the fields convertCandidates and the
  // room lines actually need.
  const room = await prisma.room.findUnique({
    where: { id: attempt.roomId },
    select: { id: true, name: true, kind: true, locationId: true, accessTagSlugs: true, discordThreadId: true },
  });
  if (!room) return { ok: false, reason: "That room is gone." };

  const eligible = await convertCandidates(prisma, room);
  const target = pick ? eligible.find((c) => pickCode(attempt.id, asker.characterId, c.id) === pick) : null;
  if (!target) return { ok: false, reason: "They are beyond your reach now." };

  // CLAIM THE ANSWER FIRST, the way answerPanic does: two cultists can pick in
  // the same second, and without this both would put a vision in somebody's
  // DMs off one chant.
  const { count } = await prisma.riteAttempt.updateMany({
    where: { id: attempt.id, status: "AWAITING" },
    data: { status: "FIRED", firedAt: new Date() },
  });
  if (count === 0) return { ok: false, reason: "Another of the circle has already called somebody." };

  // The vision simply bounces off the faithful — no offer row, nothing to
  // answer, and the cult learns it wasted the chant by reading the room.
  const result = dismisses(target)
    ? await dismissConversion(prisma, { target, room })
    : await (async () => {
        const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
        const asked = await createConversionOffer(prisma, { target, room, askedBy: asker, turn });
        return asked.ok
          ? { asked: target.name, characterId: target.id, offerId: asked.offer.id }
          : { asked: false, reason: asked.reason, characterId: target.id };
      })();

  await prisma.riteAttempt
    .update({ where: { id: attempt.id }, data: { result: { ...(attempt.result ?? {}), ...result } } })
    .catch(log("recording the pick"));

  // The sentence and nothing else. `result` holds the chosen person's real
  // name and id for the GMs, and it is on the attempt row for them; handed
  // back here it went to the chanter's browser whole, since a server action's
  // return value is shipped whether or not the page draws it. They picked "a
  // young woman", and that is all they learn.
  return { ok: true, line: "Lord Tzchernobog reaches out to them." };
}

// ---- The three roads out ---------------------------------------------------

/**
 * The Pious path. The vision arrives, means nothing, and leaves them surer of
 * themselves than before. No Offer row is ever written, so there is nothing to
 * answer and nothing to expire — the cult finds out it wasted the chant by
 * reading the room. acceptConversion() comes here too, for somebody who turned
 * Pious while the question was open; that road closes its own row first and
 * has no room when the offer never recorded one.
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
  if (room) {
    await roomLine(prisma, room, `${aliasSubject(target)} refuses the ritual, a look of determination in their eyes!`).catch(
      log("dismissal room line"),
    );
  }
  return { dismissed: target.name, characterId: target.id };
}

/**
 * Put the question. Returns `{ ok, offer }` or `{ ok: false, reason }`.
 * `askedBy` is the cultist who picked this target out of the circle's list —
 * a real fact now rather than the placeholder "first chanter" it used to be,
 * and who refuseConversion() reports back to. It is still never shown to the
 * person being asked.
 */
async function createConversionOffer(prisma, { target, room, askedBy, turn }) {
  // Offer.turnId is required and a rite fires off a minute cron, so it can land
  // between turns. Nothing to do then but let the cult chant again.
  if (!turn?.id) return { ok: false, reason: "no open turn" };
  if (!target.discordUserId) return { ok: false, reason: `${target.name} can't be reached.` };

  const initiatorId = askedBy?.characterId ?? askedBy?.id ?? null;
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
 * Yes. The old rite's whole body, now on the far side of a question.
 *
 * It used to also lift Depressed and set the dial to the floor of Pleased, to
 * rescue somebody a previous refusal had wrecked. Refusing wrecks nobody any
 * more, so there is nothing to undo — and doing it anyway would clear a
 * depression the character earned somewhere else and hand them a mood reset
 * they never asked for.
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
      tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { slug: true } } } },
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

  // And long enough to find faith in. The Pious cannot be converted, so
  // somebody who became Pious after the vision was put to them gets the Pious
  // ending rather than the one they pressed — otherwise the Thanati grant
  // below would strip the Pious (it conflicts) and convert them anyway.
  if (dismisses(target)) {
    const claimed = await prisma.offer.updateMany({
      where: { id: offer.id, status: "PENDING" },
      data: { status: "DECLINED", respondedAt: new Date(), resolvedAt: new Date() },
    });
    if (claimed.count === 0) return { ok: false, reason: "That offer's gone.", dms: [] };
    await dismissConversion(prisma, { target, room: roomFromOffer(offer) });
    await tellAsker(prisma, offer);
    return { ok: true, line: "You dismiss the vision.", dms: [] };
  }

  const claim = await prisma.offer.updateMany({
    where: { id: offer.id, status: "PENDING" },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, reason: "That offer's gone.", dms: [] };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const thanati = await prisma.tag.findUnique({ where: { slug: THANATI_SLUG }, select: { id: true } });

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
    await logSystemTagChange(tx, {
      system: "rite",
      targetCharacterId: target.id,
      applied: mapGrantedTags(granted),
      extra: { rite: "conversion", accepted: true },
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
 * No, and it costs nobody anything — see the header. What is left is closing
 * the row, letting the room see it happen, and telling the cultist who called
 * them, which is the one thing the rite still owes anybody.
 *
 * ONE function for all three roads to no: the Refuse button
 * (db/lib/dmAnswer.js), the three-hour sweep (db/lib/riteSweep.js) and the
 * turn-close pass (db/lib/offerExpiryPass.js). Silence answers here too, so
 * the guarded `updateMany` below still matters — it is what stops two of them
 * telling the cultist twice if they ever race.
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

  // A dead refuser is still a refusal — the row closes — but there is nothing
  // left to say to them and nothing for the room to watch.
  if (target && target.status === "ALIVE") {
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

  await tellAsker(prisma, offer);

  return { ok: true, line: "You refuse.", dms: [] };
}

/**
 * The cultist who called them finds out, whether the answer was a button or
 * three hours of nothing. Best-effort and last, like every other send here:
 * the row is already closed by the time this runs, so a DM that will not go
 * cannot leave the offer half-answered.
 */
async function tellAsker(prisma, offer) {
  if (!offer?.initiatorId) return;
  const asker = await prisma.character
    .findUnique({
      where: { id: offer.initiatorId },
      select: { id: true, name: true, status: true, discordUserId: true },
    })
    .catch(log("asker lookup"));
  if (!asker || asker.status !== "ALIVE" || !asker.discordUserId) return;
  await sendDm(prisma, asker.discordUserId, ASK_REFUSED_DM, { source: "rite" }).catch(
    log(`refusal notice to ${asker.name}`),
  );
}

/**
 * Every PENDING conversion whose three hours are up, refused. Called by the
 * minute sweep in db/lib/riteSweep.js. Returns how many it closed.
 */
async function expireConversionOffers(prisma, now = new Date()) {
  const due = await prisma.offer.findMany({
    where: { kind: "CONVERSION", status: "PENDING", expiresAt: { lte: now } },
    select: { id: true, responderId: true, initiatorId: true, outcome: true },
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
  CONVERSION_PICK_PREFIX,
  PICK_OPTION_LIMIT,
  VISION_DM,
  ACCEPTED_DM,
  REFUSED_DM,
  DISMISSED_DM,
  REFUSED_LINE,
  ASK_REFUSED_DM,
  PICK_DM,
  dismisses,
  dismissConversion,
  conversionPickRow,
  pickCode,
  pickOptions,
  askCircleToPick,
  answerConversionPick,
  createConversionOffer,
  acceptConversion,
  refuseConversion,
  expireConversionOffers,
};
