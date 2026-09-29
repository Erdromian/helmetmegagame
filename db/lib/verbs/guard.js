// Escort, both faces (docs/systemdocs/ATTACK.md §6a, MAP.md §3d): the web's Escort dialog
// (web/app/(app)/character/guardActions.js) and the Discord bot's /escort guard and /escort stop
// (bot/src/lib/verbs/people.js). The rule is db/lib/guard.js; this is the write and the audit. See
// ./common.js for the result shape. Nothing here costs a Move, ⬢ or a ration — following somebody costs
// what each crossing costs, when it happens.
//
// Setting one needs combat mode and an open turn with the game in session, like the combat mode button.
// The Move lock does not apply: an escort acts on nobody until somebody moves or is attacked, and both of
// those are already shut by the lock. Stopping one is never gated.
const { autoMovesOpen } = require("../turnGate");
const { logAudit } = require("../auditLog");
const { resolveTargetKey } = require("../targetKey");
const { seenById, seenBy, IDENTITY_SELECT } = require("../intercept");
const { whosHere } = require("../whosHere");
const { refuse, asResult } = require("./common");
const { GUARD_LINES, guardBlock, guardNote } = require("../guard");

// What guardBlock reads off the actor. Loaded here, so neither face's select has to carry it.
const ACTOR_SELECT = {
  id: true,
  status: true,
  locationId: true,
  guardingId: true,
  combatModeSinceTurn: true,
  discordUserId: true,
  tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { slug: true, name: true } } } },
};

async function loadActor(prisma, characterId) {
  const row = await prisma.character.findUnique({ where: { id: characterId }, select: ACTOR_SELECT });
  if (!row || row.status !== "ALIVE") refuse("You don't have a living character.");
  return row;
}

// `targetKey` is a picker key (db/lib/targetKey.js): "character:<id>" for a bare face, "hood:<token>"
// for a mask, so no hood's id ever comes from a browser.
function setEscort(prisma, { character, discordUserId, targetKey }) {
  return asResult(async () => {
    const gate = await autoMovesOpen(prisma);
    if (!gate.ok) refuse(gate.message);
    const turn = gate.turn;
    const actor = await loadActor(prisma, character.id);
    const early = guardBlock(actor);
    if (early) refuse(early);

    const targetId = await resolveTargetKey(prisma, actor, targetKey);
    const target = targetId ? await prisma.character.findUnique({ where: { id: targetId }, select: IDENTITY_SELECT }) : null;
    const why = guardBlock(actor, target ?? null) ?? (target ? null : GUARD_LINES.NOT_HERE);
    if (why) refuse(why);

    const name = await seenBy(prisma, actor.id, target);
    if (actor.guardingId === target.id) return { line: GUARD_LINES.ALREADY(name), changed: false, dms: [] };

    const previousId = actor.guardingId;
    await prisma.character.update({ where: { id: actor.id }, data: { guardingId: target.id } });
    await logAudit(prisma, {
      actorDiscordUserId: discordUserId ?? "",
      actionType: "request_escort_set",
      targetCharacterId: target.id,
      turnId: turn.id,
      // By the face the escort saw, never the true name (the intercept.js rule for a hood).
      details: { charge: name, replaced: Boolean(previousId) },
    });

    const dms = [];
    if (previousId) {
      const previous = await prisma.character.findUnique({ where: { id: previousId }, select: IDENTITY_SELECT });
      if (previous) dms.push(guardNote(previous, GUARD_LINES.TOLD_CHARGE_STOPPED(await seenById(prisma, previous.id, actor.id))));
    }
    dms.push(guardNote(target, GUARD_LINES.TOLD_CHARGE(await seenById(prisma, target.id, actor.id))));
    return { line: GUARD_LINES.STARTED(name), changed: true, dms: dms.filter(Boolean) };
  });
}

function stopEscort(prisma, { character, discordUserId }) {
  return asResult(async () => {
    const row = await prisma.character.findUnique({ where: { id: character.id }, select: { id: true, guardingId: true } });
    if (!row?.guardingId) return { line: GUARD_LINES.NOT_GUARDING, changed: false, dms: [] };
    const won = await prisma.character.updateMany({
      where: { id: row.id, guardingId: row.guardingId },
      data: { guardingId: null },
    });
    if (won.count === 0) return { line: GUARD_LINES.NOT_GUARDING, changed: false, dms: [] };
    const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
    const name = await seenById(prisma, row.id, row.guardingId);
    await logAudit(prisma, {
      actorDiscordUserId: discordUserId ?? "",
      actionType: "request_escort_stopped",
      targetCharacterId: row.guardingId,
      turnId: turn?.id ?? null,
      details: { charge: name },
    });
    const charge = await prisma.character.findUnique({ where: { id: row.guardingId }, select: IDENTITY_SELECT });
    const dms = charge ? [guardNote(charge, GUARD_LINES.TOLD_CHARGE_STOPPED(await seenById(prisma, charge.id, row.id)))] : [];
    return { line: GUARD_LINES.STOPPED(name), changed: true, dms: dms.filter(Boolean) };
  });
}

// What the Escort dialog and the Discord picker draw: who you are escorting (by the name you know them
// by, and whether they are here with you), why Confirm is dead, and everybody here you could pick — a
// hood by its token, never its id.
async function escortPicker(prisma, { character }) {
  const actor = await prisma.character.findUnique({ where: { id: character.id }, select: ACTOR_SELECT });
  if (!actor || actor.status !== "ALIVE") return { blocked: "You don't have a living character.", current: null, people: [] };
  let current = null;
  if (actor.guardingId) {
    const charge = await prisma.character.findUnique({
      where: { id: actor.guardingId },
      select: { id: true, locationId: true, status: true },
    });
    current = {
      name: await seenById(prisma, actor.id, actor.guardingId),
      here: Boolean(charge && charge.status === "ALIVE" && charge.locationId === actor.locationId),
    };
  }
  const room = await whosHere(prisma, actor, { includeSelf: false, withSightings: true, withHoodIds: true });
  const people = [
    ...room.named.map((row) => ({
      key: `character:${row.characterId}`,
      name: row.name,
      current: row.characterId === actor.guardingId,
    })),
    ...room.concealed
      .filter((row) => row.token)
      .map((row) => ({ key: `hood:${row.token}`, name: row.alias, current: room.hoodIds?.get(row.token) === actor.guardingId })),
  ].sort((a, b) => String(a.name).localeCompare(String(b.name)) || (a.key < b.key ? -1 : 1));
  // Standing here, the charge is named the way the picker names them, so two lookalike strangers
  // ("a man, behind" and "a man, at the back") are told apart.
  const here = people.find((p) => p.current);
  if (current && here) current.name = here.name;
  return { blocked: guardBlock(actor), current, people };
}

module.exports = { setEscort, stopEscort, escortPicker };
