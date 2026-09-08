import { redirect } from "next/navigation";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import NotesView from "./NotesView";
import Loading from "./Skeleton";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";

// Notes are personal — a player's own Journal and their own list of messages
// they've starred, never a shared/GM view. Each signed-in user only ever
// sees rows keyed to their own discordUserId. See docs/systemdocs/
// PROXYING.md §7 for the Starred half's full history, and this file's own
// comments below for the two disclosure rules the Journal half has to obey.
// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page reads the session,
// mounts the shell, and streams FreshNotes in behind it. A browser that has
// been here before paints its last data in the first frame.
export default async function NotesPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  return (
    <SnapshotPage scope="notes" userId={session.discordUserId} render={NotesView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshNotes />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshNotes() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const [notes, journalEntries, roster, openTurn] = await Promise.all([
    prisma.note.findMany({
      where: { discordUserId: session.discordUserId },
      orderBy: { sentAt: "desc" },
      include: { zone: { select: { name: true } }, character: { select: { name: true } } },
    }),
    prisma.journalEntry.findMany({
      where: { discordUserId: session.discordUserId },
      orderBy: { updatedAt: "desc" },
    }),
    // The @mention roster: every character a player may currently see stood
    // somewhere, alive or freshly dead — mirrors character/page.js's own
    // zoneRoster precedent. This is the ONE roster query, reused for both the
    // composer's autocomplete AND resolving a saved {char:<id>} token: an
    // entry can only ever mention a character its author was allowed to see
    // in the autocomplete in the first place, so there is nothing a second,
    // narrower lookup could withhold that this one doesn't already carry.
    // Crucially, this is also what keeps a buried character's death from
    // leaking by omission (CHARACTERS.md §5) — a dead-and-buried character is
    // simply absent from the list, exactly like every other roster in the app.
    prisma.character.findMany({
      where: { OR: [{ status: "ALIVE" }, { status: "DEAD", buriedAt: null }] },
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      select: { id: true, name: true, updatedAt: true },
    }),
    getOpenTurn(),
  ]);

  const starred = notes.map((n) => ({
    id: n.id,
    characterName: n.characterName,
    // A concealed message was filed under its alias (see
    // bot/src/events/messageReactionAdd.js#handleStarReaction), which stores
    // characterId unconditionally even though characterName becomes the
    // alias. Rendering a face from that id would hand the starrer the identity
    // the concealment was hiding.
    //
    // The face the room actually SAW is recorded now
    // (Note.presentedAvatarPath), so an aliased note draws the mask or plaque
    // it was heard under and never asks /api/avatar at all. The name
    // comparison behind it is the fallback for notes taken before that column
    // existed: it fails safe in both directions, since a merely-renamed
    // character loses its face here rather than gaining somebody else's — and
    // when it does fail, the plate says so instead of the wrong person.
    avatarPath: n.presentedAvatarPath ?? null,
    characterId:
      !n.presentedAvatarPath && n.character && n.character.name === n.characterName ? n.characterId : null,
    unknownFace: !n.presentedAvatarPath && !(n.character && n.character.name === n.characterName),
    zoneName: n.zone?.name ?? null,
    content: n.content,
    sentAt: n.sentAt.toISOString(),
    // Numeric twin of sentAt, so the shared table state sorts on a number
    // rather than re-parsing a date string per comparison.
    sentAtMs: n.sentAt.getTime(),
  }));

  const journal = journalEntries.map((e) => ({
    id: e.id,
    title: e.title,
    body: e.body,
    pinned: e.pinned,
    turnNumber: e.turnNumber,
    labels: e.labels,
    updatedAt: e.updatedAt.toISOString(),
    updatedAtMs: e.updatedAt.getTime(),
  }));

  const mentionRoster = roster.map((c) => ({ id: c.id, name: c.name, updatedAt: c.updatedAt.getTime() }));

  return (
    <SnapshotFresh
      scope="notes"
      userId={session.discordUserId}
      data={{
        starred: starred,
        journal: journal,
        roster: mentionRoster,
        currentTurnNumber: openTurn?.number ?? null,
      }}
    />
  );
}
