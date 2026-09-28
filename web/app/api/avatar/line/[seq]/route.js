import { prisma } from "@lifeweb/db";
import { mayReadPlace } from "@lifeweb/db/lib/feedAccess";
import { readDisguises, disguiseRead, fooledFace } from "@lifeweb/db/lib/disguises";
import { loadFeedViewer } from "@/lib/feedAccess";
import { avatarResponse, STRANGER_FACE_CACHE } from "@/lib/avatarResponse";

// The face on a line in chat, fetched by the line and not by the speaker
// (docs/systemdocs/STRANGERS.md). A line from somebody the reader cannot put a
// name to has its id taken off (db/lib/strangers.js#lensRow), but the face
// stays, since a stranger is not hiding it. It is served here to anybody who
// may read the line: somebody who can read its place now, or who was in the
// room for it (a HeardLine, which is what the day's memories read). A line said
// under a hood or a false name never gets its speaker's face here: that face is
// not theirs. A disguise's line may get somebody else's (below).
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
    select: { characterId: true, placeKey: true, concealedAlias: true, disguised: true, deletedAt: true },
  });
  const disguise = Boolean(row?.concealedAlias) && Boolean(row?.disguised);
  if (!row?.characterId || row.deletedAt || (row.concealedAlias && !disguise) || !row.placeKey) {
    return new Response("Not found", { status: 404 });
  }
  // A line said in disguise shows its reader the face of whoever the disguise
  // fools them into seeing, when the wearer looks like them (STRANGERS.md §10),
  // and nobody else any face at all.
  const faceId = disguise ? await fooledBy(viewer.character, row.concealedAlias, row.characterId) : row.characterId;
  if (!faceId) return new Response("Not found", { status: 404 });

  const heard = viewer.character
    ? await prisma.heardLine.findUnique({
        where: { characterId_seq: { characterId: viewer.character.id, seq: key } },
        select: { seq: true },
      })
    : null;
  const readable = heard || (await mayReadPlace(prisma, viewer.character, row.placeKey, viewer.options));
  if (!readable) return new Response("Not found", { status: 404 });

  return avatarResponse(faceId, { cacheControl: STRANGER_FACE_CACHE, blankPlaque: !disguise });
}

async function fooledBy(character, name, wearerId) {
  if (!character?.id) return null;
  const [reads, wearer] = await Promise.all([
    readDisguises(prisma, character.id, [name]),
    prisma.character.findUnique({ where: { id: wearerId }, select: { age: true, gender: true } }),
  ]);
  const read = disguiseRead(reads, name);
  return fooledFace(read, wearer) ? read.fooledAs : null;
}
