import { redirect } from "next/navigation";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import MemoriesView from "./MemoriesView";
import Loading from "./Skeleton";
import { prisma } from "@lifeweb/db";
import { FEED_ROW_SELECT, withAvatarVersions } from "@lifeweb/db/lib/archive";
import { scrambleEntry, scrambleFields, scrambleText } from "@lifeweb/db/lib/memoryScramble";
import { ROLE_GROUPS } from "@lifeweb/db/lib/roleGroups";
import { createLens } from "@lifeweb/db/lib/strangers";
import { getGmSession } from "@/lib/discordGuild";
import { loadMemoryViewer, placeNames, starKey, scrambleJournal, scrambleLine } from "@/lib/memories";
import { loadMentionDirectory, loadOfferableMentions } from "@/lib/mentionDirectory";

// A character's memories (docs/systemdocs/MEMORIES.md) — five sections, and
// all of them personal: nothing here is ever a shared view. A GM reads and
// edits the same five on the Dev Panel's Memories tab instead (§8).
//
//   Friends              the people this character knows (Acquaintance)
//   Who am I?            their own PIN, seat and age
//   Memories of the day  every line they were in the room for, today (HeardLine)
//   Notes                the old Journal, the player's own writing
//   Highlights           the old Starred list
//
// The first three belong to the living character; the last two to the account,
// as they always have (PROXYING.md §7 has the Highlights half's full history).
//
// EVERYTHING IS SCRAMBLED HERE, ON THE SERVER, when the character is Concussed
// or Amnesiac (db/lib/memoryScramble.js). The real words never reach the
// browser, so there is nothing to read out of the page source.
//
// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page reads the session,
// mounts the shell, and streams FreshMemories in behind it.
export default async function MemoriesPage() {
  const { session } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  return (
    <SnapshotPage scope="memories" userId={session.discordUserId} render={MemoriesView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshMemories />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshMemories() {
  const { session } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  const discordUserId = session.discordUserId;

  const viewer = await loadMemoryViewer(discordUserId);
  const { character, state, dayNumber } = viewer;

  const [notes, journalEntries, roster, directory, entries, roles, heard] = await Promise.all([
    prisma.note.findMany({
      where: { discordUserId },
      orderBy: { sentAt: "desc" },
      include: { zone: { select: { name: true } }, character: { select: { name: true, updatedAt: true } } },
    }),
    // The player's own notes, plus any the game wrote into THIS character's
    // memory (JournalEntry.characterId — the bomb's note, docs/systemdocs/NUKE.md).
    // A note an earlier character started with stays with that character.
    prisma.journalEntry.findMany({
      where: { discordUserId, OR: [{ characterId: null }, ...(character ? [{ characterId: character.id }] : [])] },
      orderBy: { updatedAt: "desc" },
    }),
    // The Journal's two rosters — what the composer may OFFER, and what a
    // saved {char:…} draws its face against. The whole argument for keeping
    // them apart is in web/lib/mentionDirectory.js.
    loadOfferableMentions({ includeUnburiedDead: true, viewerId: character?.id ?? null }),
    loadMentionDirectory({ includeUnburiedDead: true, viewerId: character?.id ?? null }),
    character
      ? prisma.acquaintance.findMany({
          where: { ownerId: character.id },
          orderBy: [{ name: "asc" }],
          select: {
            id: true,
            subjectId: true,
            name: true,
            roleText: true,
            roleSlug: true,
            notes: true,
            source: true,
            // The face's ?v=: /api/avatar/<id> is cached for a year, so without
            // it a changed portrait never reached this list.
            subject: { select: { updatedAt: true } },
          },
        })
      : [],
    prisma.role.findMany({ select: { slug: true, groupSlug: true } }),
    character && dayNumber != null
      ? prisma.heardLine.findMany({ where: { characterId: character.id, dayNumber }, select: { seq: true } })
      : [],
  ]);

  // ---- Friends -------------------------------------------------------------
  const groupOf = new Map(roles.map((r) => [r.slug, r.groupSlug]));
  const friends = entries.map((entry) => {
    const shown = scrambleEntry(state, entry);
    // Filed by what the owner can READ. A role they cannot make out files
    // under Unknown, or the heading above it would say what the nonsense hides.
    const group = !shown.scrambled.roleText && entry.roleSlug ? (groupOf.get(entry.roleSlug) ?? null) : null;
    return {
      id: entry.id,
      name: shown.name,
      roleText: shown.roleText,
      notes: shown.notes,
      group: ROLE_GROUPS.some((g) => g.slug === group) ? group : null,
      // A face for somebody they can put a name to. Never for a scrambled
      // name — a face would give away who the nonsense is.
      faceId: entry.subjectId && !shown.scrambled.name ? entry.subjectId : null,
      faceVersion: entry.subject?.updatedAt?.getTime?.() ?? null,
      scrambled: shown.anyScrambled,
      handMade: entry.source === "MANUAL",
    };
  });

  // ---- Who am I? -----------------------------------------------------------
  const self = character
    ? {
        name: scrambleText(state, "self:name", character.name ?? "").text,
        // Every digit of the PIN is a word of its own, so a concussion leaves
        // about one digit in four.
        pin: scrambleText(state, "self:pin", character.pin ?? "", { eachChar: true }).text || null,
        roleTitle: scrambleText(state, "self:role", character.roleTitle ?? character.role?.name ?? "").text || null,
        intro: scrambleText(state, "self:intro", character.role?.intro ?? "").text || null,
        charter: (character.role?.description ?? []).map((line, i) => scrambleText(state, `self:charter:${i}`, line).text),
        age: character.age == null ? null : scrambleText(state, "self:age", String(character.age)).text,
      }
    : null;

  // ---- Memories of the day ---------------------------------------------------
  const seqs = heard.map((h) => h.seq);
  const lineRows = seqs.length
    ? await prisma.archiveEntry.findMany({
        where: { seq: { in: seqs }, deletedAt: null },
        select: FEED_ROW_SELECT,
        orderBy: { seq: "asc" },
      })
    : [];
  // Through this character's own lens: somebody they could not put a name to
  // is remembered as the alias they heard (docs/systemdocs/STRANGERS.md).
  const lens = createLens(prisma, { characterId: character?.id ?? null });
  const [shaped, names] = await Promise.all([
    withAvatarVersions(prisma, lineRows).then((rows) => lens.all(rows)),
    placeNames([...new Set(lineRows.map((r) => r.placeKey).filter(Boolean))]),
  ]);
  const day = shaped.map((row, i) => {
    const raw = lineRows[i];
    // A line with no speaker is the world talking — a shout from next door,
    // a door slamming, a GM's scene. It reads as scenery, not as a person.
    const narrated = !raw.characterId || raw.source === "SYSTEM";
    const shown = scrambleLine(state, raw.seq, row);
    return {
      seq: row.seq,
      name: narrated ? null : shown.name,
      characterId: shown.scrambled ? null : row.characterId,
      avatarPath: shown.scrambled ? null : row.avatarPath,
      unknownFace: shown.scrambled || row.unknownFace,
      avatarVersion: row.avatarVersion,
      roleGroup: shown.scrambled ? null : row.roleGroup,
      content: shown.content,
      place: names.get(raw.placeKey) ?? null,
      sentAt: row.sentAt,
      sentAtMs: raw.sentAt ? new Date(raw.sentAt).getTime() : 0,
      narrated,
      scrambled: shown.scrambled,
    };
  });

  // ---- Highlights ------------------------------------------------------------
  const starred = notes.map((n) => {
    const shown = scrambleFields(state, starKey(n.id), { characterName: n.characterName, content: n.content });
    // A concealed message was filed under its alias (see
    // bot/src/events/messageReactionAdd.js#handleStarReaction), which stores
    // characterId unconditionally even though characterName becomes the
    // alias. Rendering a face from that id would hand the starrer the identity
    // the concealment was hiding. The face the room SAW is recorded
    // (Note.presentedAvatarPath); the name comparison is the fallback for
    // notes taken before that column existed, and fails safe both ways.
    const ownFace = !n.presentedAvatarPath && n.character && n.character.name === n.characterName;
    return {
      id: n.id,
      characterName: shown.characterName,
      avatarPath: shown.scrambled ? null : (n.presentedAvatarPath ?? null),
      characterId: !shown.scrambled && ownFace ? n.characterId : null,
      avatarVersion: ownFace ? (n.character.updatedAt?.getTime?.() ?? null) : null,
      unknownFace: shown.scrambled || (!n.presentedAvatarPath && !ownFace),
      zoneName: n.zone?.name ?? null,
      content: shown.content,
      sentAt: n.sentAt.toISOString(),
      sentAtMs: n.sentAt.getTime(),
      scrambled: shown.scrambled,
    };
  });

  // ---- Notes (the Journal) ---------------------------------------------------
  const journal = journalEntries.map((e) => {
    const shown = scrambleJournal(state, e);
    return {
      id: e.id,
      title: shown.title,
      body: shown.body,
      pinned: e.pinned,
      turnNumber: e.turnNumber,
      labels: e.labels,
      updatedAt: e.updatedAt.toISOString(),
      updatedAtMs: e.updatedAt.getTime(),
      scrambled: shown.scrambled,
    };
  });

  return (
    <SnapshotFresh
      scope="memories"
      userId={discordUserId}
      data={{
        hasCharacter: Boolean(character),
        foggy: state.active,
        friends,
        self,
        day,
        starred,
        journal,
        roster,
        directory,
        currentTurnNumber: viewer.turnNumber,
      }}
    />
  );
}
