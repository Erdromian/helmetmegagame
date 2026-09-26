// Pure — no Prisma, no server imports — so the client picker and healCharacterRequest can never disagree.
export { buildSkillAncestry, satisfiedSkillIds, canTreatAsRoutine }from "@lifeweb/db/lib/medicalVision";
// The Heal gate and the Saint's miracle rules live in db/lib/medicalVision.js,
// so the Discord bot reads the same ones. Imported as well as re-exported,
// because this file is one of their readers.
import { HEAL_SKILL_SLUG, SAINT_SLUG, MIRACLE_PER_TURN, isHealable, isMiracleable } from "@lifeweb/db/lib/medicalVision";
import { DYING_SLUG } from "@lifeweb/db/lib/constants";

export { HEAL_SKILL_SLUG, SAINT_SLUG, MIRACLE_PER_TURN, isHealable, isMiracleable };

export const HEALABLE_CATEGORY = "Health";

export const INFLICTABLE_GROUPS = new Set(["health-wounds", "health-maiming"]);

export const INFLICTABLE_SLUGS = new Set(["concussed", "shell-shocked", "blind", "mute"]);

export function isInflictable(tag) {
  if (!tag || tag.category !== HEALABLE_CATEGORY || tag.custom) return false;
  return INFLICTABLE_GROUPS.has(tag.group?.slug) || INFLICTABLE_SLUGS.has(tag.slug);
}

export function healCost(tag) {
  return tag?.requirementResources ?? 0;
}

// Every query feeding isGambitHeal()/needsSurgicalSite() must select all three fields, not a subset.
export const HEAL_SKILL_SELECT = { id: true, name: true, slug: true };

function missingSkillsFor(tag, satisfied) {
  return (tag?.requirementSkills ?? []).filter((skill) => !satisfied.has(skill.id));
}

// A failed roll can leave the patient worse (docs/systemdocs/TAGS.md §5c).
export function isGambitHeal(tag, satisfied) {
  if (!tag) return false;
  return Boolean(tag.requirementGambit) || missingSkillsFor(tag, satisfied).length > 0;
}

// Non-minor surgery needs a site (M3, TAGS.md §5c). Dying is the one
// exception: it requires medical-expert but is a field rescue, not a
// procedure, so it's exempt outright (docs/tags.yaml `dying:` comment).
export function needsSurgicalSite(tag) {
  if (tag?.slug === DYING_SLUG) return false;
  return (tag?.requirementSkills ?? []).some((skill) => skill.slug === "medical-expert");
}

// Only a 0-turn cure draws on the medic's shared free pool (M2, TAGS.md §5c).
export function countsAgainstHealCap(tag, gambit = false) {
  return (tag?.requirementTurns ?? 0) === 0 && !gambit;
}

export function healCapFor(heldSlugs, pool) {
  const ladder = ["medical-expert", "medical-skilled", "medical-basic"];
  return ladder.some((slug) => heldSlugs.has(slug)) ? pool : 0;
}

// Saint's Perform Miracle: SAINT_SLUG, MIRACLE_PER_TURN and isMiracleable are
// re-exported from db/lib/medicalVision.js at the top of this file. Not the
// medic's MEDICAL_SIMPLE_PER_TURN pool — its own count on the AuditLog.
