// One-off, for a game already running when `hidden:` blocks land in
// docs/zones.yaml (docs/systemdocs/SEARCH.md §9e). Start Game poured every
// authored stack onto the floor, in plain sight; this moves what is STILL
// lying there under it, so the first person through the door no longer gets
// it for free.
//
// For each room whose YAML stash now has a `hidden:` list, and for each slug
// in it: min(on the floor, authored hidden) units move from RoomTag.quantity
// to RoomTag.hiddenQuantity. It never adds a unit — what a player already
// carried off is gone — and never touches a slug the `hidden:` list does not
// name, so a bottle somebody dropped in the Bar since stays on the shelf. It
// also rewrites Room.stashSeed to the new shape, so the GM panel reads
// "Authored, hidden" correctly and a later Restart Game seeds it hidden.
//
// DRY RUN unless given `--apply`. It changes what players can see on the
// floor mid-game, so it goes through .claude/hooks/db-guard.py's CONFIRMED=1
// gate like any other apply-flagged script. Run it once, after the migration
// that adds the column, in the same push as the YAML change.
require("dotenv").config();
const fs = require("node:fs");
const yaml = require("js-yaml");
const { prisma } = require("../../index");
const { docsPath } = require("../../lib/repoPaths");
const { parseZonesYaml } = require("../../lib/syncZones/parse");

async function main() {
  const apply = process.argv.includes("--apply");
  const parsed = parseZonesYaml(yaml.load(fs.readFileSync(docsPath("zones.yaml"), "utf8")));
  const authored = new Map();
  for (const room of parsed.roomEntries ?? []) {
    if (room.stash?.hidden?.length) authored.set(room.slug, room.stash);
  }
  if (authored.size === 0) {
    console.log("No room in docs/zones.yaml has a hidden: block. Nothing to do.");
    return;
  }

  const rooms = await prisma.room.findMany({
    where: { slug: { in: [...authored.keys()] } },
    select: {
      id: true,
      slug: true,
      name: true,
      stashSeed: true,
      tags: { select: { id: true, quantity: true, hiddenQuantity: true, tag: { select: { slug: true, name: true } } } },
    },
  });

  const moves = [];
  for (const room of rooms) {
    const seed = authored.get(room.slug);
    const already = new Map(seed.hidden.map(([slug, n]) => [slug, n]));
    for (const rt of room.tags) {
      const wanted = already.get(rt.tag.slug);
      if (!wanted) continue;
      // What is authored hidden minus what is already under the floor (a re-run moves nothing twice).
      const stillToHide = Math.max(0, wanted - (rt.hiddenQuantity ?? 0));
      const n = Math.min(rt.quantity ?? 0, stillToHide);
      if (n > 0) moves.push({ room, rt, n });
    }
  }

  for (const { room, rt, n } of moves) {
    console.log(`${room.slug} (${room.name}): ${rt.tag.name} — ${n} of ${rt.quantity} on the floor go under it`);
  }
  const seedRewrites = rooms.filter((r) => JSON.stringify(r.stashSeed?.hidden ?? []) !== JSON.stringify(authored.get(r.slug).hidden));
  for (const room of seedRewrites) console.log(`${room.slug}: stashSeed gains a hidden: list`);
  if (moves.length === 0 && seedRewrites.length === 0) {
    console.log("Nothing left on any of those floors to hide, and every seed already has its hidden: list.");
    return;
  }
  if (!apply) {
    console.log(`\nDry run: ${moves.length} stack${moves.length === 1 ? "" : "s"} would move. Re-run with --apply.`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const { rt, n } of moves) {
      // Guarded on the floor count, so a Take that landed since the read fails the move rather than driving it negative.
      const { count } = await tx.roomTag.updateMany({
        where: { id: rt.id, quantity: { gte: n } },
        data: { quantity: { decrement: n }, hiddenQuantity: { increment: n } },
      });
      if (!count) console.warn(`  skipped ${rt.tag.slug}: the floor changed under this run`);
    }
    for (const room of seedRewrites) {
      await tx.room.update({ where: { id: room.id }, data: { stashSeed: authored.get(room.slug) } });
    }
  });
  console.log(`\nMoved ${moves.length} stack${moves.length === 1 ? "" : "s"} under the floor; ${seedRewrites.length} seed${seedRewrites.length === 1 ? "" : "s"} rewritten.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
