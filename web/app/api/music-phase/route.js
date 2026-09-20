import { auth } from "@/lib/auth";
import { getMusicPhase } from "@/lib/gamePhase";

// What PhaseProvider.js polls once a minute, so a phase change reaches the music without a
// hard refresh. Signed out is a real answer here, not a 401 — the closed door has a
// soundtrack and a visitor who has not signed in is exactly who is standing at it.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const phase = await getMusicPhase(session?.discordUserId ?? null);
  return Response.json(phase, { headers: { "cache-control": "no-store" } });
}
