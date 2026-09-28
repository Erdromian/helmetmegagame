// What a phone carries. See docs/systemdocs/PHONES.md §6.
//
// A line said in a room with a connected call on its phone is repeated at the
// other end, and who hears it how is the whole social design of the feature.
// Bascinet's design document, for a line said at phone A of a call to B:
//
//   said by A's holder      B's holder hears it clearly;
//                           everybody else in B hears it half-garbled
//   said by anybody else    B's holder alone hears it, half-garbled;
//   in A                    the rest of B hears nothing
//
// So a Baron taking a call in his study can be overheard in the Ward, badly,
// by everybody but the person holding the receiver there — and whoever is
// standing behind him reaches that receiver, badly, and nobody else. With
// nobody holding B, the room hears A's holder half-garbled and nothing more.
//
// TWO VOICES AT ONE PLACE are two ArchiveEntry rows: one for B's holder only
// (onlyCharacterId), one for the room without them (exceptCharacterId). The
// feed lens (db/lib/strangers.js#readsRow) decides per reader which they get.
// Discord cannot show one reader a different line in a thread, so the thread
// gets the room's version, and a holder who picked the phone up ON DISCORD
// gets theirs as a DM. A web holder reads theirs in web chat.
//
// A PHONE CARRIES A VOICE, NEVER A NAME. Every line written here is a SYSTEM
// row with no character on it, so db/lib/presentedIdentity.js never comes into
// it — a concealed caller stays concealed for free, and so does an unconcealed
// one, because a handset does not come with a face.
//
// The shape is db/lib/gateEcho.js's: a fire-and-forget hook off recordSpeech
// that re-emits a line into another place, written through
// recordArchiveMessage and NEVER through recordSpeech, so a carried line can
// never carry again. Takes `prisma`, off the @lifeweb/db barrel (db/lib/dm.js).

const { recordArchiveMessage } = require("./archive");
const { TOKEN_RE } = require("./characterMentions");
const { archiveContextForPlaceKey, parsePlaceKey, placeKeyForRoom } = require("./placeKey");
const { muffle } = require("./muffle");
const { PHONE_BACKGROUND_MUFFLE, PHONE_TEXT } = require("./phoneText");
const { postMessage } = require("./discordRest");
const { ambientLine } = require("./ambientLine");
const { isSkinless, gruntify } = require("./skinless");

// `{char:<id>|Name}` becomes plain `Name`, the same flattening gateEcho.js
// does and for the same reason: the outbox must not relay a second mention DM
// to somebody who was named in a room they are not in.
function plain(content) {
  return String(content ?? "").replace(TOKEN_RE, (_match, _id, name) => name || "someone");
}

/**
 * Who gets what, for one line. Pure, so the table in the header is testable
 * without a database. `speakerHolds` is whether the speaker holds the phone
 * they spoke beside; `farHolderId` is whoever holds the far one, or null.
 * `words` is the plain line and `garbled` the same line half-garbled, rolled
 * once so every copy agrees.
 *
 * Returns { holder, room } — each { text, only?, except? } or null:
 *   holder   the far holder's own row (onlyCharacterId)
 *   room     the far room's row, kept from the holder if there is one
 */
function routeLine({ speakerHolds, farHolderId, words, garbled }) {
  if (speakerHolds) {
    const room = { text: PHONE_TEXT.voice(garbled), except: farHolderId ?? null };
    const holder = farHolderId ? { text: PHONE_TEXT.voice(words), only: farHolderId } : null;
    return { holder, room };
  }
  if (!farHolderId) return { holder: null, room: null };
  return { holder: { text: PHONE_TEXT.background(garbled), only: farHolderId }, room: null };
}

