import { prisma } from "@lifeweb/db";
import { mayReadPlace } from "@lifeweb/db/lib/feedAccess";
import { loadFeedViewer } from "@/lib/feedAccess";
import { avatarResponse, STRANGER_FACE_CACHE } from "@/lib/avatarResponse";

// The face on a line in chat, fetched by the line and not by the speaker
// (docs/systemdocs/STRANGERS.md). A line from somebody the reader cannot put a
// name to has its id taken off (db/lib/strangers.js#lensRow), but the face
// stays, since a stranger is not hiding it. It is served here to anybody who
// may read the line: somebody who can read its place now, or who was in the
// room for it (a HeardLine, which is what the day's memories read). A line said
// under a hood or a false name never gets a face here: that face is not theirs.
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { seq } = await params;
  let key;
  try {
    key = BigInt(seq);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const viewer = await loadFeedViewer();
  if (!viewer.discordUserId) return new Response("Not found", { status: 404 });

  const row = await prisma.archiveEntry.findUnique({
    where: { seq: key },
    select: { characterId: true, placeKey: true, concealedAlias: true, deletedAt: true },
  });
  if (!row?.characterId || row.deletedAt || row.concealedAlias || !row.placeKey) {
    return new Response("Not found", { status: 404 });
  }

  const heard = viewer.character
    ? await prisma.heardLine.findUnique({
        where: { characterId_seq: { characterId: viewer.character.id, seq: key } },
        select: { seq: true },
      })
    : null;
  const readable = heard || (await mayReadPlace(prisma, viewer.character, row.placeKey, viewer.options));
  if (!readable) return new Response("Not found", { status: 404 });

  return avatarResponse(row.characterId, { cacheControl: STRANGER_FACE_CACHE, blankPlaque: true });
}
