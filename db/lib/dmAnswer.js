// Answering a DM's buttons, from either face — the load, ownership check and
// tail order live here once. ARCHITECTURE.md §4 one level up: COMPOSES the
// per-kind db/lib functions rather than returning Discord work itself; bot
// awaits it inline, web defers to after() (awaiting Discord in a server
// action freezes the app). Stays per-face and cannot be lifted: DM button
// removal, Discord User fetch/send (gateway vs. REST, ARCHITECTURE.md §3),
// and room access/carry drop (web/lib/afterInventoryChange.js
// runs them inside after()). Takes `prisma`, NOT on the @lifeweb/db barrel — require by path.
const { DM_ACTION, DM_CHOICE } = require("./dmActions");
const { acceptLesson, declineOffer } = require("./lessons");
const { acceptBind } = require("./bind");
const { acceptConfession } = require("./confession");
const { acceptKiss } = require("./kiss");
const { acceptCollar } = require("./collar");
const { acceptSearch } = require("./search");
const { acceptConversion, refuseConversion } = require("./conversionRite");
const { acceptEscort } = require("./escort");
const { syncPartyMembership } = require("./partyChat");
const { acceptThreatSpawn, declineThreatSpawn } = require("./threatSpawn");
const { declineAssignment } = require("./lobby");
const { holdKeyedOpen } = require("./gates");
const { settleCarry } = require("./carry");
const { releaseHeldBy, seenBy, seenById, IDENTITY_SELECT } = require("./intercept");
const { cancelAttack, ATTACK_CALLED_OFF_DM } = require("./attack");
const { answerFightInvite, callOffFight } = require("./verbs/combat");
const { recordArchiveEvent } = require("./archive");

const GONE = "That offer's gone.";
const NOT_YOURS = "That's not yours to answer.";

function empty(extra = {}) {
  return { dms: [], sideEffects: { spawn: null, roomSyncCharacterIds: [], carryDrop: null, boundNotification: null, ...extra } };
}

// Lifted from bot/src/lib/offers.js so the web can share it instead of reinventing it.
async function loadOfferFor(prisma, offerId, discordUserId) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer) return { problem: GONE };
  const responder = await prisma.character.findFirst({
    where: { id: offer.responderId, status: "ALIVE" },
    select: { id: true, name: true, discordUserId: true },
  });
  if (!responder || responder.discordUserId !== discordUserId) return { offer, problem: NOT_YOURS };
  return { offer, responder, problem: null };
}

// Post-bind tail, minus its Discord half (a round trip the caller runs its
// own twin of). Best-effort throughout, never flips `ok` — a room nobody can
// enter is the channel doctor's problem, not a reason to fail the bind.
async function afterBind(prisma, boundId) {
  const out = { roomSyncCharacterIds: [], carryDrop: null, boundNotification: null };
  try {
    out.carryDrop = await settleCarry(prisma, boundId);
    out.roomSyncCharacterIds = [boundId];
    const target = await prisma.character.findUnique({ where: { id: boundId }, select: { discordUserId: true } });
    if (target?.discordUserId) out.boundNotification = { discordUserId: target.discordUserId, content: "Someone bound you." };
  } catch (err) {
    console.error(`Post-bind settle for ${boundId} failed:`, err);
  }
  return out;
}

// The one place an offer's kind picks its accept. The web's "waiting on you"
// list calls this too — it used to keep its own copy, which had no ESCORT or
// KISS branch and so ran a ride offer through acceptLesson.
function acceptOffer(prisma, offer, responder) {
  switch (offer.kind) {
    case "BIND":
      return acceptBind(prisma, offer, responder);
    case "CONFESSION":
      return acceptConfession(prisma, offer, responder);
    case "ESCORT":
      return acceptEscort(prisma, offer, responder);
    case "KISS":
      return acceptKiss(prisma, offer, responder);
    case "COLLAR":
      return acceptCollar(prisma, offer, responder);
    case "SEARCH":
      return acceptSearch(prisma, offer, responder);
    case "CONVERSION":
      return acceptConversion(prisma, offer, responder);
    default:
      return acceptLesson(prisma, offer, responder);
  }
}

