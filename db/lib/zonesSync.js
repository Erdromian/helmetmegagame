// docs/zones.yaml -> the places. `npm run db:sync-zones`, and a step of both
// Restart Game and Start Game.
//
// WHY. db/lib/importZones.js only ever CREATES, so a zones.yaml edit to a place
// the game already had never reached it: a new description, a moved room, a
// dropped way, a stash that grew a `hidden:` block. Restart Game re-pours every
// room from Room.stashSeed, not from the YAML, so a stale seed came back every
// game — that is how the Den's Bar poured its hidden drink and cigarettes onto
// the floor on 2026-09-28.
//
// THE RULE: THE YAML IS THE MASTER, AND A GAME'S EDITS END WITH THE GAME.
// Places are also edited live at /gm/dev/zones, and those edits are for the
// game they were made in. Every run makes each place the YAML names match it,
// field by field, whoever changed it in between:
//
//   - in the YAML, not in the database: created (through importZonesFromYaml),
//     even one a GM hard-deleted;
//   - in both: every field the YAML owns is set to the YAML's value, and a
//     place a GM retired comes back;
//   - in the database, not in the YAML: a zone, location or room is RETIRED
//     (never deleted, so its history and Discord footprint stay), a room's
//     side or a way between two locations is removed. That covers places a GM
//     made at /gm/dev/zones as well as ones the YAML dropped. A location
//     somebody is standing in is not retired, and says so;
//   - a quest room (Room.questId) is a GM's runtime room with a lifecycle of
//     its own (QUESTS.md), and is never even looked at.
//
// So a change that should outlive the game belongs in docs/zones.yaml.
//
// It never touches a structure, which db/lib/worldSeed.js owns. What is lying
// in a room (RoomTag) it touches only with `beforePlay` (below).
//
// `beforePlay: true` is for the two callers that run before anybody plays,
// Restart Game and Start Game. With it, a room whose stash seed changed is
// emptied and its seed history cleared, so the world seed pours the new seed
// (Start Game can follow a restart by days, with deploys in between, and the
// restart already poured the old one); a way whose authored state changed is
// set to it; a mining rate starts again from its new base. Without it — the
// ops script, run on a game in progress — only the authored columns move and
// the next game picks them up, and a Location attribute a structure grants
// (`noticeboard`, `kitchen`) is left as the game has it: a board somebody
// built stays up, and one a GM destroyed stays down (BUILT_ATTRIBUTE_KEYS).
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel; require
// it by path. Dry run by default, like the importer.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { Prisma } = require("@prisma/client");
const { docsPath } = require("./repoPaths");
const { parseZonesYaml } = require("./syncZones/parse");
const { importZonesFromYaml } = require("./importZones");
const { enqueueMirror } = require("./discordMirror/queue");
const { ATTRIBUTES } = require("./locationAttributes");
// Whole module, not destructured, so a test can stub one export.
const placeDeletable = require("./placeDeletable");

// Everything docs/zones.yaml owns on each kind of row, named as the model below
// names it (slug space: a parent, zone or location is its slug, not an id).
const FIELDS = {
  zones: ["name", "kind", "sortOrder", "description", "parentSlug", "mapPolygon", "mapLabelX", "mapLabelY"],
  locations: ["name", "description", "indoors", "attributes", "sortOrder", "zoneSlug", "mining"],
  rooms: [
    "name",
    "description",
    "sortOrder",
    "kind",
    "accessTagSlugs",
    "destroysContents",
    "soundproof",
    "stable",
    "phone",
    "payphone",
    "vendingMachine",
    "live",
    "locationSlug",
    "stashSeed",
  ],
  sides: ["kind", "accessTagSlugs", "sortOrder"],
  links: ["announce", "requiredTagSlug", "hidden", "modular", "authoredOpen", "keyed", "onFoot", "tightSqueeze"],
};
const KINDS = Object.keys(FIELDS);
const RETIRABLE = { zones: "zone", locations: "location", rooms: "room" };

const pairKey = (a, b) => [a, b].sort().join("|");
const sideKey = (roomSlug, locationSlug) => `${roomSlug}|${locationSlug}`;

