// /conceal, as a rule rather than as a handler. Both faces call it —
// bot/src/events/interactionCreate.js#handleConcealCommand and the web's Chat
// composer — so the refusals read the same wherever you meet them.
//
// A standing state, not a per-message prefix. While it is on, every message
// proxies under the alias with the unknown silhouette, and Who's here lists
// the alias instead of the name.
//
// Three refusals, in order:
//
//   - A held forcesName tag refuses outright. That identity is fixed, and
//     there is nothing to hide.
//   - A bare face has nothing to toggle. Concealment is a property of what
//     you are wearing, not a free action.
//   - Something that FORCES concealment is already hiding you, and it does
//     not come off by asking. The column is left alone in that case, so
//     whatever the player last chose is what they go back to when the thing
//     comes off. That line has to say which way the refusal points, and an
//     older one ("take it off first") said the opposite of the truth: a
//     forcesConceal piece is ALREADY hiding you — presentedIdentity conceals
//     on piece.forced alone — so a player who read it reasonably concluded
//     their helmet had broken concealment rather than granted it. Name the
//     piece where we know it.
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
