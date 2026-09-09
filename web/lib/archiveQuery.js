// What the transcript is asking for, in one place.
//
// Two surfaces read the same rows — the page's first screen and the endpoint
// that feeds the scroll — and they MUST agree about the filter and the order,
// or scrolling past the first screen would quietly change what you are reading.
// So the `where` and the ordering live here and neither builds its own.
//
// No prisma import: this is a plain object builder, so the client can use
// `archiveParamsToQuery` for its URL without dragging PrismaClient into the
// bundle (ARCHITECTURE.md §2).

// One screen. The old page-size was 150 because a page was all you got; a
// scroll wants a smaller first paint and more of them.
export const ARCHIVE_PAGE_SIZE = 60;

// Every filter the transcript understands, normalised out of a URL. Written
// once so the page, the endpoint and the client's own link-building read the
// same names — a filter that exists on one and not another is the bug this
// shape exists to make impossible.
export function parseArchiveParams(params = {}) {
  const get = (key) => params?.[key]?.toString().trim() || "";
  const day = get("day");
  const dayNumber = day ? Number.parseInt(day, 10) : null;
  return {
    game: get("game"),
    zone: get("zone"),
    character: get("character"),
    day,
    // A day is two turns, Dawn first: day 3 is turns 5 and 6.
    dayTurns: dayNumber && dayNumber > 0 ? [dayNumber * 2 - 1, dayNumber * 2] : null,
    q: get("q"),
    // Speech only by default is what makes a day readable.
    show: params?.show?.toString() === "all" ? "all" : "speech",
    // Oldest-first by default: a diary is read forward, not skimmed
    // newest-first like /gm/audit.
    order: params?.order?.toString() === "desc" ? "desc" : "asc",
  };
}

// The filters that actually narrow the rows — what the chips under the bar
// show, and what "3 filters on" counts. `order` and `show` are how you are
// reading rather than what you are reading, so neither is in here.
export function activeArchiveFilters(f) {
  const on = [];
  if (f.q) on.push({ key: "q", label: `“${f.q}”` });
  if (f.day) on.push({ key: "day", label: `Day ${f.day}` });
  if (f.zone) on.push({ key: "zone", label: f.zone });
  if (f.character) on.push({ key: "character", label: "one speaker" });
  return on;
}

export function archiveWhere(gameId, f) {
  return {
    gameId,
    // Delete is soft since phase 1 of Chat so a browser holding a row can
    // reconcile. The transcript honours the retraction: a taken-back message
    // is not in it.
    deletedAt: null,
    // Since Chat phase 4 the world writes MESSAGE rows of its own
    // (db/lib/scene.js — smells, bells, gate crossings) as `source: SYSTEM`.
    // Speech leaves them out; Everything folds them back in. TURN_START stays
    // either way — it is the day divider, never a row.
    ...(f.show === "speech"
      ? { OR: [{ kind: "TURN_START" }, { kind: "MESSAGE", source: { not: "SYSTEM" } }] }
      : {}),
    ...(f.zone ? { zoneName: f.zone } : {}),
    ...(f.character ? { characterId: f.character } : {}),
    ...(f.dayTurns ? { turnNumber: { in: f.dayTurns } } : {}),
    ...(f.q ? { content: { contains: f.q, mode: "insensitive" } } : {}),
  };
}

// `sentAt` then `id`, and NOT `seq`.
//
// seq is unique, indexed and monotonic, which makes it the obvious cursor —
// and it is the wrong one here. It is assigned at INSERT, so a message
// recovered after the bot was down (bot/src/lib/messageCatchUp.js) carries its
// REAL sentAt from hours earlier and a brand-new seq. Ordering by seq would
// file it at the bottom of the day it was recovered in rather than the moment
// it was said, which is precisely the lie a transcript must not tell.
//
// id breaks the tie because sentAt is millisecond-resolution and a burst of
// proxied messages shares a timestamp. Backed by @@index([gameId, sentAt, id]).
export function archiveOrderBy(order) {
  return [{ sentAt: order }, { id: order }];
}

// Keyset, not offset. `skip` over a long transcript re-counts the rows it
// skipped on every request and drifts if anything lands mid-scroll; a tuple
// comparison walks the same index straight to the row after the last one shown.
export function archiveCursorWhere(cursor, order) {
  if (!cursor) return {};
  const at = cursor.lastIndexOf("|");
  if (at <= 0) return {};
  const sentAt = new Date(cursor.slice(0, at));
  const id = cursor.slice(at + 1);
  if (Number.isNaN(sentAt.getTime()) || !id) return {};
  const after = order === "desc" ? "lt" : "gt";
  return { OR: [{ sentAt: { [after]: sentAt } }, { sentAt, id: { [after]: id } }] };
}

export function archiveCursorOf(row) {
  if (!row?.sentAt) return null;
  const iso = typeof row.sentAt === "string" ? row.sentAt : new Date(row.sentAt).toISOString();
  return `${iso}|${row.id}`;
}

// The filters as a query string, for a link the browser writes. Empty values
// are dropped so a shared URL carries only what is actually on.
export function archiveParamsToQuery(f, overrides = {}) {
  const merged = { game: f.game, zone: f.zone, character: f.character, day: f.day, q: f.q, show: f.show, order: f.order, ...overrides };
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value == null || value === "") continue;
    // The two defaults never need saying, and leaving them out keeps a plain
    // /archive link plain.
    if (key === "show" && value === "speech") continue;
    if (key === "order" && value === "asc") continue;
    out.set(key, String(value));
  }
  return out.toString();
}
