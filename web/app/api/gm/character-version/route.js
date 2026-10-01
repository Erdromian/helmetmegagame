import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";

// GET /api/gm/character-version?id=… — "has this sheet moved?" for the Dev
// Character Panel (DevPanelPoller.js). The GM twin of /api/character-version:
// that one reads the character from the session, this one takes an id, so it
// is gated on GM membership the same way the panel itself is.
//
// A route handler rather than a server action for the reason
// /api/gm/conversation-search gives: a pending action blocks the router, and a
// poll firing every few seconds over a desk is the last thing that should.
//
// The fingerprint names the meters a turn close moves by hand rather than
// trusting Character.updatedAt, because not every writer bumps it: the mood
// pass clamps in raw SQL (db/lib/mood.js), which @updatedAt never sees.
export const dynamic = "force-dynamic";

export async function GET(request) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return new Response(null, { status: 403 });

  const id = String(new URL(request.url).searchParams.get("id") ?? "");
  if (!id) return new Response(null, { status: 400 });

  const [me, tags, openTurn, move, staged] = await Promise.all([
    prisma.character.findUnique({
      where: { id },
      select: {
        updatedAt: true,
        status: true,
        locationId: true,
        zoneId: true,
        tagPoints: true,
        mood: true,
        hungerValue: true,
        starvingSinceTurn: true,
        vampireBloodLevel: true,
        vampireHumanity: true,
      },
    }),
    prisma.characterTag.findMany({
      where: { characterId: id },
      select: { tagId: true, quantity: true, equipped: true, equippedQuantity: true, expiresTurn: true },
      orderBy: { tagId: "asc" },
    }),
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } }),
    // The band's "This turn" tile and the Turn tab.
    prisma.action.findFirst({
      where: { characterId: id, turn: { status: "OPEN" } },
      select: { id: true, moveReviewStatus: true },
    }),
    // The band's "Staged for push" tile.
    prisma.stagedEffect.count({ where: { targetCharacterId: id, appliedAt: null } }),
  ]);
  if (!me) return new Response(null, { status: 404 });

  const fp = [
    me.updatedAt.getTime(),
    me.status,
    me.locationId ?? "",
    me.zoneId ?? "",
    me.tagPoints,
    me.mood,
    me.hungerValue,
    me.starvingSinceTurn ?? "",
    me.vampireBloodLevel,
    me.vampireHumanity,
    tags
      .map((t) => `${t.tagId}:${t.quantity}:${t.equipped ? 1 : 0}:${t.equippedQuantity}:${t.expiresTurn ?? ""}`)
      .join(","),
    openTurn?.id ?? "",
    move ? `${move.id}:${move.moveReviewStatus}` : "",
    staged,
  ].join("|");

  return Response.json({ fp }, { headers: { "cache-control": "no-store" } });
}
