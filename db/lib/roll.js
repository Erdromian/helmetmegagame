// TODO(rewire): castDie() below is the shared form of
// bot/src/events/interactionCreate.js#handleRollCommand (around lines
// 1747-1752 at 2f4f79ca). The bot still runs its own copy, which posts
// `» *A die is cast* — **N**` into the channel and records nothing; it should
// call castDie() with the channel's place key instead, so a die rolled on
// Discord is a die Chat and /archive can both see.

// The one die a player rolls for themselves.
//
// It is written as a SYSTEM archive row (db/lib/scene.js) rather than as an
// interaction reply, for the reason the bot's own comment gives: a public
// reply carries Discord's "@account used /roll" header and outs the player
// behind the character (PROXYING.md).
//
// The row is written BESIDE the Discord post, never instead of it. The outbox
// carries WEB rows only — a SYSTEM row is deliberately never echoed into a
// channel (db/lib/scene.js) — so a caller that wants both faces to see the die
// has to do both, and this does.
//
// Who rolled it IS named, unlike a shout. A die is an act, not a noise, and
// the alias is what a concealed roller is named by — presentedIdentity is the
// same resolution every other line about them uses.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.

const { rollDie } = require("./moveEffects");
const { sceneLine } = require("./scene");
const { discordTargetForPlaceKey } = require("./placeKey");
const { postMessage } = require("./discordRest");
const { loadForcedName, loadConcealment, presentedIdentity } = require("./presentedIdentity");

// `character` needs { id, name, age, gender, concealed, webOnly }.
// Returns { ok, value, line } or { ok: false, error }.
async function castDie(prisma, character, placeKey) {
  if (!character?.id) return { ok: false, error: "You don't have a living character. ‡" };
  if (!placeKey) return { ok: false, error: "There's nowhere to roll it. ‡" };

  const [forcedName, concealment] = await Promise.all([
    loadForcedName(prisma, character.id),
    loadConcealment(prisma, character.id),
  ]);
  const who = presentedIdentity(character, { forcedName, concealment }).name ?? "Somebody";

  const value = rollDie(6);
  // Signed HERE, once, rather than by sceneLine: the same sentence goes to
  // Discord below, and a line drafted by Claude is drafted on both faces.
  // `signed: false` is what stops the archive row carrying two marks.
  const text = `${who} casts a die — **${value}**. ‡`;

  // The archive row first: it is what Chat shows, and it is the half that
  // cannot fail silently for a web-only player.
  await sceneLine(prisma, { placeKey, text, signed: false });

  // Then Discord, best-effort. A dead channel loses the audience, not the die.
  try {
    const target = await discordTargetForPlaceKey(prisma, placeKey);
    const channelId = target?.threadId ?? target?.channelId ?? null;
    // parse: [] — the text is composed here, but a forced name is player-
    // adjacent data and a shout of an "@everyone" is not a thing a die throws.
    if (channelId) await postMessage(channelId, text, undefined, { parse: [] });
  } catch (err) {
    console.error("Roll post failed:", err.message ?? err);
  }

  return { ok: true, value, line: `You rolled a ${value}.` };
}

module.exports = { castDie };
