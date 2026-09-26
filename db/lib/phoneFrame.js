// What the telephone sounds like from where a character is standing
// (docs/systemdocs/PHONES.md §8), for the web feed's `phones` frame.
//
// A phone makes three sounds that are STATES, not moments: a bell that rings
// until somebody answers (in its own Location, and faintly one Location over),
// the long tone at a caller's ear until somebody picks up, and the busy tone of
// a line the far end hung up on. A state cannot ride an ArchiveEntry, which is
// a moment, so the browser is told the state instead and holds the loop itself
// (web/app/components/sfx.js#setPhoneTones). The shape is the Performance
// frame's (db/lib/performance.js): one NOTIFY on the feed channel whenever any
// phone changes, naming the Locations that could hear it, and every stream
// standing in one of them re-reads its own frame.
//
// The frame never names a phone, a room or a person — it is two words and,
// for the holder, their own handset. Takes `prisma`; require by path.

const { FEED_CHANNEL } = require("./feedNotify");
const { PHONE_OBOL_PROMPT_MS, PHONE_HOLD_IDLE_MS } = require("./phoneText");

const PHONE_OP = "phone";
const LIVE = ["RINGING", "CONNECTED"];

// The Locations one hop from each of `locationIds`, and themselves. One
// query: the graph is a few dozen edges.
async function withNeighbours(prisma, locationIds) {
  const ids = [...new Set(locationIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const links = await prisma.locationLink.findMany({
    where: { OR: [{ aId: { in: ids } }, { bId: { in: ids } }] },
    select: { aId: true, bId: true },
  });
  const out = new Set(ids);
  for (const { aId, bId } of links) {
    out.add(aId);
    out.add(bId);
  }
  return [...out];
}

/**
 * Tell every stream that could hear these phones to look again. `roomIds` are
 * the phones that changed; best-effort, like every notify — a missed one costs
 * a browser its loop until the next change.
 */
async function notifyPhones(prisma, roomIds) {
  const ids = [...new Set((roomIds ?? []).filter(Boolean))];
  if (ids.length === 0) return false;
  try {
    const rooms = await prisma.room.findMany({ where: { id: { in: ids } }, select: { locationId: true } });
    const locationIds = await withNeighbours(prisma, rooms.map((r) => r.locationId));
    if (locationIds.length === 0) return false;
    const payload = JSON.stringify({ op: PHONE_OP, locationIds });
    await prisma.$executeRaw`SELECT pg_notify(${FEED_CHANNEL}, ${payload})`;
    return true;
  } catch (err) {
    console.error("Phone notify failed:", err.message ?? err);
    return false;
  }
}

/**
 * What a handset in this room is doing, from the live call on it (or null)
 * and the room's own columns. Pure. "ringing" is the phone ringing on the
 * wall; "calling" is this phone ringing somebody else's.
 */
function handsetState(room, call) {
  if (call?.status === "CONNECTED") return "connected";
  if (call?.status === "RINGING") return call.fromRoomId === room.id ? "calling" : "ringing";
  if (room?.phoneDeadSince) return "dead";
  return "idle";
}

/**
 * The timers a holder sees, from the room's columns. Pure, so the sweep and
 * the dialog agree to the second. `now` is injectable for a test.
 *
 *   paidUntil     a payphone's paid time runs out (null: nothing paid)
 *   needsCoin     a payphone that will not dial or keep a call without a coin
 *                 now: no paid time, or in its last PHONE_OBOL_PROMPT_MS
 *   idleEjectAt   when a holder with no call connected is dropped
 */
function handsetTimers(room, state, now = Date.now()) {
  const paidUntil = room?.payphone && room.phonePaidUntil ? new Date(room.phonePaidUntil).getTime() : null;
  const paidLeft = paidUntil == null ? 0 : paidUntil - now;
  const needsCoin = Boolean(room?.payphone) && paidLeft <= PHONE_OBOL_PROMPT_MS;
  const idleSince = room?.phoneIdleSince ? new Date(room.phoneIdleSince).getTime() : null;
  const idleEjectAt = state !== "connected" && idleSince != null ? idleSince + PHONE_HOLD_IDLE_MS : null;
  return { paidUntil, needsCoin, idleEjectAt };
}

// One room's handset, as the holder's browser sees it. Never the far end.
function handsetFrame(room, call, now = Date.now()) {
  const state = handsetState(room, call);
  const { paidUntil, needsCoin, idleEjectAt } = handsetTimers(room, state, now);
  return {
    roomId: room.id,
    // The phone's own name and number: its holder is standing at it.
    name: room.phone ?? null,
    number: room.phoneNumber ?? null,
    payphone: Boolean(room.payphone),
    state,
    paidUntil: paidUntil == null ? null : new Date(paidUntil).toISOString(),
    needsCoin,
    idleEjectAt: idleEjectAt == null ? null : new Date(idleEjectAt).toISOString(),
  };
}

/**
 * This character's `phones` frame, standing in `locationId`:
 *
 *   ring     "near" when a phone rings in this Location, "far" when one rings
 *            one Location over, else null
 *   handset  the phone in their hand (handsetFrame), else null
 */
async function phoneFrameFor(prisma, { characterId = null, locationId = null } = {}) {
  if (!locationId) return { ring: null, handset: null };
  const ringing = await prisma.phoneCall.findMany({
    where: { status: "RINGING" },
    select: { toRoom: { select: { locationId: true } } },
  });
  let ring = null;
  const at = new Set(ringing.map((c) => c.toRoom?.locationId).filter(Boolean));
  if (at.has(locationId)) ring = "near";
  else if (at.size > 0) {
    const near = await withNeighbours(prisma, [locationId]);
    if (near.some((id) => at.has(id))) ring = "far";
  }

  let handset = null;
  if (characterId) {
    const room = await prisma.room.findFirst({
      where: { phoneHolderId: characterId },
      select: {
        id: true,
        phone: true,
        payphone: true,
        phoneNumber: true,
        phonePaidUntil: true,
        phoneIdleSince: true,
        phoneDeadSince: true,
      },
    });
    if (room) {
      const call = await prisma.phoneCall.findFirst({
        where: { status: { in: LIVE }, OR: [{ fromRoomId: room.id }, { toRoomId: room.id }] },
        orderBy: { startedAt: "desc" },
        select: { status: true, fromRoomId: true },
      });
      handset = handsetFrame(room, call);
    }
  }
  return { ring, handset };
}

module.exports = {
  PHONE_OP,
  notifyPhones,
  handsetState,
  handsetTimers,
  handsetFrame,
  phoneFrameFor,
  withNeighbours,
};
