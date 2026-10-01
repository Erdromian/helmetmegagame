// The Caving Die (docs/systemdocs/CAVING.md, Bascinet's Caving.docx). One
// trigger, rollCavingOnArrival(), fires on every CAVE_LEVEL arrival; standing
// still costs nothing. EVERY arrival rolls — the walk cooldown
// (GameConfig.locationMoveCooldownSeconds) is the only brake on the ROLLING.
// Every 1 a caver rolls on a turn adds one to the SEVERITY of their one caving
// result; at severity 10 they go nowhere until the push
// (cavingRestrictionsFor, below). Takes `prisma` as a parameter — see
// db/lib/dm.js for why.
const { drawLoot } = require("./cavingLoot");
const { addToStack, addToRoomStack } = require("./tagWrites");
const { accessibleRooms, roomAccessKeys } = require("./roomAccess");
const { loadRoomsAt } = require("./roomSides");
const { isTradeable } = require("./tradeable");
const { applyMood } = require("./mood");
const { rollWithAdvantage } = require("./advantage");
const { LUCKY_SLUG } = require("./constants");
const { expiryFrom } = require("./turnFormat");
const { loadPresentedState } = require("./examineSnapshot");
const { logAudit } = require("./auditLog");

function quietDm(die) {
  return `Caving Die: ${die} — Nothing happens.`;
}

function troubleDm(die) {
  return `Caving Die: ${die} — Something is wrong down here. A GM has been notified.`;
}

// The tenth 1 of the turn, said in the same DM rather than a second one — the
// player reads their roll and, in the same breath, that the walking is over.
function stuckDm(die) {
  return `${troubleDm(die)} ${CAVING_STUCK_REASON}`;
}

function findDm(die, tagName) {
  return `Caving Die: ${die} — You found something: ${tagName}.`;
}

// A second of something that does not stack, set down where the caver stands.
function leftDm(die, tagName, roomName) {
  return `${findDm(die, tagName)} You already have one, so you leave it in ${roomName}.`;
}

// A second of something that is not a thing (a skill, directions) — or a
// thing with nowhere to put it down. Nothing changes; the DM says so.
function alreadyDm(die, tagName) {
  return `${findDm(die, tagName)} You already have it.`;
}

// Where a doubled find goes: one of the rooms at this Location the caver can
// get into, picked at random — the same doors accessibleRooms() opens for
// everything else. Never a retired room, and never one that eats what is put
// in it. Null when there is none (every cave Location has a public room
// today, so that would be a map edit).
async function roomToLeaveIn(tx, characterId, locationId) {
  const rooms = await loadRoomsAt(tx, locationId, {
    where: { retiredAt: null, destroysContents: false },
    select: { id: true, name: true, kind: true, accessTagSlugs: true },
  });
  if (!rooms.length) return null;
  const keys = await roomAccessKeys(tx, characterId);
  const open = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds);
  return open.length ? open[Math.floor(Math.random() * open.length)] : null;
}

// The caver as they stood at this 1 — tags with equipped flags, and combat mode — for the GM who
// adjudicates the folded result off the newest one (CAVING.md §5). Never fails the roll: a snapshot
// that cannot be taken is a null column, and the desk says so.
async function troubleSnapshot(tx, characterId) {
  try {
    return (await loadPresentedState(tx, characterId)).state ?? undefined;
  } catch (err) {
    console.error("Caving pass: snapshot failed:", err.message ?? err);
    return undefined;
  }
}

