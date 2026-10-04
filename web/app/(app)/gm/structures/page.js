import { redirect } from "next/navigation";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import StructuresView from "./StructuresView";
import Loading from "../../Skeleton";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { placementOf, statusWord } from "@lifeweb/db/lib/structures";

// Every structure in the world, with the GM's Damage/Repair/Destroy/Clear
// verbs (docs/systemdocs/ADJUDICATION.md carries the conventions — the
// player half is a Gambit at the desk; this is where its outcome lands).
// Open to every GM, not just the superadmin: rulings happen here, and a
// tool four of five GMs can't reach is a rule only one of them remembers.
// No rail item — reachable through ⌘K, like the rest of the GM pages
// without one.
// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page reads the session,
// mounts the shell, and streams FreshStructures in behind it. A browser that has
// been here before paints its last data in the first frame.
export default async function StructuresPage() {
  const { session } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  return (
    <SnapshotPage scope="gm-structures" userId={session.discordUserId} render={StructuresView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshStructures userId={session.discordUserId} />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshStructures({ userId }) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!isGm) redirect("/character");

  const rows = await prisma.structure.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      location: { select: { name: true, zone: { select: { name: true, sortOrder: true } } } },
    },
  });

  // Crew size per site, one groupBy for the page rather than one count per
  // row — the contributor list itself lives on the desk's request card.
  const work = rows.length
    ? await prisma.structureWork.groupBy({
        by: ["structureId"],
        _count: { _all: true },
        where: { structureId: { in: rows.map((r) => r.id) } },
      })
    : [];
  const crewBySite = new Map(work.map((w) => [w.structureId, w._count._all]));

  // Which types a Damage ruling destroys outright (Tag.placement.fragile), so
  // the confirm can say so before the click rather than after it.
  const types = rows.length
    ? await prisma.tag.findMany({
        where: { slug: { in: [...new Set(rows.map((r) => r.typeSlug))] } },
        select: { slug: true, placement: true },
      })
    : [];
  const fragileSlugs = new Set(types.filter((t) => placementOf(t)?.fragile).map((t) => t.slug));

  // DTOs only — the Prisma rows carry Dates and payer keys the client table
  // has no business holding.
  const structures = rows.map((row) => ({
    id: row.id,
    zoneName: row.location?.zone?.name ?? "—",
    locationName: row.location?.name ?? "—",
    typeName: row.typeName,
    fragile: fragileSlugs.has(row.typeSlug),
    status: row.status,
    statusLabel: statusWord(row.status),
    turnsDone: row.turnsDone,
    turnsNeeded: row.turnsNeeded,
    builderName: row.builderName ?? "—",
    payerName: row.payerName ?? "—",
    resourcesCost: row.resourcesCost ?? 0,
    crew: crewBySite.get(row.id) ?? 0,
    createdAtMs: row.createdAt.getTime(),
  }));

  return (
    <SnapshotFresh
      scope="gm-structures"
      userId={userId}
      data={{
        structures: structures,
      }}
    />
  );
}
