#!/usr/bin/env node
// Bascinet's two "Music and Sounds" design documents -> docs/sounds.yaml.
//
// The documents are the source of truth and they are hand-written. This script only ever
// projects them into the repo: `use` and `class` are rewritten from the .docx files on every
// run, so the registry can never quietly disagree with the documents it claims to describe.
// The two fields the repo owns — `served` and `needs` — are carried forward, the way
// scripts/copy/extract.js carries a `new:` field forward.
//
// TWO DOCUMENTS. The first, now "Music and Sounds(OLD).docx", describes the OpenSourceWeb
// library a row per file. The second, "New Music and Sounds.docx", describes the tracks
// Bascinet picked (scripts/audio/import-bascinet-sounds.mjs) and sets placement rules for
// every file, old and new. Where both describe one file, the NEW document wins.
//
// DRY RUN unless given --apply, same as db:import-zones.
//
//   node scripts/audio/import-sound-doc.mjs [--apply] [--doc "<old .docx>"] [--new-doc "<new .docx>"]
//
// It never repairs one of Bascinet's filenames on its own. A row naming a file that is
// not in assets/osw-sounds/ is reported with its closest match and left out, because a
// registry keyed on a guess is worse than one with a hole in it.
//
// No dependencies: a .docx is a zip, and node:zlib can inflate it. `unzip` is not on
// every machine this runs on.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIBRARY = path.join(ROOT, "assets", "osw-sounds");
const OUT = path.join(ROOT, "docs", "sounds.yaml");
const SOURCES = path.join(LIBRARY, "bascinet-sources.json");
const DEFAULT_DOC = "E:\\Bascinet\\V3\\Sounds\\Music and Sounds(OLD).docx";
const DEFAULT_NEW_DOC = "E:\\Bascinet\\V3\\Sounds\\New Music and Sounds.docx";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const docArg = argv.indexOf("--doc");
const DOC = docArg === -1 ? DEFAULT_DOC : argv[docArg + 1];
const newDocArg = argv.indexOf("--new-doc");
const NEW_DOC = newDocArg === -1 ? DEFAULT_NEW_DOC : argv[newDocArg + 1];

// --------------------------------------------------------------------------- the zip

