// Who personally witnessed an archive row (docs/systemdocs/ARCHIVE.md, "Witnesses").
// Frozen onto ArchiveEntry.witnessIds / witnessNames as the row is written, for
// /archive's "Witnessed by" filter. One rule for all three writers:
//
//   a line or an event   whoever it is about (the speaker, the one who died),
//                        plus everyone standing in the place it was said in
//   an act (ACTION)      the one who did it and the one it was done to, and
//                        nobody else: a quiet Steal is not seen by the room,
//                        and what the room WAS shown is its own scene line
//
// Standing there, not able to read it: the same presence rule as the day's
// heard lines (db/lib/memoryHearing.js#presentWhere). A street you walked out
// of or a room seen through the Scrying Eye is not being there. Somebody asleep
// or unconscious witnesses nothing, unless the row is their own.
//
// Why a column and not HeardLine: that table is wiped every day and cascades
// off Character, which Restart Game clears. A column rides in the game's
// packet (db/lib/archiveExport.js reads the columns off the DMMF), so a past
// game still knows who was in the room.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel.

// A day divider is not something anybody saw.
const NO_WITNESS_KINDS = new Set(["TURN_START"]);

// Everyone standing at a place key, as { id, name, deaf }. Never throws: a
// line must not fail because nobody could be counted around it.
async function presentAt(prisma, placeKey, speakerId = null) {
  if (!placeKey) return [];
  try {
    // Required here, not at the top: memoryHearing sits in a require cycle with
    // skinless.js, and archive.js requires this file at the top.
    const { presentWhere, DEAF_TAG_SLUGS } = require("./memoryHearing");
    const where = await presentWhere(prisma, placeKey, { speakerId });
    if (!where) return [];
    const people = await prisma.character.findMany({
      where,
      select: { id: true, name: true, tags: { where: { tag: { slug: { in: DEAF_TAG_SLUGS } } }, select: { tagId: true } } },
    });
    return people.map((p) => ({ id: p.id, name: p.name, deaf: p.tags.length > 0 }));
  } catch (err) {
    console.error("Archive witness lookup failed:", err.message ?? err);
    return [];
  }
}

// The witnesses of one row, as [{ id, name }], its own character first. `row`
// needs kind, characterId, characterName, and the audience columns a
// telephone's row carries (onlyCharacterId / exceptCharacterId).
function witnessesFrom(row, present = []) {
  if (!row || NO_WITNESS_KINDS.has(row.kind)) return [];
  const out = new Map();
  if (row.characterId) out.set(row.characterId, row.characterName ?? "");
  for (const p of present) {
    if (!p?.id || out.has(p.id) || p.deaf) continue;
    // A row meant for one reader, or kept from one, is only witnessed by the
    // people who read it (PHONES.md §6).
    if (row.onlyCharacterId && p.id !== row.onlyCharacterId) continue;
    if (row.exceptCharacterId && p.id === row.exceptCharacterId) continue;
    out.set(p.id, p.name ?? "");
  }
  return [...out].map(([id, name]) => ({ id, name }));
}

// Who would witness a line said right now in a Conversation or a Room, as a Set
// of ids — the same rule as the row's own witnesses. Any other kind of place
// answers null. A mention DMs its target on Discord only when they are in this
// set (PROXYING.md §6): a street is too loud a place to be DM'd from.
async function privateWitnessIds(prisma, placeKey, speakerId = null) {
  const kind = typeof placeKey === "string" ? placeKey.split(":")[0] : null;
  if (kind !== "conv" && kind !== "room") return null;
  const present = await presentAt(prisma, placeKey, speakerId);
  return new Set(witnessesFrom({ characterId: speakerId }, present).map((w) => w.id));
}

// The two columns, kept in step: the same person at the same index in both.
function witnessColumns(people = []) {
  const seen = new Set();
  const witnessIds = [];
  const witnessNames = [];
  for (const p of people) {
    if (!p?.id || seen.has(p.id)) continue;
    seen.add(p.id);
    witnessIds.push(p.id);
    witnessNames.push(p.name ?? "");
  }
  return { witnessIds, witnessNames };
}

// Everyone who witnessed anything in one game, as [{ id, name }] sorted by
// name: the "Witnessed by" picker. Read off the rows, not the live Character
// table, since a past game's characters are gone. A renamed character appears
// once, under the name they last witnessed something by.
async function archiveWitnessOptions(prisma, gameId) {
  if (!gameId) return [];
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON (w.id) w.id, w.name
    FROM "ArchiveEntry" e
    CROSS JOIN LATERAL unnest(e."witnessIds", e."witnessNames") AS w(id, name)
    WHERE e."gameId" = ${gameId} AND e."deletedAt" IS NULL
    ORDER BY w.id, e."sentAt" DESC`;
  return rows
    .map((r) => ({ id: r.id, name: r.name || r.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { presentAt, witnessesFrom, privateWitnessIds, witnessColumns, archiveWitnessOptions, NO_WITNESS_KINDS };
