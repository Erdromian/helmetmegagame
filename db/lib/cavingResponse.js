// The prompt an alert caver gets on a failed Caving roll (Combat Mode.docx; docs/systemdocs/COMBAT-MODE.md §6,
// CAVING.md §5b). A caver in combat mode at a 1 is asked how they respond to whatever is down there, the
// attack description's shape (ATTACK.md §4): the trouble DM says so and carries "Write your response" (a modal
// on Discord, a dialog on the web), and a line under the turn card asks until they have. One response per
// caving RESULT — every 1 of the turn is one result (CAVING.md §5a) — so it lives on the result's oldest row,
// beside the GM's Result box. Out of combat mode at every 1 so far, there is nothing to write: the doc's way
// back in is to turn combat mode on and fail again, since the 1s fold into the one result.
//
// Takes `db` as a parameter (db/lib/dm.js convention). Not on the @lifeweb/db barrel; require by path.
const { movesOpen } = require("./turnGate");
const { DESCRIPTION_LIMIT, CAVING_PROMPT, CAVING_SURPRISED, CAVING_LOCKED, CAVING_WRITTEN } = require("./combatMode");
const { DM_ACTION, dmAction } = require("./dmActions");

// The Discord button and its modal's submit. Each names a CavingRoll, never a character.
const CAVING_WRITE_PREFIX = "cav:write:";
const CAVING_RESPOND_PREFIX = "cav:resp:";

// One caver's result on one turn: the same rows db/lib/cavingPass.js#troubleGroupWhere names, written out
// here because cavingPass.js requires this module.
function resultWhere(characterId, turnId) {
  return { turnId, characterId, kind: "TROUBLE" };
}

// The caver's caving result on `turn`, or null if nothing has gone wrong. `alert` is whether ANY of its 1s
// came while they were in combat mode — that is what lets them write.
async function cavingResultFor(db, characterId, turn) {
  if (!characterId || !turn?.id) return null;
  const rows = await db.cavingRoll.findMany({
    where: resultWhere(characterId, turn.id),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, alert: true, response: true, respondedAt: true, location: { select: { name: true } } },
  });
  if (!rows.length) return null;
  const oldest = rows[0];
  return {
    rollId: oldest.id,
    severity: rows.length,
    alert: rows.some((r) => r.alert),
    response: oldest.response ?? null,
    respondedAt: oldest.respondedAt ?? null,
    locationName: rows[rows.length - 1].location?.name ?? null,
  };
}

// What they do about it. `rollId` is optional — the DM's button names one roll of the result, the web's line
// names none — and when given it must be the caver's own roll on this turn. Refuses after the Move cutoff,
// like an attack description. Writes no audit row: the words are on the row the GM reads (ATTACK.md §13).
async function respondToCaving(db, { characterId, rollId = null, text, turn, now = new Date() }) {
  if (!turn) return { ok: false, error: "No turn is open." };
  const gate = await movesOpen(db, { turn, now });
  if (!gate.ok) return { ok: false, error: gate.reason === "LOCKED" ? CAVING_LOCKED : gate.message };
  const clean = String(text ?? "").trim();
  if (!clean) return { ok: false, error: "Write something first." };
  if (clean.length > DESCRIPTION_LIMIT) {
    return { ok: false, error: `That's too long — keep it under ${DESCRIPTION_LIMIT} characters.` };
  }
  if (rollId) {
    const roll = await db.cavingRoll.findUnique({ where: { id: String(rollId) }, select: { characterId: true, turnId: true } });
    if (!roll || roll.characterId !== characterId) return { ok: false, error: "That isn't yours to answer." };
    if (roll.turnId !== turn.id) return { ok: false, error: "That was another turn. It's over now." };
  }
  const result = await cavingResultFor(db, characterId, turn);
  if (!result) return { ok: false, error: "Nothing has gone wrong down here this turn." };
  if (!result.alert) return { ok: false, error: CAVING_SURPRISED };
  await db.cavingRoll.update({ where: { id: result.rollId }, data: { response: clean, respondedAt: now } });
  return { ok: true, line: CAVING_WRITTEN };
}

// The line and buttons a trouble DM carries. `canWrite` is the RESULT's alert, not just this roll's: a later 1
// out of combat mode doesn't take back the chance an earlier one gave.
function troubleDmParts(rollId, canWrite) {
  if (!canWrite) return { line: CAVING_SURPRISED, components: [], meta: undefined };
  return {
    line: CAVING_PROMPT,
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 1, custom_id: `${CAVING_WRITE_PREFIX}${rollId}`, label: "Write your response" }],
      },
    ],
    meta: dmAction(DM_ACTION.CAVING, rollId),
  };
}

module.exports = {
  CAVING_WRITE_PREFIX,
  CAVING_RESPOND_PREFIX,
  cavingResultFor,
  respondToCaving,
  troubleDmParts,
};
