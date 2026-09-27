// Rooms that open onto more than one Location — a window, a counter
// (Multi-locational rooms.docx, docs/systemdocs/MAP.md §2d). The one module
// that reads RoomSide.
//
// A room's HOME side is Room.locationId with its own kind/accessTagSlugs and
// thread columns; each RoomSide row is one further Location it opens onto,
// gated on its own. Almost nothing outside this file has to know that,
// because of one trick: roomAt(room, L) returns the room AS SEEN FROM L — the
// same object with that side's gate, thread and sort order swapped in, and
// `locationId` set to L. accessibleRooms(), the anchor index, the thread sync
// and every "is this room where I stand" test then answer for the side the
// character is on without being rewritten. The truth stays on the view as
// `homeLocationId`, and `sideId` is null at home.
//
// What crosses between sides is the room itself — its feed, its stash, who is
// in it. What never crosses is a Location: every verb on a PERSON stays
// Location-grain (db/lib/presence.js#isHere, db/lib/whosHere.js#presentRows),
// which is the doc's "cannot target characters on the other location".
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel; require
// it by path. Requires nothing of its own, so anything may require it.

const SIDE_SELECT = Object.freeze({
  id: true,
  locationId: true,
  kind: true,
  accessTagSlugs: true,
  sortOrder: true,
  discordThreadId: true,
  starterMessageId: true,
  postHash: true,
  location: { select: { id: true, name: true, discordChannelId: true, zoneId: true } },
});
const WITH_SIDES = Object.freeze({ sides: { select: SIDE_SELECT } });

// The room fields the overlay reads, merged into any caller's select.
const VIEW_SELECT = Object.freeze({ id: true, name: true, locationId: true, kind: true, accessTagSlugs: true, sortOrder: true });

// Every room that opens onto this Location, home or side.
function opensOntoWhere(locationId) {
  return { OR: [{ locationId }, { sides: { some: { locationId } } }] };
}

function opensOntoAnyWhere(locationIds) {
  const ids = [...new Set((locationIds ?? []).filter(Boolean))];
  return { OR: [{ locationId: { in: ids } }, { sides: { some: { locationId: { in: ids } } } }] };
}

function homeOf(room) {
  return room?.homeLocationId ?? room?.locationId ?? null;
}

// The side row for L, or the home pseudo-side, or null if the room does not
// open onto L. A room loaded without `sides` only answers for its home.
function sideOf(room, locationId) {
  if (!room || !locationId) return null;
  if (homeOf(room) === locationId) return { home: true, locationId };
  const side = (room.sides ?? []).find((s) => s.locationId === locationId);
  return side ? { home: false, ...side } : null;
}

// The room as seen from Location L, or null. A pure overlay: the id is still
// the room's, so placeKeys, stashes and archive rows never split.
function roomAt(room, locationId) {
  const side = sideOf(room, locationId);
  if (!side) return null;
  const homeLocationId = homeOf(room);
  if (side.home) {
    // Re-viewing a side view from home has to put the home fields back, and
    // those were overwritten; a fresh load is the only honest answer there.
    if (room.sideId) return null;
    return { ...room, atLocationId: locationId, homeLocationId, sideId: null };
  }
  return {
    ...room,
    locationId,
    ...(side.location ? { location: side.location } : {}),
    kind: side.kind ?? "PUBLIC",
    accessTagSlugs: side.accessTagSlugs ?? [],
    sortOrder: side.sortOrder ?? room.sortOrder ?? 0,
    discordThreadId: side.discordThreadId ?? null,
    starterMessageId: side.starterMessageId ?? null,
    postHash: side.postHash ?? null,
    atLocationId: locationId,
    homeLocationId,
    sideId: side.id,
  };
}

function bySortThenName(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name ?? "").localeCompare(String(b.name ?? ""));
}

// Views of every room in `rooms` that opens onto L, in L's own order.
function roomsAt(rooms, locationId) {
  return (rooms ?? [])
    .map((room) => roomAt(room, locationId))
    .filter(Boolean)
    .sort(bySortThenName);
}

// Home first, then each side.
function roomLocationIds(room) {
  const home = homeOf(room);
  return [home, ...(room?.sides ?? []).map((s) => s.locationId)].filter(Boolean);
}

// Every Location but L that this room opens onto.
function otherSides(room, locationId) {
  return roomLocationIds(room).filter((id) => id !== locationId);
}

// Every view of one room: home, then each side. For whatever acts per thread
// (the mirror, the wipes, the doctor, private membership).
function roomViews(room) {
  if (!room) return [];
  return roomLocationIds(room)
    .map((locationId) => roomAt(room, locationId))
    .filter(Boolean);
}

function withViewSelect(select) {
  if (!select) return undefined;
  return { ...VIEW_SELECT, ...select, ...WITH_SIDES };
}

