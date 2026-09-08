import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import PersonView from "./PersonView";
import Loading from "./Skeleton";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { getGmProfiles } from "@/lib/gmProfiles";
import { getOpenTurn } from "@/lib/turn";
import { withoutDmNoise } from "@/lib/dmThread";

const TAKE = 100;

// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page reads the session,
// mounts the shell, and streams FreshPlayerDeskPerson in behind it. A browser that has
// been here before paints its last data in the first frame.
export default async function PlayerDeskPersonPage({ params }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const { discordUserId } = await params;
  return (
    <SnapshotPage scope={`gm-player:${discordUserId}`} userId={session.discordUserId} render={PersonView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshPlayerDeskPerson params={params} userId={session.discordUserId} />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshPlayerDeskPerson({ params, userId }) {
  const { discordUserId } = await params;
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  // take one more than the page size so "there is older history" is a fact
  // rather than a guess.
  const [recent, guildMembers, character, aliveCharacter, gmProfiles, claim, openTurn, readCursor] = await Promise.all([
    prisma.directMessage.findMany({
      where: withoutDmNoise({ discordUserId }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TAKE + 1,
    }),
    listGuildMembers(),
    prisma.character.findFirst({ where: { discordUserId }, orderBy: { createdAt: "desc" } }),
    prisma.character.findFirst({
      where: { discordUserId, status: "ALIVE" },
      orderBy: { createdAt: "desc" },
      include: { zone: { select: { name: true } } },
    }),
    getGmProfiles(),
    prisma.conversationMeta.findUnique({ where: { playerDiscordUserId: discordUserId } }),
    getOpenTurn(),
    // This GM's read cursor, for the thread's NEW line. Read here, before the
    // pane's mark-read effect moves it.
    prisma.conversationRead.findUnique({
      where: {
        gmDiscordUserId_playerDiscordUserId: { gmDiscordUserId: session.discordUserId, playerDiscordUserId: discordUserId },
      },
      select: { lastReadAt: true },
    }),
  ]);
  const hasMore = recent.length > TAKE;
  const messages = recent.slice(0, TAKE).reverse();
  const username = guildMembers.find((m) => m.id === discordUserId)?.username;
  // Unknown id → 404. A guild member with no character and no conversation
  // yet is not unknown — they are exactly who a GM opens this page to
  // message first. listGuildMembers() returns [] when Discord is
  // unreachable, so this check must stay additive, not either/or.
  if (messages.length === 0 && !character && !username) notFound();
  const label = character?.name ?? username ?? discordUserId;

  // The Canon panel's payload loads inside the inspector's Canon tab
  // (players/actions.js#getPlayerCanon), since the inspector can point at
  // somebody who isn't this conversation. This route only needs the open
  // turn to link to a Move from the conversation header.
  const openMove =
    aliveCharacter && openTurn
      ? await prisma.action.findUnique({
          where: { characterId_turnId: { characterId: aliveCharacter.id, turnId: openTurn.id } },
          select: { id: true },
        })
      : null;

  return (
    <SnapshotFresh
      scope={`gm-player:${discordUserId}`}
      userId={userId}
      data={{
        discordUserId: discordUserId,
        label: label,
        characterId: aliveCharacter?.id ?? character?.id ?? null,
        avatarVersion: (aliveCharacter ?? character)?.updatedAt.getTime() ?? null,
        zoneName: aliveCharacter?.zone?.name ?? null,
        status: character && character.status !== "ALIVE" ? character.status : null,
        initialMessages: messages,
        initialHasMore: hasMore,
        gmProfiles: gmProfiles,
        myDiscordUserId: session.discordUserId,
        claimedByDiscordUserId: claim?.claimedByDiscordUserId ?? null,
        moveId: openMove?.id ?? null,
        lastReadAtMs: readCursor?.lastReadAt ? readCursor.lastReadAt.getTime() : 0,
      }}
    />
  );
}
