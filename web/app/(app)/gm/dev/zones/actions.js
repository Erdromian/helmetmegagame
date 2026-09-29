"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { UserError, guarded } from "@/lib/actionResult";
import { requireDev } from "@/lib/devAccess";
import { validateNewSlug, validateUniqueName } from "@lifeweb/db/lib/placeValidation";
import { retirePlace, unretirePlace, hardDeleteBlockers, hardDeletePlace, removeRoomSide as closeRoomSide } from "@lifeweb/db/lib/placeDeletable";
import { enqueueMirror } from "@lifeweb/db/lib/discordMirror/queue";
import { ATTRIBUTES, attributesFromInput } from "@lifeweb/db/lib/locationAttributes";
import { seedRoomStashRows } from "@lifeweb/db/lib/roomStashSeed";
import { rehomeStandingCharacters } from "@lifeweb/db/lib/locationMove";
import { roomLocationIds } from "@lifeweb/db/lib/roomSides";

// /gm/dev/zones — the GM place editor. Every writer here re-validates
// everything server-side (a disabled button is a hint, not a lock), writes
// one AuditLog row, enqueues the touched place for the mirror, and revalidates
// the pages that show it. See db/lib/placeValidation.js and
// db/lib/placeDeletable.js for the rules this only calls.

async function requireGmSession() {
  // A plain GM may edit; only a superadmin may retire/hard-delete/seed
  // (checked at each call site with requireDev("super")).
  return requireDev("gm");
}

async function audit(session, actionType, details) {
  await prisma.auditLog.create({
    data: { actorDiscordUserId: session.discordUserId, actionType, details },
  });
}

function revalidateZonesTree() {
  revalidatePath("/gm/dev");
}

function trimmed(v) {
  return (v ?? "").toString().trim();
}

function optionalInt(raw, label) {
  if (raw === "" || raw == null) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n)) throw new UserError(`${label} must be a whole number.`);
  return n;
}

function parseMapPolygon(raw) {
  const text = trimmed(raw);
  if (!text) return null;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UserError("Map polygon must be valid JSON — a list of [x, y] pairs.");
  }
  if (!Array.isArray(value) || !value.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && n >= 0 && n <= 100))) {
    throw new UserError("Map polygon must be a list of [x, y] pairs, each 0-100.");
  }
  return value;
}

// Every save posts `updatedAt` back; a stale write (someone else changed the
// row since this form loaded) is refused rather than clobbering their edit.
async function claimRow(model, id, updatedAtRaw, data) {
  const updatedAt = updatedAtRaw ? new Date(updatedAtRaw) : null;
  const where = updatedAt ? { id, updatedAt } : { id };
  const { count } = await model.updateMany({ where, data });
  if (count === 0) throw new UserError("Someone else changed this; reload and try again.");
  return model.findUnique({ where: { id } });
}

// ---------------------------------------------------------------- Zone ----

export async function createZone(input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const slug = trimmed(input.slug).toLowerCase();
    const slugError = await validateNewSlug(prisma, slug);
    if (slugError) throw new UserError(slugError);
    const nameError = await validateUniqueName(prisma, "zone", input.name);
    if (nameError) throw new UserError(nameError);
    const kind = input.kind === "CAVE_GROUP" || input.kind === "CAVE_LEVEL" ? input.kind : "SURFACE";

    const zone = await prisma.zone.create({
      data: {
        slug,
        name: trimmed(input.name),
        kind,
        sortOrder: optionalInt(input.sortOrder, "Sort order"),
        description: trimmed(input.description),
      },
    });
    await audit(session, "gm_zone_created", { zoneId: zone.id, slug, name: zone.name });
    await enqueueMirror(prisma, "zone", zone.id, "created from /gm/dev/zones");
    revalidateZonesTree();
    return { zoneId: zone.id };
  });
}

