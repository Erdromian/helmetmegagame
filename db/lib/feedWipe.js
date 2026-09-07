// The web half of the Dawn wipe (docs/systemdocs/HALL.md §7, CHANNELS.md §8).
//
// Discord's half deletes: db/lib/dawnWipe.js walks every channel and empties
// it. The Hall cannot do that, and should not — ArchiveEntry IS the transcript
// /archive reads, so deleting a row to clear a scene would burn the record to
// tidy the screen. So the Hall reads past the wipe instead: GameConfig
// carries a WATERMARK, and every feed query asks for `seq > feedWipeSeq`.
//
// One nice consequence: the unread dots reset with the wipe on their own. A
// dot is "the newest seq here, against the newest seq this browser saw here",
// and after a wipe there is no newest seq here until somebody speaks.
//
// Takes `prisma` as a parameter, same reason as archive.js and say.js:
// db/index.js imports this, so requiring it back would resolve to a partial
// exports object.

// The watermark is taken as the wipe BEGINS, not after it, and that is the
// same instant `cutoffMs` names on the Discord side. A message posted while
// the wipe is still walking the map survives on Discord, and it has to
// survive here too, or where you were standing would decide whether what you
// said still exists.
async function markFeedWiped(prisma) {
  try {
    const newest = await prisma.archiveEntry.aggregate({ _max: { seq: true } });
    const seq = newest?._max?.seq ?? null;
    if (seq === null || seq === undefined) return null;
    await prisma.gameConfig.update({ where: { id: 1 }, data: { feedWipeSeq: seq } });
    return seq;
  } catch (err) {
    // Best-effort, like every other step of the wipe. A watermark that failed
    // to move shows a player yesterday's scene; it never loses anything.
    console.error("Feed wipe watermark failed:", err);
    return null;
  }
}

// The floor every feed read filters above, as a BigInt. Zero whenever the
// wipe is switched off, so a game running without it behaves exactly as it
// did before this existed.
async function feedWipeFloor(prisma) {
  try {
    const config = await prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: { messageWipeEnabled: true, feedWipeSeq: true },
    });
    if (!config?.messageWipeEnabled) return 0n;
    return BigInt(config.feedWipeSeq ?? 0);
  } catch (err) {
    // Reading nothing must never mean hiding everything: the safe failure
    // here is the pre-wipe behaviour, which is a floor of zero.
    console.error("Feed wipe floor failed:", err);
    return 0n;
  }
}

// The same floor as a Prisma `seq` filter, folded into whatever else a query
// already asks of the column. `gt: 0n` is harmless but noisy, so it is left
// out entirely when the wipe is off.
function seqFilterAbove(floor, extra = {}) {
  if (!floor || floor <= 0n) return Object.keys(extra).length > 0 ? extra : undefined;
  return { ...extra, gt: extra.gt !== undefined && extra.gt > floor ? extra.gt : floor };
}

module.exports = { markFeedWiped, feedWipeFloor, seqFilterAbove };
