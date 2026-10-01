// The Move ledger: spending a turn's Routine a PART at a time
// (docs/systemdocs/CRAFTING.md §2a). A craft, a cure, a burial and a room
// search each cost a share of the Move, and the shares add up on one Action
// row's `craftBudget` — { usedNum, usedDen, entries }. The row IS the record.
//
// Costs are carried as num/den pairs and compared by cross-multiplication.
// The rationals are the point: a turn's Move has to close exactly, and a
// float budget would let four quarters leave a sliver behind or come up
// short, which is a character doing work they never paid for.
//
// This used to live in web/lib/craftBudget.js and
// web/app/(app)/character/actions/shared.js, and every spender was a server
// action. Searching a room (SEARCH.md §9) put a share-of-a-Move verb on a
// Discord button for the first time, so the arithmetic and the two writers
// moved here where both faces can reach them. The web keeps its import
// paths: craftBudget.js and shared.js re-export from this file.
//
// No prisma import and no node:fs — craftBudget.js is imported by "use
// client" components, so this must stay bundle-safe. Every writer takes `tx`.
const { formatMoveAmount } = require("./formatTagRequirement");

const NO_MOVE = { num: 0, den: 1 };
const WHOLE_MOVE = { num: 1, den: 1 };

// Bascinet's words, verbatim.
const MOVE_SPENT = "You've already used your Move this turn.";
const TURN_RESET = "A GM just reset your turn — try again.";

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function reduceFraction(num, den) {
  const g = gcd(Math.abs(num), Math.abs(den)) || 1;
  return { num: num / g, den: den / g };
}

function addFractions(a, b) {
  return reduceFraction(a.num * b.den + b.num * a.den, a.den * b.den);
}

// Does `cost` still fit in what is left? Cross-multiplied, so nothing rounds.
function fitsInRemaining(cost, remaining) {
  return cost.num * remaining.den <= remaining.num * cost.den;
}

// How many units at 1/den each the remainder still pays for.
function unitsAffordable(remaining, den) {
  if (!den) return 0;
  return Math.floor((remaining.num * den) / remaining.den);
}

function ledgerUsed(ledger) {
  if (!ledger) return NO_MOVE;
  return { num: ledger.usedNum ?? 0, den: ledger.usedDen || 1 };
}

function ledgerRemaining(ledger) {
  const used = ledgerUsed(ledger);
  return reduceFraction(used.den - used.num, used.den);
}

// The marker checkLedgerMove recognises as a shareable ledger. `includes`, not
// equality: other machinery APPENDS to gmNotes ("auto:craft auto:bury"), and
// an appended note must not strand a half-spent ledger.
const LEDGER_MARKER = "auto:craft";

function isLedgerAction(action) {
  return Boolean(action && (action.gmNotes ?? "").includes(LEDGER_MARKER) && action.craftBudget);
}

// Reads the turn's Action against what this verb needs. Returns
// { ok: true, ledger } — `ledger` null when no Action is filed yet — or
// { ok: false, reason }. A sentence rather than a throw, the db/lib shape, so
// a Discord button and a server action refuse in the same words.
function checkLedgerMove(action, need) {
  // Asked for more than a turn holds, which an empty turn would otherwise wave through with no ledger yet to fail against.
  if (!fitsInRemaining(need, WHOLE_MOVE)) {
    return { ok: false, reason: "That's more than a turn's work — make fewer at once." };
  }
  if (!action) return { ok: true, ledger: null };
  // A cost with no family can neither lock a Routine nor share one — anything already filed stops it.
  if (!need.family) return { ok: false, reason: MOVE_SPENT };
  if (!isLedgerAction(action)) return { ok: false, reason: MOVE_SPENT };
  const ledger = action.craftBudget;
  const left = ledgerRemaining(ledger);
  if (!fitsInRemaining(need, left)) {
    const asks = need.num >= need.den ? "a whole Move" : `${formatMoveAmount(need.num, need.den)} of a Move`;
    return {
      ok: false,
      reason:
        left.num > 0
          ? `That takes ${asks}, and you have ${formatMoveAmount(left.num, left.den)} of this turn's Move left.`
          : `That takes ${asks}, and this turn's Move is spent.`,
    };
  }
  return { ok: true, ledger };
}

function ledgerEntryList(entries) {
  return entries.map((e) => (e.qty > 1 ? `${e.qty}× ${e.name}` : e.name)).join(", ");
}

// Rebuilt from the ledger every time an entry lands, so a GM reading the desk
// sees the whole turn's work. Grouped by family, each with its own verb:
// "Treating" for medical, "Searching" for a room search, "Crafting" for the
// rest (burial included — a shovel is a tool, and that read is older than
// this file).
function craftLedgerDescription(entries) {
  const healing = entries.filter((e) => e.family === "medical");
  const searching = entries.filter((e) => e.family === "search");
  const crafted = entries.filter((e) => e.family !== "medical" && e.family !== "search");
  const lines = [];
  if (crafted.length) lines.push(`Crafting this turn: ${ledgerEntryList(crafted)}.`);
  if (healing.length) lines.push(`Treating this turn: ${ledgerEntryList(healing)}.`);
  if (searching.length) lines.push(`Searching this turn: ${ledgerEntryList(searching)}.`);
  return lines.join(" ");
}

