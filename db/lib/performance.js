// Performances: one song on one equipped instrument, heard in the browser of everyone
// standing in the performer's Location (docs/systemdocs/SOUND.md, "Performances").
//
// A row is LIVE while stoppedAt is null and endsAt is still ahead — so a song that runs
// out needs no write at all, the clock ends it. A character holds at most one unstopped
// row; the partial unique index "Performance_live_unique" backs that up under a race.
//
// Every start and stop raises one pg_notify on the feed channel, op "music", with the
// Location's place key. The web hub (web/lib/feedHub.js) re-reads what is live there and
// sends each stream standing in it an `event: music` frame. A notify raised inside a
// transaction is delivered on commit, so the stop hooks can pass their `tx`.
//
// Takes `prisma` (or a transaction client) as a parameter, off the @lifeweb/db barrel
// like db/lib/dm.js; require it by path. Leaf requires only, because the stop hooks are
// called from attack.js, intercept.js, bind.js and locationMove.js.

const { INSTRUMENT_SONGS } = require("./instrumentSongs");
const { blockerFor, ACT } = require("./incapacitation");
const { FEED_CHANNEL } = require("./feedNotify");
const { performerKey } = require("./hoodToken");

const MUSIC_OP = "music";

// Held tags -> the slugs of every instrument with at least one unit on the rack.
function equippedInstruments(characterTags) {
  const out = [];
  for (const ct of characterTags ?? []) {
    if (!ct?.tag?.instrument) continue;
    if (!((ct.equippedQuantity ?? 0) > 0 || ct.equipped)) continue;
    if (!out.includes(ct.tag.slug)) out.push(ct.tag.slug);
  }
  return out;
}

// Held tags -> whether any instrument is carried at all, equipped or not.
function holdsInstrument(characterTags) {
  return (characterTags ?? []).some((ct) => ct?.tag?.instrument && (ct.quantity ?? 1) > 0);
}

// The stop hooks run inside attack.js, whosHere.js and friends, whose tests hand in a
// hand-built client with only the models they care about. No Performance model there
// means there is nothing playing, which is the true answer for those tests.
function hasModel(db) {
  return Boolean(db?.performance);
}

function liveWhere(now = new Date()) {
  return { stoppedAt: null, endsAt: { gt: now } };
}

function clampVolume(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

async function notifyMusic(prisma, locationId) {
  if (!locationId) return false;
  try {
    const payload = JSON.stringify({ op: MUSIC_OP, placeKey: `loc:${locationId}` });
    await prisma.$executeRaw`SELECT pg_notify(${FEED_CHANNEL}, ${payload})`;
    return true;
  } catch (err) {
    console.error("Music notify failed:", err);
    return false;
  }
}

// `character` needs { id, status, locationId, tags: [{ quantity, equipped, equippedQuantity,
// tag: { slug, name, instrument } }] }. Returns { ok, performance } or { ok: false, error }.
async function startPerformance(prisma, character, { instrumentSlug = null, songKey, volume = 1 } = {}) {
  if (!character?.id || character.status !== "ALIVE") {
    return { ok: false, error: "[PLACEHOLDER: performer is not a living character]" };
  }
  if (!character.locationId) return { ok: false, error: "[PLACEHOLDER: performer is nowhere]" };
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) return { ok: false, error: `[PLACEHOLDER: can't play while ${blocker.name}]` };

  const equipped = equippedInstruments(character.tags);
  if (equipped.length === 0) return { ok: false, error: "Equip an instrument first." };
  const slug = instrumentSlug ?? (equipped.length === 1 ? equipped[0] : null);
  if (!slug || !equipped.includes(slug)) {
    return { ok: false, error: "[PLACEHOLDER: that instrument is not equipped]" };
  }
  const song = (INSTRUMENT_SONGS[slug] ?? []).find((s) => s.key === songKey);
  if (!song) return { ok: false, error: "[PLACEHOLDER: that song is not on this instrument]" };

  const now = new Date();
  const endsAt = new Date(now.getTime() + Math.max(1, Number(song.seconds) || 0) * 1000);
  const previous = await prisma.performance.findMany({
    where: { characterId: character.id, stoppedAt: null },
    select: { locationId: true },
  });
  const performance = await prisma.$transaction(async (tx) => {
    await tx.performance.updateMany({
      where: { characterId: character.id, stoppedAt: null },
      data: { stoppedAt: now, stoppedReason: "replaced" },
    });
    return tx.performance.create({
      data: {
        characterId: character.id,
        locationId: character.locationId,
        instrumentSlug: slug,
        songKey: song.key,
        volume: clampVolume(volume),
        startedAt: now,
        endsAt,
      },
    });
  });

  const places = new Set([character.locationId, ...previous.map((p) => p.locationId)]);
  for (const locationId of places) await notifyMusic(prisma, locationId);
  return { ok: true, performance };
}