// The decline half of the same table, and the reason it needs one at all:
// declineOffer() in db/lib/lessons.js closes the row and picks wording, but
// applies NO effects, because until Conversion arrived no refusal cost the
// person refusing anything (docs/systemdocs/THANATI.md). Saying no to the dark
// god does. A `WORDING` entry over there would have written the sentence and
// quietly skipped the mood hit and the Depressed tag.
function declineOfferOfKind(prisma, offer, responder) {
  if (offer.kind === "CONVERSION") return refuseConversion(prisma, offer, { responder });
  return declineOffer(prisma, offer, responder);
}

async function answerOffer(prisma, { id, discordUserId, choice }) {
  const { offer, responder, problem } = await loadOfferFor(prisma, id, discordUserId);
  if (problem) return { ok: false, line: problem, ...empty() };

  const accepting = choice === DM_CHOICE.ACCEPT;
  const result = accepting
    ? await acceptOffer(prisma, offer, responder)
    : await declineOfferOfKind(prisma, offer, responder);

  const base = empty();
  base.dms = result.dms ?? [];
  if (result.ok && result.boundId) Object.assign(base.sideEffects, await afterBind(prisma, result.boundId));
  if (result.ok && accepting && offer.kind === "ESCORT") {
    await syncPartyMembership(prisma, offer.initiatorId).catch(() => {});
  }
  return { ok: result.ok, line: result.ok ? result.line : result.reason, ...base };
}

async function answerThreatSpawn(prisma, { id, discordUserId, choice }) {
  if (choice !== DM_CHOICE.ACCEPT) {
    const result = await declineThreatSpawn(prisma, id, discordUserId);
    return { ok: result.ok, line: result.ok ? result.line : result.reason, ...empty() };
  }

  const result = await acceptThreatSpawn(prisma, id, discordUserId);
  if (!result.ok) return { ok: false, line: result.reason, ...empty() };

  const out = empty({ spawn: result.sideEffects });

  // A seat with a `brief` (the Thanati — db/lib/threats.js) says what it is only NOW, to somebody who accepted; a decline never reads the doctrine.
  if (result.threat.brief?.length) {
    out.dms.push({ discordUserId, content: result.threat.brief.join("\n") });
  }

  try {
    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: discordUserId,
        actionType: "character_created",
        targetCharacterId: result.character.id,
        details: { threat: result.threat.name, spawn: true, role: result.character.roleTitle },
      },
    });
  } catch (err) {
    console.error("Threat spawn audit failed:", err);
  }
  try {
    await recordArchiveEvent(prisma, {
      kind: "CHARACTER_CREATED",
      character: result.character,
      zoneId: result.character.zoneId ?? null,
      turn: result.turn,
      content: `${result.character.name} arrived in Ravenheart as ${result.character.roleTitle}.`,
    });
  } catch (err) {
    console.error("Threat spawn archive failed:", err);
  }

  return { ok: true, line: result.line, character: result.character, ...out };
}

async function answerLobbySeat(prisma, { id, discordUserId }) {
  const result = await declineAssignment(prisma, id, discordUserId);
  return { ok: result.ok, line: result.ok ? result.line : result.reason, ...empty() };
}

async function answerKeyedWay(prisma, { id, discordUserId, choice }) {
  const result = await holdKeyedOpen(prisma, { discordUserId, linkId: id, hold: choice === DM_CHOICE.ACCEPT });
  if (!result.ok) return { ok: false, line: result.error, ...empty() };
  return { ok: true, line: result.note ? `${result.line}\n-# ${result.note}` : result.line, ...empty() };
}

// (docs/systemdocs/INTERCEPT.md) The odd one out: `id` is the person being
// held, and the clicker must be the one holding them — releaseHeldBy's WHERE is that check, so no separate ownership lookup here.
async function answerInterceptHold(prisma, { id, discordUserId }) {
  const holder = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: { id: true, name: true },
  });
  if (!holder) return { ok: false, line: NOT_YOURS, ...empty() };
  const freed = await releaseHeldBy(prisma, holder.id, { targetId: id });
  if (freed.length === 0) return { ok: false, line: "They're already free.", ...empty() };

  const target = freed[0];
  const dms = [];
  if (target.discordUserId && target.status === "ALIVE") {
    dms.push({ discordUserId: target.discordUserId, content: "You've been let go. You can move again." });
  }
  // Named as the holder knows them, the way the Break-off line below does.
  return { ok: true, line: `You let ${await seenById(prisma, holder.id, target.id)} go.`, ...empty(), dms };
}

