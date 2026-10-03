// A Vampire's death always ends in ash (docs/systemdocs/VAMPIRE.md §7), whichever
// path kills them: db/lib/characterDeath.js#applyDeathToRow sets their goods down
// beside a Pile of Ash (db/lib/vampireDeath.js#ashBody) and gibs the sheet, so no
// body is left lying anywhere. A wrapper used to do this for two death paths out of
// eleven, which is how a collar or the Magma left an ordinary vampire corpse.
//
// The first test holds the repair migration's seat list to SEAT_TAG_SLUGS, because
// SQL cannot require a JS module. The second wants a real Postgres and skips itself
// otherwise (db/lib/localDatabase.js). It builds a Location of its own with one
// public room, so every row it writes can be found and removed again.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SEAT_TAG_SLUGS } = require("../lib/threats");
const { isLocalDatabase } = require("../lib/localDatabase");

const REPAIR = path.join(__dirname, "..", "prisma", "migrations", "20261218000000_vampire_ash_repair", "migration.sql");

test("the ash repair keeps exactly the antagonist seats when it gibs a sheet", () => {
  const sql = fs.readFileSync(REPAIR, "utf8");
  const list = sql.match(/"slug" NOT IN \(([^)]*)\)/);
  assert.ok(list, "the repair's seat list could not be read");
  const slugs = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(slugs.sort(), [...SEAT_TAG_SLUGS].sort());
});

const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