// The performer's slider, moved mid-song. Only the live row, and only its volume.
async function setPerformanceVolume(prisma, characterId, volume) {
  if (!characterId) return false;
  const live = await prisma.performance.findFirst({
    where: { characterId, ...liveWhere() },
    select: { id: true, locationId: true },
  });
  if (!live) return false;
  await prisma.performance.update({ where: { id: live.id }, data: { volume: clampVolume(volume) } });
  await notifyMusic(prisma, live.locationId);
  return true;
}

// Stop whatever these characters are playing. Safe to call for anybody — one indexed read
// that finds nothing for the great majority. Returns how many rows it stopped.
async function stopPerformances(prisma, characterIds, reason = "stopped") {
  const ids = [...new Set((Array.isArray(characterIds) ? characterIds : [characterIds]).filter(Boolean))];
  if (ids.length === 0 || !hasModel(prisma)) return 0;
  const rows = await prisma.performance.findMany({
    where: { characterId: { in: ids }, stoppedAt: null },
    select: { id: true, locationId: true },
  });
  if (rows.length === 0) return 0;
  await prisma.performance.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, stoppedAt: null },
    data: { stoppedAt: new Date(), stoppedReason: String(reason).slice(0, 32) },
  });
  for (const locationId of new Set(rows.map((r) => r.locationId))) await notifyMusic(prisma, locationId);
  return rows.length;
}

function stopPerformance(prisma, characterId, reason) {
  return stopPerformances(prisma, [characterId], reason);
}

// After an unequip or a tag leaving the sheet: stop the song if its instrument is no
// longer on the rack. Reads the rack fresh, so it can run after any tag write.
async function stopIfInstrumentGone(prisma, characterId) {
  if (!characterId || !hasModel(prisma)) return 0;
  const live = await prisma.performance.findFirst({
    where: { characterId, stoppedAt: null },
    select: { instrumentSlug: true },
  });
  if (!live) return 0;
  const still = await prisma.characterTag.findFirst({
    where: { characterId, equippedQuantity: { gt: 0 }, tag: { slug: live.instrumentSlug } },
    select: { id: true },
  });
  if (still) return 0;
  return stopPerformances(prisma, [characterId], "unequipped");
}

// What is playing at a Location right now, shaped for the wire. `performerKey` is the
// mute handle (db/lib/hoodToken.js) — never the character id, which would unmask a hood.
async function livePerformancesAt(prisma, locationId) {
  if (!locationId) return [];
  const rows = await prisma.performance.findMany({
    where: { locationId, ...liveWhere() },
    select: {
      id: true,
      characterId: true,
      instrumentSlug: true,
      songKey: true,
      volume: true,
      startedAt: true,
      endsAt: true,
      character: {
        select: { locationId: true, status: true, tags: { select: { tag: { select: { slug: true, name: true } } } } },
      },
    },
    orderBy: { startedAt: "asc" },
  });
  return rows
    // Belt and braces for the stop hooks: somebody no longer here, alive and able to act is
    // not heard, whether or not whatever changed that remembered to stop the row.
    .filter(
      (r) =>
        r.character?.locationId === locationId &&
        r.character?.status === "ALIVE" &&
        !blockerFor(r.character.tags, ACT),
    )
    .map((r) => ({
      id: r.id,
      performerKey: performerKey(r.characterId),
      instrumentSlug: r.instrumentSlug,
      songKey: r.songKey,
      volume: r.volume,
      startedAt: r.startedAt.getTime(),
      endsAt: r.endsAt.getTime(),
    }));
}

// Which of these characters has ever played — the mute button is drawn for them only.
async function hasEverPerformed(prisma, characterIds) {
  const ids = [...new Set((characterIds ?? []).filter(Boolean))];
  if (ids.length === 0 || !hasModel(prisma)) return new Set();
  const rows = await prisma.performance.findMany({
    where: { characterId: { in: ids } },
    select: { characterId: true },
    distinct: ["characterId"],
  });
  return new Set(rows.map((r) => r.characterId));
}

module.exports = {
  MUSIC_OP,
  notifyMusic,
  equippedInstruments,
  holdsInstrument,
  startPerformance,
  setPerformanceVolume,
  stopPerformance,
  stopPerformances,
  stopIfInstrumentGone,
  livePerformancesAt,
  hasEverPerformed,
};
