// Two surfaces read the same rows — the page's first screen and the endpoint
// that feeds the scroll — and they MUST agree about the filter and the order.
// No prisma import, so the client can use `archiveParamsToQuery` without dragging PrismaClient into the bundle (ARCHITECTURE.md §2).

export const ARCHIVE_PAGE_SIZE = 60;

// The filters that take several values at once. Each is a repeated URL param
// (`?zone=Town&zone=Caves`): OR within one filter, AND across filters.
const MULTI = ["zone", "location", "room", "character"];

// A place is named by the names above it, since two zones can each have a
// Cellar: a Location is `Zone|Location`, a room or conversation
// `Zone|Location|Room`. A missing part is empty, so a party thread, which has
// neither, is `||Name`. Only the last part may hold the separator itself.
const SEP = "|";

function splitKey(key, parts) {
  const out = [];
  let rest = String(key ?? "");
  for (let i = 1; i < parts; i++) {
    const at = rest.indexOf(SEP);
    if (at < 0) return null;
    out.push(rest.slice(0, at) || null);
    rest = rest.slice(at + 1);
  }
  out.push(rest);
  return out;
}

export function locationKey(zoneName, locationName) {
  return [zoneName ?? "", locationName ?? ""].join(SEP);
}

export function parseLocationKey(key) {
  const parts = splitKey(key, 2);
  return parts?.[1] ? { zoneName: parts[0], locationName: parts[1] } : null;
}

export function roomKey(zoneName, locationName, threadName) {
  return [zoneName ?? "", locationName ?? "", threadName ?? ""].join(SEP);
}

export function parseRoomKey(key) {
  const parts = splitKey(key, 3);
  return parts?.[2] ? { zoneName: parts[0], locationName: parts[1], threadName: parts[2] } : null;
}

// Places narrow downward: with zones picked, only Locations in them count, and
// with Locations picked (else zones), only rooms in those. Whatever a change
// higher up leaves outside is dropped, so no pick can sit hidden in the drawer
// while it empties the transcript. The keys carry their parents' names, so
// this needs no list of places.
export function prunePlaces({ zones = [], locations = [], rooms = [] }) {
  const keptLocations = zones.length
    ? locations.filter((k) => zones.includes(parseLocationKey(k)?.zoneName ?? ""))
    : locations;
  const keptRooms = rooms.filter((k) => {
    const room = parseRoomKey(k);
    if (!room) return false;
    if (keptLocations.length) return keptLocations.includes(locationKey(room.zoneName, room.locationName));
    if (zones.length) return zones.includes(room.zoneName ?? "");
    return true;
  });
  return { zones, locations: keptLocations, rooms: keptRooms };
}

// Next hands a repeated param over as an array, and a single one as a string.
function listOf(value) {
  const all = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(all.map((v) => v.toString().trim()).filter(Boolean))];
}

function dayOf(value) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseArchiveParams(params = {}) {
  const get = (key) => {
    const v = params?.[key];
    return (Array.isArray(v) ? v[0] : v)?.toString().trim() || "";
  };
  // `day=N` is the old single-day link, kept working as a range of one.
  const legacyDay = dayOf(get("day"));
  let from = dayOf(get("from")) ?? legacyDay;
  let to = dayOf(get("to")) ?? legacyDay;
  if (from && to && from > to) [from, to] = [to, from];
  return {
    game: get("game"),
    zones: listOf(params?.zone),
    locations: listOf(params?.location).filter((k) => parseLocationKey(k)),
    rooms: listOf(params?.room).filter((k) => parseRoomKey(k)),
    characters: listOf(params?.character),
    // Matched against the row's own stamped day, never worked out from the turn number: a day is one to four turns now
    // (TURN-ENGINE.md), so "turns 2N-1 and 2N" found the wrong rows at every length.
    from,
    to,
    q: get("q"),
    show: get("show") === "all" ? "all" : "speech",
    order: get("order") === "desc" ? "desc" : "asc",
    // What characters did (ArchiveKind.ACTION). Off unless asked for: the
    // transcript is what was said, and the acts are a layer a GM turns on.
    actions: get("actions") === "1",
  };
}