// JSON with sorted keys, so two objects that differ only in key order compare
// equal.
function canonical(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(",")}}`;
}
const same = (a, b) => canonical(a) === canonical(b);

// An access list is a set: any one of its tags opens the door, so the order a
// GM or the YAML happened to write them in is not a difference.
const slugSet = (list) => [...new Set(list ?? [])].sort();

// A stash seed in one shape whatever wrote it. Older seeds have no `hidden`
// key and some have bare slugs for pairs; an empty seed is no seed.
function normalizeSeed(seed) {
  if (!seed || typeof seed !== "object") return null;
  const pairs = (list) =>
    (Array.isArray(list) ? list : []).map((pair) => {
      const [slug, quantity] = Array.isArray(pair) ? pair : [pair, 1];
      return [String(slug), Number(quantity ?? 1)];
    });
  const resources = Number(seed.resources ?? 0) || 0;
  const items = pairs(seed.items);
  const hidden = pairs(seed.hidden);
  if (resources <= 0 && items.length === 0 && hidden.length === 0) return null;
  return { resources, items, hidden };
}

function readZonesYaml() {
  const p = docsPath("zones.yaml");
  if (!p) throw new Error("Cannot find docs/zones.yaml — see db/lib/repoPaths.js");
  return yaml.load(fs.readFileSync(p, "utf8"));
}

// The YAML half of the comparison, from parseZonesYaml's entries. The same
// fields importZones.js writes when it creates a row.
function yamlModel(parsed) {
  const model = { zones: {}, locations: {}, rooms: {}, sides: {}, links: {} };
  for (const e of parsed.zoneEntries) {
    model.zones[e.slug] = {
      name: e.name,
      kind: e.kind,
      sortOrder: e.sortOrder,
      description: e.description,
      parentSlug: e.parentSlug ?? null,
      mapPolygon: e.mapPolygon ?? null,
      mapLabelX: e.mapLabelX ?? null,
      mapLabelY: e.mapLabelY ?? null,
    };
  }
  for (const e of parsed.locationEntries) {
    model.locations[e.slug] = {
      name: e.name,
      description: e.description,
      indoors: e.indoors,
      attributes: e.attributes ?? {},
      sortOrder: e.sortOrder,
      zoneSlug: e.zoneSlug,
      mining: e.mining ?? null,
    };
  }
  for (const e of parsed.roomEntries) {
    model.rooms[e.slug] = {
      name: e.name,
      description: e.description,
      sortOrder: e.sortOrder,
      kind: e.kind,
      accessTagSlugs: slugSet(e.accessTagSlugs),
      destroysContents: e.destroysContents,
      soundproof: e.soundproof,
      stable: e.stable,
      phone: e.phone ?? null,
      payphone: e.payphone,
      vendingMachine: e.vendingMachine,
      live: e.live ?? null,
      locationSlug: e.locationSlug,
      stashSeed: normalizeSeed(e.stash),
    };
    for (const side of e.sides ?? []) {
      model.sides[sideKey(e.slug, side.locationSlug)] = {
        kind: side.kind,
        accessTagSlugs: slugSet(side.accessTagSlugs),
        sortOrder: side.sortOrder,
      };
    }
  }
  for (const c of parsed.connections) {
    model.links[pairKey(c.a, c.b)] = {
      announce: c.announce,
      requiredTagSlug: c.requiredTagSlug ?? null,
      hidden: c.hidden,
      modular: c.modular,
      authoredOpen: c.isOpen,
      keyed: c.keyed,
      onFoot: c.onFoot,
      tightSqueeze: c.tightSqueeze,
    };
  }
  return model;
}

// The database half, in the same slug space, plus the rows themselves so the
// apply step can find ids. Quest rooms are a GM's runtime rooms and are left
// out entirely, sides and all.
async function dbModel(prisma) {
  const [zones, locations, rooms, sides, links] = await Promise.all([
    prisma.zone.findMany(),
    prisma.location.findMany({ include: { mining: true } }),
    prisma.room.findMany({ where: { questId: null } }),
    prisma.roomSide.findMany(),
    prisma.locationLink.findMany(),
  ]);
  const zoneSlug = new Map(zones.map((z) => [z.id, z.slug]));
  const locationSlug = new Map(locations.map((l) => [l.id, l.slug]));
  const roomSlug = new Map(rooms.map((r) => [r.id, r.slug]));

  const model = { zones: {}, locations: {}, rooms: {}, sides: {}, links: {} };
  const rows = { zones: {}, locations: {}, rooms: {}, sides: {}, links: {} };
  for (const z of zones) {
    rows.zones[z.slug] = z;
    model.zones[z.slug] = {
      name: z.name,
      kind: z.kind,
      sortOrder: z.sortOrder,
      description: z.description,
      parentSlug: z.parentZoneId ? zoneSlug.get(z.parentZoneId) ?? null : null,
      mapPolygon: z.mapPolygon ?? null,
      mapLabelX: z.mapLabelX ?? null,
      mapLabelY: z.mapLabelY ?? null,
      retired: Boolean(z.retiredAt),
    };
  }
  for (const l of locations) {
    rows.locations[l.slug] = l;
    model.locations[l.slug] = {
      name: l.name,
      description: l.description,
      indoors: l.indoors,
      attributes: l.attributes ?? {},
      sortOrder: l.sortOrder,
      zoneSlug: zoneSlug.get(l.zoneId) ?? null,
      mining: l.mining?.base ?? null,
      retired: Boolean(l.retiredAt),
    };
  }
  for (const r of rooms) {
    rows.rooms[r.slug] = r;
    model.rooms[r.slug] = {
      name: r.name,
      description: r.description,
      sortOrder: r.sortOrder,
      kind: r.kind,
      accessTagSlugs: slugSet(r.accessTagSlugs),
      destroysContents: r.destroysContents,
      soundproof: r.soundproof,
      stable: r.stable,
      phone: r.phone ?? null,
      payphone: r.payphone,
      vendingMachine: r.vendingMachine,
      live: r.live ?? null,
      locationSlug: locationSlug.get(r.locationId) ?? null,
      stashSeed: normalizeSeed(r.stashSeed),
      retired: Boolean(r.retiredAt),
    };
  }
  for (const s of sides) {
    const room = roomSlug.get(s.roomId);
    const location = locationSlug.get(s.locationId);
    if (!room || !location) continue; // a quest room's side
    const key = sideKey(room, location);
    rows.sides[key] = s;
    model.sides[key] = { kind: s.kind, accessTagSlugs: slugSet(s.accessTagSlugs), sortOrder: s.sortOrder };
  }
  for (const k of links) {
    const a = locationSlug.get(k.aId);
    const b = locationSlug.get(k.bId);
    if (!a || !b) continue;
    const key = pairKey(a, b);
    rows.links[key] = k;
    model.links[key] = {
      announce: k.announce,
      requiredTagSlug: k.requiredTagSlug ?? null,
      hidden: k.hidden,
      modular: k.modular,
      authoredOpen: k.authoredOpen,
      keyed: k.keyed,
      onFoot: k.onFoot,
      tightSqueeze: k.tightSqueeze,
    };
  }
  return { model, rows };
}

// The Location attributes a structure can give its ground (`buildable` in
// db/lib/locationAttributes.js: a Noticeboard's board, a Field Kitchen's
// kitchen). While a game runs they belong to the game, because building or
// destroying the structure is what set them (db/lib/structureGrants.js), so
// a sync on a game in progress leaves them as they stand. Before play the
// YAML wins on them like everything else; the wipe has taken the structures
// down by then, and the world seed raises the authored ones after.
const BUILT_ATTRIBUTE_KEYS = Object.keys(ATTRIBUTES).filter((key) => ATTRIBUTES[key].buildable);

function keepBuiltAttributes(yamlAttributes, dbAttributes) {
  const out = { ...(yamlAttributes ?? {}) };
  for (const key of BUILT_ATTRIBUTE_KEYS) {
    if (dbAttributes && Object.hasOwn(dbAttributes, key)) out[key] = dbAttributes[key];
    else delete out[key];
  }
  return out;
}

// What to do, decided from two models: `yaml` and `db`, both as they are now.
// Pure, so the rule at the top of this file is testable without a database.
// `keepBuilt` is a sync on a game in progress (see BUILT_ATTRIBUTE_KEYS).
function planZonesSync(yamlM, dbM, { keepBuilt = false } = {}) {
  const plan = { creates: [], updates: [], retires: [], deletes: [], reportOnly: [] };
  for (const kind of KINDS) {
    const y = yamlM[kind] ?? {};
    const d = dbM[kind] ?? {};
    for (const key of new Set([...Object.keys(y), ...Object.keys(d)])) {
      const yv = y[key];
      const dv = d[key];
      if (yv && !dv) {
        plan.creates.push({ kind, key });
        continue;
      }
      if (!yv && dv) {
        if (dv.retired) continue;
        (RETIRABLE[kind] ? plan.retires : plan.deletes).push({ kind, key });
        continue;
      }
      if (dv.retired) plan.updates.push({ kind, key, field: "retired", from: true, to: false });
      const want =
        kind === "locations" && keepBuilt ? { ...yv, attributes: keepBuiltAttributes(yv.attributes, dv.attributes) } : yv;
      for (const field of FIELDS[kind]) {
        if (!same(want[field], dv[field])) plan.updates.push({ kind, key, field, from: dv[field], to: want[field] });
      }
    }
  }
  return plan;
}

function groupUpdates(updates) {
  const byRow = new Map();
  for (const u of updates) {
    const id = `${u.kind}:${u.key}`;
    if (!byRow.has(id)) byRow.set(id, { kind: u.kind, key: u.key, fields: {} });
    byRow.get(id).fields[u.field] = u.to;
  }
  return [...byRow.values()];
}

const jsonOrNull = (v) => (v == null ? Prisma.DbNull : v);

// Writes one plan against the database. `rows` is dbModel's, read AFTER the
// importer ran, so every row the plan names has an id.
async function applyPlan(prisma, plan, rows, yamlM, report, { beforePlay = false } = {}) {
  const mirror = new Map();
  const touch = (type, id, reason) => id && mirror.set(`${type}:${id}`, { type, id, reason });
  const zoneId = (slug) => rows.zones[slug]?.id ?? null;
  const locationId = (slug) => rows.locations[slug]?.id ?? null;
  const moved = [];
  const repour = [];

  for (const { kind, key, fields } of groupUpdates(plan.updates)) {
    const row = rows[kind][key];
    if (!row) {
      report.warnings.push(`${kind} ${key}: no row to update`);
      continue;
    }
    const data = {};
    for (const [field, to] of Object.entries(fields)) {
      if (field === "retired") data.retiredAt = null;
      else if (field === "parentSlug") {
        const parentId = to ? zoneId(to) : null;
        if (to && !parentId) {
          report.warnings.push(`zone ${key}: parent "${to}" does not exist`);
          continue;
        }
        data.parentZoneId = parentId;
        data.seatZoneId = parentId ?? row.id;
      } else if (field === "zoneSlug") {
        const id = zoneId(to);
        if (!id) {
          report.warnings.push(`location ${key}: zone "${to}" does not exist`);
          continue;
        }
        data.zoneId = id;
        moved.push({ locationId: row.id, fromZoneId: row.zoneId, toZoneId: id });
      } else if (field === "locationSlug") {
        const id = locationId(to);
        if (!id) {
          report.warnings.push(`room ${key}: location "${to}" does not exist`);
          continue;
        }
        data.locationId = id;
        touch("location", row.locationId, "a room moved away (docs/zones.yaml)");
        touch("location", id, "a room moved here (docs/zones.yaml)");
      } else if (field === "mining") {
        // Its own row. A game that has not started has nothing drifted to
        // keep, so the current rate starts from the new base.
        if (to == null) await prisma.locationMining.deleteMany({ where: { locationId: row.id } });
        else
          await prisma.locationMining.upsert({
            where: { locationId: row.id },
            create: { locationId: row.id, base: to, current: to },
            update: beforePlay ? { base: to, current: to, eventTarget: null, eventUntilTurn: null } : { base: to },
          });
      } else if (field === "mapPolygon" || field === "stashSeed") {
        data[field] = jsonOrNull(to);
        if (field === "stashSeed" && beforePlay) repour.push({ id: row.id, slug: key });
      } else if (field === "authoredOpen") {
        data.authoredOpen = to;
        if (beforePlay) {
          data.isOpen = to;
          data.openUntil = null;
        }
      } else {
        data[field] = to;
      }
    }
    if (Object.keys(data).length > 0) {
      const model = { zones: "zone", locations: "location", rooms: "room", sides: "roomSide", links: "locationLink" }[kind];
      await prisma[model].update({ where: { id: row.id }, data });
    }
    if (RETIRABLE[kind]) touch(RETIRABLE[kind], row.id, "synced from docs/zones.yaml");
    if (kind === "sides") {
      touch("room", row.roomId, "a side changed (docs/zones.yaml)");
      touch("location", row.locationId, "a side changed (docs/zones.yaml)");
    }
    if (kind === "links") {
      touch("location", row.aId, "a way changed (docs/zones.yaml)");
      touch("location", row.bId, "a way changed (docs/zones.yaml)");
    }
  }

  // Character.zoneId is a denormalized copy of location.zoneId (MAP.md §1).
  // Nobody should be standing anywhere at either call site, but a lobby that
  // was never wiped can still hold a living character, so do what the place
  // editor does when it moves a location.
  if (moved.length > 0) {
    const { rehomeStandingCharacters } = require("./locationMove");
    for (const m of moved) {
      await prisma.character.updateMany({ where: { locationId: m.locationId }, data: { zoneId: m.toZoneId } });
      const [from, to] = [m.fromZoneId, m.toZoneId].map((id) => Object.values(rows.zones).find((z) => z.id === id));
      await rehomeStandingCharacters(prisma, {
        locationId: m.locationId,
        fromRoleId: from?.discordRoleId ?? null,
        toRoleId: to?.discordRoleId ?? null,
      });
    }
  }

  // Rooms whose seed changed, before anybody played: empty them and forget
  // what was poured, so the world seed that follows pours the new seed. The
  // wipe already emptied every room, so at Restart Game this finds nothing to
  // delete; at Start Game it takes back what the restart poured from the old
  // seed (roomStashSeed.js — seededStashSlugs is the guard being reset).
  for (const room of repour) {
    await prisma.$transaction([
      prisma.roomTag.deleteMany({ where: { roomId: room.id } }),
      prisma.room.update({ where: { id: room.id }, data: { seededStashSlugs: [] } }),
    ]);
    report.repoured.push(room.slug);
  }

  // Sides the YAML adds to a room that already existed. A new room's sides
  // were made by the importer with the room.
  for (const { kind, key } of plan.creates) {
    if (kind !== "sides") {
      report.warnings.push(`${kind} ${key}: still missing after the import`);
      continue;
    }
    const [roomSlug, sideLocationSlug] = key.split("|");
    const room = rows.rooms[roomSlug];
    const location = rows.locations[sideLocationSlug];
    if (!room || !location) {
      report.warnings.push(`side ${key}: room or location missing`);
      continue;
    }
    const side = yamlM.sides[key];
    await prisma.roomSide.create({
      data: { roomId: room.id, locationId: location.id, kind: side.kind, accessTagSlugs: slugSet(side.accessTagSlugs), sortOrder: side.sortOrder },
    });
    touch("room", room.id, "a side opened (docs/zones.yaml)");
    touch("location", location.id, "a room opens onto here (docs/zones.yaml)");
  }

  // Retires, innermost first, through the place editor's own rule — which
  // refuses a place a living character is standing in.
  for (const kind of ["rooms", "locations", "zones"]) {
    for (const r of plan.retires.filter((x) => x.kind === kind)) {
      const row = rows[kind][r.key];
      const out = await placeDeletable.retirePlace(prisma, RETIRABLE[kind], row.id);
      if (!out.ok) {
        report.reportOnly.push({ kind, key: r.key, reason: `dropped from zones.yaml but not retired: ${out.error}` });
        continue;
      }
      report.retired.push(`${kind}/${r.key}`);
      touch(RETIRABLE[kind], row.id, "retired: dropped from docs/zones.yaml");
    }
  }

  for (const r of plan.deletes) {
    const row = rows[r.kind][r.key];
    if (r.kind === "sides") {
      await placeDeletable.removeRoomSide(prisma, row);
      touch("room", row.roomId, "a side closed (docs/zones.yaml)");
      touch("location", row.locationId, "a room no longer opens onto here (docs/zones.yaml)");
    } else {
      await prisma.locationLink.delete({ where: { id: row.id } });
      touch("location", row.aId, "a way closed (docs/zones.yaml)");
      touch("location", row.bId, "a way closed (docs/zones.yaml)");
    }
    report.deleted.push(`${r.kind}/${r.key}`);
  }

  for (const { type, id, reason } of mirror.values()) {
    await enqueueMirror(prisma, type, id, reason);
  }
}

// One line per changed row, for a person: "rooms/undertown-8-1: stashSeed".
function changeLines(updates) {
  return groupUpdates(updates).map((r) => `${r.kind}/${r.key}: ${Object.keys(r.fields).join(", ")}`);
}

// Makes the places match docs/zones.yaml under the rule at the top of this
// file. `doc` is an already-loaded YAML document (a test fixture); otherwise
// the file is read. Throws on a YAML that does not parse, before any write.
async function syncZonesFromYaml(prisma, { apply = false, doc = null, beforePlay = false, actorDiscordUserId = "system" } = {}) {
  const source = doc ?? readZonesYaml();
  const yamlM = yamlModel(parseZonesYaml(source));

  const before = await dbModel(prisma);
  const keepBuilt = !beforePlay;
  const plan = planZonesSync(yamlM, before.model, { keepBuilt });
  const imported = await importZonesFromYaml(prisma, { apply, doc: source });

  const report = {
    apply,
    created: imported.created,
    changes: changeLines(plan.updates),
    sidesToAdd: plan.creates.filter((c) => c.kind === "sides").map((c) => c.key),
    retired: [],
    deleted: [],
    repoured: [],
    reportOnly: [],
    warnings: [...imported.warnings],
  };
  if (!apply) {
    report.retired = plan.retires.map((r) => `${r.kind}/${r.key}`);
    report.deleted = plan.deletes.map((r) => `${r.kind}/${r.key}`);
    return report;
  }

  // The importer may have made rows the plan needs ids for; plan again against
  // what is there now. Anything it created now matches the YAML, so this adds
  // no work — it only finds the new ids and drops the creates it handled.
  const after = await dbModel(prisma);
  const final = planZonesSync(yamlM, after.model, { keepBuilt });
  await applyPlan(prisma, final, after.rows, yamlM, report, { beforePlay });

  const createdCount = Object.values(imported.created).reduce((n, list) => n + list.length, 0);
  const wrote = createdCount + final.updates.length + final.creates.length + report.retired.length + report.deleted.length;
  if (wrote > 0) {
    await prisma.auditLog.create({
      data: {
        actorDiscordUserId,
        actionType: "zones_synced_from_yaml",
        details: {
          created: imported.created,
          changes: report.changes.slice(0, 200),
          retired: report.retired,
          deleted: report.deleted,
          repoured: report.repoured,
          reportOnly: report.reportOnly.slice(0, 100).map((r) => `${r.kind}/${r.key}: ${r.reason}`),
        },
      },
    });
  }
  return report;
}

// The handful of numbers a wipe report or Start Game result carries.
function summarizeZonesSync(report) {
  const created = Object.values(report.created ?? {}).reduce((n, list) => n + list.length, 0);
  return {
    created,
    changed: report.changes.length,
    retired: report.retired.length,
    deleted: report.deleted.length,
    repoured: report.repoured.length,
    ...(report.reportOnly.length > 0 ? { reportOnly: report.reportOnly.map((r) => `${r.kind}/${r.key}`) } : {}),
    ...(report.warnings.length > 0 ? { warnings: report.warnings } : {}),
  };
}

module.exports = {
  syncZonesFromYaml,
  summarizeZonesSync,
  planZonesSync,
  yamlModel,
  normalizeSeed,
  canonical,
};
