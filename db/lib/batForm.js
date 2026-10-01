// Bat Form's one gate (docs/systemdocs/VAMPIRE.md §6). Flight crosses no link,
// so it never reaches locationTravel.js#performLocationMove — but it is still
// travel, and everything that stops a walk stops it too. Before this, a vampire
// in a fight could fly out of it, and arriving took them out of the fight
// (locationMove.js → combat.js#leaveCombatsFor) with nobody the wiser.
//
// Takes `db` as a parameter (the dm.js convention); require by path.
const { sessionGate } = require("./betweenSessions");
const { travelLockReason } = require("./turnGate");
const { blockerFor, ACT } = require("./incapacitation");
const { heldReasonFor } = require("./intercept");
const { activeFightOf } = require("./combat");
const { cavingRestrictionsFor, standingZoneKind } = require("./cavingPass");

const IN_A_FIGHT = "You're in a fight. You can't move until it's over.";
const CAVING_HOLD =
  "You rolled a 1 on the Caving Die, so you can't take Bat Form until the turn ends and you receive the results of your caving die.";

// PURE. The two checks that need nothing but the row: incapacitated, or held
// where they stand (a fight, an ambush, an intercept, caught stealing, a
// withdrawal — heldReasonFor's own sentence for each). The menu greys the Fly
// button with this; the action asks it again under the row lock.
function batFormHeldReason(character, now = new Date()) {
  const stuck = blockerFor(character?.tags, ACT);
  if (stuck) return `You're in no state to do that — you're ${stuck.name}.`;
  return heldReasonFor(character, now);
}

// The sentence refusing Bat Form, or null. In performLocationMove's order.
// `character` needs id, zoneId, tags (with tag.slug), heldUntil and heldReason;
// `turn` is the open turn; `intoZoneKind` is the destination zone's kind.
async function batFormRefusal(db, character, { turn = null, intoZoneKind = null } = {}) {
  // Shut between sittings (SESSIONS.md §5), and once Moves lock before the
  // push for a flight into or out of the caves (turnGate.js) — the same two
  // stops every walk obeys.
  const session = await sessionGate(db);
  if (!session.ok) return session.message;
  const fromZoneKind = await standingZoneKind(db, character);
  const locked = await travelLockReason(db, { fromZoneKind, intoZoneKind });
  if (locked) return locked;

  const held = batFormHeldReason(character);
  if (held) return held;

  // The fight row itself, in case a hold's clock and the fight ever disagree
  // (ATTACK.md: CombatParticipant.activeTurnId is what says somebody is in a fight).
  if (turn?.id && (await activeFightOf(db, character.id, turn.id))) return IN_A_FIGHT;

  // A Caving 1 this turn keeps you underground until the push (CAVING.md §2c).
  // Refused outright, not only for a flight to the surface: a flight never
  // rolls the Die, so a hop inside the caves would be a free walk past it.
  const caving = await cavingRestrictionsFor(db, character.id, fromZoneKind);
  if (caving.stuck) return caving.stuck;
  if (caving.hold) return CAVING_HOLD;

  return null;
}

module.exports = { batFormRefusal, batFormHeldReason, IN_A_FIGHT, CAVING_HOLD };
