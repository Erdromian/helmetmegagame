// ESCORT — guarding somebody (docs/systemdocs/ATTACK.md §6a, MAP.md §3d). Players call it Escort; the
// code calls it GUARD so it never gets muddled with db/lib/escort.js, which is the party you carry and
// runs the other way round. There, a leader walks and followers are brought along for nothing. Here, the
// guard walks after their charge under their own power, spending their own travel and then their Move,
// and steps into a fight on the charge's side when the charge is attacked.
//
// Character.guardingId is the whole state: who this character is escorting. One at a time. Needs combat
// mode to set (Bascinet, 2026-09-30), and ends when combat mode goes off. A guard who is not standing with
// their charge neither follows nor defends, and picks up again once they are together — "the escort
// waits" (Bascinet, 2026-09-30). So a stale row is inert, the escortedById posture.
//
// Takes `db` as a parameter and is deliberately NOT on the @lifeweb/db barrel; require it by path. IT
// SENDS NOTHING: every write hands back DM descriptors for the caller to send after it commits.
const { inCombatMode } = require("./combatMode");
const { blockerFor, ACT } = require("./incapacitation");
const { capitalizeFirst: cap } = require("./concealedIdentity");
const { DM_KIND } = require("./dmKinds");

// The words, in one place, so the web dialog, the Discord verb and the DMs read the same.
const GUARD_LINES = {
  NEEDS_COMBAT_MODE: "You need to be in combat mode to escort somebody.",
  NOT_HERE: "They aren't here any more.",
  NOT_YOURSELF: "You can't escort yourself.",
  ALREADY: (name) => `You're already escorting ${name}.`,
  STARTED: (name) => `You're escorting ${name}. You'll follow them when they travel, and step in if they're attacked.`,
  TOLD_CHARGE: (name) => `${cap(name)} is escorting you.`,
  STOPPED: (name) => `You stop escorting ${name}.`,
  NOT_GUARDING: "You aren't escorting anybody.",
  TOLD_CHARGE_STOPPED: (name) => `${cap(name)} is no longer escorting you.`,
  COMBAT_OFF: (name) => `You're no longer on guard, so you stop escorting ${name}.`,
  FOLLOWED: (name, place) => `You followed ${name} to ${place}.`,
  FOLLOW_COST_MOVE: "It cost you your Move.",
  LOST: (name) => `${cap(name)} left, and you couldn't follow.`,
  STEP_IN: (name) => `You step in to defend ${name}.`,
};

// What refuses setting an escort, as one sentence or null — the heldReasonFor shape, so a greyed button,
// the server action and the Discord verb can never disagree about why. `actor` needs id, locationId,
// combatModeSinceTurn and tags (with tag.slug and tag.name); `target` needs id, status, locationId.
function guardBlock(actor, target = null) {
  if (!actor) return "You don't have a living character.";
  const stuck = blockerFor(actor.tags ?? [], ACT);
  if (stuck) return `You can't do that right now. You're ${stuck.name}.`;
  if (!inCombatMode(actor)) return GUARD_LINES.NEEDS_COMBAT_MODE;
  if (!target) return null;
  if (target.id === actor.id) return GUARD_LINES.NOT_YOURSELF;
  if (target.status !== "ALIVE" || !actor.locationId || target.locationId !== actor.locationId) return GUARD_LINES.NOT_HERE;
  return null;
}

function note(row, content) {
  if (!row?.discordUserId || row.status === "DEAD") return null;
  return { discordUserId: row.discordUserId, content, kind: DM_KIND.NOTICE };
}

// Everyone escorting one of `chargeIds` who is standing at `locationId` right now, alive. `select` is the
// caller's: the mover wants ESCORT_SELECT, a fight only wants ids. `not` drops ids already dealt with.
async function guardsOf(db, chargeIds, locationId, { select = { id: true, guardingId: true }, not = [] } = {}) {
  const ids = [...new Set((chargeIds ?? []).filter(Boolean))];
  if (ids.length === 0 || !locationId) return [];
  return db.character.findMany({
    where: {
      guardingId: { in: ids },
      status: "ALIVE",
      locationId,
      ...(not.length ? { id: { notIn: [...not] } } : {}),
    },
    select: { ...select, guardingId: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
}

// Ends every escort these guards hold, and tells each guard in `line`'s words (a function of the charge's
// name as they know it). Used when combat mode goes off. Conditional on the column still being set, so a
// second caller racing this one tells nobody twice. `seenById` is passed in to keep this module out of
// intercept.js's require graph.
async function endGuardsFor(db, guardIds, { line, seenById }) {
  const ids = [...new Set((guardIds ?? []).filter(Boolean))];
  if (ids.length === 0) return [];
  const rows = await db.character.findMany({
    where: { id: { in: ids }, guardingId: { not: null } },
    select: { id: true, discordUserId: true, status: true, guardingId: true },
  });
  if (rows.length === 0) return [];
  await db.character.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { guardingId: null } });
  const charges = await db.character.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.guardingId))] } },
    select: { id: true, discordUserId: true, status: true },
  });
  const chargeById = new Map(charges.map((c) => [c.id, c]));
  const dms = [];
  for (const row of rows) {
    const name = seenById ? await seenById(db, row.id, row.guardingId) : "them";
    if (line) dms.push(note(row, line(name)));
    // The charge was told when it started, so they are told when it stops.
    const charge = chargeById.get(row.guardingId);
    if (charge && seenById) dms.push(note(charge, GUARD_LINES.TOLD_CHARGE_STOPPED(await seenById(db, charge.id, row.id))));
  }
  return dms.filter(Boolean);
}

// Clears both halves when somebody leaves play (db/lib/characterDeath.js#releaseEntanglements): nobody
// escorts a body, and a body escorts nobody. Silent — the death is the news.
async function releaseGuards(db, characterId) {
  if (!characterId) return;
  await db.character.updateMany({ where: { guardingId: characterId }, data: { guardingId: null } });
  await db.character.updateMany({ where: { id: characterId, guardingId: { not: null } }, data: { guardingId: null } });
}

module.exports = {
  GUARD_LINES,
  guardBlock,
  guardsOf,
  endGuardsFor,
  releaseGuards,
  guardNote: note,
};
