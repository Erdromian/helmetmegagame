// Writes the fixtures in fixtures.mjs into the visual database, removing its
// own previous rows first, so a run always starts from the same world. Idem-
// potent: run it twice and the second run leaves exactly what the first did.
//
// Refuses any database that is not local, the same way dev:seed does — this
// writes fake characters, a fake open turn and fake audit rows into whatever
// DATABASE_URL names, and that must never be the live one.
//
//   node scripts/dev/visual/seed.mjs            # (re)build the fixtures
//   node scripts/dev/visual/seed.mjs --clean    # remove them, keep the world
//
// setup.mjs runs this for you after building the world it lives in.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  AUDIT_ROWS,
  CHARACTERS,
  DM_THREAD,
  GAME_STARTED_AT,
  GM_ACTOR,
  TURN,
  VISUAL_DATABASE_URL,
  VISUAL_PREFIX,
} from "./fixtures.mjs";

const require = createRequire(import.meta.url);

async function clean(prisma) {
  const mine = await prisma.character.findMany({
    where: { discordUserId: { startsWith: VISUAL_PREFIX } },
    select: { id: true },
  });
  const ids = mine.map((c) => c.id);

  const { count: logs } = await prisma.auditLog.deleteMany({
    where: { OR: [{ actorDiscordUserId: { startsWith: VISUAL_PREFIX } }, { targetCharacterId: { in: ids } }] },
  });
  const { count: dms } = await prisma.directMessage.deleteMany({
    where: { discordUserId: { startsWith: VISUAL_PREFIX } },
  });
  await prisma.characterTag.deleteMany({ where: { characterId: { in: ids } } });
  await prisma.bankAccount.deleteMany({ where: { characterId: { in: ids } } });
  const { count: chars } = await prisma.character.deleteMany({ where: { id: { in: ids } } });

  return { logs, dms, chars };
}

async function ensureGame(prisma) {
  let game = await prisma.game.findFirst({ orderBy: { createdAt: "asc" } });
  if (!game) game = await prisma.game.create({ data: { startedAt: GAME_STARTED_AT, label: "visual" } });

  await prisma.gameState.upsert({
    where: { id: 1 },
    update: { phase: "RUNNING", startedAt: GAME_STARTED_AT, gameId: game.id },
    create: { id: 1, gameId: game.id, phase: "RUNNING", startedAt: GAME_STARTED_AT },
  });

  // One open turn, and no other. A second OPEN row would make "which turn is
  // it" depend on insertion order.
  await prisma.turn.updateMany({
    where: { status: "OPEN", number: { not: TURN.number } },
    data: { status: "RESOLVED", resolvedAt: TURN.startedAt },
  });
  await prisma.turn.upsert({
    where: { number: TURN.number },
    update: { ...TURN, status: "OPEN", resolvedAt: null },
    create: { ...TURN, status: "OPEN" },
  });
}

async function placeFor(prisma, spec) {
  const zone = await prisma.zone.findUnique({ where: { slug: spec.zone }, select: { id: true, name: true } });
  if (!zone) throw new Error(`No Zone "${spec.zone}" — was the world built? (npm run dev:visual:setup)`);
  const location = await prisma.location.findUnique({ where: { slug: spec.location }, select: { id: true, name: true } });
  if (!location) throw new Error(`No Location "${spec.location}" in docs/zones.yaml.`);
  return { zone, location };
}

async function seedCharacter(prisma, key, spec, { openAccount }) {
  const { zone, location } = await placeFor(prisma, spec);
  const role = await prisma.role.findUnique({ where: { slug: spec.role }, select: { id: true, name: true } });
  if (!role) console.log(`  ! no Role "${spec.role}" in docs/roles.yaml — ${spec.firstName} gets none`);

  const character = await prisma.character.create({
    data: {
      discordUserId: spec.discordUserId,
      firstName: spec.firstName,
      lastName: spec.lastName,
      name: `${spec.firstName} ${spec.lastName}`,
      gender: spec.gender,
      age: spec.age,
      status: spec.status,
      deathTurn: spec.deathTurn ?? null,
      zoneId: zone.id,
      locationId: location.id,
      roleId: role?.id ?? null,
      roleTitle: role?.name ?? null,
      appearance: spec.appearance || null,
      tagPoints: spec.tagPoints,
      mood: spec.mood,
      hungerValue: spec.hungerValue,
      lastSeenAt: TURN.startedAt,
      lastActivityTurn: TURN.number,
    },
  });

  let granted = 0;
  for (const want of spec.tags) {
    const tag = await prisma.tag.findUnique({ where: { slug: want.slug }, select: { id: true } });
    if (!tag) {
      console.log(`  ! no tag "${want.slug}" in docs/tags.yaml — skipped`);
      continue;
    }
    await prisma.characterTag.create({
      data: {
        characterId: character.id,
        tagId: tag.id,
        source: "POINT_BUY",
        acquiredAt: GAME_STARTED_AT,
        quantity: want.quantity ?? 1,
        equipped: Boolean(want.equipped),
        equippedQuantity: want.equipped ? 1 : 0,
      },
    });
    granted++;
  }

  if (spec.obols != null) {
    const account = await openAccount(prisma, character, { turnNumber: 1 });
    await prisma.bankAccount.update({ where: { id: account.id }, data: { balanceObols: spec.obols } });
  }

  console.log(
    `  + ${character.name} (${key}) — ${spec.status}, ${location.name}, ${zone.name}, ${granted} tag(s)` +
      (spec.obols != null ? `, ${spec.obols} ¢` : ""),
  );
  return character;
}

async function seed(prisma) {
  const { openAccount } = require("../../../db/lib/bankAccounts.js");

  await ensureGame(prisma);
  console.log(`  = game RUNNING, Turn ${TURN.number} open`);

  const byKey = {};
  for (const [key, spec] of Object.entries(CHARACTERS)) {
    byKey[key] = await seedCharacter(prisma, key, spec, { openAccount });
  }

  for (const row of AUDIT_ROWS) {
    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: GM_ACTOR,
        actionType: row.actionType,
        targetCharacterId: byKey[row.target].id,
        details: row.details,
        createdAt: row.createdAt,
      },
    });
  }
  console.log(`  + ${AUDIT_ROWS.length} audit row(s)`);

  for (const dm of DM_THREAD) {
    await prisma.directMessage.create({
      data: {
        discordUserId: CHARACTERS[dm.to].discordUserId,
        direction: dm.direction,
        kind: dm.kind,
        content: dm.content,
        authorDiscordUserId: dm.author ?? null,
        createdAt: dm.createdAt,
      },
    });
  }
  console.log(`  + ${DM_THREAD.length} direct message(s)`);
}

export async function run(argv = []) {
  // Always the visual database, whatever the shell exported. This used to
  // fall back to it only when DATABASE_URL was unset, so `dev:visual:seed` in
  // a shell exporting the ordinary local database set that game RUNNING,
  // resolved its open turn and planted Turn 3 in it. VISUAL_DATABASE_URL is
  // the way to point it somewhere else.
  process.env.DATABASE_URL = VISUAL_DATABASE_URL;

  const { requireLocalDatabase } = require("../../../db/lib/localDatabase.js");
  requireLocalDatabase("The visual seed");

  const { prisma } = require("@lifeweb/db");
  try {
    const removed = await clean(prisma);
    console.log(
      `  - removed ${removed.chars} character(s), ${removed.logs} audit row(s), ${removed.dms} DM(s) from the last run`,
    );
    if (!argv.includes("--clean")) await seed(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch((err) => {
    console.error("\nvisual seed failed:", err.message ?? err);
    process.exit(1);
  });
}
