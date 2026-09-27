#!/usr/bin/env node
// What the sound library holds, what the app does with it, and where those two disagree.
//
//   node scripts/audio/sound-report.mjs                 the whole picture
//   node scripts/audio/sound-report.mjs --find "cave"   what have I got for a cave-in
//   node scripts/audio/sound-report.mjs --class atop     everything of one class
//   node scripts/audio/sound-report.mjs --free          only what is not wired yet
//
// Always exits 0. The hard rules — a served path with no file, a played sound the document
// marks Unused — are db/test/sounds.test.js's job. What is here is judgement: whether a
// file is wired at the surface its use case asks for. See docs/systemdocs/SOUND.md §7.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

const REGISTRY = yaml.load(read("docs", "sounds.yaml"));
const SOUNDS = REGISTRY.sounds;

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const FIND = opt("--find");
const ONLY_CLASS = opt("--class");
const FREE_ONLY = argv.includes("--free");

// --------------------------------------------------------------------------- the wiring

const COMPONENTS = ["web", "app", "components"];
const oggIn = (...p) => [...read(...p).matchAll(/"([A-Za-z0-9_.@-]+\.ogg)"/g)].map((m) => m[1].toLowerCase());
const base = (src) => src.slice(src.lastIndexOf("/") + 1).toLowerCase();

const { ALL_PLACES: PLACES } = await import("../../web/app/components/placeAmbience.js");

/** Which surface plays each served file, by basename. A file may have more than one. */
function wiring() {
  const at = new Map();
  const note = (name, surface) => {
    if (!at.has(name)) at.set(name, new Set());
    at.get(name).add(surface);
  };

  // placeAmbience.js is IMPORTED rather than scanned, because a bed and a spot are both
  // `once()`/`loop()` calls and only their position in `place()` tells them apart. It
  // imports nothing, so this is safe from plain Node.
  for (const p of PLACES) {
    for (const item of p.pieces ?? []) note(base(item.src), "place bed");
    for (const item of p.spots ?? []) note(base(item.src), "place spot");
  }

  // The lobby's pool lives in two module-level consts rather than inside the tape.
  const program = read(...COMPONENTS, "musicProgram.js");
  const lobbyList = /const LOBBY_TRACKS = \[([\s\S]*?)\];/.exec(program);
  if (lobbyList) for (const f of lobbyList[1].matchAll(/"([^"]+)"/g)) note(f[1].toLowerCase(), "lobby tape");
  const rare = /const RARE_TRACK = "([^"]+)"/.exec(program);
  if (rare) note(rare[1].toLowerCase(), "lobby tape");

  // The closed door's own tape, and the wind pool it draws from.
  const closed = /closed: \{([\s\S]*?)\n  \},/.exec(program);
  if (closed) for (const f of closed[1].matchAll(/"([A-Za-z0-9_.@-]+\.ogg)"/g)) note(f[1].toLowerCase(), "closed tape");
  const winds = /const WINDS = \[([\s\S]*?)\];/.exec(program);
  if (winds) for (const f of winds[1].matchAll(/"([^"]+)"/g)) note(f[1].toLowerCase(), "closed tape");

  const sfx = /const CUES = \{([\s\S]*?)\n\};/.exec(read(...COMPONENTS, "sfx.js"));
  if (sfx) {
    for (const line of sfx[1].split("\n")) {
      if (/^\s*\/\//.test(line)) continue;
      const after = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line;
      for (const m of after.matchAll(/"([^"]+)"/g)) {
        note((m[1].includes(".") ? m[1] : `${m[1]}.ogg`).toLowerCase(), "sfx cue");
      }
    }
  }

  for (const m of read("db", "lib", "instrumentSongs.js").matchAll(/src: "\/assets\/([^"]+)"/g)) {
    note(m[1].slice(m[1].lastIndexOf("/") + 1).toLowerCase(), "instrument");
  }
  return at;
}

// What surface each class belongs at. The closed door's wind is the one place a spot is
// allowed to be the bed: behind a shut door there is nothing for it to sit on top of.
const WANTS = {
  ambience: ["place bed", "closed tape"],
  atop: ["place spot", "closed tape"],
  lobby: ["lobby tape"],
  cue: ["sfx cue"],
  instrument: ["instrument"],
  // An interrupter is played by musicConductor.js#interrupt out of placeAmbience.js, whose
  // INTERRUPTS sit in ALL_PLACES beside the beds.
  interrupt: ["place bed"],
  // The Den's jukebox would be the `room` layer (SOUND.md §3); nothing plays it yet.
  jukebox: [],
  unused: [],
};

