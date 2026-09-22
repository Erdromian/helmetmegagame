// docs/sounds.yaml against the files on disk and the files the app actually names.
//
// The registry is a projection of Bascinet's "Music and Sounds" document, and the point of
// it is that a sound gets wired for the reason the document gives. That only holds if the
// two agree, so this is what notices when they stop.
//
// Reading source files with a regex rather than importing them is deliberate and already
// the convention here — db/test/instrumentSongs.test.js reads musicGain.js the same way.
// web/app/components/* is ESM with JSX in the same tree and cannot be required from a
// CommonJS test, and the thing under test is which filenames appear, not what they do.
//
// What this file does NOT assert is whether a file is wired at the surface its class calls
// for. That is a judgement about the game rather than a fact about the repo, and it lives
// in scripts/audio/sound-report.mjs.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const ROOT = path.join(__dirname, "..", "..");
const REGISTRY = yaml.load(fs.readFileSync(path.join(ROOT, "docs", "sounds.yaml"), "utf8"));
const SOUNDS = REGISTRY.sounds;

const CLASSES = ["ambience", "atop", "cue", "lobby", "instrument", "unused"];

/** Every audio file under a directory, as `subfolder/basename`, lowercased. */
function audioUnder(dir) {
  const out = new Set();
  const walk = (at, prefix) => {
    for (const e of fs.readdirSync(at, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(at, e.name), prefix ? `${prefix}/${e.name}` : e.name);
      else if (/\.(ogg|wav)$/i.test(e.name)) out.add(`${prefix}/${e.name}`.toLowerCase());
    }
  };
  walk(dir, "");
  return out;
}

const LIBRARY = audioUnder(path.join(ROOT, "assets", "osw-sounds"));
const SERVED = audioUnder(path.join(ROOT, "web", "public", "assets"));

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

// The registry describes assets/osw-sounds/ and nothing else, because that is what the
// document describes. A served file with no master of that name in the library came from
// somewhere else and is out of scope — `sfx/cathedral-bell.ogg` is from BigSoundBank, and
// web/public/assets/sfx/ATTRIBUTION.md says so. Derived rather than an allowlist, so the
// next sound bought in from outside needs no edit here, while anything that IS from the
// library is still held to the registry.
const LIBRARY_NAMES = new Set([...LIBRARY].map((f) => f.slice(f.lastIndexOf("/") + 1)));
const fromLibrary = (served) => LIBRARY_NAMES.has(served.slice(served.lastIndexOf("/") + 1));

/** Every served path the registry knows, lowercased, for joining code against. */
const servedInRegistry = new Map();
// And the same by BASENAME. One master can be promoted into two folders and do two jobs —
// `loop_altar.ogg` is the Thanati rite's drone in sfx/ and the underfort's bed in ambience/ —
// and `served` records one path, so a name is what joins code back to the master.
const servedByName = new Map();
for (const [id, entry] of Object.entries(SOUNDS)) {
  if (!entry.served) continue;
  const served = entry.served.toLowerCase();
  servedInRegistry.set(served, id);
  servedByName.set(served.slice(served.lastIndexOf("/") + 1), id);
}

// --------------------------------------------------------------------------- the registry

test("every entry has a use case and one of the document's six classes", () => {
  assert.ok(Object.keys(SOUNDS).length > 700, "the registry looks truncated");
  for (const [id, entry] of Object.entries(SOUNDS)) {
    assert.ok(entry.use, `${id} has no use case`);
    assert.ok(CLASSES.includes(entry.class), `${id} has class ${entry.class}`);
  }
});

test("the document's rules are all carried across", () => {
  for (const c of CLASSES) assert.ok(REGISTRY.rules[c], `no rule recorded for ${c}`);
});

test("every entry names a file in assets/osw-sounds/", () => {
  const missing = Object.keys(SOUNDS).filter((id) => !LIBRARY.has(id.toLowerCase()));
  assert.deepEqual(missing, [], "registry entries with no file in the library");
});