/** The one entry we want out of the .docx, inflated. */
function readZipEntry(file, wanted) {
  const buf = fs.readFileSync(file);

  // End of central directory, scanned backwards: the comment field means it is not at a
  // fixed offset.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error(`${file} is not a zip archive`);

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const local = buf.readUInt32LE(p + 42);
      if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("bad local header");
      const method = buf.readUInt16LE(local + 8);
      const size = buf.readUInt32LE(p + 20);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + size);
      return method === 0 ? raw : zlib.inflateRawSync(raw);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${wanted} not found in ${file}`);
}

// --------------------------------------------------------------------------- the xml

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body) => {
    if (body[0] === "#")
      return String.fromCodePoint(
        body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10),
      );
    return ENTITIES[body] ?? whole;
  });
}

/**
 * Walk the document body once, depth-aware, and return its blocks in order: either
 * `{ paragraph }` for prose outside a table, or `{ rows }` for a table. WordprocessingML
 * nests (a cell holds paragraphs, and may hold another table), so this counts depth
 * rather than pattern-matching pairs.
 */
function blocksOf(xml) {
  const re = /<w:(tbl|tr|tc|p|t|tab|br)\b([^>]*)>|<\/w:(tbl|tr|tc|p|t)>|<w:(tab|br)\/>/g;
  const blocks = [];
  let tblDepth = 0;
  let rows = null;
  let row = null;
  let cell = null;
  let para = null;
  let inText = false;
  let textAt = 0;
  let m;

  const flushPara = () => {
    if (para === null) return;
    const t = para.replace(/[ \t]+/g, " ").trim();
    if (cell !== null) {
      if (t) cell.push(t);
    } else if (t) {
      blocks.push({ paragraph: t });
    }
    para = null;
  };

  while ((m = re.exec(xml)) !== null) {
    const open = m[1];
    const close = m[3];
    const empty = m[4];
    const selfClosing = open && m[2] !== undefined && m[2].endsWith("/");

    if (inText && (open === "t" || close === "t" || open || close || empty)) {
      // text runs are flat; anything at all ends the run
    }

    if (open === "t" && !selfClosing) {
      inText = true;
      textAt = re.lastIndex;
      continue;
    }
    if (close === "t") {
      if (inText) para = (para ?? "") + decode(xml.slice(textAt, m.index));
      inText = false;
      continue;
    }
    if (empty === "tab" || (open === "tab" && selfClosing)) {
      para = (para ?? "") + " ";
      continue;
    }
    if (empty === "br" || (open === "br" && selfClosing)) {
      para = (para ?? "") + " ";
      continue;
    }

    if (open === "p" && !selfClosing) {
      flushPara();
      para = "";
      continue;
    }
    if (close === "p") {
      flushPara();
      continue;
    }

    if (open === "tbl" && !selfClosing) {
      tblDepth++;
      if (tblDepth === 1) {
        rows = [];
        blocks.push({ rows });
      }
      continue;
    }
    if (close === "tbl") {
      if (tblDepth === 1) rows = null;
      tblDepth = Math.max(0, tblDepth - 1);
      continue;
    }
    if (open === "tr" && !selfClosing) {
      if (tblDepth === 1) {
        row = [];
        rows.push(row);
      }
      continue;
    }
    if (close === "tr") {
      row = null;
      continue;
    }
    if (open === "tc" && !selfClosing) {
      if (tblDepth === 1 && row) {
        cell = [];
        row.push(cell);
      }
      continue;
    }
    if (close === "tc") {
      flushPara();
      cell = null;
      continue;
    }
  }
  flushPara();
  return blocks;
}

// --------------------------------------------------------------------------- the reading

const FOLDER = /^bascinet[\\/]assets[\\/]osw-sounds[\\/](.+)$/i;
const NOTE = /^(Instrument sounds|Boombox sound files)/i;

/** Read the document into `{ rules, groups, rows }`. */
function readDoc(xml) {
  const blocks = blocksOf(xml);
  const rules = [];
  const groups = new Map();
  const rows = [];
  let group = null;
  let pending = [];
  let seenFirstFolder = false;

  for (const block of blocks) {
    if (block.paragraph !== undefined) {
      const t = block.paragraph;
      const folder = FOLDER.exec(t);
      if (folder) {
        group = folder[1].replace(/\\/g, "/");
        if (!groups.has(group)) groups.set(group, { notes: [] });
        for (const n of pending) groups.get(group).notes.push(n);
        pending = [];
        seenFirstFolder = true;
        continue;
      }
      if (NOTE.test(t)) {
        // A note sitting between two tables belongs to the group it introduces.
        pending.push(t);
        continue;
      }
      // Everything before the first folder heading is the document's own rules, minus
      // its title and the table-of-contents line.
      if (!seenFirstFolder && /\s/.test(t) && !/^Music and Sounds$/i.test(t) && !/^Tables of/i.test(t)) {
        rules.push(t);
      }
      continue;
    }

    for (const row of block.rows) {
      const cells = row.map((c) => c.join(" ").replace(/\s+/g, " ").trim());
      if (cells.length === 1) {
        // Most folder headings are a merged row spanning both columns at the top of their
        // own table; a few are an ordinary paragraph before it instead. The document is
        // not consistent about which, so both are read.
        const folder = FOLDER.exec(cells[0]);
        if (folder) {
          group = folder[1].replace(/\\/g, "/");
          if (!groups.has(group)) groups.set(group, { notes: [] });
          for (const n of pending) groups.get(group).notes.push(n);
          pending = [];
          seenFirstFolder = true;
        } else if (NOTE.test(cells[0])) {
          if (group) groups.get(group).notes.push(cells[0]);
          else pending.push(cells[0]);
        }
        continue;
      }
      if (cells.length < 2) continue;
      const [file, use] = cells;
      if (!file || !use) continue;
      if (/^file name$/i.test(file)) continue;
      if (FOLDER.test(file)) continue;
      rows.push({ group, file, use });
    }
  }
  return { rules, groups, rows };
}

// The new document names its folders by where they sit on Bascinet's own disk, and its files
// by the names the downloader gave them. Neither is a library path, so a row is matched on
// the YouTube id in its filename through assets/osw-sounds/bascinet-sources.json.
const NEW_FOLDER = /^E:\\Bascinet\\V3\\Sounds\\([^\\]+)$/i;
const YOUTUBE_ID = /\[([A-Za-z0-9_-]{11})\]/;

/**
 * Read the new document into `{ placement, rows }`. Every paragraph that is not a folder
 * heading is a placement rule — the document has no other kind of prose — and every
 * two-cell row is a file and its use.
 */
function readNewDoc(xml) {
  const placement = [];
  const rows = [];
  let folder = null;
  for (const block of blocksOf(xml)) {
    if (block.paragraph !== undefined) {
      const heading = NEW_FOLDER.exec(block.paragraph);
      if (heading) folder = heading[1];
      else placement.push(block.paragraph);
      continue;
    }
    for (const row of block.rows) {
      const cells = row.map((c) => c.join(" ").replace(/\s+/g, " ").trim()).filter(Boolean);
      if (cells.length === 1) {
        const heading = NEW_FOLDER.exec(cells[0]);
        if (heading) folder = heading[1];
        continue;
      }
      if (cells.length < 2) continue;
      const [file, use] = cells;
      if (/^file name$/i.test(file)) continue;
      rows.push({ folder, file, use, youtube: YOUTUBE_ID.exec(file)?.[1] ?? null });
    }
  }
  return { placement, rows };
}

// --------------------------------------------------------------------------- the library

/** Every audio file actually in assets/osw-sounds/, as `group/basename`. */
function libraryFiles() {
  const out = new Map();
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        walk(path.join(dir, e.name), prefix ? `${prefix}/${e.name}` : e.name);
      } else if (/\.(ogg|wav|mp3)$/i.test(e.name)) {
        // .s3m is left out on purpose: instruments/boombox/clouds.s3m is a tracker module
        // rendered to clouds.ogg once by openmpt123, so the .ogg beside it is the file
        // the document is describing.
        out.set(`${prefix}/${e.name}`.toLowerCase(), `${prefix}/${e.name}`);
      }
    }
  };
  walk(LIBRARY, "");
  return out;
}

/** Every audio file under web/public/assets/, as `folder/basename`. */
function servedFiles() {
  const base = path.join(ROOT, "web", "public", "assets");
  const out = new Map();
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), prefix ? `${prefix}/${e.name}` : e.name);
      else if (/\.(ogg|wav)$/i.test(e.name))
        out.set(`${prefix}/${e.name}`.toLowerCase(), `${prefix}/${e.name}`);
    }
  };
  walk(base, "");
  return out;
}

/**
 * Which library file is served where, read out of scripts/audio/build-assets.sh. That
 * script is the authoritative answer — it holds the renames (white_waking_1.ogg is served
 * as white_waking.ogg) and the fact that four `music/` masters are served into
 * `ambience/`, neither of which basename matching could work out.
 *
 * Its spec is "path/in/library.ogg", "path:served-name.ogg" or
 * "path:served-name.ogg:+8dB", in three lists with a destination each.
 */
function servedByBuildScript() {
  const script = fs.readFileSync(path.join(ROOT, "scripts", "audio", "build-assets.sh"), "utf8");
  const out = new Map();
  const list = (name) => {
    const m = new RegExp(`^${name}="([^"]*)"`, "m").exec(script);
    return m ? m[1].split("\n").map((s) => s.trim()).filter(Boolean) : [];
  };
  const add = (specs, dest) => {
    for (const spec of specs) {
      const [rel, name] = spec.split(":");
      const base = name || rel.slice(rel.lastIndexOf("/") + 1);
      out.set(rel.toLowerCase(), `${typeof dest === "function" ? dest(rel) : dest}/${base}`);
    }
  };
  add(list("MUSIC"), "music");
  add(list("AMBIENCE"), "ambience");
  // `for f in $INSTRUMENTS; do encode "$f" "$OUT/$(dirname "$f")"` — the spec's own
  // folder is the destination folder.
  add(list("INSTRUMENTS"), (rel) => rel.slice(0, rel.lastIndexOf("/")));
  return out;
}