export async function updateZone(zoneId, updatedAt, input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const name = trimmed(input.name);
    const nameError = await validateUniqueName(prisma, "zone", name, { excludeId: zoneId });
    if (nameError) throw new UserError(nameError);
    const kind = input.kind === "CAVE_GROUP" || input.kind === "CAVE_LEVEL" ? input.kind : "SURFACE";
    const mapPolygon = parseMapPolygon(input.mapPolygon);
    const mapLabelX = input.mapLabelX === "" || input.mapLabelX == null ? null : Number.parseFloat(input.mapLabelX);
    const mapLabelY = input.mapLabelY === "" || input.mapLabelY == null ? null : Number.parseFloat(input.mapLabelY);

    const before = await prisma.zone.findUnique({ where: { id: zoneId } });
    if (!before) throw new UserError("That zone no longer exists.");
    const renamed = before.name !== name;

    await claimRow(prisma.zone, zoneId, updatedAt, {
      name,
      kind,
      sortOrder: optionalInt(input.sortOrder, "Sort order"),
      description: trimmed(input.description),
      mapPolygon: mapPolygon ?? undefined,
      mapLabelX,
      mapLabelY,
    });
    await audit(session, "gm_zone_updated", { zoneId, name, renamed, from: before.name });
    await enqueueMirror(prisma, "zone", zoneId, renamed ? "renamed from /gm/dev/zones" : "edited from /gm/dev/zones");
    revalidateZonesTree();
  });
}

export async function reorderZone(zoneId, direction) {
  return guarded(async () => {
    const session = await requireGmSession();
    const zones = await prisma.zone.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    const idx = zones.findIndex((z) => z.id === zoneId);
    if (idx === -1) throw new UserError("That zone no longer exists.");
    const otherIdx = direction === "up" ? idx - 1 : idx + 1;
    if (otherIdx < 0 || otherIdx >= zones.length) return;
    const a = zones[idx];
    const b = zones[otherIdx];
    await prisma.$transaction([
      prisma.zone.update({ where: { id: a.id }, data: { sortOrder: b.sortOrder } }),
      prisma.zone.update({ where: { id: b.id }, data: { sortOrder: a.sortOrder } }),
    ]);
    await audit(session, "gm_zone_reordered", { zoneId: a.id, swappedWith: b.id });
    revalidateZonesTree();
  });
}

export async function retireZone(zoneId) {
  return guarded(async () => {
    const session = await requireDev("super");
    const result = await retirePlace(prisma, "zone", zoneId);
    if (!result.ok) throw new UserError(result.error);
    await audit(session, "gm_zone_retired", { zoneId });
    revalidateZonesTree();
  });
}

export async function unretireZone(zoneId) {
  return guarded(async () => {
    const session = await requireDev("super");
    await unretirePlace(prisma, "zone", zoneId);
    await audit(session, "gm_zone_unretired", { zoneId });
    revalidateZonesTree();
  });
}

// Gated like the hard delete it runs ahead of: the answer counts who is
// standing where, which is GM knowledge, and a server action is reachable
// without the page that hides its button.
export async function zoneDeleteBlockers(zoneId) {
  await requireDev("super");
  return hardDeleteBlockers(prisma, "zone", zoneId);
}

export async function hardDeleteZone(zoneId) {
  return guarded(async () => {
    const session = await requireDev("super");
    const result = await hardDeletePlace(prisma, "zone", zoneId);
    if (!result.ok) throw new UserError(`Can't delete: ${result.blockers.join("; ")}.`);
    await audit(session, "gm_zone_deleted", { zoneId });
    revalidateZonesTree();
  });
}

// ------------------------------------------------------------ Location ----

export async function createLocation(zoneId, input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const slug = trimmed(input.slug).toLowerCase();
    const slugError = await validateNewSlug(prisma, slug);
    if (slugError) throw new UserError(slugError);
    const nameError = await validateUniqueName(prisma, "location", input.name);
    if (nameError) throw new UserError(nameError);

    const location = await prisma.location.create({
      data: {
        slug,
        name: trimmed(input.name),
        zoneId,
        indoors: Boolean(input.indoors),
        sortOrder: optionalInt(input.sortOrder, "Sort order"),
        description: trimmed(input.description),
      },
    });
    await audit(session, "gm_location_created", { locationId: location.id, zoneId, slug, name: location.name });
    await enqueueMirror(prisma, "location", location.id, "created from /gm/dev/zones");
    revalidatePath(`/gm/dev/zones/${zoneId}`);
    return { locationId: location.id };
  });
}

