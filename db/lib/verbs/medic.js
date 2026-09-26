// The Saint's Perform Miracle, both faces (docs/tags.yaml `saint:`): two free
// instant cures a turn on somebody else, capped at the cure ladder's Moderate
// rung. It was web/app/(app)/character/actions/medical.js#performMiracleRequestImpl
// and still is — that action calls the function here, and so does the Discord
// bot (bot/src/lib/verbs/captives.js). See ./common.js for the result shape.
const { resolveTargetKey, splitTargetKey } = require("../targetKey");
const { isHere, notHereMessage, concealedNow } = require("../presence");
const { SAINT_SLUG, MIRACLE_PER_TURN, isMiracleable, medicallyVisibleTags } = require("../medicalVision");
const { dropCharacterTag } = require("../tagWrites");
const { lockCharacter } = require("../moveLedger");
const { logAudit } = require("../auditLog");
const { refuse, asResult } = require("./common");

const TARGET_SELECT = {
  id: true,
  name: true,
  concealed: true,
  locationId: true,
  status: true,
  buriedAt: true,
  discordUserId: true,
  tags: { include: { tag: true } },
};

function miraclesThisTurn(db, discordUserId, turnId) {
  if (!turnId || !discordUserId) return 0;
  return db.auditLog.count({ where: { actorDiscordUserId: discordUserId, actionType: "request_perform_miracle", turnId } });
}

async function miracleTarget(prisma, character, key) {
  if (!character.locationId) refuse("You aren't anywhere you could touch anyone.");
  const id = await resolveTargetKey(prisma, character, key);
  const target = id ? await prisma.character.findFirst({ where: { id, status: "ALIVE" }, select: TARGET_SELECT }) : null;
  if (!target || !isHere(character, target, { allowConcealed: true })) {
    refuse(splitTargetKey(key).kind === "hood" ? "They aren't here." : notHereMessage(target));
  }
  if (target.id === character.id) refuse("A Saint doesn't perform miracles on themselves.");
  return target;
}

// On a masked subject, only a wound the room can plainly see. An empty
// `satisfied` set is the point: sainthood is not medical training, so the
// doctor's-eye exception buys a Saint nothing.
function touchable(target) {
  const visible = concealedNow(target)
    ? new Set(medicallyVisibleTags(target.tags, new Set(), false).map((row) => row.characterTag.tagId))
    : null;
  return target.tags.filter((ct) => isMiracleable(ct.tag) && (!visible || visible.has(ct.tagId)));
}

// What a miracle could touch on the person picked — the dialog's answer, never
// the button's.
function miracleableWounds(prisma, { character, targetKey }) {
  return asResult(async () => {
    const target = await miracleTarget(prisma, character, targetKey);
    return { wounds: touchable(target).map((ct) => ({ tagId: ct.tagId, name: ct.tag.name })), name: target.name };
  });
}

function performMiracle(prisma, { character, discordUserId, targetKey, tagId, openTurn }) {
  return asResult(async () => {
    if (!character.tags.some((ct) => ct.tag.slug === SAINT_SLUG)) refuse("Only a Saint may perform a miracle.");
    const target = await miracleTarget(prisma, character, targetKey);
    const held = touchable(target).find((ct) => ct.tagId === tagId);
    if (!held) refuse("That isn't a wound a miracle could touch.");
    if (!openTurn) refuse("No turn is open.");
    // Fast fail; the row-locked re-count below is what holds under a race.
    if ((await miraclesThisTurn(prisma, discordUserId, openTurn.id)) >= MIRACLE_PER_TURN) {
      refuse("You've used both miracles this turn.");
    }
    await prisma.$transaction(async (tx) => {
      // Sorted-id lock — the heal action's deadlock avoidance.
      for (const id of [character.id, target.id].sort()) await lockCharacter(tx, id);
      if ((await miraclesThisTurn(tx, discordUserId, openTurn.id)) >= MIRACLE_PER_TURN) {
        refuse("You've used both miracles this turn.");
      }
      const heldNow = await tx.characterTag.findUnique({
        where: { characterId_tagId: { characterId: target.id, tagId: held.tagId } },
      });
      if (!heldNow) refuse(`${target.name} no longer has that.`);
      await dropCharacterTag(tx, target.id, held.tagId);
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_perform_miracle",
        targetCharacterId: target.id,
        turnId: openTurn.id,
        details: {
          targetCharacterId: target.id,
          targetName: target.name,
          tagId: held.tagId,
          tagSlug: held.tag.slug,
          tagName: held.tag.name,
        },
      });
    });
    return {
      touched: [target.id],
      notify: [{ character: target, text: `${character.name} healed your ${held.tag.name} with a miracle.` }],
      targetName: target.name,
      tagName: held.tag.name,
      name: target.name,
    };
  });
}

module.exports = { miracleableWounds, performMiracle, miraclesThisTurn };
