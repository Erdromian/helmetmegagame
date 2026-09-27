// The Caving Die (docs/systemdocs/CAVING.md). One trigger, rollCavingOnArrival(),
// fires on every CAVE_LEVEL arrival; standing still costs nothing. EVERY
// arrival rolls — the walk cooldown (GameConfig.locationMoveCooldownSeconds)
// is the only brake on the ROLLING. The one ceiling is on the 1s: ten TROUBLE
// rows in a zone on one turn and the caver goes nowhere until the push
// (cavingRestrictionsFor, below). Takes `prisma` as a parameter — see
// db/lib/dm.js for why.
const { drawLoot } = require("./cavingLoot");
const { addToStack } = require("./tagWrites");
const { applyMood } = require("./mood");
const { rollWithAdvantage } = require("./advantage");
const { LUCKY_SLUG } = require("./constants");
const { expiryFrom } = require("./turnFormat");
const { loadPresentedState } = require("./examineSnapshot");

function quietDm(die) {
  return `Caving Die: ${die} — Nothing happens.`;
}

function troubleDm(die) {
  return `Caving Die: ${die} — Something is wrong down here. A GM has been notified.`;
}

// The tenth 1 of the turn, said in the same DM rather than a second one — the
// player reads their roll and, in the same breath, that the walking is over.
function stuckDm(die) {
  return `${troubleDm(die)} That's ${CAVING_TROUBLE_CAP} this turn. Whatever is down here has you now — you can't go anywhere until the turn ends.`;
}

function findDm(die, tagName) {
  return `Caving Die: ${die} — You found something: ${tagName}.`;
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
        stuck = (await tx.cavingRoll.count({ where: troubleWhere(character.id, zone.id) })) >= CAVING_TROUBLE_CAP;
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
      select: { id: true, name: true, stackable: true, defaultDurationTurns: true },
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
    await addToStack(tx, character.id, tag.id, 1, {
      source: "EVENT",
      stackable: tag.stackable,
      expiresTurn: expiryFrom(turn.number, tag.defaultDurationTurns),
    });

    await tx.auditLog.create({
      data: {
        actorDiscordUserId: character.discordUserId ?? "system",
        actionType: "caving_loot_granted",
        targetCharacterId: character.id,
        turnId: turn.id,
        details: { tagId: tag.id, tagName: tag.name, added: 1, zoneId: zone.id, tier, die },
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
        resolvedAt: new Date(),
      },
    });

    return { roll: row, dm: { discordUserId: character.discordUserId, content: findDm(die, tag.name) } };
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
// A TROUBLE row lands unresolved and waits for a GM. Until this existed the
// caver did not wait with it — they walked out of the caves and a GM ended up
// adjudicating a monster in the dark for somebody standing in Town.
//
// The hold lasts until the TURN ENDS, not until the roll is resolved. A GM's
// Mark resolved says the encounter has been decided; what was decided — the
// staged effect, message or death wired to the roll — only reaches the caver
// at the push. Keying the hold on resolvedAt let the caver walk out of the
// caves in the hours between the two, so the bite landed on somebody standing
// in the Forest. The push is what closes the turn, so the hold can never
// outlive it either — nothing has to sweep it.
//
// Unlike heldReasonFor (db/lib/intercept.js) this is a QUERY rather than a
// pure comparison, because the answer lives in CavingRoll and nowhere on
// Character. It is scoped to the roll's own zone snapshot for two reasons: it
// is a hold on LEAVING one zone, not on walking, and a GM who relocates
// somebody out of the caves has then not also stranded them wherever they
// land.
//
// The STOP is the same query read at a higher number (CAVING.md §2e). Every
// arrival rolls and nothing caps the rolling, so a caver who kept walking
// could farm the loot table all turn with ten monsters queued behind them for
// a GM to invent. At CAVING_TROUBLE_CAP 1s in a zone on the open turn they
// go nowhere at all — not the next room, not the surface, not a Stepstone —
// until the push. Ten unadjudicated encounters is a dead character whatever
// they are carrying, and the walking is what the stop takes. Same scope as
// the hold, for the same reason: a GM's Teleport out is the adjudication, and
// must not strand them wherever they land.
const CAVING_TROUBLE_CAP = 10;

const CAVING_HOLD_REASON =
  "You rolled a 1, so you can't leave the zone until the turn ends and you receive the results of your caving die.";

const CAVING_STUCK_REASON = `You've rolled a 1 on the Caving Die ${CAVING_TROUBLE_CAP} times this turn. Whatever is down here has you now — you can't go anywhere until the turn ends.`;

// The whole rule is this WHERE: this character, this zone, a 1, on the turn
// that is still open. NOT resolvedAt — see the hold's note above.
function troubleWhere(characterId, zoneId) {
  return { characterId, zoneId, kind: "TROUBLE", turn: { status: "OPEN" } };
}

// One folded Caving result (CAVING.md §5): every 1 this caver rolled in this zone on this turn. The
// desk's Save and Mark resolved act on the group, never on one roll of it.
function troubleGroupWhere({ turnId, characterId, zoneId }) {
  return { turnId, characterId, zoneId, kind: "TROUBLE" };
}

// Both answers off one count. `hold` shuts the ways OUT of the zone; `stuck`
// shuts every way. A stuck caver is always also held — the cap is a count of
// the very rows the hold reads — so a caller that only asks about crossings
// can read `hold` and be right.
async function cavingRestrictionsFor(prisma, characterId, zoneId) {
  if (!characterId || !zoneId) return { hold: null, stuck: null };
  const troubles = await prisma.cavingRoll.count({ where: troubleWhere(characterId, zoneId) });
  return {
    hold: troubles > 0 ? CAVING_HOLD_REASON : null,
    stuck: troubles >= CAVING_TROUBLE_CAP ? CAVING_STUCK_REASON : null,
  };
}

async function cavingHoldFor(prisma, characterId, zoneId) {
  return (await cavingRestrictionsFor(prisma, characterId, zoneId)).hold;
}

// The party question, one query for everybody: which followers the Die has
// hold of (may not leave the zone) and which it has stopped (may not walk at
// all). Every stuck id is in `held` too.
async function cavingPartyRestrictions(prisma, characterIds, zoneId) {
  const held = new Set();
  const stuck = new Set();
  if (!zoneId || !characterIds?.length) return { held, stuck };
  const rows = await prisma.cavingRoll.findMany({
    where: { characterId: { in: characterIds }, zoneId, kind: "TROUBLE", turn: { status: "OPEN" } },
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

async function cavingHeldIds(prisma, characterIds, zoneId) {
  return (await cavingPartyRestrictions(prisma, characterIds, zoneId)).held;
}

// The push's release valve (docs/systemdocs/CAVING.md §2d).
//
// A TROUBLE roll nobody adjudicated is still open once the turn closes, and
// the Caving lens goes read-only on a past turn by design — so it would sit on
// the desk's "Needs attention" filter forever with nobody able to reach it.
// The hold itself no longer depends on this (it ends with the turn, above);
// this is the desk's bookkeeping.
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
  rollCavingOnArrival,
  cavingRestrictionsFor,
  cavingHoldFor,
  cavingPartyRestrictions,
  cavingHeldIds,
  releaseUnresolvedCavingRolls,
  troubleGroupWhere,
  CAVING_HOLD_REASON,
  CAVING_STUCK_REASON,
  CAVING_TROUBLE_CAP,
};