export async function updateLocation(locationId, updatedAt, input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const name = trimmed(input.name);
    const nameError = await validateUniqueName(prisma, "location", name, { excludeId: locationId });
    if (nameError) throw new UserError(nameError);

    const before = await prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } });
    if (!before) throw new UserError("That location no longer exists.");
    const renamed = before.name !== name;

    // Moving the place into another zone. The zone is where a hop starts
    // costing the Move (MAP.md §3), so this is a real change to the map, not
    // a filing detail: everyone standing here changes zone with it, and the
    // channel moves category on the next mirror pass.
    const zoneId = trimmed(input.zoneId) || before.zoneId;
    const moved = zoneId !== before.zoneId;
    let zone = before.zone;
    let sortOrder = optionalInt(input.sortOrder, "Sort order");
    if (moved) {
      zone = await prisma.zone.findUnique({ where: { id: zoneId } });
      if (!zone || zone.retiredAt) throw new UserError("That zone no longer exists.");
      // A CAVE_GROUP is only ever a parent (MAP.md §1) — nobody stands in it.
      if (zone.kind === "CAVE_GROUP") throw new UserError(`${zone.name} is a group of zones, not somewhere a place can be.`);
      // Untouched sort order goes to the END of the new zone rather than
      // colliding with whatever already holds that slot there.
      if (sortOrder === before.sortOrder) {
        const last = await prisma.location.aggregate({ where: { zoneId }, _max: { sortOrder: true } });
        sortOrder = (last._max.sortOrder ?? 0) + 1;
      }
    }

    // Validated by the same registry the form's controls came from
    // (db/lib/locationAttributes.js) — a key it doesn't know can't reach
    // here, and a bad enum/number value is refused rather than written.
    const { attributes, problems } = attributesFromInput(input.attributes ?? {});
    if (problems.length) throw new UserError(problems.join(" "));

    await claimRow(prisma.location, locationId, updatedAt, {
      name,
      zoneId,
      indoors: Boolean(input.indoors),
      sortOrder,
      description: trimmed(input.description),
      attributes,
    });
    if (moved) {
      // Character.zoneId is a denormalized mirror of location.zoneId (MAP.md
      // §1), and the channel doctor flags every row where the two disagree.
      await prisma.character.updateMany({ where: { locationId }, data: { zoneId } });
      await rehomeStandingCharacters(prisma, {
        locationId,
        fromRoleId: before.zone?.discordRoleId ?? null,
        toRoleId: zone?.discordRoleId ?? null,
      });
    }
    await audit(session, "gm_location_updated", {
      locationId,
      name,
      renamed,
      from: before.name,
      ...(moved ? { movedFromZoneId: before.zoneId, movedToZoneId: zoneId } : {}),
    });
    await enqueueMirror(
      prisma,
      "location",
      locationId,
      moved ? `moved to ${zone.name} from /gm/dev/zones` : renamed ? "renamed from /gm/dev/zones" : "edited from /gm/dev/zones",
    );
    revalidatePath(`/gm/dev/zones/locations/${locationId}`);
    revalidatePath(`/gm/dev/zones/${before.zoneId}`);
    if (moved) revalidatePath(`/gm/dev/zones/${zoneId}`);
  });
}

export async function updateLocationMining(locationId, base) {
  return guarded(async () => {
    const session = await requireGmSession();
    const value = Number.parseFloat(base);
    if (!Number.isFinite(value) || value < 0) throw new UserError("Mining base must be a number of at least 0.");
    await prisma.locationMining.upsert({
      where: { locationId },
      update: { base: value },
      create: { locationId, base: value, current: value },
    });
    await audit(session, "gm_location_mining_updated", { locationId, base: value });
    revalidatePath(`/gm/dev/zones/locations/${locationId}`);
  });
}

