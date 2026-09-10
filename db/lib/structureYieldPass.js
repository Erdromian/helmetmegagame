// What a building MAKES, every turn, by standing there.
//
// A structure type declares `placement.yields: { tag, room, quantity }` in
// docs/tags.yaml and this pours it into that Room's floor at every close. The
// Brewery is the first and so far only one: it stands at the Old Cock Inn and
// racks a cask down in the inn cellar.
//
// THE PRODUCE GOES ON A FLOOR, NOT INTO POCKETS, and that is the whole design.
// An earlier draft handed a bottle to everyone standing at the Location, which
// made a 15 ⬢ building into the best mood engine in the game — Alcohol is +30
// on consume, the largest single lift there is (MOOD.md §6), and Ecstatic's
// brake had shipped the day before on the argument that the good half of the
// dial is meant to cost something. A stash is a place people have to walk to,
// carry from, and can be robbed of. `inn-cellar` is keyed (`access: [inn-key]`
// in docs/zones.yaml), so the beer belongs to somebody in particular.
//
// The destination room need NOT be at the structure's own Location — naming it
// by slug is what lets the brewery at the inn fill the cellar under it.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.

const { addToRoomStack } = require("./tagWrites");
const { ambientLine } = require("./ambientLine");
const { postMessage } = require("./discordRest");
const { placementOf } = require("./structures");

// Structures that are actually WORKING. Deliberately COMPLETE only, and
// stricter than WORKING_STATUSES: a palisade still fences you in when it is
// DAMAGED, but a damaged brewery is one nobody is minding. Same call the
// labor bonus makes (db/lib/laborAccess.js).
const YIELDING_STATUSES = ["COMPLETE"];

async function runStructureYieldPass(prisma, turn) {
  const result = { poured: 0, skipped: 0, lines: [] };
  if (!turn?.id) return result;

  const rows = await prisma.structure.findMany({
    where: { status: { in: YIELDING_STATUSES } },
    select: { id: true, typeSlug: true, typeName: true, lastUpkeepTurnId: true },
  });
  if (!rows.length) return result;

  // One query for the catalog, joined in JS — typeSlug is a string rather than
  // a relation on purpose (schema.prisma), so there is nothing to include.
  const types = await prisma.tag.findMany({
    where: { slug: { in: [...new Set(rows.map((r) => r.typeSlug))] } },
    select: { id: true, slug: true, placement: true },
  });
  const yieldsBySlug = new Map();
  for (const t of types) {
    const y = placementOf(t)?.yields;
    if (y) yieldsBySlug.set(t.slug, y);
  }
  if (!yieldsBySlug.size) return result;

  for (const row of rows) {
    const spec = yieldsBySlug.get(row.typeSlug);
    if (!spec) continue;
    // Per-row try/catch: one bad catalog entry must not cost the whole pass,
    // the posture every other pass keeps.
    try {
      // THE CLAIM, and the reason this pass is safe to re-enter. The turn
      // engine records finished passes on Turn.resolvedPasses and a killed
      // advance resumes, so "did I already pour for this turn" has to be
      // answerable from the row itself. lastUpkeepTurnId has been sitting in
      // the schema unused for exactly this — its comment calls it "a claim
      // column for a FUTURE decay/upkeep pass". This is that pass.
      //
      // Conditional updateMany, so the WHERE is the check: two advances
      // racing cannot both pour.
      //
      // The OR-with-null is NOT decoration. `NOT: { lastUpkeepTurnId: turn.id }`
      // reads as `NOT (col = '…')`, which SQL evaluates to UNKNOWN — not true —
      // when the column is NULL, so a structure that had never yielded matched
      // nothing and every brewery in the game poured exactly zero. This is the
      // same shape the Bird's day claim spells out for the same reason
      // (requestActions.js), and it is the shape to copy.
      const { count } = await prisma.structure.updateMany({
        where: {
          id: row.id,
          OR: [{ lastUpkeepTurnId: null }, { lastUpkeepTurnId: { not: turn.id } }],
        },
        data: { lastUpkeepTurnId: turn.id },
      });
      if (count === 0) continue;

      // Cross-master references, resolved here rather than at sync time:
      // docs/tags.yaml names a room and a tag out of docs/zones.yaml and its
      // own catalog, and the two syncs run independently (SYNC.md). So both
      // fail SOFT — a rename leaves a brewery that makes nothing and says so
      // in the log, rather than throwing a turn close.
      const [room, tag] = await Promise.all([
        prisma.room.findUnique({
          where: { slug: spec.room },
          select: { id: true, name: true, discordThreadId: true },
        }),
        prisma.tag.findUnique({ where: { slug: spec.tag }, select: { id: true, name: true } }),
      ]);
      if (!room || !tag) {
        console.warn(
          `structureYield: ${row.typeName} yields ${spec.quantity}× "${spec.tag}" into "${spec.room}" — ${!room ? "no such room" : "no such tag"}. Nothing poured.`,
        );
        result.skipped += 1;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await addToRoomStack(tx, room.id, tag.id, spec.quantity);
      });
      result.poured += 1;
      if (room.discordThreadId) {
        result.lines.push({
          threadId: room.discordThreadId,
          text: ambientLine(`Something new has been left here. ‡`),
        });
      }
    } catch (err) {
      console.error(`structureYield failed for ${row.typeName} (${row.id}):`, err);
      result.skipped += 1;
    }
  }

  // Scenery, posted best-effort and catch-logged rather than handed to the
  // turn's side-effect ledger. The ledger's payload is a fixed list of keys
  // that a resume replays, and a line saying a cask appeared is not worth a
  // new one: the STATE is already durable and already idempotent above, so
  // the worst a lost post costs is that somebody finds the beer instead of
  // being told about it. Sequential, not Promise.all — the rate-limit
  // discipline soundBroadcast.js and deathSmell.js both keep.
  for (const line of result.lines) {
    await postMessage(line.threadId, line.text).catch((err) =>
      console.error("Structure yield line failed:", err),
    );
  }

  return result;
}

module.exports = { runStructureYieldPass, YIELDING_STATUSES };
