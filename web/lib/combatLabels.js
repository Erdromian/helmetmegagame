// How a fight ended, as prose (CombatEndReason, docs/systemdocs/ATTACK.md). Import-free, so the GM
// desk's mappers (moveRows.js) and the spectator page (spectatorActions.js) read one list.
export const COMBAT_END_LABELS = {
  CALLED_OFF: "Called off",
  TURN_ENDED: "Ended at the push",
  SIDE_EMPTY: "One side gone",
  GM: "Ended by a GM",
};
