import { prisma } from "@lifeweb/db";
import { MAX_REASON_LENGTH } from "@/lib/constants";
import { UserError } from "@/lib/actionResult";
import { DEAD_SIMPLE_PER_TURN, isDeadSimple } from "@/lib/tagRequests";

// A Request is a change the player already made. There is no approval step:
// the effect is applied and the row is written in the same transaction, and a
// GM reviews it afterwards from /gm/turns. See docs/systemdocs/REQUESTS.md.

export { MAX_REASON_LENGTH };

// How many ROUTINE cures a medic may work in one turn, by their highest
// medical tier (docs/systemdocs/TAGS.md §5c). A doctor's day has a floor and a
// ceiling: they cannot treat the whole ward, and the better they are the more
// they get through.
//
// Cures that cost 0 turns — first aid, bandaging, setting a simple break —
// are FREE ACTIONS and never count against this. Those are the ones you do
// between patients, and rationing them would make a nurse refuse a bandage.
//
// Gambits are not counted here at all: a gambit heal files a Move, and
// Action's @@unique([characterId, turnId]) already allows exactly one of those
// a turn.
export const MEDICAL_TIER_CAPS = {
  "medical-basic": 2,
  "medical-skilled": 3,
  "medical-expert": 4,
};

// isDeadSimple and DEAD_SIMPLE_PER_TURN live in tagRequests.js now (recipe
// facts a client component can reach); imported above for the counters below
// and re-exported further down so server-side imports keep working.

// The free allowance a 0-turn recipe has each turn: its own `perTurn` ration
// if it sets one, otherwise the shared Dead Simple pool. Null means "no
// allowance to count" — either the recipe costs a Move (so the Action rations
// it) or it is a 0-turn recipe outside both schemes, which stays a free
// action with no ceiling.
//
// Units past the allowance are no longer simply refused: for a recipe with a
// craft family they spill into the Move at 1/allowance each
// (web/lib/craftBudget.js, docs/systemdocs/CRAFTING.md §2a). This function is
// only the number, so the server's enforcement and the page's readout can
// never disagree about what "free" means.
export function craftAllowance(tag) {
  if ((tag?.requirementTurns ?? 1) !== 0) return null;
  if (tag?.requirementPerTurn != null) return tag.requirementPerTurn;
  return isDeadSimple(tag) ? DEAD_SIMPLE_PER_TURN : null;
}

// Units of ONE recipe already made this turn, for a tag that sets its own
// `perTurn` (Tag.requirementPerTurn). Distinct from the Dead Simple pool
// below: that one is a shared allowance across every 0-turn recipe, this is a
// ration on a single item.
//
// Both counters read `payload.quantity` — what the player asked for, which is
// what was granted. They used to disagree (this one read `effect.quantity`),
// which was harmless while nothing but a cap depended on it and is not now
// that a count decides how much of a Move a craft spends.
export async function unitsOfTagThisTurn(db, characterId, turnId, tagId) {
  const filed = await db.request.findMany({
    where: { characterId, turnId, type: "ADD_TAG", status: { not: "UNDONE" } },
    select: { payload: true },
  });
  return filed.reduce((sum, r) => {
    if (r.payload?.tagId !== tagId) return sum;
    return sum + (Number(r.payload?.quantity) || 0);
  }, 0);
}

// Dead Simple units already filed this turn (DEAD_SIMPLE_PER_TURN).
// EDITED still counts, UNDONE does not. `db` is prisma or a tx client.
export async function deadSimpleUnitsThisTurn(db, characterId, turnId) {
  const filed = await db.request.findMany({
    where: { characterId, turnId, type: "ADD_TAG", status: { not: "UNDONE" } },
    select: { payload: true },
  });
  const filedTagIds = [
    ...new Set(filed.map((r) => r.payload?.tagId).filter(Boolean)),
  ];
  const filedTags = filedTagIds.length
    ? await db.tag.findMany({
        where: { id: { in: filedTagIds } },
        select: {
          id: true,
          requirementTurns: true,
          requirementSkills: { select: { slug: true } },
        },
      })
    : [];
  const deadSimpleIds = new Set(filedTags.filter(isDeadSimple).map((t) => t.id));
  return filed.reduce((sum, r) => {
    if (!deadSimpleIds.has(r.payload?.tagId)) return sum;
    return sum + (Number(r.payload?.quantity) || 0);
  }, 0);
}

// Every rationed recipe's free units left this turn, in one query, keyed by
// tag id: `{ per, left }`. The Craft dialog's readout, so it can say which
// units of an order are free and which spill into the Move. `tags` is the
// page's catalog rows — they must carry `requirementTurns`,
// `requirementPerTurn` and `requirementSkills.slug` or nothing is rationed.
export async function craftFreeUnits(db, characterId, turnId, tags) {
  const out = {};
  const rationed = tags.filter((t) => craftAllowance(t) != null);
  if (!turnId || !rationed.length) return out;
  const filed = await db.request.findMany({
    where: { characterId, turnId, type: "ADD_TAG", status: { not: "UNDONE" } },
    select: { payload: true },
  });
  const units = new Map();
  for (const r of filed) {
    const id = r.payload?.tagId;
    if (!id) continue;
    units.set(id, (units.get(id) ?? 0) + (Number(r.payload?.quantity) || 0));
  }
  const byId = new Map(tags.map((t) => [t.id, t]));
  let pool = 0;
  for (const [id, n] of units) {
    if (isDeadSimple(byId.get(id))) pool += n;
  }
  for (const tag of rationed) {
    const per = craftAllowance(tag);
    const used = tag.requirementPerTurn != null ? (units.get(tag.id) ?? 0) : pool;
    out[tag.id] = { per, left: Math.max(0, per - used) };
  }
  return out;
}

// Defined in requestLabels.js so client components can have them without
// pulling this module's Prisma import into the browser bundle.
export { REQUEST_TYPE_LABELS, REQUEST_STATUS_LABELS, REQUEST_STATUS_TONES } from "@/lib/requestLabels";

// Same split, same reason: the Dead Simple ration is a fact about a RECIPE, so
// it lives with the other recipe predicates in tagRequests.js where a client
// component can reach it. Re-exported here so every server-side import of it
// keeps working unchanged.
export { DEAD_SIMPLE_PER_TURN, isDeadSimple } from "@/lib/tagRequests";

// Server actions are public endpoints, so the reason is validated here rather
// than trusted from the dialog that collected it.
export function requireReason(raw) {
  const reason = raw?.toString().trim() ?? "";
  if (!reason) throw new UserError("A reason is required.");
  return reason.slice(0, MAX_REASON_LENGTH);
}

// `payload` is what the player asked for; `effect` is what was actually
// applied. Undo reads ONLY `effect` — see the model comment in schema.prisma
// for why re-deriving from live state is unsafe.
export function createRequest(tx, { characterId, turnId, type, reason, payload, effect }) {
  return tx.request.create({
    data: {
      characterId,
      turnId: turnId ?? null,
      type,
      reason,
      payload: payload ?? {},
      effect: effect ?? {},
    },
  });
}

// Every request writes an AuditLog row too, carrying the same reason — that's
// what fills the Reason column on /gm/audit.
export function logRequest(tx, { actorDiscordUserId, actionType, targetCharacterId, reason, details }) {
  return tx.auditLog.create({
    data: {
      actorDiscordUserId,
      actionType,
      targetCharacterId: targetCharacterId ?? null,
      reason,
      details: details ?? {},
    },
  });
}
