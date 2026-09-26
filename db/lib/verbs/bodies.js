// Laying the dead to rest, both faces: Bury and Engrave. Each was a web server
// action in web/app/(app)/character/actions/corpse.js and still is — that
// action calls the function here, and so does the Discord bot
// (bot/src/lib/verbs/captives.js). Both lift the dead player's CURSE and leave
// their watching seat alone (db/lib/curse.js, db/lib/ghost.js). See
// ./common.js for the result shape.
const { corpsesInReach } = require("../corpses");
const { dropRoomTag, addToStack } = require("../tagWrites");
const { checkLedgerMove, spendLedgerMove } = require("../moveLedger");
const { autoMovesOpen } = require("../turnGate");
const { mintHeadstone } = require("../headstone");
const { resourcesOf } = require("../resourceStack");
const { matchesTypedName, FULL_NAME_LIMIT } = require("../characterName");
const { ENGRAVE_RESOURCE_COST, SHOVEL_SLUG } = require("../constants");
const { logAudit } = require("../auditLog");
const { refuse, asResult, moveResources } = require("./common");

// A whole turn's Routine each, on the same ledger crafting uses (CRAFTING.md
// §2a). A SHOVEL halves the digging and does nothing for the stone.
const BURIAL_MOVE = { num: 1, den: 1, family: "burial" };
const SHOVEL_BURY = { num: 1, den: 2, family: "burial" };

function burialLedgerEntry(name, need) {
  return { tagId: null, name, family: "burial", qty: 1, num: need.num, den: need.den };
}

// web character/actions/shared.js#resolveCraftMove: the fast fail outside
// the transaction; spendCraftMove below re-asks under the row lock.
async function resolveCraftMove(prisma, character, openTurn, need) {
  if (!openTurn) refuse("No turn is open.");
  const gate = await autoMovesOpen(prisma, { turn: openTurn });
  if (!gate.ok) refuse(gate.message);
  const action = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true, gmNotes: true, craftBudget: true },
  });
  const out = checkLedgerMove(action, need);
  if (!out.ok) refuse(out.reason);
}

async function spendCraftMove(tx, { character, openTurn, need, entry, notes }) {
  const out = await spendLedgerMove(tx, { character, turn: openTurn, need, entry, description: null, notes });
  if (!out.ok) refuse(out.reason);
}

// The bodies a character can reach that still hold a soul to free — Bury's
// list. One refusal for "you made that up" and "someone got there first".
async function buriableBodies(prisma, character) {
  const reachable = await corpsesInReach(prisma, character);
  return reachable.filter((c) => c.human && c.deadCharacterId);
}

// --- Bury (web: corpse.js#buryCharacterRequestImpl) ---------------------------

