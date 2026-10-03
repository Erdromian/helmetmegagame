import { redirect } from "next/navigation";
import { Suspense } from "react";
import { prisma } from "@lifeweb/db";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import { getGmSession } from "@/lib/discordGuild";
import { loadFeedViewer } from "@/lib/feedAccess";
import { loadSpectatorTurn, loadSpectatorTurns } from "@/lib/spectatorActions";
import ActionsView from "./ActionsView";
import Loading from "./Skeleton";

export const metadata = { title: "Actions" };

// The spectator's record of the game (docs/systemdocs/CHAT.md §5a): every pushed turn's Moves, fights
// and Caving results, and what came of each. What may and may not be shown is web/lib/spectatorActions.js.
//
// The spectator seat only — the same `viewer.spectator` the rest of the web reads, so it follows the
// phase and steps aside for anybody playing, dead or a GM — plus any GM, to see what the watchers see.
// The nav shows the link to spectators alone, but a page is a public URL.
//
// Snapshotted (web/lib/snapshot, CHAT.md §5c), one snapshot per turn asked for.
export default async function ActionsPage({ searchParams }) {
  const viewer = await loadFeedViewer();
  if (!viewer.discordUserId) redirect("/");
  const { isGm } = await getGmSession();
  if (!viewer.spectator && !isGm) redirect("/character");

  const { turn } = await searchParams;
  const wanted = Number.parseInt(turn, 10);
  const turnNumber = Number.isInteger(wanted) && wanted > 0 ? wanted : null;
  const scope = `actions:${turnNumber ?? "latest"}`;
  return (
    <SnapshotPage scope={scope} userId={viewer.discordUserId} render={ActionsView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshActions scope={scope} userId={viewer.discordUserId} turnNumber={turnNumber} />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshActions({ scope, userId, turnNumber }) {
  const turns = await loadSpectatorTurns(prisma);
  // A number that names no pushed turn (the open one, or a typo) reads the newest instead.
  const picked = turns.find((t) => t.number === turnNumber) ?? turns[0] ?? null;
  const record = picked ? await loadSpectatorTurn(prisma, picked.id) : null;
  return <SnapshotFresh scope={scope} userId={userId} data={{ turns, record }} />;
}
