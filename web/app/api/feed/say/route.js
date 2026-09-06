import { prisma, feedRowShape } from "@lifeweb/db";
import { recordArchiveMessage } from "@lifeweb/db/lib/archive";
import { loadForcedName, loadConcealment, presentedIdentity } from "@lifeweb/db/lib/presentedIdentity";
import { blockerFor, slugsBlocking, SPEAK } from "@lifeweb/db/lib/incapacitation";
import { touchCharacterActivity } from "@lifeweb/db/lib/characterActivity";
import { parsePlaceKey } from "@lifeweb/db/lib/placeKey";
import { auth } from "@/lib/auth";
import { loadFeedCharacter, mayReadPlace } from "@/lib/feedAccess";

// POST /api/feed/say — the web half of the send. Writes the ArchiveEntry row
// and returns it; the bot's outbox is what puts it on Discord, so nothing
// here holds a Discord token.
export const dynamic = "force-dynamic";

// Discord's own ceiling, kept on this side too: the outbox has to be able to
// post whatever lands here.
const MAX_LENGTH = 2000;
// Per character, per place, both faces. Discord's channel slowmode is set to
// the same number, so a player sees one rule wherever they type.
const SLOWMODE_MS = 30_000;

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

// The speech gate, read off the DATABASE rather than a passed tag list —
// bot/src/lib/proxy.js#loadVoiceState does the same thing for the same
// reason: every caller loads a different include, and a gate that reads the
// caller's include silently passes whoever forgot a field.
const VOICE_SLUGS = slugsBlocking(SPEAK);

async function speechBlockFor(characterId) {
  const rows = await prisma.characterTag.findMany({
    where: { characterId, quantity: { gt: 0 }, tag: { slug: { in: VOICE_SLUGS } } },
    select: { tag: { select: { slug: true, name: true } } },
  });
  return blockerFor(rows, SPEAK);
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
  const content = typeof body?.content === "string" ? body.content.trim() : "";

  // The gate. The character is the session's, never the request's.
  if (!mayReadPlace(character, place)) return jsonResponse({ error: "You aren't there. ‡" }, 403);
  if (!content) return jsonResponse({ error: "There was nothing in that to say. ‡" }, 400);
  if (content.length > MAX_LENGTH) {
    return jsonResponse({ error: `That was ${content.length} characters, and the limit is ${MAX_LENGTH}. ‡` }, 400);
  }

  const block = await speechBlockFor(character.id);
  if (block) {
    // A player refused with no reason files a GM ticket about it, so the tag
    // names itself — matching the bot's own refusal word for word.
    return jsonResponse({ error: `You can't get the words out — you're ${block.name}. ‡` }, 403);
  }

  const newest = await prisma.archiveEntry.findFirst({
    where: { placeKey: place, characterId: character.id, kind: "MESSAGE", deletedAt: null },
    orderBy: { seq: "desc" },
    select: { sentAt: true },
  });
  if (newest?.sentAt) {
    const waitMs = SLOWMODE_MS - (Date.now() - newest.sentAt.getTime());
    if (waitMs > 0) {
      const seconds = Math.ceil(waitMs / 1000);
      return jsonResponse({ error: `Wait ${seconds}s before speaking again. ‡`, retryAfter: seconds }, 429);
    }
  }

  // Forced name beats concealment beats their own, exactly as the proxy path
  // resolves it (db/lib/presentedIdentity.js).
  const [forcedName, concealment] = await Promise.all([
    loadForcedName(prisma, character.id),
    loadConcealment(prisma, character.id),
  ]);
  const identity = presentedIdentity(character, { forcedName, concealment });

  const parsed = parsePlaceKey(place);
  const location =
    parsed?.kind === "loc"
      ? await prisma.location.findUnique({
          where: { id: parsed.id },
          select: { zoneId: true, zone: { select: { name: true } } },
        })
      : null;

  // TODO(phase 1): the babble and autocorrect passes postAsCharacterTo runs
  // over a Discord send are not applied here yet, so {tag:stupid} does not
  // garble a web message. They move into db/lib/say.js with the rest of the
  // write path.
  const row = await recordArchiveMessage(prisma, {
    content,
    character,
    concealedAlias: identity.alias,
    zoneId: location?.zoneId ?? null,
    zoneName: location?.zone?.name ?? null,
    channelKind: "public",
    placeKey: place,
    source: "WEB",
  });

  if (!row) return jsonResponse({ error: "That didn't get written down. Try again. ‡" }, 500);

  await touchCharacterActivity(prisma, character.id).catch(() => {});

  return jsonResponse({
    row: feedRowShape(row, {
      clientId,
      avatarVersion: character.updatedAt?.getTime?.() ?? null,
    }),
  });
}
