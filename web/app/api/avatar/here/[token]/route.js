import { prisma } from "@lifeweb/db";
import { presentRows, resolveCrossRoomRef } from "@lifeweb/db/lib/whosHere";
import { hoodToken } from "@lifeweb/db/lib/hoodToken";
import { loadFeedViewer } from "@/lib/feedAccess";
import { avatarResponse, STRANGER_FACE_CACHE } from "@/lib/avatarResponse";

// A stranger's face in Who's here, fetched by the token the list gave it
// (docs/systemdocs/STRANGERS.md). A stranger hides nothing, so the room sees their
// face, but their id would tell the browser who they are, and that is the one
// thing a stranger is to you. The token names somebody only while they stand at
// the reader's Location, and only a stranger: a HOOD's token never gets a face
// here, because the face is what the hood covers. A stranger on the far side of a
// room that opens onto both Locations (db/lib/roomSides.js) is across the counter
// from you, so their face is served the same way.
//
// A DISGUISE (STRANGERS.md §10) never gets its wearer's face here. To a reader it
// fools, the token answers with the face of the person they take the wearer for,
// the way that person's own face reads to them. To anybody else, nothing: the list
// already gave them a plaque.
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { token } = await params;
  const viewer = await loadFeedViewer();
  const character = viewer.character;
  if (!character?.locationId || !token) return new Response("Not found", { status: 404 });

  const rows = await presentRows(prisma, character, { withSightings: true });
  const hit = rows.find((c) => hoodToken(c.id, c.presenceNonce) === token && faceOf(c));
  const face = hit ? faceOf(hit) : await faceOverTheCounter(character, token);
  if (!face) return new Response("Not found", { status: 404 });
  return avatarResponse(face.id, { cacheControl: STRANGER_FACE_CACHE, blankPlaque: face.blankPlaque });
}

// Whose face this row shows the reader, or null for none.
function faceOf(row) {
  if (row.disguise) return row.disguise.fooledAs ? { id: row.disguise.fooledAs, blankPlaque: false } : null;
  return row.stranger ? { id: row.id, blankPlaque: true } : null;
}

async function faceOverTheCounter(character, token) {
  const far = await resolveCrossRoomRef(prisma, character, token);
  return far ? faceOf(far) : null;
}
