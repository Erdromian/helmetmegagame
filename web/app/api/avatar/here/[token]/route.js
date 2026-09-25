import { prisma } from "@lifeweb/db";
import { presentRows } from "@lifeweb/db/lib/whosHere";
import { hoodToken } from "@lifeweb/db/lib/hoodToken";
import { loadFeedViewer } from "@/lib/feedAccess";
import { avatarResponse, STRANGER_FACE_CACHE } from "@/lib/avatarResponse";

// A stranger's face in Who's here, fetched by the token the list gave it
// (docs/systemdocs/STRANGERS.md). A stranger hides nothing, so the room sees their
// face, but their id would tell the browser who they are, and that is the one
// thing a stranger is to you. The token names somebody only while they stand at
// the reader's Location, and only a stranger: a HOOD's token never gets a face
// here, because the face is what the hood covers.
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { token } = await params;
  const viewer = await loadFeedViewer();
  const character = viewer.character;
  if (!character?.locationId || !token) return new Response("Not found", { status: 404 });

  const rows = await presentRows(prisma, character, { withSightings: true });
  const hit = rows.find((c) => c.stranger && hoodToken(c.id, c.presenceNonce) === token);
  if (!hit) return new Response("Not found", { status: 404 });
  return avatarResponse(hit.id, { cacheControl: STRANGER_FACE_CACHE, blankPlaque: true });
}
