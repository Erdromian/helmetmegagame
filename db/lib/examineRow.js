// Looking at whoever said one archived line — the Prisma half of
// db/lib/examine.js, which is deliberately pure and stays that way.
//
// This is the ONE path behind every look in the game now: 🔍 and 📸 in
// Discord, the eye on a row in the web feed, the eye in the HERE column, which
// points at the last line it watched somebody say, and the web's camera. They
// used to be four — a bot copy, a web copy, a camera copy and a hood-token
// copy — agreeing by hand on rules (the doctor's eye, the officer's ⬢, the
// impoverished hood read) where a divergence is invisible until a player
// notices one surface telling them something another won't.
//
// It is pressed against a SEQ rather than a character id, and that is the
// whole design rather than a convenience. The server resolves the speaker
// itself, so a page can offer a look at a hooded line without ever being told
// who is under the hood — the thing db/lib/whosHere.js#hoodToken exists to
// avoid, solved once here instead.
//
// AND IT ANSWERS FOR THE MOMENT THE LINE WAS SAID, not for now. A mask coming
// off never retroactively unmasks what was said behind it; a mask going on
// never hides what was said before it; and — the part this file was missing
// for a long time — gear picked up after the fact never appears on a line said
// before it. The row froze what the room could see and this reads it back;
// db/lib/examineSnapshot.js holds the rule for what is frozen and what is not,
// and is the file to read before changing either side of it.
//
// A row with no snapshot — written before the column existed — falls back to
// the live character, which is what every row did before.
//
// `viewer` is a live Character loaded with VIEWER_SELECT below. Returns
// { blocked: <sentence> } when they cannot see, null when the line or the
// speaker is gone, and { readout } otherwise.
const { getMyFactionRole } = require("./factionPermissions");
const { EXAMINE_TAG_SELECT, EXAMINE_SUBJECT_SELECT, examineReadout, canSeeDesire } = require("./examine");
const { readPresentedState, rehydrateSubject } = require("./examineSnapshot");
const { buildSkillAncestry, satisfiedSkillIds } = require("./medicalVision");
const { examineBlock } = require("./examineVision");
const { forcedNameFrom, wasHooded } = require("./presentedIdentity");
const { feedWipeFloors, floorForPlace } = require("./feedWipe");
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
    // presentedState is the rest of what it saw; turnNumber is the clock every
    // duration on the readout is counted against.
    select: {
      kind: true,
      seq: true,
      turnNumber: true,
      characterId: true,
      concealedAlias: true,
      presentedAvatarPath: true,
      presentedState: true,
      deletedAt: true,
      placeKey: true,
    },
  });
  if (!row || row.deletedAt || !row.characterId || !row.placeKey) return null;
  // A system event can carry a characterId — a death, a fulfilled Desire — and
  // is not a thing anybody watched somebody say. The camera already refused
  // one; the eye should too.
  if (row.kind !== "MESSAGE") return null;
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

  // And the same FLOOR the feed itself renders above (db/lib/feedWipe.js), so
  // a look reaches exactly as far back as Chat does and no further. Without
  // it, a seq being a sequential number meant this server action would answer
  // for any line ever said in a place the reader can currently read — every
  // row below the wipe line, back to turn one. A radio net is the bad case:
  // netPlacesFor has no location component, so a frequency audible from
  // anywhere carried its whole history.
  const floors = await feedWipeFloors(prisma);
  if (row.seq <= floorForPlace(floors, row.placeKey)) return null;

  // What the room could SEE of them, or null for a row written before the
  // column — in which case everything below falls back to the live character,
  // exactly as it always did.
  const state = readPresentedState(row.presentedState);

  // A frozen look needs almost nothing live off the speaker: rehydrateSubject
  // overwrites every in-fiction field, so loading the whole subject would be
  // fetching a twenty-column tag join to throw it away. What is left is the
  // three things that are not in-fiction state — the id, the avatar's
  // cache-buster, and the age and gender nobody can put on or take off.
  const live = await prisma.character.findUnique({
    where: { id: row.characterId },
    select: state
      ? { id: true, name: true, age: true, gender: true, updatedAt: true }
      : EXAMINE_SUBJECT_SELECT,
  });
  if (!live) return null;

  // Everything else a frozen subject needs: the tag CATALOG (rules, not
  // disguise — a rebalance should reach an old line) and the faction they were
  // in then, which inRealFaction reads to gate both the Role and the ⬢.
  const [catalog, faction] = state
    ? await Promise.all([
      prisma.tag.findMany({
        where: { id: { in: state.tags.map((t) => t.tagId) } },
        select: { id: true, ...EXAMINE_TAG_SELECT },
      }),
      state.factionId
        ? prisma.faction.findUnique({ where: { id: state.factionId }, select: { name: true, slug: true } })
        : null,
    ])
    : [[], null];

  const subject = state ? rehydrateSubject({ live, state, tags: catalog, faction }) : live;

  // Every duration on the readout counts against the turn the LINE was said
  // in, not today's. A frozen `expiresTurn: 12` read on turn 20 would render
  // "expires this turn" — false, and it quietly tells a reader doing the
  // arithmetic that the tag is long gone. Against the row's own turn it says
  // three turns left, which is what an onlooker could have worked out at the
  // time. openTurn is still fetched: examineBlock needs its phase.
  const readoutTurn = (state ? row.turnNumber : null) ?? openTurn?.number;

  // A forced name is NOT a hood — a Beast is being something, not hiding — and
  // say.js writes both into concealedAlias, so the two are told apart by what
  // the ROW froze rather than by what the speaker happens to hold now
  // (presentedIdentity.js#wasHooded). Reading the forced name off the FROZEN
  // tags closes the last of that: a Disguise Kit lasts three turns, and the
  // live comparison found no name to match once it was swept.
  const forced = forcedNameFrom(subject.tags);
  const hooded = wasHooded(row, { forcedName: forced });

  // Sight the readout may use. A camera gets none of the viewer's.
  const sightTags = bystander ? [] : (viewer.tags ?? []);

  // A hood gets the impoverished read and nothing else, so neither query below
  // is worth running for one.
  const [skillCatalog, officer, lastDesire] = await Promise.all([
    bystander ? [] : prisma.tag.findMany({ select: { id: true, parentTagId: true } }),
    // A Leader/Treasurer of the SUBJECT's faction sees their ⬢, the same seat
    // /faction's roster column reads. Keyed on the faction they were in THEN,
    // since that is the one the readout is answering for.
    !hooded && subject.factionId && viewer.discordUserId
      ? getMyFactionRole(prisma, viewer.discordUserId, subject.factionId).then((r) => r.isOfficer)
      : false,
    !hooded && canSeeDesire(sightTags)
      ? prisma.desire.findFirst({
        where: {
          characterId: subject.id,
          status: "FULFILLED",
          // A Desire fulfilled AFTER the line was said is not something this
          // line can report. Fulfilling one is a private act.
          //
          // The null arm is not optional: endedTurnNumber is stamped from the
          // OPEN turn, so one fulfilled between turns carries no number at all,
          // and a bare `lte` never matches a NULL column — it would drop the
          // most recent Desire rather than date it.
          ...(readoutTurn == null
            ? {}
            : { OR: [{ endedTurnNumber: null }, { endedTurnNumber: { lte: readoutTurn } }] }),
        },
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
      openTurnNumber: readoutTurn,
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
