// Private-room membership: members are exactly the characters ENTITLED — a
// Room.accessTagSlugs tag, or a RoomGuest row. Recomputed from tags, never
// pushed from inside a tag writer. MEMBERSHIP DOES NOT FOLLOW THE FEET —
// Discord already gates a thread on VIEW_CHANNEL of its parent Location
// channel (CLAUDE.md "Discord permission model"). GUESTS ARE still
// presence-based deliberately: /add writes a RoomGuest row, swept here. Takes
// `prisma` as a parameter and stays off the @lifeweb/db barrel; require it by path.
const { addThreadMember, removeThreadMember } = require("./discordRest");
const { notifyPresence } = require("./presenceNotify");
const { accessSlugsOf, RING_ACCESS_TAG_FIELDS } = require("./rings");
const { WITH_SIDES, membershipKey, roomViews } = require("./roomSides");
const { THANATI_SLUG } = require("./thanati");

// Some pushes can never succeed, and the diff below cannot tell: it only
// records a membership Discord ACCEPTED, so a refusal is retried on the next
// run — which is every equip, every meal, every move. That is the right
// answer for a 429 or a blip and the wrong one for "Missing Access", which
// is permanent until something outside this module changes. Discord gates a
// thread on VIEW_CHANNEL of its parent Location channel, and a character
// holding a key to a room in a Location they are not standing in has no
// overwrite there, so the add is refused every single time.
//
// On 2026-09-17 two characters in that position burned three doomed calls
// apiece on every request that reached here. Each 403 counts toward the
// breaker in discordRest/core.js, which starved ordinary guild-member
// lookups into 429s, which held GM page renders open long enough for Next to
// close the stream under them — an outage two systems away from its cause.
//
// So a refusal is remembered and skipped for a while. Per process and
// deliberately short: nothing here is authoritative, and the next window
// retries in case the character has since moved.
const REFUSAL_TTL_MS = 10 * 60_000;
const refusedUntil = new Map();

function refusalKey(characterId, roomId) {
  return `${characterId}:${roomId}`;
}

function isRefused(characterId, roomId) {
  const until = refusedUntil.get(refusalKey(characterId, roomId));
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  refusedUntil.delete(refusalKey(characterId, roomId));
  return false;
}

// Only a permanent refusal. A 429 or a 5xx is exactly what the retry is for.
function noteFailure(characterId, roomId, err) {
  const permanent = err?.status === 403 || err?.discordCode === 50001;
  if (permanent) refusedUntil.set(refusalKey(characterId, roomId), Date.now() + REFUSAL_TTL_MS);
  return permanent;
}

function clearRefusal(characterId, roomId) {
  refusedUntil.delete(refusalKey(characterId, roomId));
}

// Rooms this character may enter. `guestRoomIds` defaults empty for a keys-only caller, but
// anything deciding what a PERSON can reach must pass it. `allowedRoomIds` is Quests' door (docs/systemdocs/QUESTS.md) and the Thanati hideout's (allowedRoomIds below).
function accessibleRooms(rooms, heldSlugs, guestRoomIds = new Set(), allowedRoomIds = new Set()) {
  return rooms.filter(
    (room) =>
      room.kind !== "PRIVATE" ||
      guestRoomIds.has(room.id) ||
      allowedRoomIds.has(room.id) ||
      room.accessTagSlugs.some((slug) => heldSlugs.has(slug)),
  );
}

async function questAllowedRoomIds(prisma, characterId) {
  const rows = await prisma.quest
    .findMany({
      where: { status: "OPEN", allowedCharacterIds: { has: characterId } },
      select: { room: { select: { id: true } } },
    })
    .catch(() => []);
  return new Set(rows.map((q) => q.room?.id).filter(Boolean));
}

// The cult's hideout (db/lib/thanati.js#hideoutRoom) lets in whoever holds the
// faith, by name like a quest's allowlist. A cultist seated at the start and one
// converted mid-game hold the same `thanati` tag and nothing else in common, so a
// key the room happens to be locked with must not decide which of them gets in.
async function hideoutRoomId(prisma) {
  const state = await prisma.gameState
    .findUnique({ where: { id: 1 }, select: { thanatiHideoutRoomId: true } })
    .catch(() => null);
  return state?.thanatiHideoutRoomId ?? null;
}

