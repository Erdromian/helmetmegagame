// Fighting, both faces (docs/systemdocs/ATTACK.md). The rule half the web's server actions
// (web/app/(app)/character/combatActions.js) and the Discord bot (bot/src/lib/verbs/people.js, the DM
// buttons in bot/src/events/interactionCreate.js) share: resolving what was picked, the gates, the audit
// row. The mechanism is db/lib/combat.js. Nothing here costs a Move, ⬢ or a ration — a fight never did
// (Bascinet, 2026-09-27); what somebody does in it is their attack description.
//
// Every function answers `{ ok: false, error }` for a refusal a player reads, or `{ ok: true, line, dms,
// announce, ... }`. The face sends the DMs, and hands `announce` (a new fight's line to the room) to
// combatAnnounce.js#announceFight, after it returns.
const combat = require("../combat");
const { combatBlock } = require("../combatGate");
const { resolveTargetKey } = require("../targetKey");
const { whosHere } = require("../whosHere");
const { seenByIdMany } = require("../intercept");
const { blockerFor, ACT } = require("../incapacitation");
const { logAudit } = require("../auditLog");

// The acting character, re-read in the one shape every gate here needs. Never from a posted id — the face
// resolves `characterId` from the session or the interaction.
async function actor(prisma, characterId) {
  return prisma.character.findUnique({ where: { id: characterId ?? "" }, select: combat.COMBAT_SELECT });
}

// Who the Attack dialog offers: everybody standing here, BOTH halves — a hood by its token, never its id
// (db/lib/targetKey.js) — each marked when they are already in a fight, since that is a thing anybody in
// the room can see. The people the button will refuse are listed too, the ATTACK.md §8 reasoning: leaving
// them out would answer questions the room does not.
async function attackPicker(prisma, { character, turn }) {
  const room = await whosHere(prisma, character, { includeSelf: false, withSightings: true, withHoodIds: true });
  const fighting = await combat.fightingHere(prisma, character.locationId, turn?.id ?? null);
  return [
    ...room.named.map((row) => ({ key: `character:${row.characterId}`, name: row.name, fighting: fighting.has(row.characterId) })),
    ...room.concealed
      .filter((row) => row.token)
      .map((row) => ({ key: `hood:${row.token}`, name: row.alias, fighting: fighting.has(room.hoodIds?.get(row.token)) })),
  ];
}

// Everything the Attack surface draws, on either face: who can be picked, the fights going on here, why the
// button would refuse (or null), and the viewer's own fight if they are in one.
async function loadAttack(prisma, { characterId, turn }) {
  const character = await actor(prisma, characterId);
  if (!character) return { ok: false, error: "You aren't in the game." };
  const [people, fights, blocked, view] = await Promise.all([
    attackPicker(prisma, { character, turn }),
    combat.combatsHere(prisma, character, turn),
    combatBlock(prisma, { character, turn }),
    combat.combatViewFor(prisma, character.id, turn),
  ]);
  return { ok: true, people, fights, blocked, view };
}

// Resolve posted keys to ids for somebody standing here. Null for any key that names nobody reachable, the
// targetKey.js rule — the caller refuses without saying which.
async function resolveKeys(prisma, character, keys) {
  const out = [];
  for (const key of Array.isArray(keys) ? keys : []) {
    const id = await resolveTargetKey(prisma, character, key);
    if (!id) return null;
    out.push(id);
  }
  return [...new Set(out)];
}

