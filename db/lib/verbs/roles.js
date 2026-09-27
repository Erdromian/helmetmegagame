// The verbs a role or a rare item gives, both faces: the nuke's datacard, the
// Thanati's Recall / Recover / Set hideout, the Cerberon's warrants, the
// Bishop's excommunications, the Bastard's reinforcements, and sounding the
// trumpet or the Deep Beast Horn. Each was a web server action beside
// web/app/(app)/character/ (nukeActions.js, thanatiActions.js,
// cerberonActions.js, bishopActions.js, bastardActions.js, trumpetActions.js)
// and still is — that action calls the function here, and so does the Discord
// bot (bot/src/lib/verbs/roles.js). See ./common.js for the result shape.
//
// Each re-checks the tag the button's `show` already read: a hidden button is
// a hint, not a lock. `character` needs id, name, locationId, discordUserId and
// tags[].tag.slug.
const { DEVICE_SLUG, DATACARD_SLUG, NUKE_FUSE_TURNS, pointerReading, pointerLine } = require("../nuke");
const { THANATI_SLUG, THANATI_LEADER_SLUG, RECOVERABLE_SLUGS, listComrades } = require("../thanati");
const { accessibleRooms, roomAccessKeys } = require("../roomAccess");
const { accessSlugsOf } = require("../rings");
const { grantTagSlugs, dropCharacterTag } = require("../tagWrites");
const { WANTED_SLUG, CERBERON_SLUG, WARRANT_BADGE_SLUGS, warrantTargets, unwarrantTargets, listWanted } = require("../wanted");
const {
  BISHOP_SLUG,
  EXCOMMUNICATED_SLUG,
  POST_CHRISTIAN_SLUG,
  excommunicationCap,
  excommunicateTarget,
  listExcommunications,
} = require("../excommunication");
const {
  BASTARD_TAG_SLUG,
  DEEP_BEAST_HORN_SLUG,
  MAX_REINFORCEMENTS_PER_CALL,
  openLateJoinSlots,
  reinforcementFor,
} = require("../lateJoin");
const { HORN_COOLDOWN_MS } = require("../deepBeastHorn");
const { TRUMPET_COOLDOWN_MS } = require("../trumpet");
const { TRUMPET_SLUG } = require("../constants");
const { OBOL_SLUG } = require("../depotState");
const { readCharacterResources, takeCharacterResources } = require("../resourceStack");
const { blockerFor, ACT } = require("../incapacitation");
const { FULL_NAME_LIMIT } = require("../characterName");
const { logAudit } = require("../auditLog");
const { SFX } = require("../sfx");
const { refuse, asResult, requireFreeMove, fileAutoRoutine } = require("./common");

// Held slugs plus the worn ring's doors (docs/systemdocs/RINGS.md): the Censor's
// ring is his warrant badge.
function slugsOf(character) {
  return accessSlugsOf(character.tags);
}

// --- The datacard (web: nukeActions.js) ----------------------------------------

// Use Pointer moves nothing and files nothing. The answer is DM'd, so reading
// the card in a room full of people gives nothing away (`dm` says so).
function readDatacard(prisma, { character }) {
  return asResult(async () => {
    if (!slugsOf(character).has(DATACARD_SLUG)) refuse("You aren't carrying the datacard.");
    const reading = await pointerReading(prisma, character.locationId);
    const line = pointerLine(reading);
    return { line, here: Boolean(reading.here), dm: { discordUserId: character.discordUserId, content: line } };
  });
}

function requireBoth(character) {
  const slugs = slugsOf(character);
  if (!slugs.has(DATACARD_SLUG)) refuse("You aren't carrying the datacard.");
  if (!slugs.has(DEVICE_SLUG)) refuse("The device isn't here in your hands.");
}

