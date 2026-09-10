// Metempsychosis (a mastery, TAGS.md 4a): the soul does not wait for a body.
//
// A character holding the tag who dies is rolled straight into a new one — a
// random role with a free seat, the ordinary starting budget plus 6, and no
// Curse — instead of going back through the creation wizard as a Cursed
// re-roll limited to Migrant or Bum.
//
// It lives in db/lib rather than beside the wizard because EIGHT callers kill
// people (the dying, catatonic, ascension, nuke and turret passes, the rites,
// and the web's own killCharacter), and every one of them goes through
// db/lib/characterDeath.js#applyDeathToRow. Hanging this off the wizard would
// have covered exactly one of the eight.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.
const { METEMPSYCHOSIS_SLUG } = require("./constants");
const { roleCapacity, isSpawnOnly } = require("./roleCapacity");
const { heldSeatsByRole } = require("./seatCount");
const { effectivePlayerCount } = require("./gameState");
const { parseStartingTag } = require("./startingTags");
const { formatCharacterName } = require("./characterName");
const { applyLocationMoveSideEffects } = require("./locationMove");
const { sendDm } = require("./dm");

// What the tag is worth on top of the ordinary budget. Deliberately HALF the
// default `startingTagPoints` of 12 rather than a second full budget: coming
// back is meant to be a second life, not a better one.
const REINCARNATION_BONUS_POINTS = 6;

// The points arrive UNSPENT, on Character.tagPoints, because skipping the
// wizard means there is no menu in which to spend them. /store is that menu
// mid-game, and it already spends exactly this column.
//
// The new body is named for its seat — "Migrant", "Bum" — because a skipped
// wizard asks nobody for a name and the dead character's own is still on the
// corpse and on its personal Discord role. The player renames themselves with
// the ordinary CHANGE_NAME request, which is why no new surface is needed and
// why the DM below points at it.
function placeholderNameFor(role, existingNames) {
  const base = role.name;
  if (!existingNames.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    if (!existingNames.has(`${base} ${n}`)) return `${base} ${n}`;
  }
  return `${base} ${Date.now()}`;
}

// Every role a soul could land in. Whitelisted seats are excluded (that gate is
// a Discord role the dead player may not hold), and so are spawn-only seats,
// which "can only be spawned, never assigned" — the same two exclusions the
// assignment roll makes.
async function openRoles(prisma, config, state) {
  const roles = await prisma.role.findMany({
    where: { requiresWhitelist: false },
    include: { startingLocation: { include: { zone: true } } },
  });
  const selectable = roles.filter((r) => !isSpawnOnly(r));
  const heldById = await heldSeatsByRole(prisma, selectable);
  const playerCount = effectivePlayerCount(config, state);
  return selectable.filter((r) => (heldById.get(r.id) ?? 0) < roleCapacity(r, playerCount));
}

function holdsMetempsychosis(character) {
  return (character?.tags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === METEMPSYCHOSIS_SLUG);
}

