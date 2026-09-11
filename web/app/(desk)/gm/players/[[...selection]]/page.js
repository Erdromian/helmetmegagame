import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import RosterView from "../RosterView";
import Loading from "../Skeleton";
import { prisma, CATATONIC_SLUG } from "@lifeweb/db";
import { cursedUserIds } from "@lifeweb/db/lib/curse";
import { listGuildMembers } from "@/lib/discordGuild";
import { getVisibleZones } from "@/lib/gmZoneView";
import { getOpenTurn } from "@/lib/turn";

// The roster, and the desk's ONLY route.
//
// An optional catch-all (the same shape /gm/turns uses) rather than a plain
// page beside a [discordUserId] sibling, because selecting a conversation is
// no longer a navigation — it is client state (players/selection.js), and the
// URL follows it by pushState. This route therefore has to stay mounted
// whether or not somebody is open, so that closing a conversation reveals the
// roster underneath instead of an empty column.
//
// The `selection` param is deliberately unread here. It exists so
// /gm/players/<id> resolves to a real route on a cold load; who is open is
// read from the path by the selection store, and DeskMiddle draws the
// conversation over this.
//
// The heavy loads live here rather than in the layout on purpose. The tag
// catalog and the faction tree are only needed by this view, and the layout
// re-runs on every router.refresh().

// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page reads the session,
// mounts the shell, and streams FreshPlayerRoster in behind it. A browser that has
// been here before paints its last data in the first frame.
export default async function PlayerRosterPage({ searchParams }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  return (
    <SnapshotPage scope="gm-players" userId={session.discordUserId} render={RosterView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshPlayerRoster searchParams={searchParams} userId={session.discordUserId} />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshPlayerRoster({ searchParams, userId }) {
  const [tags, factions, visibleZones, openTurn, params] = await Promise.all([
    // The whole catalog, gates and all: bulk tagging is a GM grant, which
    // deliberately ignores requiredTag and the TagGroup gate (TAGS.md).
    prisma.tag.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        // For the roster's Catatonic column — the one slug this page reads.
        slug: true,
        category: true,
        description: true,
        pointCost: true,
        // ChipLabel's mastery star. A GM handing out Lucky from this picker
        // should see that they are granting a capstone.
        mastery: true,
        // The bulk-tag picker sorts chain-aware; without parentTagId the
        // chain walk degrades to plain alphabetical.
        parentTagId: true,
        group: { select: { name: true } },
      },
    }),
    prisma.faction.findMany({
      orderBy: { name: "asc" },
      include: { characters: { select: { id: true, name: true, isLeader: true } } },
    }),
    getVisibleZones(),
    getOpenTurn(),
    searchParams,
  ]);

  const [characters, members, actedCharacterIds, heldTags] = await Promise.all([
    prisma.character.findMany({
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      include: { faction: { include: { zone: true } }, zone: true },
      take: 1000,
    }),
    // Cursed is a live Discord role, not a DB field. listGuildMembers is
    // TTL-cached, so the layout having already called it costs nothing here.
    listGuildMembers(),
    // "Has this player moved yet this turn" is the single most-asked question
    // in the back half of a turn and the old table could not answer it.
    openTurn
      ? prisma.action
          .findMany({ where: { turnId: openTurn.id }, select: { characterId: true } })
          .then((rows) => new Set(rows.map((r) => r.characterId)))
      : Promise.resolve(new Set()),
    // Ids, not a count: the roster's fuzzy search matches on tag NAMES now
    // ("who is a smith", "who has Pale"), and the count falls out of the same
    // rows for free. Names come from the `tags` catalog already loaded above,
    // so this stays one query either way.
    prisma.characterTag.findMany({ select: { characterId: true, tagId: true } }),
  ]);

  const tagNameById = new Map(tags.map((t) => [t.id, t.name]));
  const tagNamesByCharacter = new Map();
  for (const ct of heldTags) {
    const name = tagNameById.get(ct.tagId);
    if (!name) continue;
    const list = tagNamesByCharacter.get(ct.characterId);
    if (list) list.push(name);
    else tagNamesByCharacter.set(ct.characterId, [name]);
  }
  // Who's AFK, from rows already in hand — heldTags is the full CharacterTag
  // table and the catalog is loaded above, so this costs no extra query.
  const catatonicTagId = tags.find((t) => t.slug === CATATONIC_SLUG)?.id ?? null;
  const catatonicCharacterIds = new Set(
    heldTags.filter((ct) => ct.tagId === catatonicTagId).map((ct) => ct.characterId),
  );
  // Who is cursed is a database question now (db/lib/curse.js), not a Discord
  // role — and the rows it reads are the ones already loaded above, so this
  // costs no extra query.
  const cursed = cursedUserIds(characters);
  // Same map PlayerRail already builds for the rail's fuzzy search — the
  // roster table gets it too, so it can find someone by Discord handle
  // without a second query.
  const memberById = new Map(members.map((m) => [m.id, m]));

  return (
    <SnapshotFresh
      scope="gm-players"
      userId={userId}
      data={{
        initialTab: params?.tab?.toString() ?? "",
        initialHighlightFactionId: params?.faction?.toString() ?? null,
        characters: characters.map((c) => ({
          id: c.id,
          discordUserId: c.discordUserId,
          name: c.name,
          roleTitle: c.roleTitle,
          factionId: c.factionId,
          factionName: c.faction?.name ?? "",
          factionZoneName: c.faction?.zone?.name ?? "",
          zoneName: c.zone?.name ?? "",
          status: c.status,
          username: memberById.get(c.discordUserId)?.username ?? "",
          globalName: memberById.get(c.discordUserId)?.globalName ?? "",
          resources: c.resources,
          cursed: cursed.has(c.discordUserId),
          catatonic: catatonicCharacterIds.has(c.id),
          tagCount: (tagNamesByCharacter.get(c.id) ?? []).length,
          tag: (tagNamesByCharacter.get(c.id) ?? []).join(" "),
          acted: actedCharacterIds.has(c.id),
          avatarVersion: c.updatedAt.getTime(),
        })),
        tags: tags,
        visibleZoneNames: visibleZones?.map((z) => z.name) ?? null,
        hasOpenTurn: Boolean(openTurn),
        factions: factions,
        factionCount: factions.length,
      }}
    />
  );
}