test("every death shape ashes a vampire, a turret leaves one Dying, and a human still leaves a corpse", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const { applyDeathToRow } = require("../lib/characterDeath");
  const { applyTurretShot } = require("../lib/turretPass");
  const { UNBURIED_BODY_WHERE } = require("../lib/presence");

  const zone = await prisma.zone.findFirst({ select: { id: true } });
  const tags = await prisma.tag.findMany({
    where: { slug: { in: ["vampire", "gibbed", "pile-of-ash", "resources", "bread", "dying"] } },
    select: { id: true, slug: true },
  });
  const id = Object.fromEntries(tags.map((tag) => [tag.slug, tag.id]));
  if (!zone || tags.length < 6) {
    await prisma.$disconnect();
    return t.skip("needs a Zone and the vampire/gibbed/pile-of-ash/resources/bread/dying tags (npm run db:sync-tags)");
  }

  const stamp = Date.now().toString(36);
  const location = await prisma.location.create({
    data: { slug: `ash-test-${stamp}`, name: `Ash Test ${stamp}`, zoneId: zone.id },
  });
  const room = await prisma.room.create({
    data: { slug: `ash-test-room-${stamp}`, name: "Ash Test Room", locationId: location.id, kind: "PUBLIC" },
  });
  const made = [];

  t.after(async () => {
    const ids = made.map((c) => c.id);
    const corpses = await prisma.tag.findMany({ where: { corpseOfCharacterId: { in: ids } }, select: { id: true } });
    const corpseIds = corpses.map((c) => c.id);
    await prisma.characterTag.deleteMany({ where: { OR: [{ characterId: { in: ids } }, { tagId: { in: corpseIds } }] } });
    await prisma.roomTag.deleteMany({ where: { roomId: room.id } });
    await prisma.tag.deleteMany({ where: { id: { in: corpseIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ targetCharacterId: { in: ids } }, { locationId: location.id }] } });
    await prisma.economyEntry.deleteMany({ where: { OR: [{ fromId: { in: ids } }, { toId: { in: [...ids, room.id] } }] } });
    await prisma.archiveEntry.deleteMany({
      where: { OR: [{ characterId: { in: ids } }, { placeKey: { contains: location.id } }] },
    });
    await prisma.character.deleteMany({ where: { id: { in: ids } } });
    await prisma.room.delete({ where: { id: room.id } });
    await prisma.location.delete({ where: { id: location.id } });
    await prisma.$disconnect();
  });

  // One at a time, each killed before the next is made, so no death has a living witness to frighten.
  async function character(name, { vampire = true } = {}) {
    const c = await prisma.character.create({
      data: {
        name: `${name} ${stamp}`,
        firstName: name,
        status: "ALIVE",
        locationId: location.id,
        zoneId: zone.id,
        discordUserId: `ash-test-${made.length}-${stamp}`,
      },
    });
    made.push(c);
    await prisma.characterTag.createMany({
      data: [
        { characterId: c.id, tagId: id.resources, source: "GM_GRANT", quantity: 5 },
        { characterId: c.id, tagId: id.bread, source: "GM_GRANT", quantity: 2, equipped: true, equippedQuantity: 1 },
        ...(vampire ? [{ characterId: c.id, tagId: id.vampire, source: "GM_GRANT" }] : []),
      ],
    });
    return c;
  }
  const sheet = async (c) =>
    (await prisma.characterTag.findMany({ where: { characterId: c.id }, include: { tag: { select: { slug: true } } } }))
      .map((ct) => ct.tag.slug)
      .sort();
  const floor = async (slug) =>
    (await prisma.roomTag.findUnique({ where: { roomId_tagId: { roomId: room.id, tagId: id[slug] } } }))?.quantity ?? 0;
  const lyingHere = async (c) => prisma.character.count({ where: { id: c.id, ...UNBURIED_BODY_WHERE } });

  // The plain death (a collar, catatonia), the gib (the Magma, a rite, Xom, the bomb) and the web's
  // own killCharacter, which has already written DEAD — all three must come out the same.
  const shapes = [
    ["plain", {}],
    ["gib", { gib: true }],
    ["already DEAD", { expectStatus: "DEAD" }],
  ];
  for (const [label, opts] of shapes) {
    const c = await character(`Vlad ${label.replace(/\W/g, "")}`);
    if (opts.expectStatus) await prisma.character.update({ where: { id: c.id }, data: { status: "DEAD" } });
    const before = { coin: await floor("resources"), bread: await floor("bread"), ash: await floor("pile-of-ash") };

    const result = await applyDeathToRow(prisma, c, { content: "x", ...opts });

    assert.equal(result.claimed, true, label);
    assert.equal(result.corpse.tag, null, `${label}: no corpse`);
    assert.equal(result.ash?.roomId, room.id, `${label}: ashed into the one public room`);
    assert.equal(await prisma.tag.count({ where: { corpseOfCharacterId: c.id } }), 0, `${label}: no corpse tag`);
    assert.deepEqual(await sheet(c), ["gibbed", "vampire"], `${label}: gibbed, seat kept for the epilogue`);
    assert.equal(await lyingHere(c), 0, `${label}: no body left in the room`);
    assert.equal((await floor("resources")) - before.coin, 5, `${label}: the ⬢ fell on the floor`);
    assert.equal((await floor("bread")) - before.bread, 2, `${label}: equipped or not, the goods fell too`);
    assert.equal((await floor("pile-of-ash")) - before.ash, 1, `${label}: one Pile of Ash`);
    const audit = await prisma.auditLog.findFirst({ where: { targetCharacterId: c.id, actionType: "vampire_ashed" } });
    assert.equal(audit?.details?.roomId, room.id, `${label}: audited`);
  }

  // A human is untouched by any of it: an ordinary corpse, the goods still on them.
  const human = await character("Ada", { vampire: false });
  const humanDeath = await applyDeathToRow(prisma, human, { content: "x" });
  assert.ok(humanDeath.corpse.tag, "a human leaves a corpse");
  assert.equal(humanDeath.ash, null);
  assert.deepEqual(await sheet(human), ["bread", "resources"]);
  assert.equal(await lyingHere(human), 1);

  // The turret cannot kill a vampire (VAMPIRE.md §7): the killing shot leaves them Dying.
  const target = await character("Vlad Turret");
  const loaded = await prisma.character.findUnique({
    where: { id: target.id },
    select: { id: true, name: true, discordUserId: true, discordRoleId: true, zoneId: true, tags: { select: { equipped: true, tag: { select: { slug: true } } } } },
  });
  const shot = await applyTurretShot(prisma, { character: loaded, severity: "dead", tagSlug: null }, null, {
    deathContent: "x",
    deathReason: "y",
  });
  assert.equal(shot.kind, "hit");
  assert.equal(shot.death, undefined);
  assert.equal((await prisma.character.findUnique({ where: { id: target.id } })).status, "ALIVE");
  assert.ok((await sheet(target)).includes("dying"));
});