// Always writes a row and returns { roll, dm }; never sends the DM itself.
// ARRIVAL is the only `trigger` value written now — the COLUMN stays because historic rows carry TURN_START.
async function rollCaving(prisma, character, turn, location) {
  const zone = location.zone;
  const trigger = "ARRIVAL";
  // Lucky rolls twice, keeps the better; `character` isn't guaranteed to arrive with tags loaded, so queried here.
  const lucky = await prisma.characterTag.findFirst({
    where: { characterId: character.id, tag: { slug: LUCKY_SLUG } },
    select: { id: true },
  });
  const { die } = rollWithAdvantage(lucky ? [{ tag: { slug: LUCKY_SLUG } }] : []);
  const kind = die === 1 ? "TROUBLE" : die === 6 ? "FIND" : "QUIET";

  return await prisma.$transaction(async (tx) => {
    if (kind !== "FIND") {
      const rowKind = kind;
      const row = await tx.cavingRoll.create({
        data: {
          turnId: turn.id,
          characterId: character.id,
          trigger,
          zoneId: zone.id,
          locationId: location.id,
          die,
          kind: rowKind,
          resolvedAt: rowKind === "QUIET" ? new Date() : null,
          presentedState: rowKind === "TROUBLE" ? await troubleSnapshot(tx, character.id) : undefined,
        },
      });
      let stuck = false;
      if (rowKind === "TROUBLE") {
        await applyMood(tx, character.id, { kind: "CAVE_TROUBLE" });
        // Counted INSIDE the transaction, after the row lands, so the DM that
        // says "that's ten" is written by the same roll that made it ten.
        stuck = (await tx.cavingRoll.count({ where: troubleWhere(character.id) })) >= CAVING_TROUBLE_CAP;
      }
      return {
        roll: row,
        dm: {
          discordUserId: character.discordUserId,
          content: kind !== "TROUBLE" ? quietDm(die) : stuck ? stuckDm(die) : troubleDm(die),
        },
      };
    }

    // FIND — draw, grant and file, all in one transaction.
    const { tier, slug } = drawLoot(zone.slug);
    const tag = await tx.tag.findUnique({
      where: { slug },
      select: { id: true, name: true, stackable: true, tradeable: true, defaultDurationTurns: true },
    });
    if (!tag) {
      // Catalog out of sync with cavingLoot.js — refuse the phantom tag, recorded TROUBLE-shaped so a GM notices it on the Caving lens.
      console.error(`Caving pass: loot tier "${tier}" drew unknown tag "${slug}" — run npm run db:sync-tags.`);
      const row = await tx.cavingRoll.create({
        data: {
          turnId: turn.id,
          characterId: character.id,
          trigger,
          zoneId: zone.id,
          locationId: location.id,
          die,
          kind: "TROUBLE",
          presentedState: await troubleSnapshot(tx, character.id),
        },
      });
      return {
        roll: row,
        dm: { discordUserId: character.discordUserId, content: troubleDm(die) },
      };
    }

    // `turn.number`, NOT +1: unlike hungerPass/tagExpiryPass/moveEffects, `turn` here IS already the first live turn.
    const expiresTurn = expiryFrom(turn.number, tag.defaultDurationTurns);

    // A non-stackable tag the caver already holds would be a no-op on the
    // sheet, so the find used to vanish. A THING goes into a room here
    // instead, for them to come back for or leave to whoever finds it next.
    // Only a tradeable one: nobody can take anything else back out of a room
    // (Transfer refuses it), so a second skill or set of directions stays the
    // no-op it always was.
    const doubled =
      !tag.stackable &&
      Boolean(
        await tx.characterTag.findUnique({
          where: { characterId_tagId: { characterId: character.id, tagId: tag.id } },
          select: { id: true },
        }),
      );
    const leftIn = doubled && isTradeable(tag) ? await roomToLeaveIn(tx, character.id, location.id) : null;

    if (leftIn) {
      await addToRoomStack(tx, leftIn.id, tag.id, 1, { expiresTurn });
    } else {
      await addToStack(tx, character.id, tag.id, 1, { source: "EVENT", stackable: tag.stackable, expiresTurn });
    }

    await logAudit(tx, {
      actorDiscordUserId: character.discordUserId ?? "system",
      actionType: "caving_loot_granted",
      targetCharacterId: character.id,
      turnId: turn.id,
      details: {
        tagId: tag.id,
        tagName: tag.name,
        added: 1,
        zoneId: zone.id,
        tier,
        die,
        ...(leftIn ? { roomId: leftIn.id, roomName: leftIn.name } : {}),
      },
    });

    const row = await tx.cavingRoll.create({
      data: {
        turnId: turn.id,
        characterId: character.id,
        trigger,
        zoneId: zone.id,
        locationId: location.id,
        die,
        kind: "FIND",
        lootTier: tier,
        lootTagId: tag.id,
        lootAlreadyHeld: doubled,
        lootRoomId: leftIn?.id ?? null,
        resolvedAt: new Date(),
      },
    });

    return {
      roll: row,
      dm: {
        discordUserId: character.discordUserId,
        content: leftIn
          ? leftDm(die, tag.name, leftIn.name)
          : doubled
            ? alreadyDm(die, tag.name)
            : findDm(die, tag.name),
      },
    };
  });
}

