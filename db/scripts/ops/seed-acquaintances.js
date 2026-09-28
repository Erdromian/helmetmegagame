// One-off, per environment: gives every living character the Friends entries
// their seat knows (Role.knowsRoleSlugs) and an infoterminal PIN — the catch-up for the
// characters made before the Memories page existed
// (docs/systemdocs/MEMORIES.md §2a). New characters are seeded at creation.
//
//   node db/scripts/ops/seed-acquaintances.js           # dry run
//   node db/scripts/ops/seed-acquaintances.js --apply   # write
//
// Run `npm run db:sync-roles` FIRST, or every seat still knows nobody and this
// writes only PINs. Safe to run again: seeding skips any entry that already
// exists, so nothing a player has rewritten is touched.
require("dotenv").config();
const { prisma } = require("../../index");
const { seedAcquaintances, seedRows, LIVING } = require("../../lib/acquaintances");

const APPLY = process.argv.includes("--apply");

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/]+)\//)?.[1] ?? "(unparsed)";
  console.log(`DATABASE_URL host: ${host}`);
  console.log(APPLY ? "APPLY — will write Acquaintance rows and PINs" : "DRY RUN — no writes");

  const characters = await prisma.character.findMany({
    where: { status: { in: LIVING } },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      roleTitle: true,
      pin: true,
      role: { select: { slug: true, name: true, knowsRoleSlugs: true } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
  });
  const seatsKnowing = new Set(characters.flatMap((c) => c.role?.knowsRoleSlugs ?? []));
  console.log(`${characters.length} living character(s); ${seatsKnowing.size} seat(s) are known by somebody.`);
  if (seatsKnowing.size === 0) console.log("  ! No seat knows anybody — has db:sync-roles run since `knows:` landed?");

  const pinless = characters.filter((c) => !c.pin).length;
  // Each pair is counted from both ends here, so the dry run reports the
  // one-way figure the table will actually hold.
  let planned = 0;
  for (const character of characters) {
    const rows = seedRows(character, characters).filter((row) => row.ownerId === character.id);
    planned += rows.length;
    console.log(`- ${character.name} (${character.role?.slug ?? "no role"}): knows ${rows.length}`);
  }
  console.log(`\n${planned} entr(ies) to seed at most (existing ones are skipped); ${pinless} PIN(s) to mint.`);

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to write.");
    return;
  }

  let created = 0;
  for (const character of characters) {
    const result = await seedAcquaintances(prisma, character.id);
    created += result.created;
  }
  console.log(`\nWrote ${created} entr(ies).`);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: "system",
      actionType: "acquaintance_backfill",
      details: { characterCount: characters.length, entriesCreated: created, pinsMinted: pinless },
    },
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
