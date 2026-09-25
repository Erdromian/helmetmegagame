// Who was in the room for a line, and what it taught them
// (docs/systemdocs/MEMORIES.md §2b and §4). Two jobs, one audience rule:
//
//   logHeard     — every feed row said in a place, filed for everyone physically
//                  present as a HeardLine, which is the "Memories of the day"
//                  section. Called from db/lib/archive.js#recordArchiveMessage,
//                  the one door every feed row comes through.
//
//   learnFromSpeech — a character's own line, checked for names and roles the
//                  listeners did not know (the pure half is
//                  db/lib/memoryLessons.js). Called after the line is really
//                  out: db/lib/say.js#recordSpeech for the web and the Speak
//                  modal, bot/src/lib/proxy.js once the webhook post landed.
//
// Both are fire-and-forget at their call sites. A memory is never worth a
// failed or slowed message.
//
// PRESENT means standing there, not able to read it. db/lib/feedAccess.js
// lets a character read a street they just walked out of, or a room through
// the Scrying Eye; neither is being in the room, so neither is here.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel.

const { parsePlaceKey } = require("./placeKey");
const {
  CONCEALMENT_TAG_FIELDS,
  presentedIdentity,
  forcedNameFrom,
  concealmentFrom,
} = require("./presentedIdentity");
const { lessonsFrom } = require("./memoryLessons");

// Where a line puts somebody in the room for the day log. `net:` (a radio),
// `dead:`, `game:` and the like are not rooms: nobody stands in them.
const HEARD_KINDS = new Set(["loc", "room", "conv", "party", "zone"]);

// Where a line can TEACH. The zone summary is left out on purpose — it is the
// whole zone's slow noticeboard, and a name said there is not a name said in
// the same room as its owner.
const TEACHING_KINDS = new Set(["room", "conv", "party"]);

// A listener carrying one of these hears nothing (db/lib/incapacitation.js
// notes hearing is modelled nowhere else, so this is the rule).
const DEAF_TAG_SLUGS = ["unconscious", "asleep"];

// The Character `where` for everyone physically present at a place key, or
// null for a place nobody stands in. `speakerId` places a party, which has no
// Location of its own beyond its members' feet.
async function presentWhere(prisma, placeKey, { speakerId = null } = {}) {
  const parsed = parsePlaceKey(placeKey);
  if (!parsed || !HEARD_KINDS.has(parsed.kind)) return null;
  const alive = { status: "ALIVE" };

  if (parsed.kind === "loc") return { ...alive, locationId: parsed.id };
  if (parsed.kind === "zone") return { ...alive, zoneId: parsed.id };

  if (parsed.kind === "room") {
    const room = await prisma.room.findUnique({
      where: { id: parsed.id },
      select: {
        locationId: true,
        kind: true,
        accessTagSlugs: true,
        quest: { select: { status: true, allowedCharacterIds: true } },
      },
    });
    if (!room) return null;
    if (room.kind !== "PRIVATE") return { ...alive, locationId: room.locationId };
    // A private room holds the people entitled to it: a key, a guest pass, or
    // a quest door — db/lib/roomAccess.js#accessibleRooms, asked backwards.
    const entitled = [{ roomGuestOf: { some: { roomId: parsed.id } } }];
    if (room.accessTagSlugs.length > 0) entitled.push({ tags: { some: { tag: { slug: { in: room.accessTagSlugs } } } } });
    const questIds = room.quest?.status === "OPEN" ? room.quest.allowedCharacterIds : [];
    if (questIds.length > 0) entitled.push({ id: { in: questIds } });
    return { ...alive, locationId: room.locationId, OR: entitled };
  }

  if (parsed.kind === "conv") {
    const thread = await prisma.playerThread.findUnique({
      where: { id: parsed.id },
      select: { locationId: true, members: { select: { characterId: true } } },
    });
    if (!thread) return null;
    // Membership is not presence (PROXYING.md §6): a member who walked off is
    // still on the list, and no longer in the room.
    return { ...alive, locationId: thread.locationId, id: { in: thread.members.map((m) => m.characterId) } };
  }

  // party:
  const party = await prisma.partyThread.findUnique({
    where: { id: parsed.id },
    select: { creatorCharacterId: true, members: { select: { characterId: true } } },
  });
  if (!party) return null;
  const ids = [party.creatorCharacterId, ...party.members.map((m) => m.characterId)];
  const speaker = speakerId
    ? await prisma.character.findUnique({ where: { id: speakerId }, select: { locationId: true } })
    : null;
  return { ...alive, id: { in: ids }, ...(speaker?.locationId ? { locationId: speaker.locationId } : {}) };
}