// One findMany of the rooms that open onto L, overlaid for L and sorted in
// L's order. `where` narrows (retiredAt, kind, …); `select` is merged with
// what the overlay needs, or omitted for every scalar.
async function loadRoomsAt(prisma, locationId, { where = {}, select = null } = {}) {
  if (!locationId) return [];
  const rows = await prisma.room.findMany({
    where: { AND: [opensOntoWhere(locationId), where] },
    ...(select ? { select: withViewSelect(select) } : { include: WITH_SIDES }),
  });
  return roomsAt(rows, locationId);
}

// The room behind a Discord thread id, as seen from the side that thread
// belongs to. Home threads first — they are nearly all of them.
async function roomForThread(prisma, threadId, { select = null } = {}) {
  if (!threadId) return null;
  const shape = select ? { select: withViewSelect({ ...select, discordThreadId: true }) } : { include: WITH_SIDES };
  const home = await prisma.room.findFirst({ where: { discordThreadId: threadId }, ...shape });
  if (home) return roomAt(home, home.locationId);
  const side = await prisma.roomSide.findUnique({
    where: { discordThreadId: threadId },
    select: { locationId: true, room: shape },
  });
  return side?.room ? roomAt(side.room, side.locationId) : null;
}

// Write a view's thread columns back to whichever row owns them.
function persistThread(prisma, view, data) {
  if (view?.sideId) return prisma.roomSide.update({ where: { id: view.sideId }, data });
  return prisma.room.update({ where: { id: view.id }, data });
}

// The key Character.roomThreadRoomIds stores for membership of a view's
// thread. Home is the bare room id, which is what every row written before
// sides existed already holds.
function membershipKey(view) {
  return view?.sideId ? `${view.id}@${view.atLocationId}` : view?.id ?? null;
}

function parseMembershipKey(key) {
  const text = String(key ?? "");
  const at = text.indexOf("@");
  return at < 0 ? { roomId: text, locationId: null } : { roomId: text.slice(0, at), locationId: text.slice(at + 1) };
}

// The thread ids a character's recorded memberships point at.
async function threadIdsForMembershipKeys(prisma, keys) {
  const parsed = (keys ?? []).map(parseMembershipKey).filter((k) => k.roomId);
  if (parsed.length === 0) return [];
  const homeIds = parsed.filter((k) => !k.locationId).map((k) => k.roomId);
  const sideKeys = parsed.filter((k) => k.locationId);
  const [homes, sides] = await Promise.all([
    homeIds.length
      ? prisma.room.findMany({ where: { id: { in: homeIds }, discordThreadId: { not: null } }, select: { discordThreadId: true } })
      : [],
    sideKeys.length
      ? prisma.roomSide.findMany({
          where: { OR: sideKeys.map((k) => ({ roomId: k.roomId, locationId: k.locationId })), discordThreadId: { not: null } },
          select: { discordThreadId: true },
        })
      : [],
  ]);
  return [...homes, ...sides].map((r) => r.discordThreadId);
}

// The Character `where` for who is in the room on one side: alive and
// standing at that side's Location, and — for a private side — holding a way
// in. db/lib/roomAccess.js#accessibleRooms asked backwards: a held key, the
// worn ring's tokens, a guest pass given at THIS side, or a quest door.
// `view` is a roomAt() view; `questIds` the room's open quest's allowed ids.
function sidePresenceWhere(view, { questIds = [] } = {}) {
  const where = { status: "ALIVE", locationId: view.atLocationId ?? view.locationId };
  if (view.kind !== "PRIVATE") return where;
  const slugs = view.accessTagSlugs ?? [];
  const entitled = [{ roomGuestOf: { some: { roomId: view.id, locationId: where.locationId } } }];
  if (slugs.length > 0) {
    entitled.push({ tags: { some: { tag: { slug: { in: slugs } } } } });
    entitled.push({
      tags: {
        some: {
          equipped: true,
          tag: { ringOfCharacterId: { not: null }, ringRegisteredAt: { not: null }, ringAccessSlugs: { hasSome: slugs } },
        },
      },
    });
  }
  if (questIds.length > 0) entitled.push({ id: { in: questIds } });
  return { ...where, OR: entitled };
}

// Everybody in the room, on every side it opens onto. Null when the room is gone.
async function roomPresenceWhere(prisma, roomId) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { ...VIEW_SELECT, ...WITH_SIDES, quest: { select: { status: true, allowedCharacterIds: true } } },
  });
  if (!room) return null;
  const questIds = room.quest?.status === "OPEN" ? room.quest.allowedCharacterIds : [];
  const sides = roomViews(room).map((view) => sidePresenceWhere(view, { questIds }));
  return sides.length === 1 ? sides[0] : { OR: sides };
}

module.exports = {
  WITH_SIDES,
  opensOntoWhere,
  opensOntoAnyWhere,
  roomAt,
  roomsAt,
  roomViews,
  roomLocationIds,
  otherSides,
  loadRoomsAt,
  roomForThread,
  persistThread,
  membershipKey,
  parseMembershipKey,
  threadIdsForMembershipKeys,
  sidePresenceWhere,
  roomPresenceWhere,
};
