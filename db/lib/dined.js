// Dined: "you've eaten properly today" (docs/systemdocs/COOKING.md §9). The Soilery Rework took it out along with Ate
// Meal; it is back as the mark a LAVISH meal leaves, and nothing else grants it. It lasts one in-game day, and a day is
// however many turns the game currently counts to one (turnClock.js#turnsInGameDay), so it cannot be a fixed
// `durationTurns` in docs/tags.yaml the way every other timed tag is — the length is worked out here, at the grant.
//
// Takes `tx` for the same reason db/lib/dm.js takes prisma, and is not exported from the barrel.
const { turnsInGameDay } = require("./turnClock");
const { expiryForGrant } = require("./grantExpiry");
const { isLavish } = require("./meals");

const DINED_SLUG = "dined";

// Whether eating `tag` should leave the eater Dined. The Hungerless are left out: food does nothing for them (the Soilery
// Rework doc), and a meal they never needed is not one they dined on.
function earnsDined(tag, { hungerless = false } = {}) {
  return isLavish(tag) && !hungerless;
}

// Puts Dined on `characterId` for one in-game day from `openTurn` (null between turns: expiryForGrant stamps against the
// turn about to open). Eating another lavish meal while still Dined restarts the day rather than leaving the first
// meal's clock running, so the tag always means "within a day of your last lavish meal". Returns the tag's name for
// the caller's granted list, or null if the catalog has no Dined (run db:sync-tags).
async function grantDined(tx, characterId, openTurn, config) {
  const tag = await tx.tag.findUnique({ where: { slug: DINED_SLUG }, select: { id: true, slug: true, name: true } });
  if (!tag) {
    console.error(`grantDined: no "${DINED_SLUG}" tag — run npm run db:sync-tags.`);
    return null;
  }
  const turns = turnsInGameDay({
    turnsPerDay: config?.turnsPerDay ?? 0,
    turnLengthHours: openTurn?.turnLengthHours ?? config?.turnLengthHours,
  });
  const expiresTurn = await expiryForGrant(tx, { slug: tag.slug, defaultDurationTurns: turns }, openTurn, {
    characterId,
    where: "grantDined",
  });
  const existing = await tx.characterTag.findUnique({
    where: { characterId_tagId: { characterId, tagId: tag.id } },
    select: { id: true, expiresTurn: true },
  });
  if (!existing) {
    await tx.characterTag.create({
      data: { characterId, tagId: tag.id, source: "EVENT", quantity: 1, expiresTurn },
    });
  } else if (existing.expiresTurn != null && expiresTurn != null && expiresTurn > existing.expiresTurn) {
    // A null on the held row is a GM's untimed grant, and is left alone.
    await tx.characterTag.update({ where: { id: existing.id }, data: { expiresTurn } });
  }
  return tag.name;
}

module.exports = { DINED_SLUG, earnsDined, grantDined };