export async function reorderLocation(zoneId, locationId, direction) {
  return guarded(async () => {
    const session = await requireGmSession();
    const locations = await prisma.location.findMany({ where: { zoneId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    const idx = locations.findIndex((l) => l.id === locationId);
    if (idx === -1) throw new UserError("That location no longer exists.");
    const otherIdx = direction === "up" ? idx - 1 : idx + 1;
    if (otherIdx < 0 || otherIdx >= locations.length) return;
    const a = locations[idx];
    const b = locations[otherIdx];
    await prisma.$transaction([
      prisma.location.update({ where: { id: a.id }, data: { sortOrder: b.sortOrder } }),
      prisma.location.update({ where: { id: b.id }, data: { sortOrder: a.sortOrder } }),
    ]);
    await audit(session, "gm_location_reordered", { locationId: a.id, swappedWith: b.id });
    revalidatePath(`/gm/dev/zones/${zoneId}`);
  });
}

export async function retireLocation(locationId) {
  return guarded(async () => {
    const session = await requireDev("super");
    const result = await retirePlace(prisma, "location", locationId);
    if (!result.ok) throw new UserError(result.error);
    await audit(session, "gm_location_retired", { locationId });
    revalidateZonesTree();
  });
}

export async function unretireLocation(locationId) {
  return guarded(async () => {
    const session = await requireDev("super");
    await unretirePlace(prisma, "location", locationId);
    await audit(session, "gm_location_unretired", { locationId });
    revalidateZonesTree();
  });
}

export async function locationDeleteBlockers(locationId) {
  await requireDev("super");
  return hardDeleteBlockers(prisma, "location", locationId);
}

export async function hardDeleteLocation(locationId) {
  return guarded(async () => {
    const session = await requireDev("super");
    const result = await hardDeletePlace(prisma, "location", locationId);
    if (!result.ok) throw new UserError(`Can't delete: ${result.blockers.join("; ")}.`);
    await audit(session, "gm_location_deleted", { locationId });
    revalidateZonesTree();
  });
}

// ---------------------------------------------------------------- Room ----

export async function createRoom(locationId, input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const slug = trimmed(input.slug).toLowerCase();
    const slugError = await validateNewSlug(prisma, slug);
    if (slugError) throw new UserError(slugError);
    const nameError = await validateUniqueName(prisma, "room", input.name, { locationId });
    if (nameError) throw new UserError(nameError);
    const kind = input.kind === "PRIVATE" ? "PRIVATE" : "PUBLIC";

    const room = await prisma.room.create({
      data: {
        slug,
        name: trimmed(input.name),
        locationId,
        kind,
        sortOrder: optionalInt(input.sortOrder, "Sort order"),
        description: trimmed(input.description),
        soundproof: Boolean(input.soundproof),
        destroysContents: Boolean(input.destroysContents),
      },
    });
    await audit(session, "gm_room_created", { roomId: room.id, locationId, slug, name: room.name });
    await enqueueMirror(prisma, "room", room.id, "created from /gm/dev/zones");
    revalidatePath(`/gm/dev/zones/locations/${locationId}`);
    return { roomId: room.id };
  });
}

export async function updateRoom(roomId, updatedAt, input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const before = await prisma.room.findUnique({ where: { id: roomId }, include: { sides: { select: { locationId: true } } } });
    if (!before) throw new UserError("That room no longer exists.");
    const name = trimmed(input.name);
    // Unique at every Location the room opens onto, not only its home.
    const nameError = await validateUniqueName(prisma, "room", name, {
      locationIds: roomLocationIds(before),
      excludeId: roomId,
    });
    if (nameError) throw new UserError(nameError);
    const renamed = before.name !== name;
    const kind = input.kind === "PRIVATE" ? "PRIVATE" : "PUBLIC";

    await claimRow(prisma.room, roomId, updatedAt, {
      name,
      kind,
      sortOrder: optionalInt(input.sortOrder, "Sort order"),
      description: trimmed(input.description),
      soundproof: Boolean(input.soundproof),
      destroysContents: Boolean(input.destroysContents),
      // The phone on the wall (docs/systemdocs/PHONES.md). A blank name means
      // no phone, which is also how a GM takes one OUT of a room — and taking
      // the name away is the whole removal, since the exchange and the
      // Phonebook are both built off this column. A payphone with no name is
      // simply no phone, so the flag is cleared with it rather than left as a
      // switch on nothing. A phone added here gets its number the first time
      // somebody picks it up (db/lib/phoneNumbers.js).
      phone: trimmed(input.phone) || null,
      payphone: Boolean(trimmed(input.phone)) && Boolean(input.payphone),
      // The vending machine on the wall (docs/systemdocs/VENDING.md). Unticking
      // it hides the button and nothing else — the machine row, its shelf and
      // whatever coin is in it all survive, so a GM who unticks by accident has
      // not emptied somebody's till. Tick it again and the shop is back.
      vendingMachine: Boolean(input.vendingMachine),
      accessTagSlugs: kind === "PRIVATE" ? String(input.accessTagSlugs ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [],
    });
    await audit(session, "gm_room_updated", { roomId, name, renamed, from: before.name });
    await enqueueMirror(prisma, "room", roomId, renamed ? "renamed from /gm/dev/zones" : "edited from /gm/dev/zones");
    revalidatePath(`/gm/dev/zones/rooms/${roomId}`);
  });
}