// One chip per value, so a room or a person can be taken off on its own.
// `names` turns a character id back into a name for its chip.
export function activeArchiveFilters(f, names = new Map()) {
  const on = [];
  if (f.q) on.push({ key: "q", label: `“${f.q}”` });
  if (f.from || f.to) {
    const label = f.from === f.to ? `Day ${f.from}` : f.from && f.to ? `Days ${f.from}–${f.to}` : f.from ? `From day ${f.from}` : `To day ${f.to}`;
    on.push({ key: "days", label, clear: { from: "", to: "", day: "" } });
  }
  // Taking a place off also takes off what it no longer leaves room for.
  const without = (patch) => {
    const kept = prunePlaces({ zones: f.zones, locations: f.locations, rooms: f.rooms, ...patch });
    return { zone: kept.zones, location: kept.locations, room: kept.rooms };
  };
  for (const z of f.zones) on.push({ key: `zone:${z}`, label: z, clear: without({ zones: f.zones.filter((v) => v !== z) }) });
  for (const l of f.locations) {
    const location = parseLocationKey(l);
    on.push({ key: `location:${l}`, label: location.locationName, clear: without({ locations: f.locations.filter((v) => v !== l) }) });
  }
  for (const r of f.rooms) {
    const room = parseRoomKey(r);
    on.push({ key: `room:${r}`, label: room.threadName, clear: { room: f.rooms.filter((v) => v !== r) } });
  }
  for (const c of f.characters) {
    on.push({ key: `character:${c}`, label: names.get(c) ?? "one person", clear: { character: f.characters.filter((v) => v !== c) } });
  }
  return on.map((chip) => ({ ...chip, clear: chip.clear ?? { [chip.key]: "" } }));
}

// Every clause is its own entry in AND, never a key spread onto the object:
// two filters that each need an OR (Speech, and a cursor) would otherwise
// overwrite one another, which is how Speech used to turn into Everything
// past the first screen.
export function archiveWhere(gameId, f) {
  const and = [];
  const noActions = f.actions ? [] : [{ kind: { not: "ACTION" } }];
  // MESSAGE rows the world writes itself (db/lib/scene.js) carry `source: SYSTEM`; Speech leaves them out.
  if (f.show === "speech") {
    and.push({
      OR: [
        { kind: "TURN_START" },
        { kind: "MESSAGE", source: { not: "SYSTEM" } },
        ...(f.actions ? [{ kind: "ACTION" }] : []),
      ],
    });
  } else {
    and.push(...noActions);
  }
  if (f.zones?.length) and.push({ zoneName: { in: f.zones } });
  // A Location takes in everything said or done there, its rooms and
  // conversations included: they all carry its name.
  if (f.locations?.length) {
    and.push({ OR: f.locations.map(parseLocationKey).filter(Boolean).map(({ zoneName, locationName }) => ({ zoneName, locationName })) });
  }
  if (f.rooms?.length) {
    and.push({
      OR: f.rooms
        .map(parseRoomKey)
        .filter(Boolean)
        .map(({ zoneName, locationName, threadName }) => ({ zoneName, locationName, threadName })),
    });
  }
  if (f.characters?.length) and.push({ characterId: { in: f.characters } });
  if (f.from || f.to) and.push({ dayNumber: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } });
  if (f.q) and.push({ content: { contains: f.q, mode: "insensitive" } });
  return { gameId, deletedAt: null, AND: and };
}

// `sentAt` then `id`, NOT `seq` — seq is assigned at INSERT, so a message recovered after the
// bot was down (bot/src/lib/messageCatchUp.js) carries a real sentAt from hours earlier but a
// brand-new seq; ordering by it would file the message at the wrong moment, which is precisely
// the lie a transcript must not tell. id breaks ties (sentAt is ms-resolution). @@index([gameId, sentAt, id]).
export function archiveOrderBy(order) {
  return [{ sentAt: order }, { id: order }];
}

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

// The filter and the cursor together, each whole: see archiveWhere.
export function archivePageWhere(gameId, f, cursor) {
  const where = archiveWhere(gameId, f);
  const past = archiveCursorWhere(cursor, f.order);
  return Object.keys(past).length ? { ...where, AND: [...where.AND, past] } : where;
}

export function archiveCursorOf(row) {
  if (!row?.sentAt) return null;
  const iso = typeof row.sentAt === "string" ? row.sentAt : new Date(row.sentAt).toISOString();
  return `${iso}|${row.id}`;
}

export function archiveParamsToQuery(f, overrides = {}) {
  const merged = {
    game: f.game,
    zone: f.zones,
    location: f.locations,
    room: f.rooms,
    character: f.characters,
    from: f.from,
    to: f.to,
    q: f.q,
    show: f.show,
    order: f.order,
    actions: f.actions ? "1" : "",
    ...overrides,
  };
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    // The old single-day param is read, never written.
    if (key === "day") continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v == null || v === "" || v === false) continue;
      if (key === "show" && v === "speech") continue;
      if (key === "order" && v === "asc") continue;
      out.append(key, String(v));
    }
  }
  return out.toString();
}

// URLSearchParams -> the object parseArchiveParams reads, keeping every value
// of a repeated key (Object.fromEntries keeps only the last).
export function searchParamsObject(params) {
  const out = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    out[key] = MULTI.includes(key) ? all : all[all.length - 1];
  }
  return out;
}