// (docs/systemdocs/ATTACK.md) Same rule as above — initiator answers — but
// can't go through releaseHeldBy since BOTH sides are held; cancelAttack's WHERE is the ownership check.
async function answerAttackHold(prisma, { id, discordUserId }) {
  const attacker = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: { id: true, name: true },
  });
  if (!attacker) return { ok: false, line: NOT_YOURS, ...empty() };
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
  if (!openTurn) return { ok: false, line: GONE, ...empty() };

  // By the face the room saw, never the row — the button must not become the unmasking tool the verb refuses to be (docs/systemdocs/ATTACK.md §12, legacy).
  const target = await prisma.character.findUnique({
    where: { id },
    select: { ...IDENTITY_SELECT, status: true },
  });
  const seen = target ? await seenBy(prisma, attacker.id, target) : "them";
  const done = await cancelAttack(prisma, {
    attackerId: attacker.id,
    targetCharacterId: id,
    turnId: openTurn.id,
  });
  if (!done.ok) return { ok: false, line: "You aren't fighting them.", ...empty() };

  const dms = [];
  if (target?.discordUserId && target.status === "ALIVE") {
    dms.push({ discordUserId: target.discordUserId, content: ATTACK_CALLED_OFF_DM });
  }
  return { ok: true, line: `You break off from ${seen}.`, ...empty(), dms };
}

// (docs/systemdocs/ATTACK.md) A fight's two buttons. `id` is the clicker's own CombatParticipant, and
// combat.js checks it is theirs against the character resolved here from the clicker — never from the
// button. The combat functions carry their own refusals in `error`. Through the verbs rather than combat.js
// itself, so a press on a DM writes the same audit row as the same press in the Attack dialog (ATTACK.md §13).
async function clickerCharacter(prisma, discordUserId) {
  return prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" }, select: { id: true } });
}

async function answerCombatInvite(prisma, { id, discordUserId, choice }) {
  const me = await clickerCharacter(prisma, discordUserId);
  if (!me) return { ok: false, line: NOT_YOURS, ...empty() };
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  const out = await answerFightInvite(prisma, {
    characterId: me.id,
    discordUserId,
    participantId: id,
    join: choice === DM_CHOICE.ACCEPT,
    turn,
  });
  if (!out.ok) return { ok: false, line: out.error, ...empty() };
  return { ok: true, line: out.line, ...empty(), dms: out.dms };
}

async function answerCombatCallOff(prisma, { id, discordUserId }) {
  const me = await clickerCharacter(prisma, discordUserId);
  if (!me) return { ok: false, line: NOT_YOURS, ...empty() };
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  const out = await callOffFight(prisma, { characterId: me.id, discordUserId, participantId: id, turn });
  if (!out.ok) return { ok: false, line: out.error, ...empty() };
  return { ok: true, line: out.line, ...empty(), dms: out.dms };
}

// `action` is the descriptor off DirectMessage.meta (db/lib/dmActions.js#dmActionOf);
// `discordUserId` is the CLICKER, resolved server-side, never from the client.
// Always returns { ok, line, dms, sideEffects } — a caused refusal is never a
// throw; `line` carries the refusal too, since both faces print it unconditionally.
async function answerDmAction(prisma, { action, choice, discordUserId, amount }) {
  if (!discordUserId) return { ok: false, line: NOT_YOURS, ...empty() };
  const args = { id: action.id, discordUserId, choice, amount };
  switch (action.kind) {
    case DM_ACTION.OFFER:
      return answerOffer(prisma, args);
    case DM_ACTION.THREAT_SPAWN:
      return answerThreatSpawn(prisma, args);
    case DM_ACTION.LOBBY_SEAT:
      return answerLobbySeat(prisma, args);
    case DM_ACTION.KEYED_WAY:
      return answerKeyedWay(prisma, args);
    case DM_ACTION.INTERCEPT_HOLD:
      return answerInterceptHold(prisma, args);
    case DM_ACTION.ATTACK_HOLD:
      return answerAttackHold(prisma, args);
    case DM_ACTION.COMBAT_INVITE:
      return answerCombatInvite(prisma, args);
    // The fight's own row answers one thing with a button: Call off. Writing is a dialog on the web and a
    // modal on Discord, and never comes through here.
    case DM_ACTION.COMBAT:
      return choice === DM_CHOICE.ACCEPT ? answerCombatCallOff(prisma, args) : { ok: false, line: GONE, ...empty() };
    default:
      return { ok: false, line: GONE, ...empty() };
  }
}

module.exports = {
  answerDmAction,
  acceptOffer,
  declineOfferOfKind,
};