// Arm and Disarm DO file a row: they change the world and a GM must be able to
// see and reverse them. The detonation stamp comes off the current Game.
function armNuke(prisma, { character, discordUserId, openTurn }) {
  return asResult(async () => {
    requireBoth(character);
    if (!openTurn) refuse("No turn is open.");
    const state = await prisma.gameState.findUnique({
      where: { id: 1 },
      include: { game: { select: { nukeDetonatedTurn: true } } },
    });
    if (state?.game?.nukeDetonatedTurn != null) refuse("It's already gone off.");
    if (state?.nukeArmedTurn != null) refuse("It's already counting down.");
    // Armed while turn T is open, it goes at the close of T+1.
    const firesOn = openTurn.number + NUKE_FUSE_TURNS - 1;
    const effect = { firesOn, armedOnTurn: openTurn.number, gameId: state?.gameId ?? null, locationId: character.locationId };
    await prisma.$transaction(async (tx) => {
      await tx.gameState.update({ where: { id: 1 }, data: { nukeArmedTurn: firesOn } });
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_arm_nuke",
        targetCharacterId: character.id,
        details: effect,
      });
    });
    return { firesOn, line: `The card is in and the count has begun. It goes off at the close of turn ${firesOn}.` };
  });
}

function disarmNuke(prisma, { character, discordUserId, openTurn }) {
  return asResult(async () => {
    requireBoth(character);
    if (!openTurn) refuse("No turn is open.");
    const state = await prisma.gameState.findUnique({
      where: { id: 1 },
      include: { game: { select: { nukeDetonatedTurn: true } } },
    });
    if (state?.game?.nukeDetonatedTurn != null) refuse("It's already gone off.");
    if (state?.nukeArmedTurn == null) refuse("It isn't armed.");
    const effect = { wasFiringOn: state.nukeArmedTurn, disarmedOnTurn: openTurn.number, gameId: state?.gameId ?? null };
    await prisma.$transaction(async (tx) => {
      await tx.gameState.update({ where: { id: 1 }, data: { nukeArmedTurn: null } });
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_disarm_nuke",
        targetCharacterId: character.id,
        details: effect,
      });
    });
    return { disarmed: true, line: "The card is out. The count is stopped." };
  });
}

// --- The Thanati (web: thanatiActions.js) ---------------------------------------

function requireThanati(character) {
  if (!slugsOf(character).has(THANATI_SLUG)) refuse("Not yours to press.");
}

function recallComrades(prisma, { character, discordUserId }) {
  return asResult(async () => {
    requireThanati(character);
    const rows = await listComrades(prisma);
    await logAudit(prisma, {
      actorDiscordUserId: discordUserId,
      actionType: "request_recall_comrades",
      targetCharacterId: character.id,
      details: { comrades: rows.map((r) => r.name) },
    });
    return {
      roster: rows.map((r) => ({ name: r.name, role: r.role, leader: r.leader })),
      line: rows.length ? "Your comrades." : "You are the last of them.",
    };
  });
}

// Hands back whichever of the robes and the mask the cultist is not holding.
// Spends the Move, and not on two turns running — the previous turn's audit
// row is the cooldown.
const RECOVER_ACTION = "request_recover_equipment";

function recoverEquipment(prisma, { character, discordUserId, openTurn }) {
  return asResult(async () => {
    requireThanati(character);
    const slugs = slugsOf(character);
    const missing = RECOVERABLE_SLUGS.filter((slug) => !slugs.has(slug));
    if (missing.length === 0) refuse("You already hold both.");
    await requireFreeMove(prisma, character, openTurn);
    const recentTurns = await prisma.turn.findMany({
      where: { number: { in: [openTurn.number, openTurn.number - 1] } },
      select: { id: true },
    });
    const recent = await prisma.auditLog.count({
      where: { actionType: RECOVER_ACTION, actorDiscordUserId: discordUserId, turnId: { in: recentTurns.map((t) => t.id) } },
    });
    if (recent > 0) refuse("Not again so soon.");
    const granted = await prisma.$transaction(async (tx) => {
      const rows = await grantTagSlugs(tx, character.id, missing, openTurn.number);
      await fileAutoRoutine(tx, character, openTurn, "Recovered equipment.", "auto:recover");
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: RECOVER_ACTION,
        targetCharacterId: character.id,
        turnId: openTurn.id,
        details: { granted: rows.map((r) => r.tagName) },
      });
      return rows;
    });
    const names = granted.map((r) => r.tagName);
    return {
      touched: [character.id],
      granted: names,
      line: `${names.join(" and ")} back in your hands — and that's your Move for the turn.`,
    };
  });
}