// --------------------------------------------------------------------------- classifying

// The documents' own eight words for what a track is — six from the old one, two from the new.
// A class is DERIVED from the sentence rather than stored beside it, so that the .docx
// stays the only place the answer lives.
function classOf(group, use, previous) {
  if (/^unused\.?$/i.test(use)) return "unused";
  if (group.startsWith("instruments/")) return "instrument";
  // The new document's two words. "Den music is played from the jukebox located in the den",
  // and every row in den/ is one of its songs, whether it says "Song 3" or "Den music, Song 10".
  if (group === "den") return "jukebox";
  // "Ambience interrupting sfx which plays after…", "…interrupting combat music…". It cuts
  // the bed rather than sitting under it or over it, which is neither ambience nor a cue.
  if (/\bambience interrupting\b/i.test(use)) return "interrupt";
  // "Same as above", "More intense version of badmood2.ogg" — the document leans on the row
  // before rather than repeating itself, so the class does too.
  if (/^(same as above|more (intense|quiet) )/i.test(use) && previous) return previous;
  if (/lobby music/i.test(use)) return "lobby";
  // Anywhere in the sentence, not just at the front: "Alternative played atop ambience in
  // hallowed places" is as much an atop as "Played atop ambience in hallowed places".
  if (/played (atop|over)\b/i.test(use)) return "atop";
  if (/\bambience\b/i.test(use)) return "ambience";
  // "Looping sound of a moving train", "…of heart beating". A thing that loops is a bed
  // by the document's first rule, whatever folder it was filed in.
  if (/^looping sound\b/i.test(use)) return "ambience";
  return "cue";
}

