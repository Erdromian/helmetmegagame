// Searching a ROOM (docs/systemdocs/SEARCH.md §9) — going through the place
// rather than a person. A stash keeps a second count per stack,
// RoomTag.hiddenQuantity, for what is under the floor; this rolls a d6 nobody
// is shown and moves some of those stacks into plain sight, where Take and
// Steal reach them like anything else. Finding a thing is not pocketing it.
//
// Costs a QUARTER of the Move, on the same ledger crafting and burial share
// (db/lib/moveLedger.js, CRAFTING.md §2a): four searches fill a Routine, and a
// Gambit already filed refuses it. No turn pass touches it. Behind that is
// one ration, once per character per room per turn, and the RoomSearchAttempt
// insert IS that ration (the SearchAttempt discipline): spent by the press,
// whether or not anything was found.
//
// Takes `prisma` first, NOT on the @lifeweb/db barrel — require by path.
const { blockerFor, ACT } = require("./incapacitation");
const { rollWithAdvantage } = require("./advantage");
const { revealCount, pickRevealed } = require("./search");
const { accessibleRooms, roomAccessKeys } = require("./roomAccess");
const { RESOURCES_SLUG } = require("./resourceStack");
const { autoMovesOpen } = require("./turnGate");
const { checkLedgerMove, spendLedgerMove } = require("./moveLedger");
const { SEARCH_MOVE } = require("./roomSearchCost");

const ROOM_SEARCH_AUDIT_ACTION = "room_search";

// What a search costs of the turn's Move lives in db/lib/roomSearchCost.js
// (zero requires, so the /chat panel can print the price before the press).
// The marker appended to gmNotes is what the desk and the sheet read the
// ledger back by.
const SEARCH_LEDGER_NOTES = "auto:craft auto:search";

function searchLedgerEntry(room) {
  return { tagId: null, name: room.name, family: "search", qty: 1, num: SEARCH_MOVE.num, den: SEARCH_MOVE.den };
}

// Bascinet's words, verbatim.
const RUMMAGE_LINE = "rummages through the room.";

// What sharpens or fogs the eyes. The list is CLOSED and deliberately narrower
// than gambitModifiers(), the steal.js reasoning: this costs no Move and has no
// cooldown, so Hunger and the mood bands folding in would make a hungry
// character unable to find their own boots, with nothing they could do about it.
const EYES = [
  ["eagle-eyes", "Eagle Eyes", 2],
  ["hallucinating", "Hallucinating", -2],
];

// Only where there is no daylight to see by — a CAVE_LEVEL zone, the same test
// db/lib/locationAttributes.js#parksMounts makes for "underground".
const CAVE_EYES = ["night-vision", "Night Vision", 1];

// How drunk you are, worst rung first. THE WORST ONE COUNTS AND THEY NEVER SUM,
// exactly as steal.js has it and for the same reason: Tipsy escalates into
// Wasted, and summing them would be a silent −3.
const DRINK = [
  ["wasted", "Wasted", -2],
  ["tipsy", "Tipsy", -1],
];

// Every slug that moves this die, for anything that wants to ask.
const ROOM_SEARCH_MODIFIERS = [...EYES, CAVE_EYES, ...DRINK];

// You can't search what you can't see. A refusal rather than a modifier: −6
// would read as a die that always fails, which is the same thing said less
// honestly.
const BLIND_SLUG = "blind";

// Accepts the CharacterTag[] shape used everywhere else (`{ tag: { slug } }`),
// and tolerates a bare Tag[] — the same tolerance advantage.js has.
function slugsOf(characterTags = []) {
  const out = new Set();
  for (const ct of characterTags ?? []) {
    const slug = ct?.tag?.slug ?? ct?.slug;
    if (slug) out.add(slug);
  }
  return out;
}

// -> [{ label, value }], only the rows that apply. `underground` is whether
// the room's zone is a CAVE_LEVEL.
function roomSearchModifiers(characterTags = [], { underground = false } = {}) {
  const held = slugsOf(characterTags);
  const eyes = EYES.filter(([slug]) => held.has(slug)).map(([, label, value]) => ({ label, value }));
  if (underground && held.has(CAVE_EYES[0])) eyes.push({ label: CAVE_EYES[1], value: CAVE_EYES[2] });
  const drink = DRINK.find(([slug]) => held.has(slug));
  return drink ? [...eyes, { label: drink[1], value: drink[2] }] : eyes;
}

