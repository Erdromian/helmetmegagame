#!/usr/bin/env node
// A one-off, for the sync that splits Customs and the Depot back into two
// Locations. Run it ONCE, on the live database, BEFORE `npm run db:sync-zones`.
//
//   npm run db:rename-depot-rooms              # dry run
//   npm run db:rename-depot-rooms -- --apply   # actually rename
//
// Why it exists. The four shop rooms move from `customs` to the new `depot`
// Location and take a `depot-` stem with them, because a Room's id is always
// `<location-stem>-<room>` (docs/zones.yaml). But db/lib/syncZones.js matches
// rooms BY SLUG at pass 1c-bis and prunes anything unmatched at pass 4 — so a
// slug that changes in the YAML alone reads as "one room deleted, one created".
// That prune is a real delete, and it would take with it:
//
//   - the Cargo Bay's RoomTag stacks, which ARE The Company's faction treasury
//     (Faction.siloRoomId points at the row; FACTIONS.md §3, and RoomTag is
//     onDelete: Cascade)
//   - every stash in the other three rooms
//   - the archive, since ArchiveEntry.placeKey stores `room:<cuid>` and a
//     recreated room gets a new cuid (db/lib/placeKey.js)
//
// Renaming the rows first means the sync sees four rooms whose locationId
// changed instead. That path (syncZones.js, the `roomsMoved` branch) deletes
// and recreates only the Discord THREAD — which is unavoidable either way,
// since a thread cannot be reparented — and keeps the row, its cuid, its stash
// and the silo pointer.
//
// Safe to run twice: a room already renamed is reported as done and skipped.
// Nothing here touches Discord.
const { prisma } = require("../../index");

const RENAMES = [
  ["customs-storefront", "depot-storefront"],
  ["customs-landing-pad", "depot-landing-pad"],
  ["customs-merchants-office", "depot-merchants-office"],
  ["customs-cargo-bay", "depot-cargo-bay"],
];

async function main() {
  const apply = process.argv.includes("--apply");
  let renamable = 0;
  let done = 0;
  let missing = 0;

  for (const [from, to] of RENAMES) {
    const old = await prisma.room.findUnique({
      where: { slug: from },
      select: { id: true, name: true, resources: true, _count: { select: { tags: true } } },
    });
    if (!old) {
      // Either this already ran, or the room was never there.
      const already = await prisma.room.findUnique({ where: { slug: to }, select: { id: true } });
      if (already) {
        done += 1;
        console.log(`  ${to} — already renamed, skipping`);
      } else {
        missing += 1;
        console.log(`  ${from} — NOT FOUND, and no ${to} either`);
      }
      continue;
    }
    // A pre-existing row on the target slug would make the rename a unique
    // violation. Say so rather than throwing halfway through the list.
    const clash = await prisma.room.findUnique({ where: { slug: to }, select: { id: true } });
    if (clash) {
      missing += 1;
      console.log(`  ${from} -> ${to} — REFUSED, ${to} already exists as a different room`);
      continue;
    }
    renamable += 1;
    const carried = `${old.resources} ⬢, ${old._count.tags} item stack(s)`;
    console.log(`  ${from} -> ${to}  (${old.name}; carries ${carried})`);
    if (apply) await prisma.room.update({ where: { id: old.id }, data: { slug: to } });
  }

  console.log(
    `\n${apply ? "Renamed" : "Would rename"} ${renamable} room(s); ${done} already done; ${missing} problem(s).`,
  );
  if (missing > 0) process.exitCode = 1;
  if (!apply && renamable > 0) {
    console.log("Dry run. Re-run with `-- --apply`, then run `npm run db:sync-zones`.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
