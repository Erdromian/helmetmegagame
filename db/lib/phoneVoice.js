// What a phone carries. See docs/systemdocs/PHONES.md.
//
// A line said in a room with a live call on its phone is repeated into the
// room at the other end. Two voices, not one, and the difference is the whole
// social design of the feature:
//
//   the person holding the receiver   comes through clear
//   everybody else in their room      comes through half-heard
//
// So a Baron taking a call in his study is audible to the Ward, and so is
// whoever is standing behind him, badly. You cannot have a private call in a
// crowded room, and you cannot be sure what the crowd behind the other person
// just said. That is a phone.
//
// A PHONE CARRIES A VOICE, NEVER A NAME. Every line written here is a SYSTEM
// row with no character on it, so db/lib/presentedIdentity.js never comes into
// it — a concealed caller stays concealed for free, and so does an unconcealed
// one, because a handset does not come with a face. It also means the far room
// cannot reply TO anybody: they can only talk back down the line.
//
// The shape is db/lib/gateEcho.js's, and deliberately: a fire-and-forget hook
// off recordSpeech that re-emits a line into another place, written through
// recordArchiveMessage and NEVER through recordSpeech, so a carried line can
// never carry again. Takes `prisma`, off the @lifeweb/db barrel (db/lib/dm.js).

const { recordArchiveMessage } = require("./archive");
const { TOKEN_RE } = require("./characterMentions");
const { archiveContextForPlaceKey, parsePlaceKey, placeKeyForRoom } = require("./placeKey");
const { muffle } = require("./muffle");
const { PHONE_BACKGROUND_MUFFLE, PHONE_TEXT } = require("./phoneText");
const { postMessage } = require("./discordRest");
const { ambientLine } = require("./ambientLine");

// `{char:<id>|Name}` becomes plain `Name`, the same flattening gateEcho.js
// does and for the same reason: the outbox must not relay a second mention DM
// to somebody who was named in a room they are not in.
function plain(content) {
  return String(content ?? "").replace(TOKEN_RE, (_match, _id, name) => name || "someone");
}

/**
 * The far end of the call this line was said into, or null. Resolves to
 * { call, farRoomId, holderId } — `holderId` is whoever is holding the
 * receiver in the room the line was SAID in, which is the only thing that
 * decides clear against muffled.
 */
async function farEndFor(prisma, placeKey) {
  const parsed = parsePlaceKey(placeKey);
  if (parsed?.kind !== "room") return null;

  const call = await prisma.phoneCall.findFirst({
    where: {
      status: "CONNECTED",
      OR: [{ fromRoomId: parsed.id }, { toRoomId: parsed.id }],
    },
    orderBy: { startedAt: "desc" },
  });
  if (!call) return null;

  const near = call.fromRoomId === parsed.id;
  return {
    call,
    farRoomId: near ? call.toRoomId : call.fromRoomId,
    holderId: near ? call.callerId : call.calleeId,
  };
}

/**
 * `row` is the ArchiveEntry recordSpeech just wrote. Best-effort — a phone is
 * never worth failing the line it rode in on, exactly as a gate echo isn't.
 */
async function carryOverPhone(prisma, prepared, row) {
  if (!row?.placeKey || !prepared?.character?.id) return null;

  const end = await farEndFor(prisma, row.placeKey);
  if (!end) return null;

  // A CONNECTED call always has both, but the row is written in two steps and
  // a half-written one must not garble somebody by accident.
  if (!end.holderId) return null;

  const holding = prepared.character.id === end.holderId;
  const words = plain(row.content);
  const text = holding
    ? PHONE_TEXT.voice(words)
    : PHONE_TEXT.background(muffle(words, PHONE_BACKGROUND_MUFFLE));

  // The Discord half. A SYSTEM row is never posted by bot/src/lib/feedOutbox.js
  // (it drains WEB rows only), so without this the far room hears the call on
  // the web and nothing at all on Discord. Subtext, through ambientLine: a
  // voice out of a handset is scenery in the room it lands in, not a line
  // somebody in that room said.
  const far = await prisma.room.findUnique({
    where: { id: end.farRoomId },
    select: { id: true, discordThreadId: true },
  });
  if (far?.discordThreadId) {
    await postMessage(far.discordThreadId, ambientLine(text), undefined, { parse: [] }).catch((err) =>
      console.error("Phone carry to Discord failed:", err.message ?? err),
    );
  }

  const placeKey = placeKeyForRoom(end.farRoomId);
  try {
    const context = await archiveContextForPlaceKey(prisma, placeKey);
    return await recordArchiveMessage(prisma, {
      content: text,
      placeKey,
      // SYSTEM, not WEB: nobody typed this into the far room, and no character
      // is attached to it. See the header — this is what keeps a name off the
      // wire, and it is also what stops feedOutbox.js posting it as somebody.
      source: "SYSTEM",
      zoneId: context.zoneId,
      zoneName: context.zoneName,
      threadName: context.threadName,
      channelKind: "scene",
    });
  } catch (err) {
    console.error("Phone carry failed:", err.message ?? err);
    return null;
  }
}

module.exports = { carryOverPhone, farEndFor, plain };