// Returns the new Character row, or null when nothing happened — no tag, no
// Discord user to give the body to, or no seat left in the whole game. Every
// null is a normal outcome, not an error: a player whose soul finds nowhere to
// go is simply dead the ordinary way.
//
// `deadCharacter` must arrive with `tags: { tag: { slug } }` loaded. It is read
// BEFORE applyDeathToRow strips anything, because a gib deletes the tag rows
// outright and there would be no Metempsychosis left to find afterwards.
async function reincarnate(prisma, deadCharacter, { turn = null } = {}) {
  if (!holdsMetempsychosis(deadCharacter)) return null;
  const discordUserId = deadCharacter.discordUserId;
  if (!discordUserId) return null;

  // Somebody who already has another living character does not need a body.
  const living = await prisma.character.count({ where: { discordUserId, status: "ALIVE" } });
  if (living > 0) return null;

  const [config, state] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { startingTagPoints: true, playerCount: true } }),
    prisma.gameState.findUnique({ where: { id: 1 }, select: { playerCount: true } }).catch(() => null),
  ]);

  const candidates = await openRoles(prisma, config, state);
  if (candidates.length === 0) return null;
  const role = candidates[Math.floor(Math.random() * candidates.length)];

  const budget = (config?.startingTagPoints ?? 12) + REINCARNATION_BONUS_POINTS;

  // The role's own kit, resolved the way the wizard resolves it: an entry may
  // carry a count ("obol x5"), and the lookup is a set query, so duplicates
  // have to be summed rather than repeated.
  const wanted = new Map();
  for (const entry of role.startingTagSlugs ?? []) {
    const { slug, quantity } = parseStartingTag(entry);
    wanted.set(slug, (wanted.get(slug) ?? 0) + quantity);
  }
  const startingTags = wanted.size
    ? await prisma.tag.findMany({ where: { slug: { in: [...wanted.keys()] } } })
    : [];

  const taken = new Set(
    (await prisma.character.findMany({ select: { name: true } })).map((c) => c.name),
  );
  const firstName = placeholderNameFor(role, taken);
  const name = formatCharacterName({ honorific: null, firstName, title: null, lastName: null });

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      // The same row lock the wizard takes, and for the same reason: two
      // deaths resolving in one turn pass must not both land in the last seat.
      await tx.$queryRaw`SELECT id FROM "Role" WHERE id = ${role.id} FOR UPDATE`;
      const held = await heldSeatsByRole(tx, [role]);
      if ((held.get(role.id) ?? 0) >= roleCapacity(role, effectivePlayerCount(config, state))) {
        throw new Error("ROLE_FULL");
      }

      const character = await tx.character.create({
        data: {
          discordUserId,
          firstName,
          lastName: null,
          name,
          gender: role.lockedGender ?? deadCharacter.gender ?? null,
          age: deadCharacter.age ?? null,
          roleId: role.id,
          roleTitle: role.name,
          factionId: role.factionId,
          // The denormalization contract: every writer of locationId writes
          // location.zoneId in the same statement.
          locationId: role.startingLocationId ?? null,
          zoneId: role.startingLocation?.zoneId ?? null,
          resources: role.startingResources,
          // Unspent, on purpose — see the note on the bonus above.
          tagPoints: budget,
          isLeader: role.grantsLeader,
          isTreasurer: role.grantsTreasurer,
        },
      });

      if (startingTags.length > 0) {
        await tx.characterTag.createMany({
          data: startingTags.map((tag) => ({
            characterId: character.id,
            tagId: tag.id,
            source: "GM_GRANT",
            quantity: tag.stackable ? (wanted.get(tag.slug) ?? 1) : 1,
          })),
        });
      }
      return character;
    });
  } catch (err) {
    if (err.message === "ROLE_FULL") return null;
    throw err;
  }

  // Discord and placement side effects, best-effort — a body that already
  // exists must never be undone by a failed REST call. The personal character
  // role is deliberately NOT minted here: it is a mentionable name token that
  // grants nothing (PROXYING.md 6), the placeholder name is about to be
  // changed anyway, and the channel doctor mints any missing one on the next
  // bot start.
  if (created.locationId) {
    await applyLocationMoveSideEffects(prisma, {
      characterId: created.id,
      fromLocationId: null,
      toLocationId: created.locationId,
    }).catch((err) => console.error(`Reincarnation placement failed for ${created.id}:`, err.message ?? err));
  }

  // Plain, not `-#`: sendDm prefixes every DM with `»` (CLAUDE.md), and a
  // `» -#` line renders as neither — Discord only reads subtext at the start
  // of a line. The chevron IS the DM convention, so this goes out bare.
  await sendDm(
    prisma,
    discordUserId,
    `Your soul automatically found a new body. You feel blessed. You are ${role.name} now, ` +
      `with ${budget} tag points to spend and no name of your own yet — pick one from your sheet. ‡`,
  ).catch((err) => console.error(`Reincarnation DM failed for ${discordUserId}:`, err.message ?? err));

  console.log(
    `Metempsychosis: ${deadCharacter.name} died and came back as ${created.name} (${role.slug}), turn ${turn?.number ?? "?"}.`,
  );
  return created;
}

module.exports = { reincarnate, holdsMetempsychosis, REINCARNATION_BONUS_POINTS };
