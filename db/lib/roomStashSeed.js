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

// `{ resources, items: [[slug, quantity], ...], hidden: [[slug, quantity], ...] }`,
// the shape db/lib/syncZones/parse.js#parseStash normalises a `stash:` block
// into, and the shape Room.stashSeed stores. Resources are a tag like any
// other (docs/tags.yaml `resources`), so they flatten into the same list.
//
// Returns [[slug, quantity, hiddenQuantity], ...] — ONE entry per slug, with
// the visible and the under-the-floor counts side by side (SEARCH.md §9). One
// entry rather than two because seededStashSlugs is keyed by slug: a slug
// named in both `items:` and `hidden:` is poured once, as one row with both
// counts, and never again.
function stashSeedEntries(seed) {
  if (!seed || typeof seed !== "object") return [];
  const bySlug = new Map();
  const add = (slug, quantity, hidden) => {
    const key = String(slug);
    const cur = bySlug.get(key) ?? [key, 0, 0];
    cur[1] += quantity;
    cur[2] += hidden;
    bySlug.set(key, cur);
  };
  const resources = Number(seed.resources ?? 0);
  if (Number.isInteger(resources) && resources > 0) add("resources", resources, 0);
  for (const pair of seed.items ?? []) {
    const [slug, quantity] = Array.isArray(pair) ? pair : [pair, 1];
    const n = Number(quantity ?? 1);
    if (slug && Number.isInteger(n) && n > 0) add(slug, n, 0);
  }
  for (const pair of seed.hidden ?? []) {
    const [slug, quantity] = Array.isArray(pair) ? pair : [pair, 1];
    const n = Number(quantity ?? 1);
    if (slug && Number.isInteger(n) && n > 0) add(slug, 0, n);
  }
  return [...bySlug.values()];
}

// One room. `entries` is [[slug, quantity, hiddenQuantity?], ...]; anything
// already in `room.seededStashSlugs` is dropped before a single row is
// written.
//
// Returns { seeded, skipped, unknown } — `unknown` is slugs with no Tag row,
// which is a REPORT rather than a throw here, because a zone import runs
// before db:sync-tags in the working order (SYNC.md) and one bad slug should
// not cost the other eighty rooms their contents. The editor turns a
// non-empty `unknown` into a UserError itself, where a typo is worth saying.
//
// A room that eats what is put into it (Room.destroysContents — the Godard
// Factory's Spillway) may hold nothing hidden: a trough with a false bottom
// would be the one stash in the game a Search could take from a place Take
// cannot. Reported as `refusedHidden`, and those entries seed nothing.
async function seedRoomStashRows(prisma, room, entries) {
  const already = new Set(room.seededStashSlugs ?? []);
  const refusedHidden = room.destroysContents ? entries.filter(([, , hidden]) => (hidden ?? 0) > 0).map(([slug]) => slug) : [];
  const toSeed = entries.filter(([slug, , hidden]) => !already.has(slug) && !(room.destroysContents && (hidden ?? 0) > 0));
  if (toSeed.length === 0) return { seeded: 0, skipped: entries.length, unknown: [], refusedHidden };

  const tags = await prisma.tag.findMany({ where: { slug: { in: toSeed.map(([slug]) => slug) } } });
  const bySlug = new Map(tags.map((t) => [t.slug, t]));
  const unknown = toSeed.filter(([slug]) => !bySlug.has(slug)).map(([slug]) => slug);
  const known = toSeed.filter(([slug]) => bySlug.has(slug));
  if (known.length === 0) return { seeded: 0, skipped: entries.length - unknown.length, unknown, refusedHidden };

  // The slug goes into seededStashSlugs in the same transaction as its row, so
  // a crash between the two cannot leave a room that gets seeded twice.
  await prisma.$transaction([
    ...known.map(([slug, quantity, hidden]) => {
      const visible = Math.max(0, Math.trunc(quantity ?? 0));
      const under = Math.max(0, Math.trunc(hidden ?? 0));
      return prisma.roomTag.upsert({
        where: { roomId_tagId: { roomId: room.id, tagId: bySlug.get(slug).id } },
        update: { quantity: { increment: visible }, hiddenQuantity: { increment: under } },
        create: { roomId: room.id, tagId: bySlug.get(slug).id, quantity: visible, hiddenQuantity: under },
      });
    }),
    prisma.room.update({
      where: { id: room.id },
      data: { seededStashSlugs: [...already, ...known.map(([slug]) => slug)] },
    }),
  ]);
  return { seeded: known.length, skipped: entries.length - toSeed.length, unknown, refusedHidden };
}

// Every room in the game that has an authored stash it has not been given
// yet. This is what Start Game calls, and it is safe to call again: a second
// run finds every slug already in seededStashSlugs and writes nothing.
//
// A retired room is skipped. The Restart Game wipe clears every room's seed
// history, so without this a retired room was filled again on every restart,
// with items nobody could reach.
async function seedAuthoredStashes(prisma) {
  const rooms = await prisma.room.findMany({
    where: { retiredAt: null, NOT: { stashSeed: { equals: null } } },
    select: { id: true, slug: true, seededStashSlugs: true, stashSeed: true, destroysContents: true },
  });
  const report = { rooms: 0, items: 0, unknown: [], refusedHidden: [] };
  for (const room of rooms) {
    const entries = stashSeedEntries(room.stashSeed);
    if (entries.length === 0) continue;
    const out = await seedRoomStashRows(prisma, room, entries);
    if (out.seeded > 0) {
      report.rooms += 1;
      report.items += out.seeded;
    }
    for (const slug of out.unknown) report.unknown.push(`${room.slug}: ${slug}`);
    for (const slug of out.refusedHidden ?? []) report.refusedHidden.push(`${room.slug}: ${slug}`);
  }
  return report;
}

module.exports = { stashSeedEntries, seedRoomStashRows, seedAuthoredStashes };
