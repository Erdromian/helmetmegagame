#!/usr/bin/env node
// Look a figure up in the YAML masters, one line an entry.
//
//   npm run catalog -- tags pickaxe "Ration Box"          # by slug or name, any case
//   npm run catalog -- roles esculap --fields name,starting_tags
//   npm run catalog -- locations --grep surgical            # any field containing the text
//   npm run catalog -- rooms factory-logistics-room --json
//   npm run catalog -- tags --all --grep cureRung
//
// Kinds: tags, roles, zones, locations, rooms, desires. With no slug and no --grep, --all lists every entry.
// Read-only, and on purpose it requires nothing but js-yaml and fs, so it runs anywhere the repo is checked out.

const fs = require("fs");
const yaml = require("js-yaml");

const DOCS = `${__dirname}/../../../docs`;
const load = (file) => yaml.load(fs.readFileSync(`${DOCS}/${file}`, "utf8"));
// A YAML master's map keyed by slug, as a list of entries with the slug on each.
const entries = (node) => (Array.isArray(node) ? node : Object.entries(node ?? {}).map(([slug, v]) => ({ slug, ...(v ?? {}) })));

const DEFAULTS = {
  tags: ["name", "category", "group", "pointCost", "depotPrice", "sellablePrice", "manifest", "weight", "cooked", "requirement.skills", "requirement.resourceCost", "requirement.turnsCost", "cureRung", "expiresInto", "fighting", "equipSlot", "carryBonus", "catalog", "purchasable"],
  roles: ["name", "group", "weight", "bank_account", "starting_account", "extra_starting_points", "whitelist", "multiple", "starting_tags"],
  zones: ["name", "kind", "levels"],
  locations: ["zone", "name", "mining", "indoors", "attributes", "structures", "stash"],
  rooms: ["zone", "location", "name", "access", "stash"],
  desires: ["name", "tier", "cooldownTurns", "oncePerLife", "requires", "verify"],
};

function collect(kind) {
  if (kind === "tags") return entries(load("tags.yaml").tags);
  if (kind === "desires") return entries(load("desires.yaml").desires);
  if (kind === "roles") {
    const doc = load("roles.yaml");
    return Object.entries(doc.groups ?? {}).flatMap(([group, roles]) => entries(roles).map((r) => ({ group, ...r })));
  }
  const zones = load("zones.yaml").zones ?? {};
  if (kind === "zones") return entries(zones).map((z) => ({ ...z, levels: z.levels ? Object.keys(z.levels) : undefined, locations: undefined }));
  const out = [];
  const walk = (zone, locations) => {
    for (const loc of entries(locations)) {
      if (kind === "locations") out.push({ ...loc, zone, rooms: undefined });
      else for (const room of entries(loc.rooms)) out.push({ ...room, zone, location: loc.slug });
    }
  };
  for (const [zk, zv] of Object.entries(zones)) {
    walk(zk, zv.locations);
    for (const [lk, lv] of Object.entries(zv.levels ?? {})) walk(lk, lv.locations);
  }
  if (kind === "locations" || kind === "rooms") return out;
  throw new Error(`catalog: unknown kind "${kind}" (tags, roles, zones, locations, rooms, desires)`);
}

const get = (obj, dotted) => dotted.split(".").reduce((v, k) => (v == null ? undefined : v[k]), obj);
const compact = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

function main(argv) {
  const [kind, ...rest] = argv;
  if (!kind) {
    console.log("usage: npm run catalog -- <tags|roles|zones|locations|rooms|desires> [slug or name...] [--fields a,b] [--grep text] [--all] [--json]");
    return;
  }
  const opt = (name) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : null;
  };
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const valued = new Set(["--fields", "--grep"].filter((f) => rest.includes(f)).map((f) => rest[rest.indexOf(f) + 1]));
  const wanted = rest.filter((a) => !a.startsWith("--") && !valued.has(a)).map((a) => a.toLowerCase());
  const fields = (opt("fields") ?? "").split(",").filter(Boolean);
  const grep = opt("grep")?.toLowerCase() ?? null;
  const cols = fields.length ? fields : DEFAULTS[kind];
  let rows = collect(kind);
  if (wanted.length) rows = rows.filter((r) => wanted.includes(String(r.slug).toLowerCase()) || wanted.includes(String(r.name ?? "").toLowerCase()));
  if (grep) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(grep));
  if (!wanted.length && !grep && !flags.has("--all")) {
    console.log(`${rows.length} ${kind}; name one, or pass --grep or --all`);
    return;
  }
  if (flags.has("--json")) {
    console.log(JSON.stringify(rows.map((r) => Object.fromEntries([["slug", r.slug], ...cols.map((c) => [c, get(r, c)])])), null, 2));
    return;
  }
  for (const r of rows) console.log([r.slug, ...cols.map((c) => { const v = get(r, c); return v === undefined ? null : `${c}=${compact(v)}`; }).filter(Boolean)].join("  "));
  if (!rows.length) console.log(`no ${kind} match`);
}

main(process.argv.slice(2));
