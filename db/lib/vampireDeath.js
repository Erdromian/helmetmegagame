// The Vampire's own death (docs/systemdocs/VAMPIRE.md §7 — design doc pages
// 4-5): "Vampires do not die from regular injuries expiring into the dying
// tag, or from the turret, or any other form of physical injury short of a
// blow to the heart, decapitation and burning." db/lib/dyingDeathPass.js
// skips a vampire outright, and db/lib/turretPass.js leaves one Dying instead
// of dead. Everything else that kills — a GM's hand, a collar, the Magma, a
// rite, the bomb, Xom, catatonia — kills a vampire like anyone else.
//
// What it leaves behind is never ordinary: "they are immediately gibbed,
// turning into ash... Their items will be dropped on the ground as well as a
// pile of ash tag." db/lib/characterDeath.js#applyDeathToRow calls ashBody
// below for EVERY death of a `vampire` holder, whichever path asked, and then
// gibs the sheet. That is the whole point of living there rather than in a
// wrapper: the wrapper this replaced reached two death paths out of eleven,
// so a vampire killed by a collar or the Magma mid-turn left an ordinary
// corpse, and even the ash path left the sheet lying in the room as a body
// (db/lib/presence.js#UNBURIED_BODY_WHERE only drops a Gibbed sheet).
//
// Order matters: the goods go onto the floor here, BEFORE the gib's tag wipe,
// or they would go up with the rest of the sheet.
//
// Takes `db` (a PrismaClient or a transaction client) first — db/lib/dm.js's reason.
const { PILE_OF_ASH_SLUG } = require("./secretSlugs");
const { pickRandomPublicRoom } = require("./roomStash");
const { addToRoomStack, dropCharacterTag } = require("./tagWrites");
const { stampLeftOnFloor } = require("./floorSettle");
const { isTradeable } = require("./tradeable");
const { locationLine } = require("./placeLine");
const { SFX } = require("./sfx");
const { capitalizeFirst } = require("./concealedIdentity");

// A bare client opens its own transaction, so a crash can't take an item off
// the sheet without setting it down; a transaction client (the staged push)
// is already inside one and has no `$transaction` of its own.
function inTx(db, fn) {
  return typeof db.$transaction === "function" ? db.$transaction(fn) : fn(db);
}

// Sets every tradeable holding (⬢ included) down in one public Room at their
// Location, mints the Pile of Ash beside them, and writes the audit row.
// Returns the room, or null when the Location has no public room — the goods
// then stay on the sheet and go with the gib, the way a gib's always did.
// The same move as the Overburdened shed (db/lib/carry.js#settleCarry):
// dropCharacterTag then addToRoomStack, poison threaded through, so both ends
// of the economy ledger are written and ⬢ stays reconciled.
async function setDownRemains(db, character, { turn = null } = {}) {
  return inTx(db, async (tx) => {
    const room = await pickRandomPublicRoom(tx, character.locationId ?? null);
    if (!room) {
      console.error(`Vampire ash: no public room at ${character.locationId ?? "nowhere"} for ${character.id} — goods lost with the sheet.`);
      return null;
    }

    const held = await tx.characterTag.findMany({
      where: { characterId: character.id, quantity: { gt: 0 } },
      select: {
        tagId: true,
        quantity: true,
        expiresTurn: true,
        tag: { select: { slug: true, name: true, tradeable: true } },
      },
    });
    const dropped = [];
    for (const row of held) {
      if (!isTradeable(row.tag)) continue;
      const { poisonedTaken, poisonPayload } = await dropCharacterTag(tx, character.id, row.tagId);
      await addToRoomStack(tx, room.id, row.tagId, row.quantity, {
        expiresTurn: row.expiresTurn,
        poisonedCount: poisonedTaken,
        poisonPayload,
      });
      dropped.push({ tagId: row.tagId, tagSlug: row.tag.slug, tagName: row.tag.name, quantity: row.quantity });
    }
    // Left on the floor like any other drop (CARRY.md §6a), and sinks the same way.
    await stampLeftOnFloor(tx, room.id, dropped.map((d) => d.tagId));

    const ashTag = await tx.tag.findUnique({ where: { slug: PILE_OF_ASH_SLUG }, select: { id: true } });
    if (ashTag) await addToRoomStack(tx, room.id, ashTag.id, 1, {});
    else console.error(`Vampire ash: no "${PILE_OF_ASH_SLUG}" tag — run npm run db:sync-tags.`);

    await tx.auditLog.create({
      data: {
        actorDiscordUserId: "system:vampire-ash",
        actionType: "vampire_ashed",
        targetCharacterId: character.id,
        turnId: turn?.id ?? null,
        details: { roomId: room.id, roomName: room.name, ash: Boolean(ashTag), tags: dropped },
      },
    });
    return room;
  });
}

// The whole ash half of a vampire's death, called by applyDeathToRow after
// the claim and before the gib. `seenName` is what the room saw them as,
// read while the mask was still on: a hood stays a hood even now. Never
// throws — the death has already landed on the row.
async function ashBody(db, character, { turn = null, seenName = null } = {}) {
  const room = await setDownRemains(db, character, { turn }).catch((err) => {
    console.error(`Vampire ash: setting down ${character.id}'s remains failed:`, err);
    return null;
  });

  const location = character.locationId
    ? await db.location
        .findUnique({ where: { id: character.locationId }, select: { id: true, name: true, discordChannelId: true } })
        .catch(() => null)
    : null;
  if (location) {
    await locationLine(db, location, `${capitalizeFirst(seenName ?? character.name)} disintegrates into a pile of ash!`, {
      sfx: SFX.GIB,
    }).catch((err) => console.error(`Vampire ash: the line for ${character.id} failed:`, err));
  }
  return { roomId: room?.id ?? null };
}

module.exports = { ashBody };