// The rooms here a leader could make the hideout: behind a door they can open.
async function hideoutChoices(prisma, character) {
  if (!character.locationId) return [];
  const [rooms, keys] = await Promise.all([
    prisma.room.findMany({
      where: { locationId: character.locationId, retiredAt: null },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, kind: true, locationId: true, accessTagSlugs: true },
    }),
    roomAccessKeys(prisma, character.id),
  ]);
  return accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds);
}

function setHideout(prisma, { character, discordUserId, roomId }) {
  return asResult(async () => {
    requireThanati(character);
    if (!slugsOf(character).has(THANATI_LEADER_SLUG)) refuse("Not yours to press.");
    const room = await prisma.room.findUnique({
      where: { id: String(roomId ?? "") },
      select: { id: true, name: true, kind: true, locationId: true, accessTagSlugs: true },
    });
    if (!room || room.locationId !== character.locationId) refuse("That room isn't here.");
    const keys = await roomAccessKeys(prisma, character.id);
    if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
      refuse("That door is locked.");
    }
    await prisma.gameState.update({ where: { id: 1 }, data: { thanatiHideoutRoomId: room.id } });
    await logAudit(prisma, {
      actorDiscordUserId: discordUserId,
      actionType: "thanati_hideout_set",
      targetCharacterId: character.id,
      details: { roomId: room.id, room: room.name },
    });
    return { room: room.name, line: `The hideout is ${room.name} now.` };
  });
}

// --- The Cerberon (web: cerberonActions.js) -------------------------------------

// The name is TYPED, never picked: a dropdown would be the roster handed to
// anyone with a badge. A name two living men answer to warrants BOTH.
async function warrantCandidates(prisma) {
  return prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      tags: { where: { tag: { slug: WANTED_SLUG } }, select: { id: true, tagId: true } },
    },
  });
}

function requireBadge(character) {
  if (!WARRANT_BADGE_SLUGS.some((slug) => slugsOf(character).has(slug))) refuse("Not yours to press.");
}

function arrestWarrant(prisma, { character, discordUserId, name: rawName, openTurn }) {
  return asResult(async () => {
    requireBadge(character);
    const typed = rawName?.toString().trim().slice(0, FULL_NAME_LIMIT) ?? "";
    if (!typed) refuse("Whose name?");
    const { matched, targets, skippedSelf, alreadyWanted } = warrantTargets(await warrantCandidates(prisma), typed, {
      selfId: character.id,
    });
    if (matched === 0) refuse("There's nobody with that name.");
    if (targets.length === 0) {
      if (alreadyWanted > 0) refuse("That person is already marked as wanted.");
      if (skippedSelf > 0) refuse("Swear it out on somebody else.");
      refuse("There's nobody with that name.");
    }
    await prisma.$transaction(async (tx) => {
      for (const target of targets) {
        await grantTagSlugs(tx, target.id, [WANTED_SLUG], openTurn?.number ?? null);
        // One row PER MAN — /gm/audit is read by target.
        await logAudit(tx, {
          actorDiscordUserId: discordUserId,
          actionType: "request_arrest_warrant",
          targetCharacterId: target.id,
          turnId: openTurn?.id ?? null,
          details: { name: target.name, typed, by: character.name, ...(matched > 1 ? { answeringToThatName: matched } : {}) },
        });
      }
    });
    const name = targets[0].name;
    return {
      touched: targets.map((t) => t.id),
      name,
      caught: targets.length,
      line: matched > 1 ? `A warrant is out on ${name} — ${matched} men answer to that name.` : `A warrant is out on ${name}.`,
    };
  });
}

