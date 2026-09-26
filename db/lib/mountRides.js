// The database half of the mount ladder (db/lib/mounts.js, ARELITZ.md §2a):
// spending a ride takes the equipped mount's tag one stage down, and the turn
// pass walks every stage back up to fresh. Both are a UNIT SHIFT between two
// rows of the same holder — one arelitz out of a stack of three becomes one
// `arelitz-ridden-1` beside two still fresh — and neither goes through
// tagWrites.js#addToStack / dropCharacterTag on purpose: those stamp
// acquiredAt, charge wound mood, apply supersedes and write the economy
// ledger, and a tired animal is the same asset it was a minute ago. Every
// stage of a ladder carries the head's price in docs/tags.yaml, so the
// ledger's holdings still add up without a row.
//
// Takes `prisma` (or a `tx`) off the @lifeweb/db barrel, the carry.js posture.
const { MOUNT_STAGES, FAST_TRAVEL_SLUGS, nextStage, mountHead } = require("./mounts");
const { lockRoom } = require("./tagWrites");

// Moves `units` of `row` (a CharacterTag with id/characterId/tagId/quantity/
// equippedQuantity/source/acquiredAt/expiresTurn) onto the row for `toTagId`,
// `equippedUnits` of them still equipped. Creates, merges or retags as the
// counts require; equippedQuantity is carried across so the MOUNT slot stays
// exactly as full as it was (db/lib/equipSlots.js counts rows, not tags).
async function shiftCharacterUnits(tx, row, toTagId, { units, equippedUnits }) {
  const n = Math.min(units, row.quantity);
  const eq = Math.min(equippedUnits, row.equippedQuantity, n);
  const target = await tx.characterTag.findUnique({
    where: { characterId_tagId: { characterId: row.characterId, tagId: toTagId } },
    select: { id: true, quantity: true, equippedQuantity: true },
  });
  if (n >= row.quantity) {
    if (!target) {
      await tx.characterTag.update({ where: { id: row.id }, data: { tagId: toTagId } });
      return;
    }
    await tx.characterTag.delete({ where: { id: row.id } });
  } else {
    const remainingEq = row.equippedQuantity - eq;
    await tx.characterTag.update({
      where: { id: row.id },
      data: { quantity: row.quantity - n, equippedQuantity: remainingEq, equipped: remainingEq > 0 },
    });
  }
  if (target) {
    const totalEq = target.equippedQuantity + eq;
    await tx.characterTag.update({
      where: { id: target.id },
      data: { quantity: target.quantity + n, equippedQuantity: totalEq, equipped: totalEq > 0 },
    });
  } else {
    await tx.characterTag.create({
      data: {
        characterId: row.characterId,
        tagId: toTagId,
        source: row.source,
        acquiredAt: row.acquiredAt,
        expiresTurn: row.expiresTurn ?? null,
        quantity: n,
        equippedQuantity: eq,
        equipped: eq > 0,
      },
    });
  }
}

// A whole RoomTag row onto the row for `toTagId` — the stable floor's tired
// animals at the turn. Visible and hidden units both come along (SEARCH.md
// §9); the earlier of two floor clocks wins, the way addToRoomStack merges.
async function shiftRoomRow(tx, row, toTagId) {
  await lockRoom(tx, row.roomId);
  const target = await tx.roomTag.findUnique({
    where: { roomId_tagId: { roomId: row.roomId, tagId: toTagId } },
    select: { id: true, expiresTurn: true, floorDay: true },
  });
  if (!target) {
    await tx.roomTag.update({ where: { id: row.id }, data: { tagId: toTagId } });
    return;
  }
  const clocks = [target.expiresTurn, row.expiresTurn].filter((t) => t != null);
  const days = [target.floorDay, row.floorDay].filter((d) => d != null);
  await tx.roomTag.update({
    where: { id: target.id },
    data: {
      quantity: { increment: row.quantity },
      hiddenQuantity: { increment: row.hiddenQuantity ?? 0 },
      expiresTurn: clocks.length ? Math.min(...clocks) : null,
      floorDay: days.length ? Math.min(...days) : null,
    },
  });
  await tx.roomTag.delete({ where: { id: row.id } });
}