// Start a fight: targets and collaborators picked from the people here.
async function startFight(prisma, { characterId, discordUserId, targetKeys, collaboratorKeys, turn }) {
  const character = await actor(prisma, characterId);
  if (!character || character.status !== "ALIVE") return { ok: false, error: "You aren't in the game." };
  const stuck = blockerFor(character.tags, ACT);
  if (stuck) return { ok: false, error: `You can't attack anybody — you're ${stuck.name}.` };
  const why = await combatBlock(prisma, { character, turn });
  if (why) return { ok: false, error: why };

  const targets = await resolveKeys(prisma, character, targetKeys);
  const collaborators = await resolveKeys(prisma, character, collaboratorKeys ?? []);
  if (!targets || !collaborators) return { ok: false, error: "Somebody you picked isn't here any more." };
  if (targets.length === 0) return { ok: false, error: "Pick somebody to attack." };
  if (targets.includes(character.id) || collaborators.includes(character.id)) {
    return { ok: false, error: "You can't pick yourself." };
  }
  if (targets.some((id) => collaborators.includes(id))) {
    return { ok: false, error: "Somebody can't be both a target and on your side." };
  }

  const out = await combat.startCombat(prisma, {
    initiatorId: character.id,
    targetIds: targets,
    collaboratorIds: collaborators,
    turn,
    locationId: character.locationId,
  });
  if (!out.ok) return out;

  // Named the way the attacker knows them — the audit log is not a place to unmask somebody the game
  // just refused to (the intercept.js rule).
  const targetNames = await seenByIdMany(prisma, character.id, targets);
  const withNames = await seenByIdMany(prisma, character.id, collaborators);
  await logAudit(prisma, {
    actorDiscordUserId: discordUserId ?? "system",
    actionType: "request_attack_filed",
    targetCharacterId: targets[0],
    turnId: turn.id,
    details: { combatId: out.combat.id, presented: targetNames, with: withNames, locationId: character.locationId },
  }).catch((err) => console.error("Attack: audit row failed:", err.message ?? err));

  return {
    ok: true,
    combatId: out.combat.id,
    line: `You attack ${combat.listNames(targetNames)}.`,
    dms: out.dms,
    announce: out.announce ? { ...out.announce, fighters: [character.id, ...targets, ...collaborators] } : null,
  };
}

async function interveneFight(prisma, { characterId, discordUserId, combatId, side, turn }) {
  const character = await actor(prisma, characterId);
  if (!character) return { ok: false, error: "You aren't in the game." };
  const out = await combat.intervene(prisma, { character, combatId, side, turn });
  if (!out.ok) return out;
  await logAudit(prisma, {
    actorDiscordUserId: discordUserId ?? "system",
    actionType: "request_attack_intervened",
    targetCharacterId: character.id,
    turnId: turn.id,
    details: { combatId, side, ...(out.reopened ? { reopened: true } : {}) },
  }).catch((err) => console.error("Attack: audit row failed:", err.message ?? err));
  return out;
}

async function answerFightInvite(prisma, { characterId, discordUserId, participantId, join, turn }) {
  const out = await combat.answerInvite(prisma, { participantId, characterId, join: Boolean(join), turn });
  if (!out.ok) return out;
  await logAudit(prisma, {
    actorDiscordUserId: discordUserId ?? "system",
    actionType: "request_attack_answered",
    targetCharacterId: characterId,
    turnId: turn.id,
    details: { participantId, join: Boolean(join), ...(out.reopened ? { reopened: true } : {}) },
  }).catch((err) => console.error("Attack: audit row failed:", err.message ?? err));
  return out;
}

// No audit row: an edit to your own words is not a thing the log is kept for, and the words themselves
// are on the participant row the GM reads.
async function describeFight(prisma, { characterId, participantId, text, turn }) {
  return combat.describe(prisma, { participantId, characterId, text, turn });
}

async function callOffFight(prisma, { characterId, discordUserId, participantId, turn }) {
  const out = await combat.callOff(prisma, { participantId, characterId, turn });
  if (!out.ok) return out;
  await logAudit(prisma, {
    actorDiscordUserId: discordUserId ?? "system",
    actionType: "request_attack_cancelled",
    targetCharacterId: characterId,
    turnId: turn.id,
    details: { participantId, ended: Boolean(out.ended) },
  }).catch((err) => console.error("Attack: audit row failed:", err.message ?? err));
  return out;
}

module.exports = {
  attackPicker,
  loadAttack,
  startFight,
  interveneFight,
  answerFightInvite,
  describeFight,
  callOffFight,
};
