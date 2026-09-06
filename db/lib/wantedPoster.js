// The Cerberon put a face up.
//
// A character who turns up already Wanted (the tag is a creation-time buy)
// has a bounty on them before they have done anything, and three sheets go up
// the moment they arrive: one in the garrison mess, where the soldiers who
// might collect it eat; one in the Censor's office, where the paperwork
// lives; and one nailed to the board in the Square, where everybody in Town
// walks past it.
//
// The line names the zone the character STARTED in and never updates. That is
// what a wanted poster is — a snapshot of where somebody was last seen, going
// stale the moment they move.
//
// Three separate sheets, not one: NoticePost.tagId is @unique, so a pinned
// poster cannot also be sitting in a stash.
//
// Takes `prisma` as a parameter, the db/lib/dm.js convention, and stays off
// the @lifeweb/db barrel.

const { mintUnownedPaper } = require("./paperMint");
const { addToRoomStack } = require("./tagWrites");
const { expiryFrom } = require("./turnFormat");

const WANTED_SLUG = "wanted";
const POSTER_AUTHOR = "The Cerberon";

// The two rooms that get a loose sheet in their stash.
const POSTER_ROOM_SLUGS = ["garrison-mess-hall", "garrison-censors-office"];
// The Location whose noticeboard gets the pinned one.
const POSTER_BOARD_LOCATION_SLUG = "square";

// Long enough to outlast the brigand. NoticePost.expiresTurn is required and
// db/lib/noticeboardPass.js destroys the paper with the post, so a poster with
// no clock is not an option — this is the clock that reads as "indefinitely".
const POSTER_TURNS = 30;

function posterText(name, zoneName) {
  return `WANTED: ${name}. Last seen in the ${zoneName}.`;
}

// True when a freshly created character bought Wanted. `heldSlugs` is any
// iterable of the slugs they ended up with.
function isWanted(heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  return held.has(WANTED_SLUG);
}

// Puts the three sheets up. Best-effort by contract: every caller wraps it,
// because a poster may never cost a character that already exists.
async function postWantedPosters(prisma, character, openTurn) {
  const zoneName = character?.zone?.name ?? character?.zoneName ?? null;
  if (!character?.id || !zoneName) return { rooms: 0, pinned: false };

  const text = posterText(character.name, zoneName);
  const turnNumber = openTurn?.number ?? null;

  const rooms = await prisma.room.findMany({
    where: { slug: { in: POSTER_ROOM_SLUGS } },
    select: { id: true },
  });
  const board = await prisma.location.findUnique({
    where: { slug: POSTER_BOARD_LOCATION_SLUG },
    select: { id: true },
  });

  // One transaction per sheet rather than one for all three. createWithRetry
  // re-creates on a name collision, and Postgres aborts a whole transaction
  // on the first failed statement — so batching them would turn one unlucky
  // waybill code into three lost posters (the trap paperMint.js documents).
  let posted = 0;
  for (const room of rooms) {
    await prisma.$transaction(async (tx) => {
      const tag = await mintUnownedPaper(tx, `${character.id}-${room.id}`, POSTER_AUTHOR, text);
      await addToRoomStack(tx, room.id, tag.id, 1, {});
    });
    posted += 1;
  }

  let pinned = false;
  if (board && turnNumber != null) {
    await prisma.$transaction(async (tx) => {
      const tag = await mintUnownedPaper(tx, `${character.id}-${board.id}`, POSTER_AUTHOR, text);
      await tx.noticePost.create({
        data: {
          locationId: board.id,
          tagId: tag.id,
          // Nullable by design: a notice outlives whoever pinned it, and the
          // Cerberon are not a character.
          postedById: null,
          postedTurn: turnNumber,
          expiresTurn: expiryFrom(turnNumber, POSTER_TURNS),
        },
      });
    });
    pinned = true;
  }

  return { rooms: posted, pinned };
}

module.exports = { isWanted, postWantedPosters, posterText, WANTED_SLUG };