// ------------------------------------------------------------ Room sides ----
//
// A room that opens onto more than one Location — a window, a counter
// (Multi-locational rooms.docx, docs/systemdocs/MAP.md §2d). The room's own
// form above is its HOME side; each side here is one more Location it opens
// onto, with a gate of its own. Kind follows the access list, as it does in
// docs/zones.yaml: any slug makes that side PRIVATE.

function accessSlugs(raw) {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function revalidateSide(roomId, locationIds) {
  revalidatePath(`/gm/dev/zones/rooms/${roomId}`);
  for (const locationId of locationIds) revalidatePath(`/gm/dev/zones/locations/${locationId}`);
}

export async function addRoomSide(roomId, input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const room = await prisma.room.findUnique({ where: { id: roomId }, include: { sides: { select: { locationId: true } } } });
    if (!room) throw new UserError("That room no longer exists.");
    const locationId = trimmed(input.locationId);
    const location = locationId
      ? await prisma.location.findUnique({ where: { id: locationId }, select: { id: true, name: true, retiredAt: true } })
      : null;
    if (!location || location.retiredAt) throw new UserError("Pick a Location for it to open onto.");
    if (location.id === room.locationId) throw new UserError("That is the room's own Location.");
    if (room.sides.some((s) => s.locationId === location.id)) {
      throw new UserError(`It already opens onto ${location.name}.`);
    }
    // Its thread will sit under that Location's channel too, where a thread is found by its name.
    const nameError = await validateUniqueName(prisma, "room", room.name, { locationIds: [location.id], excludeId: roomId });
    if (nameError) throw new UserError(`${location.name} already has a room called "${room.name}".`);
    const slugs = accessSlugs(input.accessTagSlugs);

    const side = await prisma.roomSide.create({
      data: {
        roomId,
        locationId: location.id,
        kind: slugs.length > 0 ? "PRIVATE" : "PUBLIC",
        accessTagSlugs: slugs,
        sortOrder: optionalInt(input.sortOrder, "Sort order"),
      },
    });
    await audit(session, "gm_room_side_added", { roomId, sideId: side.id, locationId: location.id, accessTagSlugs: slugs });
    // The room job rebuilds every thread of it, the new side's included; the Location's anchor lists it.
    await enqueueMirror(prisma, "room", roomId, `opened onto ${location.name} from /gm/dev/zones`);
    await enqueueMirror(prisma, "location", location.id, "a room opens onto here now");
    revalidateSide(roomId, [room.locationId, location.id]);
  });
}

