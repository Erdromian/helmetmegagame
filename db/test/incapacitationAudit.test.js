// The `character_incapacitated` audit row: a trigger on CharacterTag
// (db/prisma/migrations/20261208000000_incapacitation_audit) writes one
// whenever a character is bound or incapacitated, by any route.
//
// The first test reads the migration and holds its slug list to
// INCAPACITATING_SLUGS, because SQL cannot require a JS module — add a slug to
// db/lib/incapacitation.js and this fails until a migration teaches the
// trigger. The second wants a real Postgres and skips itself otherwise
// (db/lib/localDatabase.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { INCAPACITATING_SLUGS } = require("../lib/incapacitation");
const { isLocalDatabase } = require("../lib/localDatabase");
const { INCLUDED, auditLine } = require("../lib/oracleAudit");

const MIGRATIONS = path.join(__dirname, "..", "prisma", "migrations");

// The NEWEST migration that defines the function — a later one replacing it
// is what this must read, not the first.
function triggerSlugs() {
  const dirs = fs.readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).sort().reverse();
  for (const dir of dirs) {
    const file = path.join(MIGRATIONS, dir, "migration.sql");
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, "utf8");
    if (!sql.includes("FUNCTION bascinet_incapacitation_audit()")) continue;
    const list = sql.match(/NOT IN \(([^)]*)\)/);
    assert.ok(list, `${dir} defines the trigger but its slug list could not be read`);
    return new Set([...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  }
  assert.fail("no migration defines bascinet_incapacitation_audit()");
}

test("the trigger's slugs are exactly INCAPACITATING_SLUGS, Bound among them", () => {
  const slugs = triggerSlugs();
  assert.deepEqual([...slugs].sort(), [...INCAPACITATING_SLUGS].sort());
  assert.ok(slugs.has("bound"));
});

test("the Oracle reads the row as a story fact", () => {
  assert.ok(INCLUDED.has("character_incapacitated"));
  const line = auditLine(
    {
      actionType: "character_incapacitated",
      actorDiscordUserId: "system:incapacitation",
      targetCharacterId: "c1",
      details: { tagName: "Bound", locationName: "The Den" },
    },
    { byCharacterId: new Map([["c1", "Ada Vance"]]), byDiscordUserId: new Map() },
  );
  assert.equal(line, "incapacitated | Ada Vance | tagName: Bound, locationName: The Den");
});

const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

test("binding or knocking out a character writes one audit row; anything else writes none", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  const location = await prisma.location.findFirst({ select: { id: true, zoneId: true, name: true } });
  const tags = await prisma.tag.findMany({
    where: { slug: { in: ["bound", "unconscious", "tipsy"] } },
    select: { id: true, slug: true, name: true },
  });
  const bySlug = new Map(tags.map((tag) => [tag.slug, tag]));
  if (!location || bySlug.size < 3) {
    await prisma.$disconnect();
    return t.skip("needs a Location and the bound/unconscious/tipsy tags (npm run db:sync-tags)");
  }

  const stamp = Date.now().toString(36);
  const character = await prisma.character.create({
    data: {
      name: `Ada Bindtest${stamp}`,
      firstName: "Ada",
      lastName: `Bindtest${stamp}`,
      status: "ALIVE",
      locationId: location.id,
      zoneId: location.zoneId,
      discordUserId: `incap-test-${stamp}`,
    },
    select: { id: true, name: true },
  });

  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { targetCharacterId: character.id } });
    await prisma.characterTag.deleteMany({ where: { characterId: character.id } });
    await prisma.character.delete({ where: { id: character.id } });
    await prisma.$disconnect();
  });

  const rows = () =>
    prisma.auditLog.findMany({
      where: { targetCharacterId: character.id, actionType: "character_incapacitated" },
      orderBy: { createdAt: "asc" },
    });

  // Not incapacitating: no row.
  await prisma.characterTag.create({ data: { characterId: character.id, tagId: bySlug.get("tipsy").id, source: "EVENT" } });
  assert.equal((await rows()).length, 0);

  // Bound, through the ordinary create.
  await prisma.characterTag.create({ data: { characterId: character.id, tagId: bySlug.get("bound").id, source: "EVENT" } });
  const [bound] = await rows();
  assert.ok(bound, "Bound should write a character_incapacitated row");
  assert.equal(bound.actorDiscordUserId, "system:incapacitation");
  assert.equal(bound.locationId, location.id);
  assert.deepEqual(bound.details, {
    tagId: bySlug.get("bound").id,
    tagSlug: "bound",
    tagName: bySlug.get("bound").name,
    source: "EVENT",
    characterName: character.name,
    locationName: location.name,
  });

  // Unconscious, through the batch insert the turn passes use — and a
  // skipped duplicate of Bound, which inserts nothing and so logs nothing.
  await prisma.characterTag.createMany({
    data: [
      { characterId: character.id, tagId: bySlug.get("unconscious").id, source: "GM_GRANT" },
      { characterId: character.id, tagId: bySlug.get("bound").id, source: "EVENT" },
    ],
    skipDuplicates: true,
  });
  const all = await rows();
  assert.deepEqual(
    all.map((r) => r.details.tagSlug),
    ["bound", "unconscious"],
  );
  assert.equal(all[1].details.source, "GM_GRANT");
});