// Files a row for everyone present. `row` is the ArchiveEntry just written. A
// row with no open turn has no day to file under, so it is not filed.
async function logHeard(prisma, row) {
  if (!row?.placeKey || row.dayNumber == null || row.seq == null) return 0;
  const where = await presentWhere(prisma, row.placeKey, { speakerId: row.characterId ?? null });
  if (!where) return 0;
  const present = await prisma.character.findMany({ where, select: { id: true } });
  if (present.length === 0) return 0;
  const { count } = await prisma.heardLine.createMany({
    data: present.map((c) => ({ characterId: c.id, seq: row.seq, dayNumber: row.dayNumber })),
    skipDuplicates: true,
  });
  return count;
}

// Everything a lesson reads off a person in the room. One `tags` include does
// both jobs: the identity pieces (a forced name, an equipped concealer) and the
// two tags that stop somebody hearing.
const LISTENER_SELECT = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  concealed: true,
  age: true,
  gender: true,
  roleTitle: true,
  role: { select: { slug: true, name: true } },
  tags: {
    where: {
      OR: [
        { tag: { forcedName: { not: null } } },
        { equipped: true, tag: { concealsIdentity: true } },
        { tag: { slug: { in: DEAF_TAG_SLUGS } } },
      ],
    },
    select: { equipped: true, tag: { select: { slug: true, forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
  },
};

// Whether this person's own identity is showing — not hooded, not under a
// forced name. Only then can their name be matched to them.
function showsOwnFace(person) {
  const shown = presentedIdentity(person, {
    forcedName: forcedNameFrom(person.tags),
    concealment: concealmentFrom(person.tags),
  });
  return !shown.concealed && !shown.forced;
}

// The speaker's line, checked for what it teaches the room. `row` is the
// ArchiveEntry; `speakerId` is who really said it (a hooded row's
// characterId is still the speaker's).
async function learnFromSpeech(prisma, { row, speakerId }) {
  if (!row?.placeKey || !speakerId || typeof row.content !== "string" || !row.content.trim()) return { taught: 0 };
  const parsed = parsePlaceKey(row.placeKey);
  if (!parsed || !TEACHING_KINDS.has(parsed.kind)) return { taught: 0 };
  const where = await presentWhere(prisma, row.placeKey, { speakerId });
  if (!where) return { taught: 0 };

  const present = await prisma.character.findMany({ where, select: LISTENER_SELECT });
  const speaker = present.find((p) => p.id === speakerId);
  if (!speaker) return { taught: 0 };

  const candidates = present.filter(showsOwnFace);
  // The speaker's own memory of the people here, which is what decides whether
  // they could have known what they said.
  const others = candidates.filter((c) => c.id !== speakerId).map((c) => c.id);
  const known =
    others.length > 0
      ? await prisma.acquaintance.findMany({
          where: { ownerId: speakerId, subjectId: { in: others } },
          select: { subjectId: true, name: true, roleSlug: true },
        })
      : [];
  const speakerKnows = new Map(known.map((k) => [k.subjectId, k]));

  const lessons = lessonsFrom({ content: row.content, speaker, candidates, speakerKnows });
  if (lessons.length === 0) return { taught: 0 };

  const listeners = present.filter(
    (p) => p.id !== speakerId && !p.tags.some((t) => DEAF_TAG_SLUGS.includes(t.tag?.slug)),
  );
  let taught = 0;
  for (const lesson of lessons) {
    const learners = listeners.filter((l) => l.id !== lesson.subjectId).map((l) => l.id);
    if (learners.length === 0) continue;
    if (lesson.name) {
      const { count } = await prisma.acquaintance.createMany({
        data: learners.map((ownerId) => ({ ownerId, subjectId: lesson.subjectId, source: "HEARD", ...lesson.entry })),
        skipDuplicates: true,
      });
      taught += count;
    }
    // Fill a role nobody has written yet — never overwrite one, whoever wrote it.
    if (lesson.role && lesson.entry.roleText) {
      const { count } = await prisma.acquaintance.updateMany({
        where: { ownerId: { in: learners }, subjectId: lesson.subjectId, OR: [{ roleText: null }, { roleText: "" }] },
        data: { roleText: lesson.entry.roleText, roleSlug: lesson.entry.roleSlug },
      });
      taught += count;
    }
  }
  return { taught };
}

module.exports = { logHeard, learnFromSpeech, presentWhere, HEARD_KINDS, TEACHING_KINDS, DEAF_TAG_SLUGS };