// Where the sentence plainly means a loop but never says "ambience". Kept here, in code
// and under review, rather than as an editable field in the registry — the registry has
// to stay a faithful projection of the document.
const CLASS_OVERRIDE = new Map([
  // "Distant sound produced by smiths striking an anvil, or other sources of metal on
  // metal collisions" — a continuous smithy heard from elsewhere, and the only file whose
  // sentence reads as a one-shot while its name and its job are a loop.
  ["ambience/clank_loop.ogg", "ambience"],
]);

// --------------------------------------------------------------------------- yaml out

const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 ,.()'&+\/-]*$/;

function scalar(s) {
  return PLAIN.test(s) && !/\s$/.test(s) && !/: /.test(s) ? s : JSON.stringify(s);
}

function key(s) {
  return /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(s) ? s : JSON.stringify(s);
}

function wrap(text, indent) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > 88 - indent) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.map((l) => " ".repeat(indent) + l).join("\n");
}

const HEADER = `# What every sound in the library is FOR.
#
# Bascinet's two "Music and Sounds" documents, projected into the repo — the old one for the
# OpenSourceWeb library, the new one for Bascinet's own picks and for the placement rules
# that apply to all of it. They are the source of truth and they are hand-written: every
# use case below is Bascinet's own sentence about that file, carried across verbatim and
# deliberately not re-punctuated. A registry that has quietly improved its source cannot be
# checked against it. Where both describe one file, the new document's sentence is the one
# kept.
#
# THIS FILE IS GENERATED. Run:
#
#     node scripts/audio/import-sound-doc.mjs --apply
#
# Everything but \`needs\` is rewritten on every run, so \`needs\` is the only field worth
# hand-editing here. A correction to a use case belongs in the .docx, not in this file.
#
# It is read by db/test/sounds.test.js and scripts/audio/sound-report.mjs. NOTHING syncs
# it to Postgres: like docs/assets/maps/nodes.yaml, it is a registry that tooling reads,
# not a table. See docs/systemdocs/SOUND.md §7.
#
#   use     — Bascinet's sentence, verbatim.
#   class   — one of the eight classes in \`rules\` below, derived from that sentence.
#   doc     — present only where the document spells the filename differently from the
#             file itself. The key is always the real file; this records what was read,
#             so every correction the importer made is visible and can be argued with.
#   served  — path under web/public/assets/ where this file has been promoted, read out
#             of scripts/audio/build-assets.sh. Absent means it is in the library but not
#             yet in the app.
#   needs   — a fact the selector has to be taught before this use case can be honoured.
#             Absent means the use case is answerable with what the engine knows today.
#
# Loudness lives in web/app/components/musicGain.js and sfx.js, and a song's length in
# db/lib/instrumentSongs.js. Neither is duplicated here.
`;

