// Who a viewer has SEEN SPEAK this turn, and what they looked like doing it.
//
// Standing in a room is public; what is over your face is not. Presence
// surfaces used to hand out both at once — db/lib/whosHere.js drew every
// concealed person wearing their own mask sprite, so opening the column in the
// Underquarter announced "two silver masks are standing here", which is the
// one thing a Thanati in a basement is not supposed to broadcast.
//
// So a face has to be earned. You have seen somebody this turn if a line of
// theirs sits in a place your own feed shows you, in the open turn, and the
// sighting dies with the turn like everything else keyed on it.
//
// What comes back is FROZEN at the last such line rather than read live, and
// that is the whole point rather than an optimisation: somebody who chats
// bare-faced and then pulls a mask on in private still reads as themselves
// until the turn rolls. A hood put on after you heard them speak does not
// protect them from you. ArchiveEntry already froze both halves at send time
// (concealedAlias, presentedAvatarPath), so this reads them back rather than
// recomputing an identity that has since moved.
const { placesFor } = require("./feedAccess");

// A concealed row whose face was never recorded — a line said before
// ArchiveEntry.presentedAvatarPath existed. It cannot be given one now: the
// sprite lived on the Tag equipped at the time, and guessing from today's
// tags could unmask somebody. It draws the question-mark plate instead, which
// is `unknownFace` rather than a path, because the plate is CSS on the web and
// not a file (web/app/components/CharacterAvatar.js).
function shapeSighting(row) {
  const alias = row.concealedAlias ?? null;
  return {
    seq: String(row.seq),
    name: alias ?? row.characterName ?? null,
    concealed: Boolean(alias),
    avatarPath: row.presentedAvatarPath ?? null,
    unknownFace: Boolean(alias) && !row.presentedAvatarPath,
  };
}

// Returns Map<characterId, { seq, name, concealed, avatarPath, unknownFace }>.
// An absent key means unseen, which is the state that withholds a face and an
// eye — never an error.
//
// `character` is a live Character row with at least { id, locationId }; the
// place scope comes from db/lib/feedAccess.js#placesFor rather than being
// rebuilt here, because that file is the one answer to what a viewer may read
// and a second copy of the rule would drift out of step with the first.
async function lastSightings(prisma, character, { gm = false, discordUserId = null } = {}) {
  const empty = new Map();
  if (!character?.id && !gm) return empty;

  const [places, open] = await Promise.all([
    placesFor(prisma, character, { gm, discordUserId }),
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
  ]);
  // Between turns nobody has been seen. That reads as every face withheld,
  // which is the safe direction for this to fail in.
  if (places.length === 0 || open?.number == null) return empty;

  const keys = places.map((entry) => entry.placeKey).filter(Boolean);
  if (keys.length === 0) return empty;

  try {
    // The newest surviving line per speaker, in two queries rather than one
    // raw DISTINCT ON — the same groupBy-then-fetch shape the unread
    // watermarks already use (web/lib/feedAccess.js#notableWatermarks), and
    // @@index([placeKey, seq]) carries it. A viewer's place list is single
    // digits and the rows are one turn's chat inside them, so this is bounded
    // by how loud the room is, never by the size of the roster.
    const grouped = await prisma.archiveEntry.groupBy({
      by: ["characterId"],
      where: {
        placeKey: { in: keys },
        turnNumber: open.number,
        deletedAt: null,
        characterId: { not: null },
      },
      _max: { seq: true },
    });

    const seqs = grouped.map((entry) => entry._max?.seq).filter((seq) => seq !== null && seq !== undefined);
    if (seqs.length === 0) return empty;

    const rows = await prisma.archiveEntry.findMany({
      where: { seq: { in: seqs } },
      select: {
        seq: true,
        characterId: true,
        characterName: true,
        concealedAlias: true,
        presentedAvatarPath: true,
      },
    });

    const out = new Map();
    for (const row of rows) {
      if (row.characterId) out.set(row.characterId, shapeSighting(row));
    }
    return out;
  } catch (err) {
    // A failed read costs everybody their face for one render, which is the
    // quiet direction. A column that threw is not.
    console.error("Sightings read failed:", err);
    return empty;
  }
}

module.exports = { lastSightings };
