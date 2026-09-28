// Dined: "you've eaten properly today" (docs/systemdocs/COOKING.md §6a). The Soilery Rework took it out along with Ate
// Meal; it is back as the mark a LAVISH meal leaves, and nothing else grants it. A noble who ends a turn without it takes
// NOBLE_MEAL (db/lib/moodPass.js, MOOD.md §8).
//
// It lasts one in-game day, and a day is however many turns the game currently counts to one
// (turnClock.js#turnsInGameDay), so it cannot be a fixed `durationTurns` in docs/tags.yaml the way every other timed tag
// is — the length is worked out here, at the grant.
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

// The turn Dined runs out on, eaten during `turnNumber` with `turns` turns to a day: a whole day of turns AFTER the one
// it was eaten in, never "what is left of today". The close's expiry sweep runs before the mood pass (db/index.js
// TURN_PASSES), so a row with this expiry is still held at the close of the turn it was eaten in and at every close
// for a day after — `turns` closes in all, each of which it saves a noble from NOBLE_MEAL — and is swept at the next.
function dinedExpiry(turnNumber, turns) {
  return turnNumber + turns;
}

// Puts Dined on `characterId` for one in-game day from `turn`: the open turn for a Consume, the closing turn for the
// hunger pass's own eating. With no turn (between turns), expiryForGrant counts from the turn about to open. Eating
// another lavish meal while still Dined restarts the day rather than leaving the first meal's clock running, so the tag
// always means "within a day of your last lavish meal". Returns the tag's name for the caller's granted list, or null
// if the catalog has no Dined (run db:sync-tags).
async function grantDined(tx, characterId, turn, config) {
  const tag = await tx.tag.findUnique({ where: { slug: DINED_SLUG }, select: { id: true, slug: true, name: true } });
  if (!tag) {
    console.error(`grantDined: no "${DINED_SLUG}" tag — run npm run db:sync-tags.`);
    return null;
  }
  const turns = turnsInGameDay({
    turnsPerDay: config?.turnsPerDay ?? 0,
    turnLengthHours: turn?.turnLengthHours ?? config?.turnLengthHours,
  });
  // expiryForGrant counts its first live turn as the first of the duration; one more is the day AFTER it.
  const expiresTurn = turn
    ? dinedExpiry(turn.number, turns)
    : await expiryForGrant(tx, { slug: tag.slug, defaultDurationTurns: turns + 1 }, null, {
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

module.exports = { DINED_SLUG, earnsDined, dinedExpiry, grantDined };
