// A loud noise, heard across the Location graph.
//
// The bell and the trumpet are the same machine with different numbers: pick an
// origin Location, walk out from it, and post one line into every Location
// channel in earshot. db/lib/locationGraph.js#soundRange answers WHO hears;
// this file answers HOW LOUD it is where they stand.
//
// It is /shout's cousin, deliberately, but with the two things that make a
// shout a shout taken out:
//
//   - Nothing MUFFLES. A shout loses its words with distance because a shout
//     is words. A bell has none to lose, so all distance changes is whether the
//     line lands in the conversation or under it.
//   - No DIRECTION. `soundRange` offers a `viaName`, and a shout needs it —
//     you have to know which way to run. A bell hangs in a tower everyone can
//     see from the square. Naming the way to it would be telling people
//     something they already know.
//
// So the only thing left is the volume band, and it is a formatting decision:
// near the source the line is full size, past that it is `-#` subtext. That is
// the same split /play and /shout already make — the room hears the
// performance, the street outside only notices it.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path. Both faces call it: the bot for
// the bell rope, the web Character page for the trumpet.
const { ambientLine } = require("./ambientLine");
const { postMessage } = require("./discordRest");
const { soundRange } = require("./locationGraph");
const { sceneLineAt } = require("./scene");

// Sound does not cross between the surface and the underground, and that is the
// one exclusion in here. The test is Zone.kind rather than a list of zone
// slugs, because the slugs would drift the first time somebody added a cave
// level and the enum cannot.
//
// It replaces an older allowlist of four zone slugs, which had the shape of a
// wiring diagram rather than a rule about noise: it silently made the Black
// Hills deaf to a bell they are close enough to hear.
//
// The rule is SYMMETRIC — same kind as the origin, rather than "surface only" —
// and that matters more than it looks. A bell in the Cathedral must not ring in
// the Depths, which either shape gives you. But a trumpet blown underground
// must still be heard by the people standing next to the trumpeter, and
// "surface only" made it audible everywhere EXCEPT down there. Comparing
// against the origin gets both, and says the actual thing: rock is what stops
// the noise.
function carriesTo(originKind, kind) {
  return Boolean(kind) && kind === originKind;
}

// Posts `text` into every Location within `maxHops` of the origin that the
// noise actually reaches (see carriesTo above).
// Locations at `loudHops` or nearer get it full size; everything past that gets
// it as subtext. The origin itself is distance 0, so it is always in the loud
// band.
//
// `signed` rides through to ambientLine and decides the ‡ — false for a line
// Bascinet wrote verbatim (CLAUDE.md). The loud copy has to append its own,
// because it never goes through the helper.
//
// Returns { sent, failed } rather than throwing: a bell heard in thirty places
// out of thirty-six still rang, and the caller has already committed the
// cooldown by the time this runs.
async function broadcastSound(prisma, { originLocationId, text, maxHops, loudHops, signed = true }) {
  if (!originLocationId || !process.env.DISCORD_TOKEN) return { sent: 0, failed: [] };

  const heard = await soundRange(prisma, originLocationId, maxHops);
  if (heard.length === 0) return { sent: 0, failed: [] };

  // soundRange returns ids, not zones, so the surface/underground test needs
  // one more read. One query for the whole set rather than one per Location.
  const zones = await prisma.location.findMany({
    where: { id: { in: heard.map((place) => place.locationId) } },
    select: { id: true, zone: { select: { kind: true } } },
  });
  const kindById = new Map(zones.map((loc) => [loc.id, loc.zone?.kind ?? null]));
  const originKind = kindById.get(originLocationId) ?? null;
  if (!originKind) return { sent: 0, failed: [] };
  const reachable = new Set(
    zones.filter((loc) => carriesTo(originKind, loc.zone?.kind)).map((loc) => loc.id),
  );

  const loud = `${text}${signed ? "" : ""}`;
  const quiet = ambientLine(text, [], { signed });

  // Sequential, no Promise.all: a fan-out across three dozen Locations would
  // burst Discord's rate-limit buckets, and this is never urgent. Same
  // discipline as bot/src/lib/deathSmell.js and /shout. Every post is
  // individually caught, so one dead channel cannot swallow the rest of the
  // peal.
  //
  // Location CHANNELS only, never the Room threads under them — the same rule
  // /shout keeps. Somebody in a private back room is behind a door.
  let sent = 0;
  const failed = [];
  for (const place of heard) {
    if (!place.discordChannelId) continue;
    if (!reachable.has(place.locationId)) continue;
    try {
      // parse: [] — a bell is a noise, not an address. Nothing player-typed
      // reaches this text, so there is nothing here to defang, but the widest
      // broadcast in the game should not be able to ping anybody by accident.
      await postMessage(
        place.discordChannelId,
        place.distance <= loudHops ? loud : quiet,
        undefined,
        { parse: [] },
      );
      sent += 1;
    } catch (err) {
      failed.push(place.name);
      console.error(`Sound carrying to ${place.name} failed:`, err.message ?? err);
    }
    // One row per Location that hears it, beside the post (db/lib/scene.js).
    // The wording is the same at every distance because a bell never muffles
    // — the only thing distance changed was the `-#`, and the web decides
    // that for itself.
    await sceneLineAt(prisma, { locationId: place.locationId, text, signed });
  }
  return { sent, failed };
}

module.exports = { broadcastSound };