function emit({ rules, placement, groups, entries }) {
  const out = [HEADER];

  out.push("\n# The documents' own rules for each class of track, verbatim.\nrules:");
  for (const [name, text] of rules) {
    out.push(`  ${name}: >-\n${wrap(text, 4)}`);
  }

  out.push(
    "\n# Where a track may play. The new document's opening, verbatim; it applies to every file" +
      "\n# here, old and new. web/app/components/placeAmbience.js is these rules in code.\nplacement:",
  );
  for (const text of placement) {
    out.push(`  - >-\n${wrap(text, 4)}`);
  }

  out.push("\n# A rule that applies to a whole folder rather than to one file.\ngroups:");
  for (const [group, note] of groups) {
    out.push(`  ${key(group)}:\n    note: ${scalar(note)}`);
  }

  out.push(`\n# ${entries.length} files.\nsounds:`);
  let section = null;
  for (const e of entries) {
    const g = e.id.slice(0, e.id.lastIndexOf("/"));
    if (g !== section) {
      out.push(`\n  # ---- ${g}`);
      section = g;
    }
    out.push(`  ${key(e.id)}:`);
    out.push(`    use: ${scalar(e.use)}`);
    out.push(`    class: ${e.class}`);
    if (e.doc) out.push(`    doc: ${scalar(e.doc)}`);
    if (e.served) out.push(`    served: ${key(e.served)}`);
    if (e.needs) out.push(`    needs: ${scalar(e.needs)}`);
  }
  return out.join("\n") + "\n";
}

// --------------------------------------------------------------------------- carry-over

/**
 * `needs` is the one field the repo owns, so it is read back out of the existing file and
 * carried across — the way scripts/copy/extract.js carries a `new:` field forward.
 * Scraped line by line rather than parsed, for the reason scripts/copy/yamlScalars.js
 * gives: a js-yaml round trip would throw away the header comments.
 */
function carriedForward() {
  if (!fs.existsSync(OUT)) return new Map();
  const kept = new Map();
  let current = null;
  for (const line of fs.readFileSync(OUT, "utf8").split("\n")) {
    const entry = /^  (?:"([^"]+)"|([A-Za-z0-9][A-Za-z0-9._/-]*)):\s*$/.exec(line);
    if (entry) {
      current = entry[1] ?? entry[2];
      continue;
    }
    const field = /^    needs: (.+?)\s*$/.exec(line);
    if (field && current) {
      kept.set(`${current}\u0000needs`, field[1].startsWith('"') ? JSON.parse(field[1]) : field[1]);
    }
  }
  return kept;
}

// --------------------------------------------------------------------------- run

function distance(a, b) {
  const prev = new Array(b.length + 1);
  const row = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = row[j];
  }
  return prev[b.length];
}

