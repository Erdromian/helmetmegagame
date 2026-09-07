// Moved into @lifeweb/db (db/lib/moveConfirm.js) once the Hall's Move dialog
// (web/app/(app)/play/actions.js) needed the same confirm step the #turns
// modal runs — a filed-but-unconfirmed Move stays PENDING_TYPE and never
// reaches the staged push. Kept as a thin shim so the bot's existing
// `../lib/moveConfirm` require and its (action, actorDiscordUserId, opts)
// signature keep working, with the singleton client bound here — a db/lib
// module takes prisma as a parameter rather than requiring the barrel back.
const { prisma } = require("@lifeweb/db");
const { confirmMove: confirmMoveWith } = require("@lifeweb/db/lib/moveConfirm");

function confirmMove(action, actorDiscordUserId, options = {}) {
  return confirmMoveWith(prisma, action, actorDiscordUserId, options);
}

module.exports = { confirmMove };