function removeWarrant(prisma, { character, discordUserId, name: rawName, openTurn }) {
  return asResult(async () => {
    requireBadge(character);
    const typed = rawName?.toString().trim().slice(0, FULL_NAME_LIMIT) ?? "";
    if (!typed) refuse("Whose name?");
    const { matched, targets, skippedSelf, notWanted } = unwarrantTargets(await warrantCandidates(prisma), typed, {
      selfId: character.id,
    });
    if (matched === 0) refuse("There's nobody with that name.");
    if (targets.length === 0) {
      if (notWanted > 0) refuse("That person isn't wanted.");
      if (skippedSelf > 0) refuse("Somebody else has to lift it.");
      refuse("There's nobody with that name.");
    }
    await prisma.$transaction(async (tx) => {
      for (const target of targets) {
        await dropCharacterTag(tx, target.id, target.tags[0].tagId);
        await logAudit(tx, {
          actorDiscordUserId: discordUserId,
          actionType: "request_remove_warrant",
          targetCharacterId: target.id,
          turnId: openTurn?.id ?? null,
          details: { name: target.name, typed, by: character.name, ...(matched > 1 ? { answeringToThatName: matched } : {}) },
        });
      }
    });
    const name = targets[0].name;
    return {
      touched: targets.map((t) => t.id),
      name,
      caught: targets.length,
      line:
        matched > 1 ? `The warrant on ${name} is lifted — ${matched} men answer to that name.` : `The warrant on ${name} is lifted.`,
    };
  });
}

// The warrant book, read. Names only — the role is a spoiler.
function checkWanted(prisma, { character, discordUserId }) {
  return asResult(async () => {
    if (!slugsOf(character).has(CERBERON_SLUG)) refuse("Not yours to press.");
    const rows = await listWanted(prisma);
    await logAudit(prisma, {
      actorDiscordUserId: discordUserId,
      actionType: "request_check_wanted",
      targetCharacterId: character.id,
      details: { wanted: rows.map((r) => r.name) },
    });
    return { roster: rows.map((r) => ({ name: r.name })), line: rows.length ? "The warrant book." : "Nobody is wanted." };
  });
}

// --- The Bishop (web: bishopActions.js) -----------------------------------------

// Only three sentences ever reach a player from here, and all three are
// Bascinet's. Do not add a fourth. Bascinet's words, verbatim.
const NOT_POST_CHRISTIAN = "They're not Post-Christian.";
const NOT_A_PERSON = "That isn't a valid person.";

function counter(n, cap) {
  return `${n}/${cap} people excommunicated`;
}

function requireBishop(character) {
  const slugs = slugsOf(character);
  if (!slugs.has(BISHOP_SLUG)) refuse(NOT_A_PERSON);
  return excommunicationCap(slugs);
}

// The name is TYPED, and an ambiguous one REFUSES: a seat of the cap is precious.
function excommunicate(prisma, { character, discordUserId, name: rawName, openTurn }) {
  return asResult(async () => {
    const cap = requireBishop(character);
    const typed = rawName?.toString().trim().slice(0, FULL_NAME_LIMIT) ?? "";
    if (!typed) refuse(NOT_A_PERSON);
    const candidates = await prisma.character.findMany({
      where: { status: "ALIVE" },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        discordUserId: true,
        status: true,
        tags: { where: { quantity: { gt: 0 }, tag: { slug: POST_CHRISTIAN_SLUG } }, select: { tagId: true } },
        excommunicationBorne: { select: { id: true } },
      },
    });
    const { target, reason } = excommunicateTarget(candidates, typed, { selfId: character.id });
    if (reason === "not-post-christian") refuse(NOT_POST_CHRISTIAN);
    if (!target) refuse(NOT_A_PERSON);
    const held = await prisma.excommunication.count({ where: { bishopId: character.id } });
    if (held >= cap) refuse(counter(held, cap));
    await prisma.$transaction(async (tx) => {
      await tx.excommunication.create({ data: { bishopId: character.id, targetCharacterId: target.id } });
      await grantTagSlugs(tx, target.id, [EXCOMMUNICATED_SLUG], openTurn?.number ?? null);
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_excommunicate",
        targetCharacterId: target.id,
        turnId: openTurn?.id ?? null,
        details: { name: target.name, typed, by: character.name },
      });
    });
    const roster = await listExcommunications(prisma, character.id);
    return {
      touched: [target.id],
      // Bascinet's words, verbatim.
      notify: [
        { character: target, text: "You have been excommunicated, cursing you until it is lifted.", opts: { sfx: SFX.BANISH } },
      ],
      name: target.name,
      roster,
      line: counter(roster.length, cap),
    };
  });
}

