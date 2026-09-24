// Spending a whole Move from a button (ADJUDICATION.md §2): one Action per character per turn.
// Crafting instead takes requestActions.js's resolveCraftMove, since a craft may cost a FRACTION
// of the Move and share the rest with another craft (FACTORY.md §3).
import { prisma } from "@lifeweb/db";
import { UserError } from "@/lib/actionResult";
import { autoMovesOpen } from "@lifeweb/db/lib/turnGate";
import { fileAutoRoutine as fileAutoRoutineInDb } from "@lifeweb/db/lib/moveLedger";

export async function requireFreeMove(character, openTurn) {
  if (!openTurn) throw new UserError("No turn is open.");
  // One gate, one sentence — db/lib/turnGate.js. The `auto` half: this verb settles itself with no GM, so the Move lock
  // does not stop it, but the game being out of session still does.
  const gate = await autoMovesOpen(prisma, { turn: openTurn });
  if (!gate.ok) throw new UserError(gate.message);
  const acted = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true },
  });
  if (acted) throw new UserError("You've already used your Move this turn.");
}

// A Move the player never wrote: filed for them, already PASSED. The writer is
// db/lib/moveLedger.js#fileAutoRoutine now, shared with the Discord face; this
// keeps the import path and turns its refusal into the UserError every caller
// here expects.
export async function fileAutoRoutine(tx, character, openTurn, description, gmNotes, craftBudget = null, opts = {}) {
  const out = await fileAutoRoutineInDb(tx, character, openTurn, description, gmNotes, craftBudget, opts);
  if (!out.ok) throw new UserError(out.reason);
  return out.action;
}