// Every room that admits this character by name rather than by key: the open
// quests that list them, and the hideout if they are Thanati. `heldSlugs` is
// what the caller already loaded (held tags plus ring tokens).
async function allowedRoomIds(prisma, characterId, heldSlugs) {
  const [quests, hideoutId] = await Promise.all([
    questAllowedRoomIds(prisma, characterId),
    heldSlugs?.has(THANATI_SLUG) ? hideoutRoomId(prisma) : null,
  ]);
  if (hideoutId) quests.add(hideoutId);
  return quests;
}

// Every door token the character has: what they hold, plus what the signet
// ring on their finger opens (db/lib/rings.js#accessSlugsOf). The ring's
// tokens are the retired seat keys' slugs, which every `access:` list still
// names, so no door needs to know a ring exists.
async function heldTagSlugs(prisma, characterId) {
  const tags = await prisma.characterTag.findMany({
    where: { characterId },
    select: { equipped: true, tag: { select: RING_ACCESS_TAG_FIELDS } },
  });
  return accessSlugsOf(tags);
}

// Just the worn ring's door tokens, for a caller that already has the held
// slugs in hand from a select of its own (travel, the keyed-way prompt). One
// indexed lookup; an empty array when there is no registered ring on a finger.
async function wornRingTokens(prisma, characterId) {
  if (!characterId) return [];
  const row = await prisma.characterTag.findFirst({
    where: { characterId, equipped: true, tag: { ringOfCharacterId: { not: null }, ringRegisteredAt: { not: null } } },
    select: { tag: { select: { ringAccessSlugs: true } } },
  });
  return row?.tag?.ringAccessSlugs ?? [];
}

