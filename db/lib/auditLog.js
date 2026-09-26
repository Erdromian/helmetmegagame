// One player action's audit row — the db/lib twin of web/lib/requests.js#logAudit,
// for the verbs the Discord bot runs itself. Same columns, same place pair, so a
// row written from Discord reads on /gm/audit exactly like one from the web, and
// the per-turn rations that COUNT these rows (REQUESTS.md §1a) count both faces.
// `tx` is prisma or a transaction client.
const { placePairForAudit } = require("./placeKey");

async function logAudit(tx, { actorDiscordUserId, actionType, targetCharacterId, turnId, details, place }) {
  const { locationId, roomId } = await placePairForAudit(tx, place);
  return tx.auditLog.create({
    data: {
      actorDiscordUserId,
      actionType,
      targetCharacterId: targetCharacterId ?? null,
      turnId: turnId ?? null,
      details: details ?? {},
      locationId,
      roomId,
    },
  });
}

module.exports = { logAudit };
