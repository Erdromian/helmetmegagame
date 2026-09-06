import { redirect } from "next/navigation";
import { prisma, feedRowShape, FEED_ROW_SELECT, placeKeyForLocation } from "@lifeweb/db";
import { loadForcedName, loadConcealment, presentedIdentity } from "@lifeweb/db/lib/presentedIdentity";
import { auth } from "@/lib/auth";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import EmptyState from "@/app/components/EmptyState";
import PlayFeed from "./PlayFeed";

// /play — the web face of a Location's channel. Phase 0 of docs' Hall design:
// the scene you are standing in, and one box to speak into it. No rooms, no
// conversations, no people column yet.
//
// The rows are rendered on the server so the page has something to show
// before any JavaScript runs; everything after that arrives on the SSE
// stream PlayFeed opens.
export const dynamic = "force-dynamic";

const HISTORY_ROWS = 100;

export default async function PlayPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      concealed: true,
      age: true,
      gender: true,
      updatedAt: true,
      locationId: true,
      location: { select: { id: true, name: true, description: true } },
    },
  });

  if (!character?.location) {
    return (
      <PageShell width="default">
        <PageHeader title="Play ‡" />
        <div className="panel">
          <EmptyState>You are nowhere yet. ‡</EmptyState>
        </div>
      </PageShell>
    );
  }

  const place = placeKeyForLocation(character.location.id);

  const [rows, forcedName, concealment] = await Promise.all([
    prisma.archiveEntry.findMany({
      where: { placeKey: place, deletedAt: null },
      orderBy: { seq: "desc" },
      take: HISTORY_ROWS,
      select: FEED_ROW_SELECT,
    }),
    loadForcedName(prisma, character.id),
    loadConcealment(prisma, character.id),
  ]);

  // The name this character's own optimistic rows wear before the server
  // answers — forced beats concealed beats their own, the same resolution the
  // send route does, so an optimistic row never shows a name the confirmed
  // one will not.
  const identity = presentedIdentity(character, { forcedName, concealment });

  return (
    <PageShell width="default">
      <PageHeader title={character.location.name} subtitle={character.location.description || null} />
      <PlayFeed
        place={place}
        placeName={character.location.name}
        initialRows={rows.reverse().map((row) => feedRowShape(row))}
        self={{
          characterId: character.id,
          name: identity.name,
          avatarVersion: character.updatedAt?.getTime?.() ?? null,
        }}
      />
    </PageShell>
  );
}