// From the Bishop's own list: another Bishop's mark is not yours to take off,
// and which of the two a refusal was must not be told apart.
function liftExcommunication(prisma, { character, discordUserId, targetId: rawId, openTurn }) {
  return asResult(async () => {
    const cap = requireBishop(character);
    const targetId = rawId?.toString().trim() ?? "";
    const row = targetId
      ? await prisma.excommunication.findUnique({
          where: { targetCharacterId: targetId },
          select: {
            id: true,
            bishopId: true,
            targetCharacter: { select: { id: true, name: true, discordUserId: true, status: true } },
          },
        })
      : null;
    if (!row || row.bishopId !== character.id) refuse(NOT_A_PERSON);
    const target = row.targetCharacter;
    const tag = await prisma.tag.findUnique({ where: { slug: EXCOMMUNICATED_SLUG }, select: { id: true } });
    await prisma.$transaction(async (tx) => {
      await tx.excommunication.delete({ where: { id: row.id } });
      if (tag) await dropCharacterTag(tx, target.id, tag.id);
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_lift_excommunication",
        targetCharacterId: target.id,
        turnId: openTurn?.id ?? null,
        details: { name: target.name, by: character.name },
      });
    });
    const roster = await listExcommunications(prisma, character.id);
    return {
      touched: [target.id],
      // Bascinet's words, verbatim.
      notify: [{ character: target, text: "You are no longer excommunicated." }],
      name: target.name,
      roster,
      line: counter(roster.length, cap),
    };
  });
}

// --- The Bastard (web: bastardActions.js#callReinforcements) ---------------------

// Buys a CHAIR, not a person: a late-join seat a real player walks into.
// Priced and drawn inside the transaction; obols first, then ⬢, at par.
function callReinforcements(prisma, { character, discordUserId, roleSlug, quantity = 1 }) {
  return asResult(async () => {
    if (!slugsOf(character).has(BASTARD_TAG_SLUG)) refuse("Only the Bastard calls reinforcements.");
    const reinforcement = reinforcementFor(String(roleSlug ?? ""));
    if (!reinforcement) refuse("There's nobody by that name to call.");
    const count = Math.trunc(Number(quantity));
    if (!Number.isInteger(count) || count < 1 || count > MAX_REINFORCEMENTS_PER_CALL) {
      refuse(`Call between 1 and ${MAX_REINFORCEMENTS_PER_CALL} at a time.`);
    }
    const total = reinforcement.price * count;
    const tooPoor = `You can't cover ${total} ¢.`;
    const obolTag = await prisma.tag.findUnique({ where: { slug: OBOL_SLUG }, select: { id: true } });
    await prisma.$transaction(async (tx) => {
      const [obolRow, resources] = await Promise.all([
        obolTag
          ? tx.characterTag.findUnique({
              where: { characterId_tagId: { characterId: character.id, tagId: obolTag.id } },
              select: { quantity: true },
            })
          : null,
        readCharacterResources(tx, character.id),
      ]);
      const obols = obolRow?.quantity ?? 0;
      if (obols + resources < total) refuse(tooPoor);
      const fromObols = Math.min(total, obols);
      const fromResources = total - fromObols;
      if (fromObols > 0) {
        const hit = await tx.characterTag.updateMany({
          where: { characterId: character.id, tagId: obolTag.id, quantity: { gte: fromObols } },
          data: { quantity: { decrement: fromObols } },
        });
        if (hit.count === 0) refuse(tooPoor);
        await tx.characterTag.deleteMany({ where: { characterId: character.id, tagId: obolTag.id, quantity: { lte: 0 } } });
      }
      if (fromResources > 0 && !(await takeCharacterResources(tx, character.id, fromResources))) refuse(tooPoor);
      await openLateJoinSlots(tx, reinforcement.roleSlug, count);
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: discordUserId,
          actionType: "reinforcements_called",
          targetCharacterId: character.id,
          details: {
            characterName: character.name,
            roleSlug: reinforcement.roleSlug,
            quantity: count,
            paidObols: fromObols,
            paidResources: fromResources,
          },
        },
      });
    });
    return {
      touched: [character.id],
      line: `${count} ${reinforcement.name} ${count === 1 ? "seat is" : "seats are"} open.`,
    };
  });
}