test("every served path names a file in web/public/assets/", () => {
  const missing = [];
  for (const [id, entry] of Object.entries(SOUNDS)) {
    if (entry.served && !SERVED.has(entry.served.toLowerCase())) missing.push(`${id} -> ${entry.served}`);
  }
  assert.deepEqual(missing, [], "served paths with no file behind them");
});

// --------------------------------------------------------------------------- the code

/**
 * The filenames sfx.js can actually play: the VALUES in CUES, never its keys, which are
 * the game's own vocabulary and name no file. Values are taken from after the first colon
 * on a line, so both `success: "chime"` and a pool spread over several lines are caught.
 */
function sfxFiles() {
  const src = read("web", "app", "components", "sfx.js");
  const block = /const CUES = \{([\s\S]*?)\n\};/.exec(src);
  assert.ok(block, "could not find CUES in sfx.js");
  const files = new Set();
  for (const line of block[1].split("\n")) {
    if (/^\s*\/\//.test(line)) continue;
    const after = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line;
    for (const m of after.matchAll(/"([^"]+)"/g)) {
      files.add(`sfx/${m[1].includes(".") ? m[1] : `${m[1]}.ogg`}`.toLowerCase());
    }
  }
  return files;
}

/** Bare `*.ogg` literals, which is how the music side names a file. */
function oggLiterals(...file) {
  return [...read(...file).matchAll(/"([A-Za-z0-9_.@-]+\.ogg)"/g)].map((m) => m[1]);
}

test("every cue file sfx.js can play is in the registry", () => {
  const unknown = [...sfxFiles()].filter(
    (f) => fromLibrary(f) && !servedByName.has(f.slice(f.lastIndexOf("/") + 1)),
  );
  assert.deepEqual(unknown, [], "sfx.js names library files the registry does not describe");
});

test("every music and ambience file the app names is in the registry", () => {
  // musicGain.js is keyed on the bare basename and covers music/, ambience/ and
  // instruments/ together, so a name is looked up wherever the registry serves it.
  const unknown = [];
  for (const where of [
    ["web", "app", "components", "musicGain.js"],
    ["web", "app", "components", "musicProgram.js"],
    ["web", "app", "components", "musicConductor.js"],
    ["web", "app", "components", "placeAmbience.js"],
  ]) {
    for (const name of oggLiterals(...where)) {
      const base = name.toLowerCase();
      if (LIBRARY_NAMES.has(base) && !servedByName.has(base)) unknown.push(`${where[where.length - 1]}: ${name}`);
    }
  }
  assert.deepEqual(unknown, [], "the app names files the registry does not describe");
});

test("every instrument song is in the registry, and is an instrument", () => {
  const src = read("db", "lib", "instrumentSongs.js");
  const bad = [];
  for (const m of src.matchAll(/src: "(\/assets\/[^"]+)"/g)) {
    const served = m[1].replace(/^\/assets\//, "").toLowerCase();
    const id = servedInRegistry.get(served);
    if (!id) {
      bad.push(`${m[1]} is not in the registry`);
      continue;
    }
    const cls = SOUNDS[id].class;
    if (cls !== "instrument") bad.push(`${m[1]} is class ${cls}`);
  }
  assert.deepEqual(bad, [], "instrument catalog disagrees with the registry");
});

test("nothing the app plays is a file the document marks Unused", () => {
  const played = new Set();
  for (const f of sfxFiles()) played.add(f);
  for (const where of [
    ["web", "app", "components", "musicProgram.js"],
    ["web", "app", "components", "musicConductor.js"],
    ["web", "app", "components", "placeAmbience.js"],
  ]) {
    for (const name of oggLiterals(...where)) played.add(name.toLowerCase());
  }

  const unused = [];
  for (const [id, entry] of Object.entries(SOUNDS)) {
    if (entry.class !== "unused" || !entry.served) continue;
    const served = entry.served.toLowerCase();
    const base = served.slice(served.lastIndexOf("/") + 1);
    if (played.has(served) || played.has(base)) unused.push(`${id} — "${entry.use}" — played via ${entry.served}`);
  }
  assert.deepEqual(unused, [], "the app plays sounds the document says not to select");
});
