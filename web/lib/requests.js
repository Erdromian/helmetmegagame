import { prisma } from "@lifeweb/db";
import { MAX_REASON_LENGTH } from "@/lib/constants";
import { UserError } from "@/lib/actionResult";

// What is left of the old Request system: the per-turn rations, and the one
// helper every player action writes its audit row through. A player action
// applies its effect and logs it in the same transaction, and there is no
// review step and no Undo. See docs/systemdocs/REQUESTS.md.

export { MAX_REASON_LENGTH };

// How many Dead Simple items a character may make in one turn.
//
// Dead Simple is the bottom rung of the smithing ladder (SMITHING.md §2) and
// the only one that costs 0 turns, so nothing was rationing it: a player could
// file Add Tag requests all turn and walk away with any number of work knives.
// The cap is on UNITS, not requests — the Dead Simple items are stackable and
// one request can carry a quantity of 20 — and it is summed across every
// ADD_TAG request the character has filed this turn.
export const DEAD_SIMPLE_PER_TURN = 4;

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

// The skills that mark a recipe as smithing/crafting work. Every smithing rung
// counts, not just the one Dead Simple actually gates on, so a future 0-turn
// recipe at a higher rung is covered without editing this list.
const DEAD_SIMPLE_SKILL_SLUGS = (slug) => slug === "crafting" || slug.startsWith("smithing");

// There is no "tier" column — Dead Simple is only a comment header in
// docs/tags.yaml — so the tier is recognised by its recipe: 0 turns of work,
// and a smithing or crafting skill gate. That is exactly the craftables
// under the Dead Simple headers today. The one other tag in the catalog with
// `turnsCost: 0` is Frostbite, whose requirement block is a CURE (medical
// skills, the removal direction), so the skill test keeps it out.
//
// `tag.requirementSkills` must be loaded ({ slug }) or this reads false.
export function isDeadSimple(tag) {
  if (tag?.requirementTurns !== 0) return false;
  return (tag.requirementSkills ?? []).some((skill) => DEAD_SIMPLE_SKILL_SLUGS(skill.slug));
}

// Server actions are public endpoints, so the reason is validated here rather
// than trusted from the dialog that collected it.
export function requireReason(raw) {
  const reason = raw?.toString().trim() ?? "";
  if (!reason) throw new UserError("A reason is required.");
  return reason.slice(0, MAX_REASON_LENGTH);
}


// A player action writes one AuditLog row and nothing else. There is no
// Request table any more and no Undo: the player acts, the row records what
// happened, and a GM repairs by hand from /gm/dev if they must. `details` is
// therefore the ONLY record — where the old Request.effect carried a restore
// snapshot, that snapshot belongs in here now.
export function logAudit(tx, { actorDiscordUserId, actionType, targetCharacterId, turnId, details }) {
  return tx.auditLog.create({
    data: {
      actorDiscordUserId,
      actionType,
      targetCharacterId: targetCharacterId ?? null,
      turnId: turnId ?? null,
      details: details ?? {},
    },
  });
}

