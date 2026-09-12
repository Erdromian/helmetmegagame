// One-off: grants every ALIVE character in a seat that would plausibly
// already know an item's worth the new Appraisal skill
// (docs/systemdocs/TAGS.md §4a) — the catch-up for everybody who was already
// playing before it joined the seven roles' starting_tags and the two
// courtier kits (docs/roles.yaml, docs/tags.yaml).
//
//   node db/scripts/ops/grant-appraisal.js           # dry run
//   node db/scripts/ops/grant-appraisal.js --apply   # write + DM
//
// Dry-run-by-default with an --apply flag, matching db:prune-tags and the
// rest of db/scripts/ops/ (see grant-factory-road-merchant-docker.js, the
// template this follows).
//
// Two ways in:
//   - Role slug in ROLE_SLUGS, straight from starting_tags.
//   - Role "courtier" AND holding a fingerprint of one of the two kits that
//     now grant it (courtier-manor-lord, courtier-court-artist). The kit
//     itself is a consumable crate tag — spent at creation — so a courtier
//     who already took one no longer holds the crate, only what it left
//     behind. Matched on that instead:
//       Manor Lord    -> holds `heirloom` or `manor-key`
//       Court Artist  -> holds `artist` and `musician`
//
// Anybody already holding `appraisal` is skipped outright, so a re-run
// neither double-grants nor double-DMs.
require("dotenv").config();
const { prisma } = require("../../index");
const { grantTagSlugs } = require("../../lib/tagWrites");
const { sendDm } = require("../../lib/dm");
const { APPRAISAL_SLUG } = require("../../lib/appraisal");

const APPLY = process.argv.includes("--apply");
const DM_TEXT =
  "You have received the appraisal tag, allowing you to discern the value of an item in obols.";
const ROLE_SLUGS = ["merchant", "arbiter", "baron", "docker", "geschef", "banneret", "innkeeper"];

function courtierKitMatch(heldSlugs) {
  if (heldSlugs.has("heirloom") || heldSlugs.has("manor-key")) return "Manor Lord";
  if (heldSlugs.has("artist") && heldSlugs.has("musician")) return "Court Artist";
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/]+)\//)?.[1] ?? "(unparsed)";
  console.log(`DATABASE_URL host: ${host}`);
  console.log(APPLY ? "APPLY — will write appraisal and DM players" : "DRY RUN — no writes");

  const characters = await prisma.character.findMany({
    where: {
      status: "ALIVE",
      OR: [{ role: { slug: { in: ROLE_SLUGS } } }, { role: { slug: "courtier" } }],
    },
    select: {
      id: true,
      name: true,
      discordUserId: true,
      role: { select: { slug: true } },
      tags: { select: { tag: { select: { slug: true } } } },
    },
  });

  const targets = [];
  for (const character of characters) {
    const heldSlugs = new Set(character.tags.map((ct) => ct.tag.slug));
    if (heldSlugs.has(APPRAISAL_SLUG)) continue;

    if (character.role.slug === "courtier") {
      const match = courtierKitMatch(heldSlugs);
      if (match) targets.push({ character, why: `courtier: ${match}` });
      continue;
    }
    targets.push({ character, why: character.role.slug });
  }

  console.log(`${characters.length} ALIVE candidate(s), ${targets.length} to grant.`);
  for (const { character, why } of targets) {
    console.log(`- ${character.name} (${why})`);
  }

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to write and DM.");
    return;
  }

  const dmTargets = new Map();
  for (const { character } of targets) {
    await prisma.$transaction(async (tx) => {
      await grantTagSlugs(tx, character.id, [APPRAISAL_SLUG], null);
    });
    if (character.discordUserId) dmTargets.set(character.discordUserId, character.name);
  }

  console.log(`\nGranted appraisal to ${targets.length} character(s).`);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: "system",
      actionType: "appraisal_backfill",
      details: {
        roles: ROLE_SLUGS,
        courtierMatches: targets.filter((t) => t.why.startsWith("courtier")).map((t) => t.character.name),
        characterCount: targets.length,
      },
    },
  });

  // Post-commit and best-effort, same as grant-factory-road-merchant-docker.js:
  // a Discord outage must not undo the grant.
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