// Held slugs from an already-loaded tag list, plus the worn ring's tokens.
async function withRingTokens(prisma, characterId, tags) {
  const slugs = new Set((tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
  for (const token of await wornRingTokens(prisma, characterId)) slugs.add(token);
  return slugs;
}

// The rooms a guest pass lets this character into from where they stand. A
// pass is good on the side it was given (RoomGuest.locationId): a room that
// opens onto two Locations can be strict on one side and easy on the other,
// and a nod over the easy counter is no key to the strict one. The sweep in
// syncCharacterRoomAccess spends a pass on leaving; this filter holds the
// line for the moment in between.
async function guestRoomIds(prisma, characterId) {
  const rows = await prisma.roomGuest.findMany({
    where: { characterId },
    select: { roomId: true, locationId: true, character: { select: { locationId: true } } },
  });
  return new Set(rows.filter((r) => r.locationId === r.character?.locationId).map((r) => r.roomId));
}

// Every private thread there is, one unit per side: the home thread and each
// private side's own. A pure step so the per-side split is testable.
function privateThreadUnits(rooms) {
  return (rooms ?? [])
    .flatMap(roomViews)
    .filter((view) => view.kind === "PRIVATE" && view.discordThreadId)
    .map((view) => ({ key: membershipKey(view), threadId: view.discordThreadId, name: view.name, view }));
}

async function roomAccessKeys(prisma, characterId) {
  const [heldSlugs, guests] = await Promise.all([
    heldTagSlugs(prisma, characterId),
    guestRoomIds(prisma, characterId),
  ]);
  const allowed = await allowedRoomIds(prisma, characterId, heldSlugs);
  return { heldSlugs, guestRoomIds: guests, allowedRoomIds: allowed };
}

// Returns { added, removed }. THERE IS NO CHEAP MODE, deliberately — a `guestsOnly` fast
// path narrowed the scope so a move could never repair drift the diff would otherwise catch.
async function syncCharacterRoomAccess(prisma, character, { tagSlugs = null } = {}) {
  const result = { added: 0, removed: 0 };
  if (!character?.id) return result;

  // A private thread is the home one or a private side's (db/lib/roomSides.js).
  const rooms = await prisma.room.findMany({
    where: {
      OR: [
        { kind: "PRIVATE", discordThreadId: { not: null } },
        { sides: { some: { kind: "PRIVATE", discordThreadId: { not: null } } } },
      ],
    },
    select: { id: true, name: true, locationId: true, kind: true, accessTagSlugs: true, sortOrder: true, discordThreadId: true, ...WITH_SIDES },
  });
  const units = privateThreadUnits(rooms);

  // Spend stale guest grants before the recompute below and before the
  // DISCORD_TOKEN bail-out. The mover has its own token guard, so a tokenless
  // move never reaches this line; the doctor's room-guest check is the backstop.
  const alive = character.status === "ALIVE";
  const staleGuestWhere = {
    characterId: character.id,
    ...(alive && character.locationId ? { locationId: { not: character.locationId } } : {}),
  };
  await prisma.roomGuest
    .deleteMany({ where: staleGuestWhere })
    .catch((err) => console.error(`Room guest sweep failed for ${character.id}:`, err.message ?? err));

  if (units.length === 0) return result;
  if (!process.env.DISCORD_TOKEN) return result;
  // A character with no account cannot be a thread member; the guest sweep above still ran for them.
  if (!character.discordUserId) return result;

  // Entitlement, deliberately NOT filtered by location: holding the key is the whole test,
  // and a key-holder is in every private side's thread at once — Discord shows each only
  // under a Location channel they can see. A guest pass is the exception: it opens the one
  // side it was given at (RoomGuest.locationId), and the sweep above has spent the rest.
  const held = alive ? tagSlugs ?? (await heldTagSlugs(prisma, character.id)) : new Set();
  const guests = alive ? await guestRoomIds(prisma, character.id) : new Set();
  const allowed = alive ? await allowedRoomIds(prisma, character.id, held) : new Set();
  const entitled = new Set(
    alive
      ? units
          .filter((unit) => {
            const guestHere = unit.view.atLocationId === character.locationId ? guests : new Set();
            return accessibleRooms([unit.view], held, guestHere, allowed).length === 1;
          })
          .map((unit) => unit.key)
      : [],
  );

  // What Discord has been told, so we act on the DIFFERENCE: entitlement is recomputed
  // constantly (every equip, every meal) and almost never changes, so this makes no calls at all.
  const record = await prisma.character
    .findUnique({ where: { id: character.id }, select: { roomThreadRoomIds: true, discordMirrored: true } })
    .catch(() => null);
  const stored = new Set(record?.roomThreadRoomIds ?? []);

  // not mirrored to Discord (docs/systemdocs/CHAT.md §6): cleared rather than never computed, so the diff below REMOVES whatever they still stand in.
  if (!record?.discordMirrored) entitled.clear();

  const targets = units
    .filter((unit) => entitled.has(unit.key) !== stored.has(unit.key))
    .filter((unit) => !isRefused(character.id, unit.key));
  if (targets.length === 0) return result;

  // Wake their tabs before the Discord calls, the slow part (docs CHAT.md §3).
  await notifyPresence(prisma, character.id);

  const next = new Set(stored);
  for (const unit of targets) {
    try {
      if (entitled.has(unit.key)) {
        await addThreadMember(unit.threadId, character.discordUserId);
        next.add(unit.key);
        result.added += 1;
      } else {
        await removeThreadMember(unit.threadId, character.discordUserId);
        next.delete(unit.key);
        result.removed += 1;
      }
      clearRefusal(character.id, unit.key);
    } catch (err) {
      // Left OUT of `next` on failure, so the next run retries rather than recording a membership Discord never accepted.
      const permanent = noteFailure(character.id, unit.key, err);
      console.error(
        `Room access sync failed for ${character.id} in "${unit.name}"` +
          `${permanent ? `, not retrying for ${REFUSAL_TTL_MS / 60_000}m` : ""}:`,
        err.message ?? err,
      );
    }
  }

  await prisma.character
    .update({ where: { id: character.id }, data: { roomThreadRoomIds: [...next] } })
    .catch((err) => console.error(`Room membership record failed for ${character.id}:`, err.message ?? err));
  return result;
}

// Record/unrecord one room thread (a membershipKey — the bare room id at home) for code paths that push membership WITHOUT the
// recompute above: /add, /remove, the doctor's repair. They must call this or
// the column lies — an ACCESS CONTROL FAILURE in the quiet direction, since
// the diff only acts where `entitled` and `stored` DISAGREE, so a membership
// Discord has but the column does not is a membership that can never be removed.
async function recordRoomThread(prisma, characterId, roomId, present) {
  if (!characterId || !roomId) return;
  const row = await prisma.character
    .findUnique({ where: { id: characterId }, select: { roomThreadRoomIds: true } })
    .catch(() => null);
  if (!row) return;
  const current = row.roomThreadRoomIds ?? [];
  if (current.includes(roomId) === Boolean(present)) return; // already right
  const next = present ? [...current, roomId] : current.filter((id) => id !== roomId);
  await prisma.character
    .update({ where: { id: characterId }, data: { roomThreadRoomIds: next } })
    .catch((err) => console.error(`Room membership record failed for ${characterId}:`, err.message ?? err));
}

module.exports = {
  recordRoomThread,
  syncCharacterRoomAccess,
  privateThreadUnits,
  accessibleRooms,
  heldTagSlugs,
  wornRingTokens,
  withRingTokens,
  guestRoomIds,
  questAllowedRoomIds,
  allowedRoomIds,
  roomAccessKeys,
};
