// A line the WORLD says, written down.
//
// db/lib/ambientLine.js is how one of these LOOKS on Discord (`-#` subtext);
// this is how it is RECORDED, so Chat (/chat) can show it too. Until phase
// 4 none of them archived at all, which meant a web player never saw a gate
// crossing, a smell, a turret burst or a noticeboard pin — the scene simply
// did not happen on that face.
//
// The row is an ordinary ArchiveEntry MESSAGE with `source: "SYSTEM"` and no
// character. Three things follow from that and all three are deliberate:
//
//   - The content carries NO `-#`. The prefix is Discord's rendering of
//     subtext; the web renders a SYSTEM row as `.chat-subtext` itself
//     (CHAT.md §5), and storing the prefix would put literal `-#` on the page.
//   - The outbox never touches it. bot/src/lib/feedOutbox.js posts `WEB` rows
//     only, so a SYSTEM row can never be echoed back into the channel the
//     poster already posted to.
//   - Every poster writes the row BESIDE its Discord post, never instead of
//     it. Discord is not downstream of the archive here.
//
// Best-effort like every other write in archive.js: it swallows and logs. A
// transcript row is never worth breaking a bell over.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.

const { recordArchiveMessage } = require("./archive");
const {
  archiveContextForPlaceKey,
  placeKeyForLocation,
  placeKeyForRoom,
  placeKeyForZone,
} = require("./placeKey");

// `text` is the line; `lines` are quoted extras under it, taking the same `»`
// ambientLine gives them. `signed` is still accepted so callers need not
// change, but it does nothing now — see below.
async function sceneLine(prisma, { placeKey, text, lines = [], signed = true } = {}) {
  if (!placeKey) return null;

  const body = [
    String(text ?? "").trim(),
    ...lines.filter(Boolean).map((line) => `» ${line}`),
  ].filter(Boolean);
  if (body.length === 0) return null;

  // `signed` is a leftover of the retired draft-mark convention: still
  // accepted so callers need not change, and it does nothing.
  void signed;
  const content = body.join("\n");

  try {
    const context = await archiveContextForPlaceKey(prisma, placeKey);
    return await recordArchiveMessage(prisma, {
      content,
      placeKey,
      source: "SYSTEM",
      zoneId: context.zoneId,
      zoneName: context.zoneName,
      threadName: context.threadName,
      // Not "location"/"summary": a scene line is not something anybody typed
      // into a channel, and /archive's filters read this to tell them apart.
      channelKind: "scene",
    });
  } catch (err) {
    console.error("Scene line failed:", err.message ?? err);
    return null;
  }
}

// The same thing for a caller holding an id rather than a key, which is most
// of them. Exactly one of locationId / roomId / zoneId is used, in that order.
async function sceneLineAt(prisma, { locationId, roomId, zoneId, ...rest } = {}) {
  const placeKey =
    placeKeyForLocation(locationId) ?? placeKeyForRoom(roomId) ?? placeKeyForZone(zoneId);
  if (!placeKey) return null;
  return sceneLine(prisma, { placeKey, ...rest });
}

module.exports = { sceneLine, sceneLineAt };
