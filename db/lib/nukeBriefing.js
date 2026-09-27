// Who starts the game knowing about the bomb (docs/systemdocs/NUKE.md §4, from
// Bascinet's "Nuclear bomb" design document):
//
//   - every leader in the fortress, and the Tribunal, start with a Notes entry
//     on /memories reading "The bomb is in {location}";
//   - the Tribunal's leader, the Ordinator, also starts with a paper note that
//     has the eight-digit arming sequence written on it.
//
// "Leader" is the Leader Whitelist seats (`whitelist: true` in docs/roles.yaml)
// less the Bastard, who is an outsider — Bascinet's call, since factions and
// their leaders are gone from the code. The Tribunal is either role, or either
// seat tag, since a GM's Assign hands the seat to an existing character without
// changing their role (web/app/(app)/gm/dev/threatActions.js).
//
// Best-effort everywhere it is called, like db/lib/acquaintances.js beside it:
// a character who arrives without their note is a GM fix, not a failed
// creation. And safe to call twice — neither the note nor the paper is ever
// handed over again once the character has it.

const { mintPaperRow } = require("./paperMint");
const { enqueueMirror } = require("./discordMirror/queue");
const { nukePlace } = require("./nuke");
const { NUKE_TEXT } = require("./nukeText");

const LEADER_ROLE_SLUGS = ["baron", "bishop", "inquisitor", "censor", "esculap", "merchant", "exactor"];
const ORDINATOR = "tribunal-ordinator";
const TRIBUNAL_ROLE_SLUGS = [ORDINATOR, "tribune"];
// The Tribunal's two seat tags (db/lib/threats.js), against the role each one is.
const TRIBUNAL_SEAT_TAGS = { "ordinator-insignia": ORDINATOR, "tribunal-helmet": "tribune" };
const BRIEFED_ROLE_SLUGS = new Set([...LEADER_ROLE_SLUGS, ...TRIBUNAL_ROLE_SLUGS]);

// The label that marks the game's own note, so a second call can find it.
const NOTE_LABEL = "bomb";

/** Which seats a character sits in: their role, plus any Tribunal seat tag. */
function seatsOf(character) {
  const seats = new Set();
  if (character?.role?.slug) seats.add(character.role.slug);
  for (const row of character?.tags ?? []) {
    const seat = TRIBUNAL_SEAT_TAGS[row?.tag?.slug];
    if (seat) seats.add(seat);
  }
  return seats;
}

/** `{ note, paper }`: whether this character is owed the Notes entry, and the paper. */
function briefingFor(character) {
  const seats = [...seatsOf(character)];
  return { note: seats.some((s) => BRIEFED_ROLE_SLUGS.has(s)), paper: seats.includes(ORDINATOR) };
}

const CHARACTER_SELECT = {
  id: true,
  status: true,
  discordUserId: true,
  role: { select: { slug: true } },
  tags: { select: { tag: { select: { slug: true } } } },
};

/** Hand one character whatever of the briefing they are owed and do not have. */
async function seedNukeBriefing(prisma, characterId) {
  if (!characterId) return { note: false, paper: false };
  const character = await prisma.character.findUnique({ where: { id: characterId }, select: CHARACTER_SELECT });
  if (!character || character.status !== "ALIVE") return { note: false, paper: false };
  const owed = briefingFor(character);
  if (!owed.note && !owed.paper) return { note: false, paper: false };

  const place = await nukePlace(prisma);
  if (!place) return { note: false, paper: false };

  let note = false;
  if (owed.note) {
    const had = await prisma.journalEntry.findFirst({
      where: { characterId: character.id, labels: { has: NOTE_LABEL } },
      select: { id: true },
    });
    if (!had) {
      await prisma.journalEntry.create({
        data: {
          discordUserId: character.discordUserId,
          characterId: character.id,
          title: NUKE_TEXT.noteTitle,
          body: NUKE_TEXT.noteBody(place.room.location.name),
          labels: [NOTE_LABEL],
          pinned: true,
        },
      });
      note = true;
    }
  }

  let paper = false;
  if (owed.paper) {
    const had = await prisma.characterTag.findFirst({
      where: { characterId: character.id, tag: { paperKind: { not: null }, paperText: place.code } },
      select: { id: true },
    });
    if (!had) {
      // Its OWN transaction: mintPaperRow retries on a slug collision, which a
      // caller's open transaction cannot survive (db/lib/slaveContract.js).
      await prisma.$transaction((tx) => mintPaperRow(tx, character.id, null, place.code, NUKE_TEXT.paperTitle));
      paper = true;
    }
  }
  return { note, paper };
}

/** Every living character owed a briefing, briefed. */
async function briefEveryone(prisma) {
  const rows = await prisma.character.findMany({
    where: {
      status: "ALIVE",
      OR: [
        { role: { slug: { in: [...BRIEFED_ROLE_SLUGS] } } },
        { tags: { some: { tag: { slug: { in: Object.keys(TRIBUNAL_SEAT_TAGS) } } } } },
      ],
    },
    select: { id: true },
  });
  let briefed = 0;
  for (const row of rows) {
    const done = await seedNukeBriefing(prisma, row.id).catch((err) => {
      console.error(`Bomb briefing failed for ${row.id}:`, err);
      return null;
    });
    if (done?.note || done?.paper) briefed += 1;
  }
  return briefed;
}

/**
 * Put the bomb's button on (or take it off) a room's Discord post: the room
 * post is hashed with its buttons, so the mirror redraws only what moved.
 */
async function queueBombPosts(prisma, roomIds, reason) {
  for (const roomId of new Set(roomIds.filter(Boolean))) {
    await enqueueMirror(prisma, "room", roomId, reason);
  }
}

/**
 * A game that was already running rolled its bomb just now (db/lib/nuke.js#
 * ensureNuke): the leaders and the Tribunal get their notes, and the room gets
 * its button on Discord.
 */
async function afterLazyRoll(prisma, roomId) {
  await queueBombPosts(prisma, [roomId], "the bomb was placed");
  await briefEveryone(prisma);
}

module.exports = {
  LEADER_ROLE_SLUGS,
  TRIBUNAL_ROLE_SLUGS,
  TRIBUNAL_SEAT_TAGS,
  NOTE_LABEL,
  seatsOf,
  briefingFor,
  seedNukeBriefing,
  briefEveryone,
  queueBombPosts,
  afterLazyRoll,
};
