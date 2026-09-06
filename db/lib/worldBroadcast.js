// Two fan-outs that reach the WHOLE map, for the handful of events that are
// not scenery in one room but news everywhere at once.
//
// Why this is not db/lib/soundBroadcast.js: that one is range-gated from an
// origin — a bell carries so many hops and then stops, which is the whole
// point of it. These two have no origin. A fireball in the sky is seen from
// everywhere, and a shuttle coming down is heard from everywhere.
//
// Why this is not db/lib/intercom.js: broadcastIntercom is the right SHAPE and
// the wrong function. It defangs the mentions a caller typed (correct, for a
// PA anyone at the table can use), wraps everything in "You hear a voice from
// the intercom", and deliberately skips the Black Hills because no speaker was
// ever strung that far. None of that is true of a nuclear detonation.
//
// The discipline both share, and the reason neither uses Promise.all: a burst
// of parallel posts is how an integration earns a 429 and then an IP ban. Post
// sequentially, catch each one on its own, and never let a dead channel take
// the rest of the fan-out down with it.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.
const { postMessage } = require("./discordRest");
const { ambientLine } = require("./ambientLine");
const { sceneLineAt } = require("./scene");

// Only set for a message that is MEANT to wake people who are offline. The
// nuke is the one thing in the game that qualifies.
const EVERYONE = { parse: ["everyone"] };

// Every zone's #summary. Unlike the intercom this skips NO zone: the two cave
// levels have no #summary and drop out on their own (which is exactly right —
// underground is where you survive this), and the Black Hills hear it, because
// what they are being told about is not coming out of a speaker.
async function broadcastToZones(prisma, content, { mentionEveryone = false } = {}) {
  const zones = await prisma.zone.findMany({
    where: { discordSummaryChannelId: { not: null } },
    select: { id: true, name: true, discordSummaryChannelId: true },
    orderBy: { sortOrder: "asc" },
  });

  let sent = 0;
  const failed = [];
  for (const zone of zones) {
    try {
      await postMessage(
        zone.discordSummaryChannelId,
        content,
        undefined,
        mentionEveryone ? EVERYONE : undefined,
      );
      sent += 1;
    } catch (err) {
      failed.push(zone.name);
      console.error(`World broadcast to ${zone.name} failed:`, err.message ?? err);
    }
    // Beside the post, never instead of it (db/lib/scene.js). `content` is
    // already the finished message, ‡ and all, so the row does not sign it
    // again. Written even when the post failed: the thing happened.
    await sceneLineAt(prisma, { zoneId: zone.id, text: content, signed: false });
  }
  return { sent, failed };
}

// Every Location channel on the map. `text` is one plain sentence — it is
// wrapped in ambientLine here rather than by the caller, because a line the
// WORLD says is `-#` subtext by house rule (CLAUDE.md) and doing it in one
// place keeps the per-line prefix and the single trailing ‡ correct.
//
// `signed: false` for a line Bascinet wrote verbatim — their words take no
// mark, which is the one exemption the prime directive names.
async function ambientEverywhere(prisma, text, { signed = true } = {}) {
  const content = ambientLine(text, [], { signed });
  const locations = await prisma.location.findMany({
    where: { discordChannelId: { not: null } },
    select: { id: true, name: true, discordChannelId: true },
    orderBy: { name: "asc" },
  });

  let sent = 0;
  const failed = [];
  for (const location of locations) {
    try {
      await postMessage(location.discordChannelId, content);
      sent += 1;
    } catch (err) {
      failed.push(location.name);
      console.error(`Ambient broadcast to ${location.name} failed:`, err.message ?? err);
    }
    // The Hall's half of the same line: the plain sentence, no `-#`, which
    // the web renders as subtext itself.
    await sceneLineAt(prisma, { locationId: location.id, text, signed });
  }
  return { sent, failed };
}

module.exports = { broadcastToZones, ambientEverywhere };
