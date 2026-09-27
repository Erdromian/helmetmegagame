import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";

// GET /api/music-places — every place's id → slug, for a GM's ambience (SOUND.md §4).
//
// A GM hears the place they are looking at in Chat, and Chat's place keys are ids. What
// crosses is slugs, zone slugs and attribute names, the same things /api/music-phase sends
// a player about their own place — never a description or a stash. GM-only all the same:
// the list of rooms at each Location is the map, and a player has no business fetching it.
//
// Fetched once per page load (web/app/components/gmPlaces.js); places are authored rarely
// enough that a GM who wants a brand-new room's sound can reload.
export const dynamic = "force-dynamic";

export async function GET() {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return new Response(null, { status: 403 });

  const [zones, locations] = await Promise.all([
    prisma.zone.findMany({ select: { id: true, slug: true } }),
    prisma.location.findMany({
      select: {
        id: true,
        slug: true,
        attributes: true,
        zone: { select: { slug: true } },
        rooms: { select: { id: true, slug: true } },
      },
    }),
  ]);

  const roomLocation = {};
  const byId = {};
  for (const loc of locations) {
    const rooms = {};
    for (const r of loc.rooms) {
      rooms[r.id] = r.slug;
      roomLocation[r.id] = loc.id;
    }
    byId[loc.id] = {
      slug: loc.slug,
      zoneSlug: loc.zone?.slug ?? null,
      attributes: loc.attributes ? Object.keys(loc.attributes) : [],
      rooms,
    };
  }

  return Response.json(
    { zones: Object.fromEntries(zones.map((z) => [z.id, z.slug])), locations: byId, roomLocation },
    { headers: { "cache-control": "no-store" } },
  );
}
