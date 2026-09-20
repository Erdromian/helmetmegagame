// Pouring a room's AUTHORED stash into the room, exactly once per game.
//
// Two callers, one behaviour on purpose. `Start Game` seeds every room in the
// game in one pass (db/lib/lobby.js), and the "Seed these items now" box on
// /gm/dev/zones seeds one room by hand. Both come through here, so a fix to
// how seeding works cannot land on one and miss the other.
//
// THE GUARD IS `Room.seededStashSlugs`, and it is the whole point. The old
// test was "does a RoomTag row exist", which cannot tell "emptied" from
// "never seeded" — taking the last unit deletes the row — so every re-sync
// refilled a looted room. That cost a live game 139 duplicated items on
// 2026-09-10. A slug written into seededStashSlugs is never seeded again, by
// anybody, for the rest of that game, so a player who carries the anvil off
// keeps it.
//
// The one thing that clears the column is the Restart Game wipe, which does it
// in the same transaction that deletes every RoomTag
// (web/app/(app)/gm/dev/actions.js). That is deliberate and it is not a hole:
// the rows and the history of them go together, so the NEXT game starts
// furnished. Before it, the guard outlived its game and every restart opened
// with bare rooms.
//
// Takes `prisma` as a parameter for the db/lib/dm.js reason, and is
// deliberately NOT on the @lifeweb/db barrel; require it by path.

// `{ resources, items: [[slug, quantity], ...] }`, the shape
// db/lib/syncZones/parse.js#parseStash normalises a `stash:` block into, and
// the shape Room.stashSeed stores. Resources are a tag like any other
// (docs/tags.yaml `resources`), so they flatten into the same list.
function stashSeedEntries(seed) {
  if (!seed || typeof seed !== "object") return [];
  const out = [];
  const resources = Number(seed.resources ?? 0);
  if (Number.isInteger(resources) && resources > 0) out.push(["resources", resources]);
  for (const pair of seed.items ?? []) {
    const [slug, quantity] = Array.isArray(pair) ? pair : [pair, 1];
    const n = Number(quantity ?? 1);
    if (slug && Number.isInteger(n) && n > 0) out.push([String(slug), n]);
  }
  return out;
}

// One room. `entries` is [[slug, quantity], ...]; anything already in
// `room.seededStashSlugs` is dropped before a single row is written.
//
// Returns { seeded, skipped, unknown } — `unknown` is slugs with no Tag row,
// which is a REPORT rather than a throw here, because a zone import runs
// before db:sync-tags in the working order (SYNC.md) and one bad slug should
// not cost the other eighty rooms their contents. The editor turns a
// non-empty `unknown` into a UserError itself, where a typo is worth saying.
async function seedRoomStashRows(prisma, room, entries) {
  const already = new Set(room.seededStashSlugs ?? []);
  const toSeed = entries.filter(([slug]) => !already.has(slug));
  if (toSeed.length === 0) return { seeded: 0, skipped: entries.length, unknown: [] };

  const tags = await prisma.tag.findMany({ where: { slug: { in: toSeed.map(([slug]) => slug) } } });
  const bySlug = new Map(tags.map((t) => [t.slug, t]));
  const unknown = toSeed.filter(([slug]) => !bySlug.has(slug)).map(([slug]) => slug);
  const known = toSeed.filter(([slug]) => bySlug.has(slug));
  if (known.length === 0) return { seeded: 0, skipped: entries.length - unknown.length, unknown };

  // The slug goes into seededStashSlugs in the same transaction as its row, so
  // a crash between the two cannot leave a room that gets seeded twice.
  await prisma.$transaction([
    ...known.map(([slug, quantity]) =>
      prisma.roomTag.upsert({
        where: { roomId_tagId: { roomId: room.id, tagId: bySlug.get(slug).id } },
        update: { quantity: { increment: quantity } },
        create: { roomId: room.id, tagId: bySlug.get(slug).id, quantity },
      }),
    ),
    prisma.room.update({
      where: { id: room.id },
      data: { seededStashSlugs: [...already, ...known.map(([slug]) => slug)] },
    }),
  ]);
  return { seeded: known.length, skipped: entries.length - toSeed.length, unknown };
}

// Every room in the game that has an authored stash it has not been given
// yet. This is what Start Game calls, and it is safe to call again: a second
// run finds every slug already in seededStashSlugs and writes nothing.
async function seedAuthoredStashes(prisma) {
  const rooms = await prisma.room.findMany({
    where: { NOT: { stashSeed: { equals: null } } },
    select: { id: true, slug: true, seededStashSlugs: true, stashSeed: true },
  });
  const report = { rooms: 0, items: 0, unknown: [] };
  for (const room of rooms) {
    const entries = stashSeedEntries(room.stashSeed);
    if (entries.length === 0) continue;
    const out = await seedRoomStashRows(prisma, room, entries);
    if (out.seeded > 0) {
      report.rooms += 1;
      report.items += out.seeded;
    }
    for (const slug of out.unknown) report.unknown.push(`${room.slug}: ${slug}`);
  }
  return report;
}

module.exports = { stashSeedEntries, seedRoomStashRows, seedAuthoredStashes };
