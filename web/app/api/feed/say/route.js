import { prisma, feedRowShape } from "@lifeweb/db";
import { sayInPlace } from "@lifeweb/db/lib/say";
import { touchCharacterActivity } from "@lifeweb/db/lib/characterActivity";
import { archiveContextForPlaceKey } from "@lifeweb/db/lib/placeKey";
import { auth } from "@/lib/auth";
import { loadFeedCharacter } from "@/lib/feedAccess";

// POST /api/feed/say — the web half of the send. Every gate, transform and
// identity decision lives in db/lib/say.js, the one write path the Discord
// proxy runs too; this route is the HTTP shape around it. The row is what it
// writes, and the bot's outbox is what puts it on Discord, so nothing here
// holds a Discord token.
export const dynamic = "force-dynamic";

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

export async function POST(request) {
  const session = await auth();
  if (!session?.discordUserId) return jsonResponse({ error: "Sign in first. ‡" }, 401);

  const character = await loadFeedCharacter(session.discordUserId);
  if (!character) return jsonResponse({ error: "You have no living character. ‡" }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "That didn't arrive in one piece. ‡" }, 400);
  }

  const place = typeof body?.place === "string" ? body.place : null;
  const clientId = typeof body?.clientId === "string" ? body.clientId : null;
  const content = typeof body?.content === "string" ? body.content : "";

  // The zone name and the thread name are snapshot columns on the row, so
  // /archive can still read them after a resync. Resolved from the place key
  // alone, and shaped to match exactly what the Discord proxy stamps — the
  // same scene must not render two ways depending on which face said it.
  const context = await archiveContextForPlaceKey(prisma, place);

  // The gate is inside sayInPlace — it asks db/lib/feedAccess.js#placesFor,
  // which is also what drew the composer the player typed into, so a Location
  // (scenery, no composer) is refused here too. The character it gates on is
  // the session's, never the request's.
  const said = await sayInPlace(prisma, {
    character,
    placeKey: place,
    content,
    source: "WEB",
    zoneId: context.zoneId,
    zoneName: context.zoneName,
    channelKind: context.channelKind,
    threadName: context.threadName,
  });

  if (!said.ok) {
    // A slowmode refusal is the only one with a clock on it, and the composer
    // shows the seconds rather than a flat "no".
    const status = said.retryAfter ? 429 : 403;
    return jsonResponse({ error: said.refusal, retryAfter: said.retryAfter ?? null }, status);
  }

  await touchCharacterActivity(prisma, character.id).catch(() => {});

  return jsonResponse({
    row: feedRowShape(said.row, {
      clientId,
      avatarVersion: character.updatedAt?.getTime?.() ?? null,
    }),
  });
}