const WIRED = wiring();
const entries = Object.entries(SOUNDS).map(([id, e]) => {
  const base = e.served ? e.served.slice(e.served.lastIndexOf("/") + 1).toLowerCase() : null;
  return { id, ...e, base, surfaces: base ? [...(WIRED.get(base) ?? [])] : [] };
});

// --------------------------------------------------------------------------- output

const pad = (s, n) => String(s).padEnd(n);
const h = (s) => `\n${s}\n${"-".repeat(s.length)}`;

if (FIND) {
  const q = FIND.toLowerCase();
  const hits = entries.filter((e) => e.use.toLowerCase().includes(q) || e.id.toLowerCase().includes(q));
  console.log(h(`${hits.length} sound(s) matching "${FIND}"`));
  for (const e of hits) {
    console.log(`  ${pad(e.id, 40)} ${pad(e.class, 11)} ${e.surfaces.length ? "wired" : "free "}  ${e.use}`);
  }
  process.exit(0);
}

if (ONLY_CLASS || FREE_ONLY) {
  let list = entries;
  if (ONLY_CLASS) list = list.filter((e) => e.class === ONLY_CLASS);
  if (FREE_ONLY) list = list.filter((e) => e.surfaces.length === 0);
  console.log(h(`${list.length} sound(s)`));
  for (const e of list) console.log(`  ${pad(e.id, 40)} ${pad(e.class, 11)} ${e.use}`);
  process.exit(0);
}

console.log(h("The library"));
const byClass = {};
for (const e of entries) {
  byClass[e.class] ??= { total: 0, wired: 0 };
  byClass[e.class].total++;
  if (e.surfaces.length) byClass[e.class].wired++;
}
console.log(`  ${pad("class", 12)}${pad("described", 11)}${pad("wired", 7)}rule`);
for (const [c, n] of Object.entries(byClass).sort((a, b) => b[1].total - a[1].total)) {
  const rule = (REGISTRY.rules[c] ?? "").split(/(?<=\.)\s/)[0];
  console.log(`  ${pad(c, 12)}${pad(n.total, 11)}${pad(n.wired, 7)}${rule.slice(0, 58)}`);
}

// The one thing the document states as a prohibition rather than a placement.
const playedUnused = entries.filter((e) => e.class === "unused" && e.surfaces.length);
if (playedUnused.length) {
  console.log(h(`${playedUnused.length} sound(s) the document marks Unused, still played`));
  for (const e of playedUnused) console.log(`  ${pad(e.id, 40)} ${e.surfaces.join(", ")}`);
}

const misplaced = entries.filter(
  (e) => e.surfaces.length && e.class !== "unused" && !e.surfaces.some((s) => WANTS[e.class].includes(s)),
);
if (misplaced.length) {
  console.log(h(`${misplaced.length} sound(s) wired somewhere their use case does not ask for`));
  for (const e of misplaced) {
    console.log(`  ${pad(e.id, 40)} ${pad(e.class, 11)}${pad(e.surfaces.join(", "), 20)} ${e.use}`);
  }
}

const needs = entries.filter((e) => e.needs);
if (needs.length) {
  console.log(h(`${needs.length} use case(s) waiting on something the selector cannot ask yet`));
  const grouped = {};
  for (const e of needs) (grouped[e.needs] ??= []).push(e);
  for (const [need, list] of Object.entries(grouped)) {
    console.log(`  ${need}:`);
    for (const e of list) console.log(`    ${pad(e.id, 38)} ${e.use}`);
  }
}

const freeByGroup = {};
for (const e of entries) {
  if (e.surfaces.length || e.class === "unused") continue;
  const g = e.id.slice(0, e.id.lastIndexOf("/"));
  freeByGroup[g] = (freeByGroup[g] ?? 0) + 1;
}
console.log(h("Described, not yet in the app"));
for (const [g, n] of Object.entries(freeByGroup).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pad(g, 24)}${n}`);
}
console.log(`\n  --find "<text>" searches these by use case; --free --class <c> lists them.`);
