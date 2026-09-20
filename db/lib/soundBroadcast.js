// A loud noise, heard across the Location graph: pick an origin Location, walk out, post one line into every Location channel in earshot.
// db/lib/locationGraph.js#soundRange answers WHO hears; this file answers HOW LOUD. Unlike /shout, nothing muffles and there's no direction — only
// the volume band: full size near the source, `-#` subtext past that. Takes `prisma` as a parameter, off the @lifeweb/db barrel; require it by path.
const { ambientLine } = require("./ambientLine");
const { postMessage } = require("./discordRest");
const { soundRange } = require("./locationGraph");
const { sceneLineAt } = require("./scene");

// Sound does not cross surface/underground — Zone.kind, SYMMETRIC to the origin (not "surface only"), so a bell doesn't reach the Depths but a trumpet blown underground still reaches nearby listeners.
function carriesTo(originKind, kind) {
  return Boolean(kind) && kind === originKind;
}

// Posts `text` into every reachable Location within `maxHops` (loud within `loudHops`, else subtext). Returns { sent, failed } rather than throwing.
// `sfx` is the noise the web face makes as each line lands (./sfx.js) — a bell that is
// heard should be heard. Discord gets the words alone.
async function broadcastSound(prisma, { originLocationId, text, maxHops, loudHops, signed = true, sfx = null }) {
  if (!originLocationId || !process.env.DISCORD_TOKEN) return { sent: 0, failed: [] };

  const heard = await soundRange(prisma, originLocationId, maxHops);
  if (heard.length === 0) return { sent: 0, failed: [] };

  // soundRange returns ids, not zones — one query for the whole set rather than one per Location.
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

  const loud = text;
  const quiet = ambientLine(text, [], { signed });

  // Sequential (a fan-out would burst Discord's rate limits); Location CHANNELS only, never Room threads under them — /shout's rules too.
  let sent = 0;
  const failed = [];
  for (const place of heard) {
    if (!place.discordChannelId) continue;
    if (!reachable.has(place.locationId)) continue;
    try {
      // parse: [] — the widest broadcast in the game should not be able to ping anybody by accident.
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
    // One row per Location that hears it (db/lib/scene.js) — wording is identical at every distance since a bell never muffles.
    await sceneLineAt(prisma, { locationId: place.locationId, text, signed, sfx });
  }
  return { sent, failed };
}

// The whole world at once, with no origin and no hops. `broadcastSound` above
// walks the Location graph out from somewhere, which is right for a bell and
// wrong for the Charon: a ship leaving the planet is not louder near the Keep,
// and `carriesTo` would stop it reaching the Caves at all — which is exactly
// where the quieter line is supposed to land.
//
// So this one reaches every Location that is not retired, and picks its wording
// off the Zone's own kind rather than off a distance: underground hears
// `undergroundText` (falling back to `text` when a caller gives only one),
// everywhere else hears `text`. Both go out as `-#` subtext, because this is
// scenery however far it carries — see CLAUDE.md, "Bot message style".
//
// Returns { sent, failed } rather than throwing, like its neighbour.
async function broadcastEverywhere(prisma, { text, undergroundText = null, signed = true, sfx = null }) {
  if (!text) return { sent: 0, failed: [] };

  const places = await prisma.location.findMany({
    where: { retiredAt: null },
    select: { id: true, name: true, discordChannelId: true, zone: { select: { kind: true } } },
  });

  const underground = (kind) => kind === "CAVE_GROUP" || kind === "CAVE_LEVEL";

  let sent = 0;
  const failed = [];
  for (const place of places) {
    const words = underground(place.zone?.kind) ? (undergroundText ?? text) : text;
    // Sequential, and `parse: []` — the same two reasons broadcastSound gives:
    // a fan-out would burst Discord's rate limits, and the widest broadcast in
    // the game must not be able to ping anybody by accident.
    if (place.discordChannelId && process.env.DISCORD_TOKEN) {
      try {
        await postMessage(place.discordChannelId, ambientLine(words, [], { signed }), undefined, { parse: [] });
        sent += 1;
      } catch (err) {
        failed.push(place.name);
        console.error(`Broadcast to ${place.name} failed:`, err.message ?? err);
      }
    }
    // The web row goes down whether or not Discord is configured, so a local
    // game with no bot token still hears the world.
    await sceneLineAt(prisma, { locationId: place.id, text: words, signed, sfx });
  }
  return { sent, failed };
}

module.exports = { broadcastSound, broadcastEverywhere };
