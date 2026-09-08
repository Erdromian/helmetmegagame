import { prisma } from "@lifeweb/db";
import { hereWhere } from "@lifeweb/db/lib/presence";
import { auth } from "@/lib/auth";
import { deployVersion } from "@/lib/deployVersion";

// GET /api/character-version — "has anything on my sheet moved?" for
// CharacterPoller.js. Answers with a FINGERPRINT of the acting character's
// world, not the world itself, so /character can refresh only when something
// changed instead of re-running its dozen queries on a timer. Everything here
// is one cheap round of aggregates; no Discord call, nothing heavy.
//
// The character comes from the session and never from the query. A player
// with no living character gets 403 and the poller stands down.
//
// What goes into the print: where you are, what you carry and how much,
// what's in the stashes at your Location, the open turn, and the bomb's
// clock. A GM grant, a bot-side move, a labor payout, a room being looted, a
// turn closing — each moves one of those. Anything it misses is still there
// on the next navigation, which is where the page was before this existed.
//
// It also watches the people standing with you, because for a while it did
// not, and that read as a broken feature: somebody accepted a Bind in Discord,
// the grant landed in the database on the click, and the binder's sheet went
// on showing them untied with nobody to Free. Three terms cover it — WHO is
// here (an arrival, a death, a hood going up or coming down), whether any of
// them is Bound or Crucified, which is what every roster here branches on, and
// how many handshakes of your own are still waiting on an answer. Deliberately
// no updatedAt on the neighbours: at a busy Location that churns on every
// resource they spend, and a print that always moves is a page that always
// refreshes.
export const dynamic = "force-dynamic";

// The status tags every people-picker on /character branches on: Bind wants
// the untied, Free and Torture the tied, Crucify anyone not already up.
const ROSTER_STATUS_SLUGS = ["bound", "crucified"];

export async function GET() {
  const session = await auth();
  if (!session?.discordUserId) return new Response("Not signed in.", { status: 401 });

  const me = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true, locationId: true, zoneId: true, resources: true, status: true, tagPoints: true },
  });
  if (!me) return new Response("No living character.", { status: 403 });

  const [tags, roomTags, roomResources, openTurn, state, here, heldStatus, offers] =
    await Promise.all([
      prisma.characterTag.findMany({
        where: { characterId: me.id },
        select: { tagId: true, quantity: true, equipped: true, equippedQuantity: true, expiresTurn: true },
        orderBy: { tagId: "asc" },
      }),
      me.locationId
        ? prisma.roomTag.aggregate({
            where: { room: { locationId: me.locationId } },
            _count: { _all: true },
            _sum: { quantity: true },
            _max: { updatedAt: true },
          })
        : null,
      me.locationId
        ? prisma.room.aggregate({ where: { locationId: me.locationId }, _sum: { resources: true } })
        : null,
      prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } }),
      prisma.gameState.findUnique({ where: { id: 1 }, select: { phase: true, nukeArmedTurn: true } }),
      // The same co-presence rule the rosters are built from, so the print and
      // the pickers can't disagree about who is standing here. A hood counts:
      // it changes what the pickers offer, and this list never leaves the
      // server.
      me.locationId
        ? prisma.character.findMany({
            where: hereWhere(me, { includeDead: true, allowConcealed: true }),
            select: { id: true, status: true, concealed: true },
            orderBy: { id: "asc" },
          })
        : [],
      // Narrowed by slug on purpose. Counting every tag your neighbours hold
      // would refresh the whole Location every time one of them ate a meal.
      me.locationId
        ? prisma.characterTag.aggregate({
            where: {
              character: { locationId: me.locationId },
              tag: { slug: { in: ROSTER_STATUS_SLUGS } },
            },
            _count: { _all: true },
          })
        : null,
      prisma.offer.count({
        where: { status: "PENDING", OR: [{ initiatorId: me.id }, { responderId: me.id }] },
      }),
    ]);

  const fp = [
    me.locationId ?? "",
    me.zoneId ?? "",
    me.resources,
    me.tagPoints,
    tags
      .map((t) => `${t.tagId}:${t.quantity}:${t.equipped ? 1 : 0}:${t.equippedQuantity}:${t.expiresTurn ?? ""}`)
      .join(","),
    roomTags?._count?._all ?? 0,
    roomTags?._sum?.quantity ?? 0,
    roomTags?._max?.updatedAt?.getTime() ?? 0,
    roomResources?._sum?.resources ?? 0,
    openTurn?.id ?? "",
    openTurn?.number ?? "",
    state?.phase ?? "",
    state?.nukeArmedTurn ?? "",
    here.map((c) => `${c.id}${c.status[0]}${c.concealed ? 1 : 0}`).join(","),
    heldStatus?._count?._all ?? 0,
    offers,
  ].join("|");

  return Response.json(
    { version: deployVersion(), fp },
    { headers: { "cache-control": "no-store" } },
  );
}