// Bails quietly on a surface Location, no open turn, or any error at all — a caving roll must never fail the move that caused it.
async function rollCavingOnArrival(prisma, character, location) {
  // Underground is the whole gate now. The `safe` attribute used to except
  // the cave mouth; it was deleted with the watchtower it belonged to, so the
  // Die rolls everywhere below ground, the Entrance included.
  if (location?.zone?.kind !== "CAVE_LEVEL") return null;

  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!turn) return null;

  try {
    const { dm } = await rollCaving(prisma, character, turn, location);
    return dm;
  } catch (err) {
    console.error(`Caving arrival roll failed for character ${character.id}:`, err);
    return null;
  }
}

// ---- The hold a 1 puts on you, and the stop ten of them put on you --------
//
// Caving.docx: "Having failed caving rolls awaiting the turn push prevent a
// character from moving from a cave/depths location to an aboveground
// location", and "Having a pending cave result of a severity of 10 inhibits
// all movement between locations." Each 1 is a point of severity on the
// caver's ONE result for the turn, wherever underground they rolled it.
//
// The hold lasts until the TURN ENDS, not until the roll is resolved. A GM's
// Mark resolved says the encounter has been decided; what was decided — the
// staged effect, message or death wired to the roll — only reaches the caver
// at the push. Keying the hold on resolvedAt let the caver walk out of the
// caves in the hours between the two, so the bite landed on somebody standing
// in the Forest. The push is what closes the turn, so the hold can never
// outlive it either — nothing has to sweep it.
//
// It takes the way UP and nothing else: the Caves and the Depths stay open to
// each other, so a party can regroup, camp or push deeper while they wait.
//
// Both rules are only ever asked of somebody standing underground. The hold is
// about leaving the caves, so on the surface it has nothing to take; and the
// stop is the same — a GM who teleports a stuck caver up to Town has made the
// ruling, and must not strand them there (Bascinet, 2026-09-27).
//
// Unlike heldReasonFor (db/lib/intercept.js) this is a QUERY rather than a
// pure comparison, because the answer lives in CavingRoll and nowhere on
// Character.
const CAVING_TROUBLE_CAP = 10;

const CAVING_HOLD_REASON =
  "You rolled a 1, so you can't leave the caves until the turn ends and you receive the results of your caving die.";

// Caving.docx, verbatim.
const CAVING_STUCK_REASON =
  "You are too worn out to keep going, best to hunker down and prepare for whatever evil awaits.";

// The whole rule is this WHERE: this character, a 1, on the turn that is
// still open. NOT resolvedAt — see the hold's note above — and not the zone:
// a 1 in the Caves still counts once they are down in the Depths.
function troubleWhere(characterId) {
  return { characterId, kind: "TROUBLE", turn: { status: "OPEN" } };
}

// One Caving result (CAVING.md §5): every 1 this caver rolled on this turn, its severity their
// count. The desk's Save and Mark resolved act on the group, never on one roll of it.
function troubleGroupWhere({ turnId, characterId }) {
  return { turnId, characterId, kind: "TROUBLE" };
}

// Both answers off one count, and only for somebody standing underground
// (`standingZoneKind` is the kind of the zone they stand in) — anywhere else
// the answer is nothing and no query is made. `hold` shuts the ways up to the
// surface; `stuck` shuts every way. A stuck caver is always also held.
async function cavingRestrictionsFor(prisma, characterId, standingZoneKind) {
  if (!characterId || standingZoneKind !== "CAVE_LEVEL") return { hold: null, stuck: null };
  const troubles = await prisma.cavingRoll.count({ where: troubleWhere(characterId) });
  return {
    hold: troubles > 0 ? CAVING_HOLD_REASON : null,
    stuck: troubles >= CAVING_TROUBLE_CAP ? CAVING_STUCK_REASON : null,
  };
}

// The kind of zone a character is standing in, for a caller that loaded the
// character without it (the Stepstone, Bat Form). Uses what is already on the
// row when it can; one small read of Zone when it can't.
async function standingZoneKind(prisma, character) {
  const loaded = character?.zone?.kind ?? character?.location?.zone?.kind;
  if (loaded) return loaded;
  if (!character?.zoneId) return null;
  const zone = await prisma.zone.findUnique({ where: { id: character.zoneId }, select: { kind: true } });
  return zone?.kind ?? null;
}

