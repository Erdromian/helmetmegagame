// What hauling a crate costs the hauler (Depot Overhaul.docx, CARRY.md §10).
//
// "When picking up or transferring a crate for the first time in a turn, a
// character's tiredness will escalate unless they possess the pack mule or
// strong tag. Characters will also lose 20 mood each time they pick up a crate
// unless they have one of the two tags."
//
// So two costs, and both are the ACTOR's:
//   - the first Transfer (or Loot) in a turn that moves a crate at all climbs
//     the Tired ladder one rung (db/lib/fatigue.js), whichever way the crate
//     went; Character.crateHauledTurn is what makes it the first;
//   - every crate that lands in their own hands by their own doing costs
//     EVENTS.CRATE_HAULED mood (db/lib/mood.js), each one.
//
// Somebody handed a crate has not picked it up: the giver hauled it. An
// Exhausted character is already at the top of the ladder and climbs nothing.
//
// Runs inside the caller's transaction (`tx`), after the goods have moved.
// Takes `db` first and stays off the barrel; require it by path.

const { hauls } = require("./crates");
const { applyFatigueStep } = require("./fatigue");
const { applyMood } = require("./mood");
const { EXHAUSTED_SLUG } = require("./constants");

/**
 * `character` needs { id, tags: [{ tag: { slug } }] }. `moved` is how many
 * crates this act moved at all; `pickedUp` how many of them landed in the
 * actor's own hands. `turn` is the open turn. Returns what it did, for the
 * caller's line: { tired, mood } — both false when nothing was charged.
 */
async function chargeCrateHaul(tx, character, { moved = 0, pickedUp = 0, turn = null } = {}) {
  const out = { tired: false, mood: false };
  if (!character?.id || moved <= 0) return out;
  if (!hauls(character.tags)) return out;

  if (turn?.number != null) {
    // The claim IS the check: two Transfers racing in one turn cannot both
    // be the first.
    const { count } = await tx.character.updateMany({
      where: {
        id: character.id,
        OR: [{ crateHauledTurn: null }, { crateHauledTurn: { not: turn.number } }],
      },
      data: { crateHauledTurn: turn.number },
    });
    if (count === 1) {
      const exhausted = await tx.characterTag.findFirst({
        where: { characterId: character.id, tag: { slug: EXHAUSTED_SLUG } },
        select: { id: true },
      });
      if (!exhausted) out.tired = Boolean(await applyFatigueStep(tx, character.id, turn.number));
    }
  }

  for (let i = 0; i < pickedUp; i++) {
    await applyMood(tx, character.id, { kind: "CRATE_HAULED" });
    out.mood = true;
  }
  return out;
}

module.exports = { chargeCrateHaul };