const stem = (f) => f.slice(f.lastIndexOf("/") + 1).toLowerCase().replace(/\.[a-z0-9]+$/, "");

// How far a spelling may be off before it stops being a slip of the pen. Two edits, and
// only when ONE file is that close: `Stab_light1.ogg` sits one edit from `stab_light`,
// `stab_light2` and `stab_light3` alike, and picking one of those would be inventing an
// answer rather than reading one.
const NEAR_EDITS = 2;

/** The one file a misspelling plainly meant, or null if that is not plain. */
function nearest(name, candidates) {
  const want = stem(name);
  const scored = candidates
    .map((c) => ({ c, d: distance(want, stem(c)) }))
    .sort((x, y) => x.d - y.d);
  const best = scored[0];
  if (!best || best.d > NEAR_EDITS || best.d >= want.length) return null;
  return { file: best.c, d: best.d, ambiguous: Boolean(scored[1] && scored[1].d === best.d) };
}

function main() {
  if (!fs.existsSync(DOC)) {
    console.error(`No document at ${DOC}\nPass --doc "<path>" if it has moved.`);
    process.exit(1);
  }
  if (!fs.existsSync(NEW_DOC)) {
    console.error(`No document at ${NEW_DOC}\nPass --new-doc "<path>" if it has moved.`);
    process.exit(1);
  }

  const xml = readZipEntry(DOC, "word/document.xml").toString("utf8");
  const { rules: rulePara, groups: docGroups, rows } = readDoc(xml);
  const newDoc = readNewDoc(readZipEntry(NEW_DOC, "word/document.xml").toString("utf8"));
  // YouTube id -> library path, for the new document's rows.
  const byYoutube = new Map(
    Object.entries(fs.existsSync(SOURCES) ? JSON.parse(fs.readFileSync(SOURCES, "utf8")) : {}).map(
      ([rel, s]) => [s.youtube, rel],
    ),
  );
  const library = libraryFiles();
  const served = servedFiles();
  const keep = carriedForward();

  // The rules paragraphs, named by the class each one describes.
  const RULE_ORDER = [
    ["ambience", /^ambience tracks/i],
    ["atop", /played atop/i],
    ["cue", /^sounds with defined/i],
    ["lobby", /^lobby music/i],
    ["instrument", /^instrument tracks/i],
    ["unused", /^unused tracks/i],
  ];
  const rules = new Map();
  for (const [name, re] of RULE_ORDER) {
    const hit = rulePara.find((p) => re.test(p));
    if (hit) rules.set(name, hit);
  }
  // The new document's two classes. Neither has a paragraph of its own the way the old six
  // do; these are the sentences that say what each one does.
  for (const [name, re] of [
    ["interrupt", /interrupted by an ambience interrupting sfx/i],
    ["jukebox", /^den music is played from the jukebox/i],
  ]) {
    const hit = newDoc.placement.find((p) => re.test(p));
    if (hit) rules.set(name, hit);
  }

  const entries = [];
  const seen = new Map();
  const duplicates = [];
  const unmatched = [];
  const groups = new Map();

  const buildMap = servedByBuildScript();
  // build-assets.sh first, since it holds the renames and the cross-folder moves. The sfx/
  // library is copied in by hand with no script behind it, so that one falls back to
  // matching on the name.
  const servedFor = (id) => {
    const base = id.slice(id.lastIndexOf("/") + 1);
    const guess =
      buildMap.get(id.toLowerCase()) ??
      [...served.values()].find((s) => s.slice(s.lastIndexOf("/") + 1) === base);
    return guess && served.has(guess.toLowerCase()) ? guess : undefined;
  };
  const readAs = [];
  // Rows are walked in document order, so a row that says "same as above" can be told what
  // above was.
  let previousClass = null;

  for (const row of rows) {
    if (!row.group) continue;
    // The document writes a leading capital and sometimes omits the extension; the
    // library is what decides the real name.
    const bare = row.file.trim();
    let id = null;
    for (const c of [bare, `${bare}.ogg`, `${bare}.wav`, bare.replace(/\s+/g, "")]) {
      const hit = library.get(`${row.group}/${c}`.toLowerCase());
      if (hit) {
        id = hit;
        break;
      }
    }

    // A spelling one or two edits from exactly one UNCLAIMED file is a slip of the pen,
    // and throwing away the sentence Bascinet wrote about that file would be the worse
    // mistake. This covers both kinds of slip, which turn out to be the same kind:
    // a misspelling (`Lw_sacrified1` for `lw_sacrificed1`), and a row copy-pasted down a
    // numbered series without bumping the number (a second `Ghost.ogg` row describing a
    // ghost dissipating, with `ghost2.ogg` sitting undescribed). Anything less clear-cut
    // is reported and left out.
    if (!id || seen.has(id)) {
      const free = [...library.values()].filter((v) => v.startsWith(`${row.group}/`) && !seen.has(v));
      const near = nearest(bare, free);
      if (near && !near.ambiguous) {
        readAs.push({ ...row, id: near.file, d: near.d, wasTaken: Boolean(id) });
        id = near.file;
      } else if (id) {
        duplicates.push({ id, first: seen.get(id), second: row.use, near });
        continue;
      } else {
        unmatched.push({ ...row, near });
        continue;
      }
    }
    seen.set(id, row.use);

    const cls = CLASS_OVERRIDE.get(id.toLowerCase()) ?? classOf(row.group, row.use, previousClass);
    previousClass = cls;
    entries.push({
      id,
      doc: stem(bare) === stem(id) ? undefined : bare,
      use: row.use,
      class: cls,
      served: servedFor(id),
      needs: keep.get(`${id}\u0000needs`),
    });
  }

  // The new document. Its rows are matched on the YouTube id, never on a spelling, and where
  // one describes a file the old document also described, it replaces that entry: it is the
  // later of the two, and Bascinet wrote it knowing the old one was there.
  const replaced = [];
  const newUnmatched = [];
  for (const row of newDoc.rows) {
    const id = row.youtube ? byYoutube.get(row.youtube) : null;
    if (!id) {
      newUnmatched.push(row);
      continue;
    }
    const group = id.slice(0, id.lastIndexOf("/"));
    const entry = {
      id,
      doc: row.file,
      use: row.use,
      class: classOf(group, row.use, null),
      served: servedFor(id),
      needs: keep.get(`${id}\u0000needs`),
    };
    const at = entries.findIndex((e) => e.id === id);
    if (at === -1) entries.push(entry);
    else {
      replaced.push({ id, was: entries[at].use, now: row.use });
      entries[at] = entry;
    }
  }

  for (const [group, { notes }] of docGroups) {
    const joined = [...new Set(notes)].map((n) => (/[.!?]$/.test(n) ? n : `${n}.`)).join(" ");
    if (joined) groups.set(group, joined);
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));

  // ----- the report
  const byClass = {};
  for (const e of entries) byClass[e.class] = (byClass[e.class] ?? 0) + 1;

  console.log(`document   ${DOC}`);
  console.log(`rows       ${rows.length} in ${docGroups.size} sections`);
  console.log(`new doc    ${NEW_DOC}`);
  console.log(`rows       ${newDoc.rows.length}, and ${newDoc.placement.length} placement paragraphs`);
  console.log(`rules      ${[...rules.keys()].join(", ")}`);
  console.log(`library    ${library.size} audio files in assets/osw-sounds/`);
  console.log(`entries    ${entries.length}`);
  console.log(
    `classes    ${Object.entries(byClass)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );
  console.log(`served     ${entries.filter((e) => e.served).length} promoted into web/public/assets/`);
  if (keep.size) console.log(`carried    ${keep.size} needs field(s) from the existing file`);

  if (replaced.length) {
    console.log(`\n${replaced.length} file(s) the new document re-describes — its sentence is kept:`);
    for (const r of replaced) console.log(`  ${r.id}\n    was: ${r.was}\n    now: ${r.now}`);
  }

  if (newUnmatched.length) {
    console.log(`\n${newUnmatched.length} new-document row(s) with no file — run import-bascinet-sounds.mjs:`);
    for (const r of newUnmatched) console.log(`  [${r.folder}] ${r.file}`);
  }

  if (readAs.length) {
    console.log(`\n${readAs.length} row(s) read as a near-identical real file:`);
    for (const r of readAs)
      console.log(
        `  [${r.group}] ${r.file}  ->  ${r.id.slice(r.id.lastIndexOf("/") + 1)}  ` +
          `(${r.d} edit${r.d === 1 ? "" : "s"}${r.wasTaken ? ", its own name was already taken" : ""})`,
      );
    console.log("  Each is recorded as `doc:` in the registry. Fix the document to clear them.");
  }

  if (duplicates.length) {
    console.log(`\n${duplicates.length} row(s) naming a file another row already described — DROPPED:`);
    for (const d of duplicates)
      console.log(
        `  ${d.id}\n    kept:    ${d.first}\n    dropped: ${d.second}` +
          (d.near ? `\n    nearest free file was ambiguous` : ""),
      );
  }

  if (unmatched.length) {
    console.log(`\n${unmatched.length} row(s) naming no file in the library — LEFT OUT, not guessed:`);
    for (const u of unmatched)
      console.log(
        `  [${u.group}] ${u.file}\n    ` +
          (u.near
            ? `closest: ${u.near.file}${u.near.ambiguous ? " (and others equally close — ambiguous)" : ""}`
            : "no close match"),
      );
  }

  const documented = new Set(entries.map((e) => e.id.toLowerCase()));
  const undocumented = [...library.values()].filter((v) => !documented.has(v.toLowerCase()));
  if (undocumented.length) {
    console.log(`\n${undocumented.length} file(s) in the library with no row in the document:`);
    for (const u of undocumented) console.log(`  ${u}`);
  }

  // Everything left over, put side by side. A row with no file and a file with no row are
  // usually the same mistake seen from both ends, and pairing them is the whole of what is
  // left to fix in the document by hand.
  const orphanRows = [
    ...unmatched.map((u) => ({ group: u.group, file: u.file, use: u.use })),
    ...duplicates.map((d) => ({ group: d.id.slice(0, d.id.indexOf("/")), file: d.id, use: d.second })),
  ];
  if (orphanRows.length && undocumented.length) {
    console.log(`\nLEFT TO DECIDE — ${orphanRows.length} description(s) with no home, ${undocumented.length} file(s) with no description:`);
    for (const r of orphanRows) {
      // Advisory only, so this ignores the edit threshold entirely and just names the
      // closest undescribed file in the same folder.
      const group = r.group.includes("/") ? r.group : r.group;
      const pool = undocumented.filter((u) => u.startsWith(`${group.split("/")[0]}/`));
      const pick = pool
        .map((u) => ({ u, d: distance(stem(r.file), stem(u)) }))
        .sort((a, b) => a.d - b.d)[0];
      console.log(
        `  "${r.use}"\n    written against: ${r.file}\n    likeliest home:  ` +
          (pick ? `${pick.u}  (${pick.d} edit${pick.d === 1 ? "" : "s"})` : "(no undescribed file in this folder)"),
      );
    }
    console.log("  Nothing above was applied. Correct the document and re-run.");
  }

  const text = emit({ rules, placement: newDoc.placement, groups, entries });

  if (!APPLY) {
    console.log(`\nDRY RUN. ${text.split("\n").length} lines would be written to docs/sounds.yaml`);
    console.log("Pass --apply to write it.");
    return;
  }
  fs.writeFileSync(OUT, text);
  console.log(`\nWrote docs/sounds.yaml (${text.split("\n").length} lines)`);
}

main();
