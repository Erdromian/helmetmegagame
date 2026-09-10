// TODO(rewire): this is a faithful extraction of
// bot/src/events/interactionCreate.js#handleConcealCommand (the `/conceal`
// handler, around lines 1384-1443 at 2f4f79ca). The bot still runs its own
// copy; it should call toggleConceal() instead, and answer with the `line`
// this returns. Same gates, same refusal sentences, same audit row — so the
// rewiring is one edit and no behaviour change.

// /conceal, as a rule rather than as a handler.
//
// A standing state, not a per-message prefix. While it is on, every message
// proxies under the alias with the unknown silhouette, and Who's here lists
// the alias instead of the name.
//
// Three refusals, in the bot's own order and words:
//
//   - A held forcesName tag refuses outright. That identity is fixed, and
//     there is nothing to hide.
//   - A bare face has nothing to toggle. Concealment is a property of what
//     you are wearing, not a free action.
//   - Something that FORCES concealment is already hiding you, and it does
//     not come off by asking. The column is left alone in that case, so
//     whatever the player last chose is what they go back to when the thing
//     comes off.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.

const { loadForcedName, loadConcealment } = require("./presentedIdentity");
const { concealedAlias, withArticle } = require("./concealedIdentity");

// `character` needs { id, concealed, age, gender } and, for the audit row,
// { discordUserId }. Returns { ok, concealed, alias, line } or
// { ok: false, error }.
async function toggleConceal(prisma, character) {
  if (!character?.id) return { ok: false, error: "You don't have a living character." };

  const forcedName = await loadForcedName(prisma, character.id);
  if (forcedName) {
    return { ok: false, error: `You are ${forcedName} now.` };
  }

  const concealment = await loadConcealment(prisma, character.id);
  if (!concealment) {
    return { ok: false, error: "Conceal your face first." };
  }
  if (concealment.forced) {
    return {
      ok: false,
      error: concealment.name
        ? `The ${concealment.name} already conceals you.`
        : "That already conceals you.",
    };
  }

  const concealed = !character.concealed;
  await prisma.character.update({ where: { id: character.id }, data: { concealed } });

  const alias = concealedAlias(character);
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: character.discordUserId ?? "",
        actionType: "character_conceal_toggled",
        targetCharacterId: character.id,
        details: { concealed },
      },
    })
    .catch((err) => console.error("Conceal audit log failed:", err));

  return {
    ok: true,
    concealed,
    alias: concealed ? alias : null,
    line: concealed
      ? `You now speak as **${withArticle(alias.toLowerCase())}**.`
      : "You speak under your real name again.",
  };
}

module.exports = { toggleConceal };