// What those restrictions say about one move, to a place in a zone of kind
// `intoZoneKind`: the stop refuses anywhere, the hold only a way out of the
// caves. Null means go.
function cavingRefusalFor({ hold, stuck }, intoZoneKind) {
  if (stuck) return stuck;
  if (hold && intoZoneKind !== "CAVE_LEVEL") return hold;
  return null;
}

// The party question, one query for everybody: which followers the Die has
// hold of (may not go up) and which it has stopped (may not walk at all).
// Every stuck id is in `held` too. Asked only underground, like the above.
async function cavingPartyRestrictions(prisma, characterIds, standingZoneKind) {
  const held = new Set();
  const stuck = new Set();
  if (standingZoneKind !== "CAVE_LEVEL" || !characterIds?.length) return { held, stuck };
  const rows = await prisma.cavingRoll.findMany({
    where: { characterId: { in: characterIds }, kind: "TROUBLE", turn: { status: "OPEN" } },
    select: { characterId: true },
  });
  const counts = new Map();
  for (const r of rows) counts.set(r.characterId, (counts.get(r.characterId) ?? 0) + 1);
  for (const [id, n] of counts) {
    held.add(id);
    if (n >= CAVING_TROUBLE_CAP) stuck.add(id);
  }
  return { held, stuck };
}

// The push's release valve (docs/systemdocs/CAVING.md §2d).
//
// A TROUBLE roll nobody adjudicated is still open once the turn closes, and
// the Caving lens goes read-only on a past turn by design — so it would sit on
// the desk's "Needs attention" filter forever with nobody able to reach it.
// The hold itself no longer depends on this (it ends with the turn, above);
// this is the desk's bookkeeping. Whatever a GM staged on the result has
// already gone out by now — the staged push (db/lib/stagedPush.js) delivers
// every staged row on the turn, resolved or not, and runs first
// (Caving.docx: "with whatever was staged in them being pushed").
//
// So the push resolves what is left. resolvedByDiscordUserId stays NULL, and
// that null is the marker: a TROUBLE row is created unresolved and the only
// hand that resolves one (web/app/(desk)/gm/turns/actions.js) always writes an
// id, so resolved-with-no-resolver can only mean this. gmNotes is untouched —
// the game has nothing to say about a monster it never adjudicated.
async function releaseUnresolvedCavingRolls(prisma, turn) {
  const open = await prisma.cavingRoll.findMany({
    where: { turnId: turn.id, kind: "TROUBLE", resolvedAt: null },
    select: { id: true, characterId: true, zoneId: true },
  });
  if (!open.length) return { released: 0, rolls: [] };

  // Guarded updateMany is the claim — the COUNT is what was released, not `open.length`; re-read below, or the audit log names a caver already freed.
  await prisma.cavingRoll.updateMany({
    where: { id: { in: open.map((r) => r.id) }, resolvedAt: null },
    data: { resolvedAt: new Date(), resolvedByDiscordUserId: null },
  });
  const released = await prisma.cavingRoll.findMany({
    where: { id: { in: open.map((r) => r.id) }, resolvedAt: { not: null }, resolvedByDiscordUserId: null },
    select: { id: true, characterId: true },
  });
  if (!released.length) return { released: 0, rolls: [] };
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: "system",
        actionType: "caving_auto_resolved",
        details: {
          turnNumber: turn.number,
          released: released.length,
          rolls: released.map((r) => ({ cavingRollId: r.id, characterId: r.characterId })),
        },
      },
    })
    .catch((err) => console.error("Caving auto-resolve audit log failed:", err));

  return { released: released.length, rolls: released.map((r) => r.id) };
}

module.exports = {
  rollCaving,
  rollCavingOnArrival,
  cavingRestrictionsFor,
  cavingRefusalFor,
  standingZoneKind,
  cavingPartyRestrictions,
  releaseUnresolvedCavingRolls,
  troubleGroupWhere,
  CAVING_HOLD_REASON,
  CAVING_STUCK_REASON,
  CAVING_TROUBLE_CAP,
};