export async function updateRoomSide(sideId, updatedAt, input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const before = await prisma.roomSide.findUnique({ where: { id: sideId } });
    if (!before) throw new UserError("That side no longer exists.");
    const slugs = accessSlugs(input.accessTagSlugs);
    await claimRow(prisma.roomSide, sideId, updatedAt, {
      kind: slugs.length > 0 ? "PRIVATE" : "PUBLIC",
      accessTagSlugs: slugs,
      sortOrder: optionalInt(input.sortOrder, "Sort order"),
    });
    await audit(session, "gm_room_side_updated", { roomId: before.roomId, sideId, accessTagSlugs: slugs });
    await enqueueMirror(prisma, "room", before.roomId, "a side's gate edited from /gm/dev/zones");
    await enqueueMirror(prisma, "location", before.locationId, "a side's gate edited from /gm/dev/zones");
    revalidateSide(before.roomId, [before.locationId]);
  });
}

export async function removeRoomSide(sideId) {
  return guarded(async () => {
    const session = await requireGmSession();
    const side = await prisma.roomSide.findUnique({ where: { id: sideId }, include: { room: { select: { locationId: true } } } });
    if (!side) throw new UserError("That side no longer exists.");

    await closeRoomSide(prisma, side);
    await audit(session, "gm_room_side_removed", { roomId: side.roomId, sideId, locationId: side.locationId });
    await enqueueMirror(prisma, "room", side.roomId, "a side closed from /gm/dev/zones");
    await enqueueMirror(prisma, "location", side.locationId, "a room no longer opens onto here");
    revalidateSide(side.roomId, [side.room?.locationId, side.locationId].filter(Boolean));
  });
}

export async function retireRoom(roomId) {
  return guarded(async () => {
    const session = await requireDev("super");
    const result = await retirePlace(prisma, "room", roomId);
    if (!result.ok) throw new UserError(result.error);
    await audit(session, "gm_room_retired", { roomId });
    revalidateZonesTree();
  });
}

export async function unretireRoom(roomId) {
  return guarded(async () => {
    const session = await requireDev("super");
    await unretirePlace(prisma, "room", roomId);
    await audit(session, "gm_room_unretired", { roomId });
    revalidateZonesTree();
  });
}

export async function roomDeleteBlockers(roomId) {
  await requireDev("super");
  return hardDeleteBlockers(prisma, "room", roomId);
}

export async function hardDeleteRoom(roomId) {
  return guarded(async () => {
    const session = await requireDev("super");
    const result = await hardDeletePlace(prisma, "room", roomId);
    if (!result.ok) throw new UserError(`Can't delete: ${result.blockers.join("; ")}.`);
    await audit(session, "gm_room_deleted", { roomId });
    revalidateZonesTree();
  });
}

// "Seed these items now" — the hand version of what Start Game does to every
// room at once. Both go through db/lib/roomStash.js, so the never-seed-twice
// guard is one piece of code rather than two that have to agree.
// One "slug: count" a line -> [[slug, count], ...]. A bad count is a UserError
// naming the line, since somebody just typed it.
function parseSeedLines(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const wanted = [];
  for (const line of lines) {
    const [slugPart, countPart] = line.split(":").map((p) => p?.trim());
    if (!slugPart) continue;
    const quantity = countPart ? Number.parseInt(countPart, 10) : 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new UserError(`"${line}" — count must be a whole number of at least 1.`);
    }
    wanted.push([slugPart, quantity]);
  }
  return wanted;
}

