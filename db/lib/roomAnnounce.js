// One line in a Room's thread saying somebody did something to its stash,
// aliased the way the whisper poll aliases a speaker — "An old woman leaves
// Graga Sac ×3 here." The room learns an age and a presentation, never a
// name; anyone standing there can read the thread and act on it, which is
// what a public floor is for (docs/systemdocs/CARRY.md).
//
// REST, best-effort, catch-logged: a missed line is flavour lost, never a
// failed transfer. Never call this inside a transaction.
const { postMessage } = require("./discordRest");
const { aliasSubject } = require("./concealedIdentity");
const { ambientLine } = require("./ambientLine");
const { sceneLineAt } = require("./scene");

// `room` needs { id, discordThreadId, name }; `character` needs { age, gender }.
// Without the id the Discord line still goes out and the archive row does not.
// `text` is the predicate ("leaves Graga Sac ×3 here."); `lines` are extra
// quoted lines under it. Formatting is ambientLine's job, not this file's.
async function announceInRoom(room, character, text, lines = []) {
  if (!room?.discordThreadId) return;
  const said = `${aliasSubject(character)} ${text}`;
  const content = ambientLine(said, lines);
  await postMessage(room.discordThreadId, content).catch((err) =>
    console.error(`Room stash announcement failed (${room.name ?? room.discordThreadId}):`, err.message),
  );

  // The Hall's half of the same line (db/lib/scene.js). The require is INSIDE
  // the function on purpose: db/index.js reaches this module through carry.js,
  // so a top-level require back would resolve to a half-built exports object.
  // By the time anybody actually announces anything, the barrel is whole.
  if (!room.id) return;
  const { prisma } = require("../index");
  await sceneLineAt(prisma, { roomId: room.id, text: said, lines });
}

module.exports = { announceInRoom };
