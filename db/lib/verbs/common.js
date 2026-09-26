// What the player verbs in db/lib/verbs/ share. Each of those files holds the
// rule half of a verb both faces run: the web's server action
// (web/app/(app)/character/...) and the Discord bot's (bot/src/lib/verbs/).
// The face resolves WHO is acting — the session there, the interaction here —
// and applies the post-commit tail; everything between is here, once.
//
// A verb answers `{ ok: false, error }` for a refusal a player reads, and
// `{ ok: true, ...facts }` otherwise. Inside a transaction a refusal is thrown
// as a Refusal and turned back into that shape by asResult, so the rollback
// still happens. Two facts every caller reads:
//   touched  character ids whose tags or ⬢ changed — the face runs its
//            afterInventoryChange over them (web/lib/afterInventoryChange.js,
//            db/lib/inventoryTail.js).
//   notify   [{ character, text, opts }] — unattributed notices to the people
//            a verb happened TO (web/lib/notifyCharacter.js, inventoryTail.js).
const { autoMovesOpen } = require("../turnGate");
const { fileAutoRoutine: fileAutoRoutineInDb } = require("../moveLedger");
const { moveParty, InsufficientResourcesError } = require("../resourceTransfer");

class Refusal extends Error {
  constructor(message) {
    super(message);
    this.refusal = true;
  }
}

function refuse(message) {
  throw new Refusal(message);
}

async function asResult(fn) {
  try {
    const out = await fn();
    return { ok: true, touched: [], notify: [], ...(out ?? {}) };
  } catch (err) {
    if (err?.refusal) return { ok: false, error: err.message };
    throw err;
  }
}

// web/lib/moveSpend.js#requireFreeMove: a verb that spends the whole Move. The
// `auto` half of the gate — it settles itself with no GM, so the Move lock does
// not stop it, but the game being out of session still does.
async function requireFreeMove(prisma, character, openTurn) {
  if (!openTurn) refuse("No turn is open.");
  const gate = await autoMovesOpen(prisma, { turn: openTurn });
  if (!gate.ok) refuse(gate.message);
  const acted = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true },
  });
  if (acted) refuse("You've already used your Move this turn.");
}

// web/lib/moveSpend.js#fileAutoRoutine, refusing the Refusal way.
async function fileAutoRoutine(tx, character, openTurn, description, gmNotes, craftBudget = null, opts = {}) {
  const out = await fileAutoRoutineInDb(tx, character, openTurn, description, gmNotes, craftBudget, opts);
  if (!out.ok) refuse(out.reason);
  return out.action;
}

// web/lib/tagEffects.js#moveResources: moves a party's balance by a signed
// delta and REFUSES rather than going negative — the write is the check.
async function moveResources(tx, party, delta, ctx) {
  try {
    await moveParty(tx, party, delta, ctx);
  } catch (err) {
    if (!(err instanceof InsufficientResourcesError)) throw err;
    if (party?.kind === "room") refuse(`${party.name ?? "That room"} no longer holds ${err.amount} ⬢.`);
    refuse(`${party?.name ?? "That character"} no longer has ${err.amount} ⬢.`);
  }
}

// Whole numbers only, inside [min, max], else null (web character/actions/shared.js#parseCount).
function parseCount(raw, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

module.exports = { Refusal, refuse, asResult, requireFreeMove, fileAutoRoutine, moveResources, parseCount };
