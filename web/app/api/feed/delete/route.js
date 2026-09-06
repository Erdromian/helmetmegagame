import { prisma } from "@lifeweb/db";
import { deleteSpeech } from "@lifeweb/db/lib/say";
import { auth } from "@/lib/auth";
import { loadFeedCharacter } from "@/lib/feedAccess";

// POST /api/feed/delete { seq } — take back something you said, inside the
// five-minute window. Soft: the row stays with a `deletedAt` so a browser
// holding it can reconcile and the outbox has something to read when it goes
// to remove the Discord message.
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

  const seq = typeof body?.seq === "string" || typeof body?.seq === "number" ? String(body.seq) : null;

  const result = await deleteSpeech(prisma, { characterId: character.id, seq });
  if (!result?.ok) return jsonResponse({ error: result?.refusal ?? "That didn't go. ‡" }, 403);

  return jsonResponse({
    seq: String(result.row.seq),
    deletedAt: result.row.deletedAt ? new Date(result.row.deletedAt).toISOString() : null,
  });
}