/**
 * The far end of the call this line was said into, or null. Resolves to
 * { call, nearRoom, farRoom } with each room's holder on it.
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

  const farId = call.fromRoomId === parsed.id ? call.toRoomId : call.fromRoomId;
  const rooms = await prisma.room.findMany({
    where: { id: { in: [parsed.id, farId] } },
    select: {
      id: true,
      discordThreadId: true,
      phoneHolderId: true,
      phoneHeldVia: true,
      phoneHolder: { select: { discordUserId: true } },
    },
  });
  const nearRoom = rooms.find((r) => r.id === parsed.id);
  const farRoom = rooms.find((r) => r.id === farId);
  if (!nearRoom || !farRoom) return null;
  return { call, nearRoom, farRoom };
}

async function writeRow(prisma, farRoomId, { text, only = null, except = null }) {
  const placeKey = placeKeyForRoom(farRoomId);
  const context = await archiveContextForPlaceKey(prisma, placeKey);
  return recordArchiveMessage(prisma, {
    content: text,
    placeKey,
    // SYSTEM, not WEB: nobody typed this into the far room, and no character
    // is attached to it. That is what keeps a name off the wire, and it is
    // also what stops feedOutbox.js posting it as somebody.
    source: "SYSTEM",
    zoneId: context.zoneId,
    zoneName: context.zoneName,
    threadName: context.threadName,
    channelKind: "scene",
    onlyCharacterId: only,
    exceptCharacterId: except,
  });
}

/**
 * `row` is the ArchiveEntry recordSpeech just wrote. Best-effort — a phone is
 * never worth failing the line it rode in on, exactly as a gate echo isn't.
 */
async function carryOverPhone(prisma, prepared, row) {
  if (!row?.placeKey || !prepared?.character?.id) return null;

  try {
    const end = await farEndFor(prisma, row.placeKey);
    if (!end) return null;
    const { nearRoom, farRoom } = end;

    // A Skinless's voice down the line is grunts (db/lib/skinless.js), except
    // to a Skinless holding the far receiver. The room around it hears grunts.
    const said = plain(row.content);
    const skinless = await isSkinless(prisma, prepared.character.id);
    const heard = skinless ? gruntify(said, Number(row.seq) || 0) : said;
    const holderUnderstands = skinless && farRoom.phoneHolderId && (await isSkinless(prisma, farRoom.phoneHolderId));
    const words = holderUnderstands ? said : heard;
    const route = routeLine({
      speakerHolds: nearRoom.phoneHolderId === prepared.character.id,
      farHolderId: farRoom.phoneHolderId ?? null,
      words,
      garbled: muffle(heard, PHONE_BACKGROUND_MUFFLE),
    });

    // The room's half, on both faces. Subtext on Discord, through ambientLine:
    // a voice out of a handset is scenery in the room it lands in.
    if (route.room) {
      if (farRoom.discordThreadId) {
        await postMessage(farRoom.discordThreadId, ambientLine(route.room.text), undefined, { parse: [] }).catch(
          (err) => console.error("Phone carry to Discord failed:", err.message ?? err),
        );
      }
      await writeRow(prisma, farRoom.id, route.room);
    }

    // The holder's half: their own row, and a DM too when it was Discord that
    // they picked the phone up on. Required here rather than at the top so
    // this module's graph stays what it was for everything that only speaks.
    if (route.holder) {
      await writeRow(prisma, farRoom.id, route.holder);
      const discordUserId = farRoom.phoneHolder?.discordUserId;
      if (farRoom.phoneHeldVia === "discord" && discordUserId) {
        await require("./dm")
          // `»` from sendDm's own prefix: the line quotes what somebody said.
          .sendDm(prisma, discordUserId, route.holder.text, {
            source: "phone",
            allowedMentions: { parse: [] },
          })
          .catch((err) => console.error("Phone DM failed:", err.message ?? err));
      }
    }
    return route;
  } catch (err) {
    console.error("Phone carry failed:", err.message ?? err);
    return null;
  }
}

module.exports = { carryOverPhone, farEndFor, routeLine, plain };
