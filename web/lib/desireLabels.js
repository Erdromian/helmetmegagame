// The one wording for a Desire slot that is still on cooldown. Client-safe:
// no db import, so the picker, the Chat block, the sheet and the GM tab can
// all use it without dragging @lifeweb/db into the browser bundle.
//
// "Locked (1t)" rather than "Opens on turn 3": a player does not know what
// turn it is, but they know what one more day means. `lockedTurnsLeft` is
// computed in db/lib/desireGates.js#slotStates from the open turn.
export function lockedSlotLabel(slot) {
  const n = slot?.lockedTurnsLeft ?? 1;
  return `Locked (${n}t)`;
}
