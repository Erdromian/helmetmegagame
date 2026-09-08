import { prisma } from "@lifeweb/db";
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
// It does NOT watch the people standing with you, and that is a decision
// rather than an oversight. Everything the sheet knows about your neighbours
// feeds a dialog and nothing else (web/lib/peoplePools.js: "every people pool
// the sheet's dialogs act on"), so a neighbour being bound, arriving or
// leaving changes not one pixel until you open something — and a dialog
// reads its own roster the moment it opens (components/actions/useRoster.js).
// Watching them here would mean a full render
// of this page, on a timer, for a change nobody can see, and thirty people at
// one Location all firing it the moment a turn moves them.
//
// The open handshakes are the exception, because those ARE on the page: "Waiting
// for Ada to agree to be bound" sits in StatusPanel until the offer leaves
// PENDING, and an answer given in Discord moves nothing else here. Not scoped
// to the open turn — the lesson pass expires every PENDING offer at the close
// (LESSONS.md §3a), so the two sets are the same set.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.discordUserId) return new Response("Not signed in.", { status: 401 });

  const me = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true, locationId: true, zoneId: true, resources: true, status: true, tagPoints: true },
  });
  if (!me) return new Response("No living character.", { status: 403 });

  const [tags, roomTags, roomResources, openTurn, state, offers] = await Promise.all([
    prisma.characterTag.findMany({
      where: { characterId: me.id },
      select: { tagId: true, quantity: true, equipped: true, expiresTurn: true },
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
    prisma.offer.count({
      where: { status: "PENDING", OR: [{ initiatorId: me.id }, { responderId: me.id }] },
    }),
  ]);

  const fp = [
    me.locationId ?? "",
    me.zoneId ?? "",
    me.resources,
    me.tagPoints,
    tags.map((t) => `${t.tagId}:${t.quantity}:${t.equipped ? 1 : 0}:${t.expiresTurn ?? ""}`).join(","),
    roomTags?._count?._all ?? 0,
    roomTags?._sum?.quantity ?? 0,
    roomTags?._max?.updatedAt?.getTime() ?? 0,
    roomResources?._sum?.resources ?? 0,
    openTurn?.id ?? "",
    openTurn?.number ?? "",
    state?.phase ?? "",
    state?.nukeArmedTurn ?? "",
    offers,
  ].join("|");

  return Response.json(
    { version: deployVersion(), fp },
    { headers: { "cache-control": "no-store" } },
  );
}
