import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { getDevTier } from "@/lib/devAccess";
import PageShell from "@/app/components/PageShell";
import LocationForm from "./LocationForm";
import YieldPanel from "./YieldPanel";
import RoomsList from "./RoomsList";
import LinksPanel from "./LinksPanel";
import { ATTRIBUTES } from "@lifeweb/db/lib/locationAttributes";

export default async function DevLocationPage({ params }) {
  const { locationId } = await params;
  const tier = await getDevTier();
  if (tier === "none") redirect("/character");

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    include: {
      zone: { select: { id: true, name: true } },
      mining: true,
      rooms: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      linksA: { include: { b: { select: { id: true, name: true } } } },
      linksB: { include: { a: { select: { id: true, name: true } } } },
    },
  });
  if (!location) notFound();

  // Every zone a place may sit in: a CAVE_GROUP is only ever a parent, and a
  // retired zone is not somewhere to move a live place into.
  const zones = await prisma.zone.findMany({
    where: { retiredAt: null, kind: { not: "CAVE_GROUP" } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });

  const mining = location.mining ? { base: location.mining.base, current: location.mining.current } : null;
  const rooms = location.rooms.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    kind: r.kind,
    retiredAt: r.retiredAt ? r.retiredAt.toISOString() : null,
    mirrored: Boolean(r.discordThreadId),
  }));
  const links = [
    ...location.linksA.map((l) => ({ id: l.id, otherId: l.b.id, otherName: l.b.name })),
    ...location.linksB.map((l) => ({ id: l.id, otherId: l.a.id, otherName: l.a.name })),
  ];

  return (
    <>
      <PageShell width="wide">
        <p>
          <Link href={`/gm/dev/zones/${location.zone.id}`} className="menu-item">
            ← {location.zone.name}
          </Link>
        </p>
        <LocationForm
          location={{
            id: location.id,
            slug: location.slug,
            name: location.name,
            zoneId: location.zoneId,
            indoors: location.indoors,
            sortOrder: location.sortOrder,
            description: location.description,
            attributes: location.attributes ?? {},
            updatedAt: location.updatedAt.toISOString(),
          }}
          zones={zones}
          attributeSchema={Object.entries(ATTRIBUTES).map(([key, entry]) => ({
            key,
            type: entry.type ?? "boolean",
            options: entry.options ?? null,
          }))}
        />
        <YieldPanel locationId={location.id} row={mining} />
        <RoomsList locationId={location.id} rows={rooms} canSuper={tier === "super"} />
        <LinksPanel locationId={location.id} links={links} />
      </PageShell>
    </>
  );
}