// Spend one ride off whatever mount this character has equipped: the tag
// goes one stage down its ladder. Runs INSIDE the crossing's transaction,
// after the claim has won its race (locationTravel.js#performLocationMove).
// Returns { from, to } or null when nothing rideable was out, or it had no
// ride left — the caller decided that already, this only records it.
async function rideMount(tx, characterId) {
  const row = await tx.characterTag.findFirst({
    where: { characterId, equipped: true, tag: { slug: { in: [...FAST_TRAVEL_SLUGS] } } },
    select: {
      id: true,
      characterId: true,
      tagId: true,
      quantity: true,
      equippedQuantity: true,
      source: true,
      acquiredAt: true,
      expiresTurn: true,
      tag: { select: { slug: true } },
    },
  });
  if (!row) return null;
  const to = nextStage(row.tag.slug);
  if (!to) return null;
  const toTag = await tx.tag.findUnique({ where: { slug: to }, select: { id: true } });
  if (!toTag) {
    // The ladder is authored in docs/tags.yaml; a rung missing from the
    // catalog means db:sync-tags has not run. The crossing still happens —
    // the rider is not refused for a catalog gap — the mount just stays fresh.
    console.error(`rideMount: missing tag "${to}" — run npm run db:sync-tags.`);
    return null;
  }
  await shiftCharacterUnits(tx, row, toTag.id, { units: 1, equippedUnits: 1 });
  return { from: row.tag.slug, to };
}

// The turn pass: every ridden stage, on every sheet and every floor, back to
// its fresh head. One transaction per row, so a single odd row cannot hold
// the whole pass. Returns { rested } — always an object, so runPass marks it
// done even on a quiet night.
async function runMountRestPass(prisma) {
  const ridden = [...MOUNT_STAGES].filter(([, s]) => s.ridden > 0).map(([slug]) => slug);
  const heads = [...new Set(ridden.map((slug) => mountHead(slug)))];
  const tags = await prisma.tag.findMany({
    where: { slug: { in: [...ridden, ...heads] } },
    select: { id: true, slug: true },
  });
  const idBySlug = new Map(tags.map((t) => [t.slug, t.id]));
  const headIdFor = new Map();
  for (const slug of ridden) {
    const headId = idBySlug.get(mountHead(slug));
    const stageId = idBySlug.get(slug);
    if (headId && stageId) headIdFor.set(stageId, headId);
  }
  if (headIdFor.size === 0) {
    console.error("Mount rest pass skipped: no ladder tags in the catalog — run npm run db:sync-tags.");
    return { rested: 0, skipped: true };
  }
  const stageIds = [...headIdFor.keys()];
  let rested = 0;

  const held = await prisma.characterTag.findMany({
    where: { tagId: { in: stageIds } },
    select: {
      id: true,
      characterId: true,
      tagId: true,
      quantity: true,
      equippedQuantity: true,
      source: true,
      acquiredAt: true,
      expiresTurn: true,
    },
  });
  for (const row of held) {
    await prisma.$transaction((tx) =>
      shiftCharacterUnits(tx, row, headIdFor.get(row.tagId), { units: row.quantity, equippedUnits: row.equippedQuantity }),
    );
    rested += row.quantity;
  }

  const floors = await prisma.roomTag.findMany({
    where: { tagId: { in: stageIds } },
    select: { id: true, roomId: true, tagId: true, quantity: true, hiddenQuantity: true, expiresTurn: true, floorDay: true },
  });
  for (const row of floors) {
    await prisma.$transaction((tx) => shiftRoomRow(tx, row, headIdFor.get(row.tagId)));
    rested += row.quantity + (row.hiddenQuantity ?? 0);
  }

  return { rested };
}

module.exports = { rideMount, runMountRestPass, shiftCharacterUnits };