// Takes the body — you have to have it, or reach it — and spends your whole
// Move, or half of it with a Shovel equipped. `announce` is the room line the
// face owes when the body came out of a stash (db/lib/roomAnnounce.js).
function buryCorpse(prisma, { character, discordUserId, tagId, sourceKey, openTurn }) {
  return asResult(async () => {
    const corpse = (await corpsesInReach(prisma, character)).find((c) => c.tagId === tagId && c.sourceKey === sourceKey);
    if (!corpse) refuse("That body isn't there any more.");
    if (!corpse.human || !corpse.deadCharacterId) refuse("There's no soul in that one.");
    const target = await prisma.character.findUnique({ where: { id: corpse.deadCharacterId } });
    if (!target) refuse("There's nobody left to bury.");
    if (target.buriedAt) refuse("They're already in the ground.");
    // Resolved ONCE, so an unequip between two checks can't bill half a Move
    // for work the gate passed at a whole one.
    const need = character.tags.some((ct) => ct.equipped && ct.tag?.slug === SHOVEL_SLUG) ? SHOVEL_BURY : BURIAL_MOVE;
    await resolveCraftMove(prisma, character, openTurn, need);
    const buriedAt = new Date();
    await prisma.$transaction(async (tx) => {
      // The conditional write IS the check, in both branches.
      if (corpse.source.kind === "room") {
        const { ok } = await dropRoomTag(tx, corpse.source.id, corpse.tagId, 1);
        if (!ok) refuse("That body isn't there any more.");
      } else {
        const gone = await tx.characterTag.deleteMany({ where: { characterId: corpse.source.id, tagId: corpse.tagId } });
        if (gone.count === 0) refuse("That body isn't there any more.");
      }
      await tx.character.update({ where: { id: target.id }, data: { buriedAt } });
      await spendCraftMove(tx, {
        character,
        openTurn,
        need,
        entry: burialLedgerEntry(`Buried ${target.name}`, need),
        notes: "auto:craft auto:bury",
      });
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_bury_character",
        targetCharacterId: target.id,
        details: { zoneId: character.zoneId, corpse: corpse.tagName },
      });
    });
    return {
      touched: [character.id],
      notify: [
        {
          character: target,
          text: "Your body was buried. The curse has lifted — you may make a new character. You are still watching.",
        },
      ],
      speak: [{ locationId: character.locationId, text: `${target.name} was buried.` }],
      announce: corpse.source.kind === "room" ? { source: corpse.source, text: "takes a body away." } : null,
      name: target.name,
    };
  });
}

// --- Engrave (web: corpse.js#engraveHeadstoneRequestImpl) ---------------------

// The answer to a body nobody can find: the name is TYPED, never picked — a
// dropdown would answer "who is dead?" over every corpse in Ravenheart. Two
// dead people with the same name are a GM's to sort out.
function engraveHeadstone(prisma, { character, discordUserId, name: rawName, openTurn }) {
  return asResult(async () => {
    const typed = rawName?.toString().trim().slice(0, FULL_NAME_LIMIT) ?? "";
    if (!typed) refuse("Whose name?");
    const candidates = await prisma.character.findMany({ where: { status: "DEAD", buriedAt: null } });
    const matches = candidates.filter((c) => matchesTypedName(c, typed));
    if (matches.length === 0) refuse("Nobody by that name is dead and unburied.");
    if (matches.length > 1) refuse("More than one dead person answers to that name. A GM will have to do it.");
    const target = matches[0];
    if (resourcesOf(character) < ENGRAVE_RESOURCE_COST) refuse(`Engraving costs ${ENGRAVE_RESOURCE_COST} ⬢.`);
    await resolveCraftMove(prisma, character, openTurn, BURIAL_MOVE);
    const buriedAt = new Date();
    const headstone = await prisma.$transaction(async (tx) => {
      // The conditional debit is the check that actually holds.
      await moveResources(tx, { kind: "character", id: character.id, name: character.name }, -ENGRAVE_RESOURCE_COST);
      await tx.character.update({ where: { id: target.id }, data: { buriedAt } });
      const stone = await mintHeadstone(tx, target);
      await addToStack(tx, character.id, stone.id, 1, { source: "EVENT", expiresTurn: null, stackable: false });
      await spendCraftMove(tx, {
        character,
        openTurn,
        need: BURIAL_MOVE,
        entry: burialLedgerEntry(`Engraved a headstone for ${target.name}`, BURIAL_MOVE),
        notes: "auto:craft auto:engrave",
      });
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_engrave_headstone",
        targetCharacterId: target.id,
        details: { spent: ENGRAVE_RESOURCE_COST },
      });
      return stone;
    });
    return {
      touched: [character.id],
      notify: [
        {
          character: target,
          text: "Somebody carved your name in stone. The curse has lifted — you may make a new character. You are still watching.",
        },
      ],
      speak: [{ locationId: character.locationId, text: `A headstone was engraved for ${target.name}.` }],
      name: target.name,
      headstone: headstone.name,
    };
  });
}

module.exports = { buriableBodies, buryCorpse, engraveHeadstone, BURIAL_MOVE, SHOVEL_BURY };
