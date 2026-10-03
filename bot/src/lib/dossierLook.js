// The GM ⚜️ dossier's look fields (events/messageReactionAdd.js#handleDossierReaction): what the room saw
// of the speaker on the line a GM reacted to, and what it sees of them now, with a hood, a disguise and a
// public name told apart (db/lib/gmPresentation.js). The dossier used to say only "Presents as Beast",
// which reads the same for Apex Form as for somebody in a Disguise Kit, and nothing at all for a hood
// beyond the alias.
//
// PURE, so it can be tested without Discord: `proxy` is lib/proxy.js#proxyRowFor's row, `now` the live
// look (or null for their own face). Returns embed fields, none at all for a bare face then and now.
const { lookText, sameLook } = require("@lifeweb/db/lib/gmLookText");
const { withArticle, capitalizeFirst } = require("@lifeweb/db/lib/concealedIdentity");

// The look the line froze. A hood's alias is stored Title Case for the webhook ("Young Man"); a sentence
// wants "a young man", the way every GM surface spells it.
function lineLook(proxy) {
  if (!proxy?.alias) return null;
  const kind = proxy.disguised ? "disguise" : proxy.concealed ? "hood" : "forced";
  return { kind, shownAs: kind === "hood" ? withArticle(proxy.alias.toLowerCase()) : proxy.alias };
}

function dossierLookFields(proxy, now) {
  const then = lineLook(proxy);
  const same = sameLook(then, now);
  const fields = [];
  // The line froze only the kind and the name; when today's look is the same one, it says more (the piece
  // over the face, the job a disguise claims), so the line reads it.
  if (then) fields.push({ name: "On this line", value: capitalizeFirst(lookText(same ? now : then)), inline: true });
  if (!same) fields.push({ name: "Now", value: capitalizeFirst(lookText(now)), inline: true });
  return fields;
}

// A GM's Who's here on Discord: one line a person, the real name, then what the room sees when it is not
// their own face. `rows` is db/lib/whosHere.js#whosHereGm's answer. Starts with the bold heading, so
// lib/respond.js leaves the readout alone rather than italicising it.
function gmWhosHereLines(rows) {
  if (!rows?.length) return [];
  return ["**Here** (real names):", ...rows.map((row) => (row.look ? `${row.name} — ${lookText(row.look)}` : row.name))];
}

module.exports = { dossierLookFields, lineLook, gmWhosHereLines };
