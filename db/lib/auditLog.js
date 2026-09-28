// One player action's audit row — the db/lib twin of web/lib/requests.js#logAudit,
// for the verbs the Discord bot runs itself. Same columns, same place pair, so a
// row written from Discord reads on /gm/audit exactly like one from the web, and
// the per-turn rations that COUNT these rows (REQUESTS.md §1a) count both faces.
// `tx` is prisma or a transaction client.
//
// It also files the act in the archive (./archiveActions.js), through the same
// `tx`, which is why a player action writes its row here and never with a raw
// auditLog.create (ARCHIVE.md).
const { placePairForAudit } = require("./placeKey");
const { fileAuditInArchive } = require("./archiveActions");

async function logAudit(tx, { actorDiscordUserId, actionType, targetCharacterId, turnId, details, place }) {
  const { locationId, roomId } = await placePairForAudit(tx, place);
  const row = await tx.auditLog.create({
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
  await fileAuditInArchive(tx, row);
  return row;
}

module.exports = { logAudit };