// `text` seeds the floor, `hiddenText` seeds under it (SEARCH.md §9). One
// entry per slug — a slug in both boxes is one row with both counts, and
// the once-per-slug guard applies to it once.
export async function seedRoomStash(roomId, text, hiddenText = "") {
  return guarded(async () => {
    const session = await requireDev("super");
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new UserError("That room no longer exists.");

    const bySlug = new Map();
    for (const [slug, n] of parseSeedLines(text)) {
      const cur = bySlug.get(slug) ?? [slug, 0, 0];
      cur[1] += n;
      bySlug.set(slug, cur);
    }
    for (const [slug, n] of parseSeedLines(hiddenText)) {
      if (room.destroysContents) throw new UserError("This room eats what goes into it, so it may hold nothing hidden.");
      const cur = bySlug.get(slug) ?? [slug, 0, 0];
      cur[2] += n;
      bySlug.set(slug, cur);
    }
    const wanted = [...bySlug.values()];
    if (wanted.length === 0) throw new UserError("Nothing to seed — write one \"slug: count\" per line.");

    const out = await seedRoomStashRows(prisma, room, wanted);
    // A typo is worth saying out loud HERE, where somebody just typed it —
    // the bulk pass only reports unknown slugs, because one bad slug in the
    // YAML should not cost eighty other rooms their contents.
    if (out.unknown.length) {
      throw new UserError(`Unknown tag slug${out.unknown.length === 1 ? "" : "s"}: ${out.unknown.join(", ")}.`);
    }
    if (out.seeded === 0) return { seeded: 0 };

    await audit(session, "gm_room_stash_seeded", {
      roomId,
      slugs: wanted.map(([slug, q, h]) => `${slug}:${q}${h ? `+${h} hidden` : ""}`),
    });
    revalidatePath(`/gm/dev/zones/rooms/${roomId}`);
    return { seeded: out.seeded };
  });
}

// ------------------------------------------------------------- Links ----

export async function createLink(input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const aId = trimmed(input.aId);
    const bId = trimmed(input.bId);
    if (!aId || !bId || aId === bId) throw new UserError("Pick two different locations.");
    const [a, b] = await Promise.all([
      prisma.location.findUnique({ where: { id: aId } }),
      prisma.location.findUnique({ where: { id: bId } }),
    ]);
    if (!a || !b) throw new UserError("One of those locations no longer exists.");
    // Held in slug order, same convention the old zones sync used, so an edge can
    // never disagree between the two directions.
    const [loId, hiId] = a.slug < b.slug ? [aId, bId] : [bId, aId];

    const link = await prisma.locationLink.create({
      data: {
        aId: loId,
        bId: hiId,
        announce: ["NONE", "TRUE_NAME", "CONCEALED"].includes(input.announce) ? input.announce : "NONE",
        hidden: Boolean(input.hidden),
        modular: Boolean(input.modular),
        keyed: Boolean(input.keyed),
        onFoot: Boolean(input.onFoot),
        tightSqueeze: Boolean(input.tightSqueeze),
        requiredTagSlug: trimmed(input.requiredTagSlug) || null,
        authoredOpen: input.modular ? Boolean(input.authoredOpen) : true,
        isOpen: input.modular ? Boolean(input.authoredOpen) : true,
      },
    });
    await audit(session, "gm_link_created", { linkId: link.id, aId: loId, bId: hiId });
    await enqueueMirror(prisma, "location", loId, "link created from /gm/dev/zones");
    await enqueueMirror(prisma, "location", hiId, "link created from /gm/dev/zones");
    revalidatePath("/gm/dev/zones/links");
  });
}

export async function updateLink(linkId, updatedAt, input) {
  return guarded(async () => {
    const session = await requireGmSession();
    await claimRow(prisma.locationLink, linkId, updatedAt, {
      announce: ["NONE", "TRUE_NAME", "CONCEALED"].includes(input.announce) ? input.announce : "NONE",
      hidden: Boolean(input.hidden),
      modular: Boolean(input.modular),
      keyed: Boolean(input.keyed),
      onFoot: Boolean(input.onFoot),
      tightSqueeze: Boolean(input.tightSqueeze),
      requiredTagSlug: trimmed(input.requiredTagSlug) || null,
      authoredOpen: input.modular ? Boolean(input.authoredOpen) : true,
    });
    await audit(session, "gm_link_updated", { linkId });
    revalidatePath("/gm/dev/zones/links");
  });
}

export async function deleteLink(linkId) {
  return guarded(async () => {
    const session = await requireDev("super");
    const link = await prisma.locationLink.findUnique({ where: { id: linkId } });
    if (!link) return;
    await prisma.locationLink.delete({ where: { id: linkId } });
    await audit(session, "gm_link_deleted", { linkId, aId: link.aId, bId: link.bId });
    revalidatePath("/gm/dev/zones/links");
  });
}
