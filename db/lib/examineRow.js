// Looking at whoever said one archived line — the Prisma half of
// db/lib/examine.js, which is deliberately pure and stays that way.
//
// This is the ONE path behind every look in the game now: 🔍 and 📸 in
// Discord, the eye on a row in the web feed, and the eye in the HERE column,
// which points at the last line it watched somebody say. They used to be three
// — a bot copy, a web copy, and a hood-token copy — agreeing by hand on rules
// (the doctor's eye, the officer's ⬢, the impoverished hood read) where a
// divergence is invisible until a player notices one surface telling them
// something another won't.
//
// It is pressed against a SEQ rather than a character id, and that is the
// whole design rather than a convenience. The server resolves the speaker
// itself, so a page can offer a look at a hooded line without ever being told
// who is under the hood — the thing db/lib/whosHere.js#hoodToken exists to
// avoid, solved once here instead. And it answers for the hood worn WHEN THE
// LINE WAS SAID: a mask coming off never retroactively unmasks what was said
// behind it, and a mask going on never hides what was said before it.
//
// `viewer` is a live Character loaded with VIEWER_SELECT below. Returns
// { blocked: <sentence> } when they cannot see, null when the line or the
// speaker is gone, and { readout } otherwise.
const { getMyFactionRole } = require("./factionPermissions");
const { EXAMINE_SUBJECT_SELECT, examineReadout, canSeeDesire } = require("./examine");
const { buildSkillAncestry, satisfiedSkillIds } = require("./medicalVision");
const { examineBlock } = require("./examineVision");
const { forcedNameFrom, wasHooded } = require("./presentedIdentity");
const { mayReadPlace } = require("./feedAccess");
const { THANATI_SLUG } = require("./thanati");

// What the caller must load onto the viewer. `equipped` and the roof are for
// examineVision.js — spectacles only correct your sight while worn, and Sun
// Sensitivity only blinds you outdoors.
const VIEWER_SELECT = {
  id: true,
  locationId: true,
  factionId: true,
  discordUserId: true,
  tags: { select: { tagId: true, equipped: true, tag: { select: { slug: true } } } },
  location: { select: { indoors: true } },
};

// `bystander: true` strips the viewer's own sight before the readout is built
// — no doctor's eye, no Seductive. That is what a CAMERA sees: a lens has no
// medical training, and without it a surgeon's photograph would carry their
// diagnosis to whoever they handed the print to, which is the one way the
// doctor's-eye gate could be laundered.
async function examineRow(prisma, viewer, seq, { bystander = false, gm = false } = {}) {
  if (!viewer?.id || seq === null || seq === undefined) return null;

  let key;
  try {
    key = BigInt(seq);
  } catch {
    return null;
  }

  const row = await prisma.archiveEntry.findUnique({
    where: { seq: key },
    // presentedAvatarPath rides along for wasHooded below: it is the face the
    // room actually saw, frozen at send time, and the only signal that still
    // tells a hood from a forced name once the forcing tag has worn off.
    select: {
      characterId: true,
      concealedAlias: true,
      presentedAvatarPath: true,
      deletedAt: true,
      placeKey: true,
    },
  });
  if (!row || row.deletedAt || !row.characterId || !row.placeKey) return null;
  if (row.characterId === viewer.id) return null;

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true, phase: true } });

  // The vision gate, before any work. Blindness first, because nothing else
  // can rescue it.
  const blocked = examineBlock(viewer.tags ?? [], {
    phase: openTurn?.phase ?? null,
    indoors: viewer.location?.indoors ?? true,
  });
  if (blocked) return { blocked };

  // Earshot is the gate, not co-presence: you may look at somebody because you
  // HEARD them, and the place you heard them in is one you are allowed to
  // read. A seq is a guessable number, so this is what stops a line being
  // looked at out of a room the reader is standing outside of — the same check
  // starRow and photographRow make.
  const allowed = await mayReadPlace(prisma, viewer, row.placeKey, { gm, discordUserId: viewer.discordUserId });
  if (!allowed) return null;

  const subject = await prisma.character.findUnique({
    where: { id: row.characterId },
    select: EXAMINE_SUBJECT_SELECT,
  });
  if (!subject) return null;

  // A forced name is NOT a hood — a Beast is being something, not hiding — and
  // say.js writes both into concealedAlias, so the two are told apart by what
  // the ROW froze rather than by what the speaker happens to hold now
  // (presentedIdentity.js#wasHooded). Comparing against the live forced name
  // was the whole bug: a Disguise Kit lasts three turns, and once it was swept
  // every line said under it started reading as a hood.
  const forced = forcedNameFrom(subject.tags);
  const hooded = wasHooded(row, { forcedName: forced });

  // Sight the readout may use. A camera gets none of the viewer's.
  const sightTags = bystander ? [] : (viewer.tags ?? []);

  // A hood gets the impoverished read and nothing else, so neither query below
  // is worth running for one.
  const [skillCatalog, officer, lastDesire] = await Promise.all([
    bystander ? [] : prisma.tag.findMany({ select: { id: true, parentTagId: true } }),
    // A Leader/Treasurer of the SUBJECT's faction sees their ⬢, the same seat
    // /faction's roster column reads.
    !hooded && subject.factionId && viewer.discordUserId
      ? getMyFactionRole(prisma, viewer.discordUserId, subject.factionId).then((r) => r.isOfficer)
      : false,
    !hooded && canSeeDesire(sightTags)
      ? prisma.desire.findFirst({
        where: { characterId: subject.id, status: "FULFILLED" },
        orderBy: [{ endedTurnNumber: "desc" }, { id: "desc" }],
        select: { text: true, points: true },
      })
      : null,
  ]);

  return {
    readout: examineReadout({
      // Faked onto the subject shape so one readout serves both — see
      // db/lib/examine.js.
      subject: hooded ? { ...subject, concealed: true } : subject,
      viewerTags: sightTags,
      satisfied: bystander
        ? new Set()
        : satisfiedSkillIds(
          (viewer.tags ?? []).map((ct) => ct.tagId),
          buildSkillAncestry(skillCatalog),
        ),
      openTurnNumber: openTurn?.number,
      lastDesire,
      viewerFactionId: viewer.factionId ?? null,
      viewerIsOfficer: officer,
      // The hood the room SAW, which outlives the hood they are wearing now.
      wasConcealedAs: hooded ? (row.concealedAlias ?? null) : null,
      viewerIsThanati: !bystander && (viewer.tags ?? []).some((ct) => ct.tag?.slug === THANATI_SLUG),
    }),
  };
}

module.exports = { VIEWER_SELECT, examineRow };