function roomSearchModifierTotal(modifiers = []) {
  return modifiers.reduce((sum, m) => sum + (m.value ?? 0), 0);
}

// The modified die, clamped to the face of a d6. revealCount is written for a
// die and reads `die / 6`; a 7 would find more than everything, and a 0 would
// still find nothing, which it does anyway.
function roomSearchTotal(die, modifiers = []) {
  return Math.max(1, Math.min(6, die + roomSearchModifierTotal(modifiers)));
}

// The rows a search may turn up: every stack with anything under the floor.
function hiddenStacks(roomTags = []) {
  return (roomTags ?? []).filter((rt) => (rt?.hiddenQuantity ?? 0) > 0);
}

// The whole outcome, pure: which hidden stacks come up for this total. The
// rule is the person search's (search.js#revealCount) — a STACK is one row,
// and a found stack comes out whole, so one hidden thing needs a modified 6
// and four hidden things give one up on a 2. `rng` is injected for the test.
function roomSearchOutcome({ die, modifiers = [], hidden = [], rng = Math.random }) {
  const total = roomSearchTotal(die, modifiers);
  const count = revealCount(total, hidden.length);
  return { total, found: pickRevealed(hidden, count, rng) };
}

function formatStack(row) {
  const name = row.tag?.name ?? row.name ?? row.tag?.slug ?? row.slug;
  const n = row.hiddenQuantity ?? row.quantity ?? 1;
  if ((row.tag?.slug ?? row.slug) === RESOURCES_SLUG) return `${n} ⬢`;
  return n > 1 ? `${name} ×${n}` : name;
}

// The searcher's line, and nobody else's. The die is not in it (SEARCH.md §3b).
function roomSearchReadout({ roomName, found = [] }) {
  if (found.length === 0) return `You search the ${roomName} and find nothing.`;
  return `You search the ${roomName}. You find: ${found.map(formatStack).join(", ")}.`;
}

// Everything that can refuse, in one place, so the two faces cannot disagree.
// `character` needs { id, status, locationId, tags: [{ tag: { slug, name } }] };
// `room` needs { id, kind, locationId, accessTagSlugs, destroysContents }.
// Returns a sentence, or null when the search may go ahead.
function roomSearchRefusal(character, room, { admitted = true, turn = null } = {}) {
  if (!character || character.status !== "ALIVE") return "You can't do that right now.";
  if (!room) return "That room is gone.";
  if (!character.locationId || character.locationId !== room.locationId) return "You're not here.";
  if (!admitted) return "You can't get in there.";
  if (!turn?.id) return "No turn is open.";
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) return `You're ${blocker.name}.`;
  if (slugsOf(character.tags).has(BLIND_SLUG)) return "You can't see.";
  return null;
}

// ─── The impure half ───────────────────────────────────────────────────────

const ROOM_SELECT = {
  id: true,
  name: true,
  kind: true,
  locationId: true,
  accessTagSlugs: true,
  discordThreadId: true,
  location: { select: { id: true, zone: { select: { kind: true } } } },
  tags: {
    where: { hiddenQuantity: { gt: 0 } },
    select: { id: true, tagId: true, hiddenQuantity: true, tag: { select: { id: true, name: true, slug: true } } },
  },
};