// Serializer every verb touching a ration or a stack takes first — Postgres
// holds it to end of transaction, so two tabs submitting at once queue up
// instead of both reading the same count.
function lockCharacter(tx, characterId) {
  return tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${characterId} FOR UPDATE`;
}

// A Move the player never wrote: filed for them, already PASSED. `gmNotes`
// names the caller. One Action per character per turn — the P2002 catch is
// the real gate (@@unique([characterId, turnId])), since two tabs can both
// have passed the cheap check a moment ago.
//
// `deferEffects` (Soilery, db/lib/moveEffects.js's `farmed` entry): the Move
// is spent and its cost paid NOW, but `appliedEffects` stays null so the
// turn-push's staged-push claim still sees this row as unresolved and rolls
// its dice at push time. `farmPlan` rides along for that same later
// resolution.
//
// `moveReviewStatus` overrides the PASSED it files as. Only the ledger passes
// one: a row carrying a cure files SOLVED (see spendLedgerMove).
//
// Returns { ok: true, action } or { ok: false, reason }.
async function fileAutoRoutine(
  tx,
  character,
  turn,
  description,
  gmNotes,
  craftBudget = null,
  { deferEffects = false, farmPlan = null, moveReviewStatus = "PASSED" } = {},
) {
  // The floor under the session gate (SESSIONS.md §5). Every caller is refused
  // long before here, but nothing may write an Action row between sittings,
  // so the last word is asked on the caller's own transaction client.
  // Required here rather than at the top: this file reaches "use client" bundles through craftBudget.js, and the gate's readers do not belong there.
  const { sessionGate } = require("./betweenSessions");
  const session = await sessionGate(tx);
  if (!session.ok) return { ok: false, reason: session.message };

  try {
    const action = await tx.action.create({
      data: {
        ...(craftBudget ? { craftBudget } : {}),
        characterId: character.id,
        turnId: turn.id,
        type: "MOVE",
        status: "CONFIRMED",
        confirmedAt: new Date(),
        moveKind: "ROUTINE",
        moveReviewStatus,
        description,
        ...(deferEffects ? {} : { appliedEffects: {} }),
        ...(farmPlan ? { farmPlan } : {}),
        zoneId: character.zoneId ?? null,
        locationId: character.locationId ?? null,
        gmNotes,
      },
    });
    return { ok: true, action };
  } catch (err) {
    if (err?.code === "P2002") return { ok: false, reason: MOVE_SPENT };
    throw err;
  }
}

// Claims the Move (or slice) this verb needs, inside the caller's
// transaction, re-checked under the Character row lock. `need` is
// { num, den, family }; `entry` is the ledger line
// ({ tagId, name, family, qty, num, den }). `description`: a project passes
// its own "(2/3)" line and keeps it; a fractional verb passes none and gets
// the running list. `notes` must CONTAIN "auto:craft", so a non-craft verb on
// this budget appends its own marker rather than replacing it
// ("auto:craft auto:search").
//
// A cure on the row (a "medical" entry: a medic's cure, or an item only a
// medic may administer) makes it SOLVED rather than PASSED. The cure already
// happened, so there is nothing left for a GM to do with it, and the desk
// shouldn't present it as waiting on one. Only ever PASSED -> SOLVED: a row a
// GM reopened stays as they left it.
//
// Returns { ok: true, action, budget } or { ok: false, reason }.
async function spendLedgerMove(tx, { character, turn, need, entry, description = null, notes = LEDGER_MARKER }) {
  await lockCharacter(tx, character.id);
  const existing = await tx.action.findFirst({
    where: { characterId: character.id, turnId: turn.id },
    select: { id: true, gmNotes: true, craftBudget: true, moveReviewStatus: true },
  });
  const curing = entry?.family === "medical";
  const check = checkLedgerMove(existing, need);
  if (!check.ok) return check;
  const ledger = check.ledger;
  // No family, no ledger: takes the whole Move, and the next verb that turn is refused by the Action's own existence.
  if (!need.family) {
    const filed = await fileAutoRoutine(tx, character, turn, description, notes);
    return filed.ok ? { ok: true, action: filed.action, budget: null } : filed;
  }
  const entries = [...(ledger?.entries ?? []), entry];
  const used = addFractions(ledgerUsed(ledger), need);
  const budget = { usedNum: used.num, usedDen: used.den, entries };
  const line = description ?? craftLedgerDescription(entries);
  if (!existing) {
    const filed = await fileAutoRoutine(tx, character, turn, line, notes, budget, {
      moveReviewStatus: curing ? "SOLVED" : "PASSED",
    });
    return filed.ok ? { ok: true, action: filed.action, budget } : filed;
  }
  const solve = curing && existing.moveReviewStatus === "PASSED";
  // `updateMany` + count, not `update`: racing a GM Reject should read as "your turn was just reset", not a raw P2025.
  const { count } = await tx.action.updateMany({
    where: { id: existing.id },
    data: { craftBudget: budget, description: line, ...(solve ? { moveReviewStatus: "SOLVED" } : {}) },
  });
  if (count === 0) return { ok: false, reason: TURN_RESET };
  return { ok: true, action: existing, budget };
}

module.exports = {
  WHOLE_MOVE,
  MOVE_SPENT,
  LEDGER_MARKER,
  reduceFraction,
  addFractions,
  fitsInRemaining,
  unitsAffordable,
  ledgerUsed,
  ledgerRemaining,
  isLedgerAction,
  checkLedgerMove,
  craftLedgerDescription,
  lockCharacter,
  fileAutoRoutine,
  spendLedgerMove,
};
