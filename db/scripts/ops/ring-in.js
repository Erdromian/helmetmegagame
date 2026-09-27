// One-off, per environment: moves a running game onto signet rings
// (docs/systemdocs/RINGS.md). New characters get their ring at creation; this
// is the catch-up for everybody already alive.
//
//   node db/scripts/ops/ring-in.js           # dry run
//   node db/scripts/ops/ring-in.js --apply   # write
//
// Run `npm run db:sync-tags` and `npm run db:sync-roles` FIRST — the rings read
// each seat's `ring:` block off the Role table, and the Ring recipe row
// is what a minted ring takes its group from.
//
// What it does:
//   1. Every living character whose seat spawns with a ring and who has no ring
//      engraved for them gets one: minted, on their finger, registered to their
//      seat and linked to their account (opened if they had none). An office
//      seat's ring is its own named one, the only kind that seals.
//   2. The retired seat keys come out of every character's hands and every
//      room's stash. The rooms and ways still name those slugs; a ring opens
//      them now. The Collar Key goes too: the Exactor's and the Pusher's rings unlock
//      collars now. The Inn's and the Den's guest-room keys, the
//      Elevator key and the Depot keycard are NOT touched.
//   3. The fifteen wax stamps come out of hands and stashes the same way. A
//      letter already sealed keeps its wax. `npm run db:prune-tags` removes the
//      stamps' own rows afterwards, if wanted.
//   4. Everybody touched has their private-room threads recomputed (needs
//      DISCORD_TOKEN; without it the channel doctor catches up at next bot start).
//
// Safe to run again: a character who already has a ring engraved for them is
// skipped, and a second strip finds nothing to strip.
require("dotenv").config();
const { prisma } = require("../../index");
const { mintSpawnRing } = require("../../lib/ringMint");
const { syncCharacterRoomAccess } = require("../../lib/roomAccess");

const APPLY = process.argv.includes("--apply");

// The seat keys a ring replaced. Kept as tags — they are the door tokens every
// `access:` list names — but nobody holds one any more.
const RETIRED_KEYS = [
  "barons-key", "baroness-key", "heirs-key", "successors-key", "hands-key", "meisters-key",
  "censors-key", "incarns-key", "tower-key", "armory-key", "cerberus-key", "cathedral-key",
  "order-key", "sanctuary-key", "smithy-key", "soilers-key", "inn-key", "den-key",
  "exactors-key", "courtesans-key", "mortus-key", "factory-key", "bannerets-key", "collar-key",
];
const RETIRED_STAMPS = [
  "wax-seal-three-cups", "wax-seal-duo-of-saints", "wax-seal-regal-cross", "wax-seal-fleur-de-lis",
  "wax-seal-mounted-knight", "wax-seal-ox", "bannerets-wax-stamp", "barons-wax-stamp",
  "esculaps-wax-stamp", "meisters-wax-stamp", "censors-wax-stamp", "hands-wax-stamp",
  "bishops-wax-stamp", "inquisitors-wax-stamp", "merchants-wax-stamp",
];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/]+)\//)?.[1] ?? "(unparsed)";
  console.log(`DATABASE_URL host: ${host}`);
  console.log(APPLY ? "APPLY — will mint rings and strip keys and stamps" : "DRY RUN — no writes");

  const recipe = await prisma.tag.findUnique({ where: { slug: "ring" }, select: { id: true } });
  if (!recipe) console.log("  ! No ring tag — has db:sync-tags run since the Rings change landed?");
  const spawning = await prisma.role.count({ where: { ringSpawns: true } });
  if (spawning === 0) console.log("  ! No seat spawns with a ring — has db:sync-roles run since `ring:` landed?");

  // 1. Rings.
  const characters = await prisma.character.findMany({
    where: { status: "ALIVE", role: { ringSpawns: true } },
    include: { role: true },
    orderBy: { name: "asc" },
  });
  const ringed = new Set(
    (
      await prisma.tag.findMany({
        where: { ringOfCharacterId: { in: characters.map((c) => c.id) } },
        select: { ringOfCharacterId: true },
      })
    ).map((t) => t.ringOfCharacterId),
  );
  const toRing = characters.filter((c) => !ringed.has(c.id));
  console.log(`\n${toRing.length} ring(s) to mint (${characters.length - toRing.length} already have one):`);
  for (const c of toRing) {
    console.log(`- ${c.name} (${c.role.slug})${c.role.ringSealOffice ? ` — the ${c.role.ringSealOffice}'s own ring` : ""}`);
  }

  // 2 and 3. What gets stripped.
  const retired = await prisma.tag.findMany({
    where: { slug: { in: [...RETIRED_KEYS, ...RETIRED_STAMPS] } },
    select: { id: true, slug: true },
  });
  const retiredIds = retired.map((t) => t.id);
  const held = await prisma.characterTag.findMany({
    where: { tagId: { in: retiredIds } },
    select: { characterId: true, quantity: true, tag: { select: { slug: true } }, character: { select: { name: true } } },
  });
  const stashed = await prisma.roomTag.findMany({
    where: { tagId: { in: retiredIds } },
    select: { quantity: true, tag: { select: { slug: true } }, room: { select: { name: true } } },
  });
  console.log(`\n${held.length} held stack(s) to strip:`);
  for (const h of held) console.log(`- ${h.character.name}: ${h.tag.slug} ×${h.quantity}`);
  console.log(`${stashed.length} stashed stack(s) to strip:`);
  for (const s of stashed) console.log(`- ${s.room.name}: ${s.tag.slug} ×${s.quantity}`);

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to write.");
    return;
  }

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  let minted = 0;
  for (const c of toRing) {
    try {
      if (await mintSpawnRing(prisma, c, c.role, { turnNumber: openTurn?.number ?? null })) minted++;
    } catch (err) {
      console.error(`  ! ${c.name}: ${err.message ?? err}`);
    }
  }
  const strippedHeld = await prisma.characterTag.deleteMany({ where: { tagId: { in: retiredIds } } });
  const strippedStash = await prisma.roomTag.deleteMany({ where: { tagId: { in: retiredIds } } });
  console.log(`\nMinted ${minted} ring(s); stripped ${strippedHeld.count} held and ${strippedStash.count} stashed stack(s).`);

  const touched = new Set([...toRing.map((c) => c.id), ...held.map((h) => h.characterId)]);
  let synced = 0;
  for (const id of touched) {
    const row = await prisma.character.findUnique({
      where: { id },
      select: { id: true, discordUserId: true, locationId: true, status: true },
    });
    if (!row) continue;
    await syncCharacterRoomAccess(prisma, row)
      .then(() => synced++)
      .catch((err) => console.error(`  ! room access for ${id}: ${err.message ?? err}`));
  }
  console.log(`Room access recomputed for ${synced} character(s)${process.env.DISCORD_TOKEN ? "" : " (no DISCORD_TOKEN — threads left to the channel doctor)"}.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
