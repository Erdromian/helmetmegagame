import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { resourcesOf, withoutResources } from "@lifeweb/db/lib/resourceStack";
import { getDevTier } from "@/lib/devAccess";
import PageShell from "@/app/components/PageShell";
import RoomForm from "./RoomForm";
import StashPanel from "./StashPanel";
import SidesPanel from "./SidesPanel";

export default async function DevRoomPage({ params }) {
  const { roomId } = await params;
  const tier = await getDevTier();
  if (tier === "none") redirect("/character");

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      location: { select: { id: true, name: true, zone: { select: { name: true } } } },
      tags: { include: { tag: { select: { id: true, slug: true, name: true } } }, orderBy: { createdAt: "asc" } },
      sides: {
        orderBy: { createdAt: "asc" },
        include: { location: { select: { name: true, zone: { select: { name: true } } } } },
      },
    },
  });
  if (!room) notFound();
  // Every Location it could be made to open onto (db/lib/roomSides.js).
  const locations = await prisma.location.findMany({
    where: { retiredAt: null, id: { not: room.locationId } },
    orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    select: { id: true, name: true, zone: { select: { name: true } } },
  });

  // ⬢ come out of the item list and go to the chip above it — they are a
  // stack row like everything else now, and a GM reading "12 ⬢" over a
  // "Resources ×12" line would reasonably think the room held both.
  const stash = withoutResources(room.tags)
    .map((rt) => ({ id: rt.id, tagId: rt.tag.id, slug: rt.tag.slug, name: rt.tag.name, quantity: rt.quantity, hiddenQuantity: rt.hiddenQuantity }));
  // Under the floor (SEARCH.md §9): shown beside the visible ⬢, never summed into it.
  const hiddenResources = room.tags.find((rt) => rt.tag.slug === "resources")?.hiddenQuantity ?? 0;

  return (
    <>
      <PageShell width="wide">
        <p>
          <Link href={`/gm/dev/zones/locations/${room.location.id}`} className="menu-item">
            ← {room.location.zone.name} · {room.location.name}
          </Link>
        </p>
        <RoomForm
          homeName={room.location.name}
          room={{
            id: room.id,
            slug: room.slug,
            name: room.name,
            kind: room.kind,
            sortOrder: room.sortOrder,
            description: room.description,
            soundproof: room.soundproof,
            destroysContents: room.destroysContents,
            phone: room.phone,
            payphone: room.payphone,
            phoneNumber: room.phoneNumber,
            vendingMachine: room.vendingMachine,
            accessTagSlugs: room.accessTagSlugs.join(", "),
            updatedAt: room.updatedAt.toISOString(),
          }}
        />
        <SidesPanel
          roomId={room.id}
          homeName={room.location.name}
          sides={room.sides.map((side) => ({
            id: side.id,
            locationId: side.locationId,
            locationName: `${side.location.zone.name} · ${side.location.name}`,
            accessTagSlugs: side.accessTagSlugs.join(", "),
            sortOrder: side.sortOrder,
            hasThread: Boolean(side.discordThreadId),
            updatedAt: side.updatedAt.toISOString(),
          }))}
          locations={locations.map((l) => ({ id: l.id, name: l.name, zoneName: l.zone.name }))}
        />
        <StashPanel
          roomId={room.id}
          resources={resourcesOf(room)}
          hiddenResources={hiddenResources}
          stash={stash}
          seededStashSlugs={room.seededStashSlugs}
          stashSeed={room.stashSeed ?? null}
          destroysContents={room.destroysContents}
          canSuper={tier === "super"}
        />
      </PageShell>
    </>
  );
}
