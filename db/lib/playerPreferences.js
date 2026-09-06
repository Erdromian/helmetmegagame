// The rules behind PlayerPreference.rolePriorities (docs/systemdocs/LOBBY.md
// §2). Pure functions, no DB, so the lobby's client component and the server
// action apply the same rule and the two can never disagree about what
// "one High" means.
//
// The shape is { [roleSlug]: "LOW" | "MEDIUM" | "HIGH" }; a slug that is
// absent is Off. Ported from tgstation's set_job_preference_level: setting a
// role to HIGH demotes whichever role held HIGH before to MEDIUM, so there is
// only ever one, and the old favourite stays in the running rather than
// vanishing.

const LEVELS = ["LOW", "MEDIUM", "HIGH"];
const JOBLESS_ROLES = ["COMMONER", "MIGRANT", "RETURN_TO_LOBBY"];

// Returns a NEW object; never mutates.
function setPriority(priorities, slug, level) {
  const next = { ...(priorities ?? {}) };
  if (level === "HIGH") {
    for (const [other, held] of Object.entries(next)) {
      if (other !== slug && held === "HIGH") next[other] = "MEDIUM";
    }
  }
  if (!level || level === "OFF") delete next[slug];
  else next[slug] = level;
  return next;
}

// Whatever was posted, reduced to known slugs at valid levels with at most
// one HIGH (the first wins). `allowed` is the set of slugs this player may
// name at all — a whitelisted seat for a player without the role is dropped
// here, the way normalizeAntagonistSlugs drops a whitelisted box.
function normalizePriorities(raw, allowed) {
  const out = {};
  let sawHigh = false;
  const entries = raw && typeof raw === "object" ? Object.entries(raw) : [];
  for (const [slug, level] of entries) {
    if (!allowed.has(slug)) continue;
    if (!LEVELS.includes(level)) continue;
    if (level === "HIGH") {
      if (sawHigh) {
        out[slug] = "MEDIUM";
        continue;
      }
      sawHigh = true;
    }
    out[slug] = level;
  }
  return out;
}

function normalizeJoblessRole(raw) {
  return JOBLESS_ROLES.includes(raw) ? raw : "COMMONER";
}

// True when Start would have nothing to give this player but the fallback.
function pickedNothing(priorities) {
  return Object.keys(priorities ?? {}).length === 0;
}

module.exports = { LEVELS, JOBLESS_ROLES, setPriority, normalizePriorities, normalizeJoblessRole, pickedNothing };