// One search. `character` is the acting row with its tags loaded
// (`{ tag: { slug, name } }` at least), `zoneId` for the Action row and
// `discordUserId` for the audit row.
// Returns { ok: true, room, found, readout, line } or { ok: false, reason }.
//
// Order matters and is the same as Steal's: everything that can refuse runs
// FIRST — the ladder, the turn gate, a cheap look at the Move — then, inside
// ONE transaction under the Character row lock: the quarter Move is spent,
// the ration is claimed, the die is thrown and the reveal is written. A
// refusal anywhere in that transaction rolls the lot back, so a spent Move
// never costs a ration and a claimed ration is never left beside an unspent
// Move. A bad roll rolls nothing back — an empty room and an unlucky one
// look the same from outside.
//
// The room's Discord line is NOT posted here — it is REST, and this runs the
// reveal inside a transaction. The caller posts `line` through
// db/lib/roomAnnounce.js#announceInRoom afterwards.
async function searchRoom(prisma, { character, roomId, turn, rng = Math.random }) {
  const room = await prisma.room.findUnique({ where: { id: roomId ?? "" }, select: ROOM_SELECT });
  let admitted = true;
  if (room && character?.id) {
    const keys = await roomAccessKeys(prisma, character.id);
    admitted = accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length > 0;
  }
  const refusal = roomSearchRefusal(character, room, { admitted, turn });
  if (refusal) return { ok: false, reason: refusal };
  // One gate, one sentence (db/lib/turnGate.js): the `auto` half, since this
  // settles itself with no GM — the Move lock does not stop it, but the game
  // being out of session does. Here rather than on each face, so Discord and
  // /chat refuse alike.
  const gate = await autoMovesOpen(prisma, { turn });
  if (!gate.ok) return { ok: false, reason: gate.message };
  // The fast fail on the Move, outside the lock; spendLedgerMove re-asks under it.
  const filed = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: turn.id },
    select: { id: true, gmNotes: true, craftBudget: true },
  });
  const cheap = checkLedgerMove(filed, SEARCH_MOVE);
  if (!cheap.ok) return { ok: false, reason: cheap.reason };

  const underground = room.location?.zone?.kind === "CAVE_LEVEL";
  const hidden = hiddenStacks(room.tags);

  let outcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const spent = await spendLedgerMove(tx, {
        character,
        turn,
        need: SEARCH_MOVE,
        entry: searchLedgerEntry(room),
        notes: SEARCH_LEDGER_NOTES,
      });
      if (!spent.ok) throw new Refused(spent.reason);

      // The ration. P2002 is the refusal, not a crash — two fast presses cannot both pass.
      try {
        await tx.roomSearchAttempt.create({ data: { searcherId: character.id, roomId: room.id, turnId: turn.id } });
      } catch (err) {
        if (err?.code === "P2002") throw new Refused(`You've already searched the ${room.name} this turn.`);
        throw err;
      }

      const roll = rollWithAdvantage(character.tags, 6);
      const modifiers = roomSearchModifiers(character.tags, { underground });
      const { total, found } = roomSearchOutcome({ die: roll.die, modifiers, hidden, rng });

      // The reveal: hidden → visible, whole stacks. Guarded on the count so a
      // concurrent GM edit that already emptied the floor cannot drive it
      // negative; a row that lost the race is simply not reported as found.
      const surfaced = [];
      for (const row of found) {
        const { count } = await tx.roomTag.updateMany({
          where: { id: row.id, hiddenQuantity: { gte: row.hiddenQuantity } },
          data: { quantity: { increment: row.hiddenQuantity }, hiddenQuantity: { decrement: row.hiddenQuantity } },
        });
        if (count) surfaced.push(row);
      }
      // The only place the die is written down (SEARCH.md §3b).
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: character.discordUserId ?? "",
          actionType: ROOM_SEARCH_AUDIT_ACTION,
          targetCharacterId: character.id,
          turnId: turn.id,
          locationId: room.locationId,
          roomId: room.id,
          details: {
            roomId: room.id,
            roomName: room.name,
            die: roll.die,
            rolls: roll.rolls,
            advantage: roll.advantage,
            modifiers,
            total,
            hiddenStacks: hidden.length,
            revealedTagIds: surfaced.map((r) => r.tagId),
            move: { num: SEARCH_MOVE.num, den: SEARCH_MOVE.den },
          },
        },
      });
      return { surfaced };
    });
  } catch (err) {
    if (err instanceof Refused) return { ok: false, reason: err.message };
    throw err;
  }

  return {
    ok: true,
    room: { id: room.id, name: room.name, discordThreadId: room.discordThreadId },
    found: outcome.surfaced,
    readout: roomSearchReadout({ roomName: room.name, found: outcome.surfaced }),
    line: RUMMAGE_LINE,
  };
}

// A refusal raised inside the transaction, so the rollback and the sentence
// travel together. Never leaves this file.
class Refused extends Error {}

module.exports = {
  ROOM_SEARCH_AUDIT_ACTION,
  SEARCH_MOVE,
  SEARCH_LEDGER_NOTES,
  ROOM_SEARCH_MODIFIERS,
  RUMMAGE_LINE,
  BLIND_SLUG,
  roomSearchModifiers,
  roomSearchModifierTotal,
  roomSearchTotal,
  hiddenStacks,
  roomSearchOutcome,
  roomSearchReadout,
  roomSearchRefusal,
  searchRoom,
};