// --- The trumpet and the Deep Beast Horn (web: trumpetActions.js, bastardActions.js) ---

// A courtesy against spam, not game state. Each process keeps its own clock
// and claims it BEFORE the broadcast (a fan-out long enough for a second
// click to slip past a stamp at the end); the last audit row is the clock the
// two faces share, so sounding it on the web and then on Discord still waits.
const lastSounded = new Map();

async function soundItem(prisma, { character, discordUserId, slug, cooldownMs, actionType, missing, blockedPrefix, lungs }) {
  return asResult(async () => {
    if (!slugsOf(character).has(slug)) refuse(missing);
    if (!character.locationId) refuse("You're nowhere.");
    // ACT, not SPEAK: it takes breath AND hands, so Bound stops it where a shout isn't.
    const blocker = blockerFor(character.tags, ACT);
    if (blocker) refuse(`${blockedPrefix} — you're ${blocker.name}.`);
    const key = `${actionType}:${character.id}`;
    const lastRow = await prisma.auditLog.findFirst({
      where: { actionType, targetCharacterId: character.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const last = Math.max(lastSounded.get(key) ?? 0, lastRow?.createdAt ? new Date(lastRow.createdAt).getTime() : 0);
    const since = Date.now() - last;
    if (since < cooldownMs) {
      const minutes = Math.max(1, Math.ceil((cooldownMs - since) / 60_000));
      refuse(`Your ${lungs} need about ${minutes} more minute${minutes === 1 ? "" : "s"}.`);
    }
    lastSounded.set(key, Date.now());
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: discordUserId,
          actionType,
          targetCharacterId: character.id,
          details: { characterName: character.name, locationId: character.locationId },
        },
      })
      .catch((err) => console.error(`${actionType} audit log failed:`, err));
    // The broadcast is the face's to send, post-commit and catch-logged
    // (ARCHITECTURE.md §5): db/lib/trumpet.js / deepBeastHorn.js.
    return { locationId: character.locationId };
  });
}

function soundTrumpet(prisma, { character, discordUserId }) {
  return soundItem(prisma, {
    character,
    discordUserId,
    slug: TRUMPET_SLUG,
    cooldownMs: TRUMPET_COOLDOWN_MS,
    actionType: "trumpet_sounded",
    missing: "You aren't carrying a trumpet.",
    blockedPrefix: "You can't play the instrument",
    lungs: "lips",
  });
}

function soundHorn(prisma, { character, discordUserId }) {
  return soundItem(prisma, {
    character,
    discordUserId,
    slug: DEEP_BEAST_HORN_SLUG,
    cooldownMs: HORN_COOLDOWN_MS,
    actionType: "deep_beast_horn_sounded",
    missing: "You aren't carrying the horn.",
    blockedPrefix: "You can't raise it",
    lungs: "lungs",
  });
}

module.exports = {
  readDatacard,
  armNuke,
  disarmNuke,
  recallComrades,
  recoverEquipment,
  hideoutChoices,
  setHideout,
  arrestWarrant,
  removeWarrant,
  checkWanted,
  excommunicate,
  liftExcommunication,
  callReinforcements,
  soundTrumpet,
  soundHorn,
};
