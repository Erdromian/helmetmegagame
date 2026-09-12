// One-off: grants the Taxman tag to every already-ALIVE Headman and Meister
// — the catch-up for the two seats that now start with it
// (docs/roles.yaml's starting_tags) but were already playing before this
// landed. Nothing in the ordinary turn machinery would ever touch their tag
// list otherwise.
//
//   node db/scripts/ops/grant-taxman.js           # dry run
//   node db/scripts/ops/grant-taxman.js --apply   # write + DM
//
// Dry-run-by-default with an --apply flag, matching db:prune-tags and the
// rest of db/scripts/ops/.
//
// Grants through addToStack (db/lib/tagWrites.js) — the one module allowed
// to write CharacterTag rows, the same rule seedMemories follows for
// LocationVisit.
require("dotenv").config();
const { prisma } = require("../../index");
const { addToStack } = require("../../lib/tagWrites");
const { sendDm } = require("../../lib/dm");

const APPLY = process.argv.includes("--apply");
const DM_TEXT = "You now have a tax button.";
const ROLE_SLUGS = ["headman", "meister"];
const TAXMAN_SLUG = "taxman";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/]+)\//)?.[1] ?? "(unparsed)";
  console.log(`DATABASE_URL host: ${host}`);
  console.log(APPLY ? "APPLY — will write the Taxman tag and DM players" : "DRY RUN — no writes");

  const tag = await prisma.tag.findUnique({ where: { slug: TAXMAN_SLUG }, select: { id: true, stackable: true } });
  if (!tag) {
    console.error(`Taxman grant skipped: no "${TAXMAN_SLUG}" tag — run npm run db:sync-tags.`);
    return;
  }

  const characters = await prisma.character.findMany({
    where: { status: "ALIVE", role: { slug: { in: ROLE_SLUGS } } },
    select: {
      id: true,
      name: true,
      discordUserId: true,
      role: { select: { slug: true } },
      tags: { select: { tagId: true } },
    },
  });

  console.log(`${characters.length} ALIVE character(s) across ${ROLE_SLUGS.join(", ")}.`);

  const dmTargets = new Map();
  let touched = 0;

  for (const character of characters) {
    const already = character.tags.some((ct) => ct.tagId === tag.id);
    if (already) {
      console.log(`- ${character.name} (${character.role.slug}): already has it`);
      continue;
    }
    console.log(`- ${character.name} (${character.role.slug}): granting Taxman`);
    if (!APPLY) continue;

    await prisma.$transaction((tx) => addToStack(tx, character.id, tag.id, 1, { source: "GM_GRANT", stackable: tag.stackable }));
    touched += 1;
    if (character.discordUserId) dmTargets.set(character.discordUserId, character.name);
  }

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to write and DM.");
    return;
  }

  console.log(`\nGranted Taxman to ${touched} character(s).`);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: "system",
      actionType: "taxman_backfill",
      details: { roles: ROLE_SLUGS, characterCount: touched, why: "Taxman added to Headman/Meister starting_tags" },
    },
  });

  // Post-commit and best-effort, same as the factory-road backfill: a
  // Discord outage must not undo the grant.
  for (const [discordUserId, name] of dmTargets) {
    await sendDm(prisma, discordUserId, DM_TEXT).catch((err) =>
      console.error(`  ! DM to ${name} failed: ${err.message}`),
    );
  }
  console.log(`DMed ${dmTargets.size} player(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
