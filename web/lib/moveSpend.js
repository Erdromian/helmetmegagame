// Spending a whole Move from a button (ADJUDICATION.md §2): one Action per
// character per turn, filed by the same rules the modal uses. Bury, Engrave,
// a build site, a Gambit heal and the Thanati's Recover Equipment all want the
// turn to themselves and use these two. (Extract used to be on that list; it
// costs no Move since 2026-09-11 and carries its own once-a-day claim instead
// — FACTORY.md §3.) Crafting takes
// requestActions.js's resolveCraftMove instead, because a craft may cost a
// FRACTION of the Move and share the rest with another craft.
//
// Lifted out of requestActions.js so a second action file (thanatiActions.js)
// spends a Move by the same two rules rather than a copy of them.
import { prisma } from "@lifeweb/db";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockFrozen } from "@lifeweb/db/lib/gameState";
import { UserError } from "@/lib/actionResult";

export async function requireFreeMove(character, openTurn) {
  if (!openTurn) throw new UserError("No turn is open.");
  const { locked } = moveWindow(openTurn, { clockFrozen: await clockFrozen(prisma) });
  if (locked) throw new UserError("Moves are locked for this turn.");
  const acted = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true },
  });
  if (acted) throw new UserError("You've already used your Move this turn.");
}

// A Move the player never wrote: filed for them, already PASSED, so a GM sees
// what happened without having to adjudicate it. `gmNotes` names the caller
// ("auto:craft", "auto:bury", …).
//
// requireFreeMove() has usually run first, but the P2002 catch is what
// actually holds: @@unique([characterId, turnId]) is the real gate, and two
// tabs submitting at once get past a check that read the table a moment ago.
export async function fileAutoRoutine(
  tx,
  character,
  openTurn,
  description,
  gmNotes,
  // The craft ledger, on the one caller that keeps one. Omitted rather than
  // written as null: a Prisma Json column wants `Prisma.JsonNull` for an
  // explicit null, and "no ledger" is exactly what the column default says.
  craftBudget = null,
) {
  try {
    return await tx.action.create({
      data: {
        ...(craftBudget ? { craftBudget } : {}),
        characterId: character.id,
        turnId: openTurn.id,
        type: "MOVE",
        status: "CONFIRMED",
        confirmedAt: new Date(),
        moveKind: "ROUTINE",
        moveReviewStatus: "PASSED",
        description,
        appliedEffects: {},
        zoneId: character.zoneId ?? null,
        locationId: character.locationId ?? null,
        gmNotes,
      },
    });
  } catch (err) {
    if (err?.code === "P2002")
      throw new UserError("You've already used your Move this turn.");
    throw err;
  }
}
