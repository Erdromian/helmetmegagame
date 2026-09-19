#!/usr/bin/env node
// docs/assets/maps/*.psci -> the JSON the web app draws the map from.
//
//   npm run map:build               compile both maps
//   npm run map:build -- --report   ...and print the per-map breakdown
//
// The Playscii file is the AUTHORING MASTER and nothing exports a PNG any
// more. A .psci is a 41x24 grid of layers; each cell carries a glyph index
// into the charset, a foreground palette index, a background one, and one of
// eight transforms. This turns that into:
//
//   web/public/assets/maps/<id>.json
//
// with two things the old raster plate could not give us:
//
//   1. Every cell names a semantic CHANNEL ("stone", "lit", "heat", …)
//      instead of a colour, so the map follows the theme like everything
//      else. The whole docs/assets/make-map-river.py alpha-mask trick exists
//      because the old plate could not do this.
//   2. Node positions come out of the art. Layer 5 of each map is a hidden
//      layer of markers whose glyph is the location's system code and whose
//      colour is its zone (docs/assets/maps/nodes.yaml). No parallel table of
//      pixel coordinates to keep in step.
//
// The glyphs ride along inside the JSON as a 1-bit mask rather than as a
// cropped atlas PNG: the charset is pure white-on-transparent, so a glyph is
// 256 bits, and the ~130 either map uses pack into about 4KB. That is smaller
// than the PNG would be and saves shipping a binary the build has to generate.
//
// See docs/systemdocs/MAP.md.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "docs", "assets", "maps");
const OUT = path.join(ROOT, "web", "public", "assets", "maps");
const CHARSET_PNG = path.join(SRC, "charset", "kenney_1bit_16.png");
const CHARSET_META = path.join(SRC, "charset", "kenney_1bit_16.char");

// Playscii's eight per-cell transforms, indexed [row][col].
//
// THIS IS THE ONLY COPY, and it stays that way on purpose. The transforms are
// BAKED INTO THE PACKED MASKS below, so a cell in the compiled JSON points at
// an already-rotated glyph and no renderer ever applies one. The first web
// renderer written against this data did carry its own copy, transposed cases
// 1 and 3 against this table, and turned 79 of barony1's cells — most of them
// the cave-edge pieces 169-171 — the wrong way round. Baking costs 144 mask
// slots instead of 106 on barony1, about 4.5KB, and makes that unrepresentable.
//
// Verified against Bascinet's own screenshots rather than read off Playscii's
// source: for every cell whose only content is one glyph, score all eight
// candidates against the screenshot by intersection-over-union and take the
// best. Stored 0 resolves to 0 (33 samples), 3 to 3, 4 to 4 (10), 6 to 6 (7),
// with no disagreement.
const XFORM = {
  0: (m, x, y, n) => m[y][x],
  1: (m, x, y, n) => m[n - 1 - x][y], // rotate 90
  2: (m, x, y, n) => m[n - 1 - y][n - 1 - x], // rotate 180
  3: (m, x, y, n) => m[x][n - 1 - y], // rotate 270
  4: (m, x, y, n) => m[y][n - 1 - x], // flip x
  5: (m, x, y, n) => m[n - 1 - y][x], // flip y
  6: (m, x, y, n) => m[x][y], // transpose
  7: (m, x, y, n) => m[n - 1 - x][n - 1 - y], // anti-transpose
};

// The solid block the rock is painted with, and the only fully-opaque glyph
// either map uses. Anything under it is invisible in Playscii but NOT in a
// renderer that fades the rock, so the build says so — see `buried` below.
const ROCK_GLYPH = 168;

// 1-9 then A-Z, which is how a node's system code is drawn. The charset puts
// '0' at 947, so the digits run 947-956; the letters start at 979. Both were
// read straight off the charset rather than assumed.
const GLYPH_ZERO = 947;
const GLYPH_A = 979;

function codeOfGlyph(g) {
  if (g >= GLYPH_ZERO && g <= GLYPH_ZERO + 9) return String(g - GLYPH_ZERO);
  if (g >= GLYPH_A && g <= GLYPH_A + 25) return String.fromCharCode(65 + (g - GLYPH_A));
  return null;
}

// ---------------------------------------------------------------- PNG

// A minimal 8-bit PNG reader, stdlib only. docs/assets/make-map-river.py
// hand-rolled the same thing in the other direction for the same reason:
// there is no image library in this repo and adding one for two files of
// pixel-poking is not worth it.
function readPng(file) {
  const d = fs.readFileSync(file);
  if (d.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${file}`);
  let i = 8;
  let hdr = null;
  const idat = [];
  while (i < d.length) {
    const len = d.readUInt32BE(i);
    const type = d.toString("ascii", i + 4, i + 8);
    const body = d.subarray(i + 8, i + 8 + len);
    if (type === "IHDR") {
      hdr = {
        w: body.readUInt32BE(0),
        h: body.readUInt32BE(4),
        depth: body[8],
        colour: body[9],
        interlace: body[12],
      };
    } else if (type === "IDAT") idat.push(body);
    i += 12 + len;
    if (type === "IEND") break;
  }
  if (!hdr) throw new Error(`no IHDR: ${file}`);
  if (hdr.depth !== 8 || hdr.interlace !== 0) {
    throw new Error(`need an 8-bit non-interlaced PNG, got depth ${hdr.depth} interlace ${hdr.interlace}`);
  }
  const nch = { 0: 1, 2: 3, 4: 2, 6: 4 }[hdr.colour];
  if (!nch) throw new Error(`unsupported PNG colour type ${hdr.colour} (palette is not handled)`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = hdr.w * nch;
  const out = Buffer.alloc(hdr.h * stride);
  let prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < hdr.h; y++) {
    const filter = raw[pos++];
    const line = Buffer.from(raw.subarray(pos, pos + stride));
    pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= nch ? line[x - nch] : 0;
      const b = prev[x];
      const c = x >= nch ? prev[x - nch] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 255;
      else if (filter === 2) line[x] = (line[x] + b) & 255;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(out, y * stride);
    prev = line;
  }
  return { ...hdr, nch, px: out };
}

// The charset is white glyphs on transparency, so alpha alone is the shape.
function loadCharset() {
  const meta = fs.readFileSync(CHARSET_META, "utf8").split("\n");
  const [cols, rows] = meta[2].split(",").map((s) => Number(s.trim()));
  const img = readPng(CHARSET_PNG);
  const cell = img.w / cols;
  if (cell !== Math.floor(cell) || img.h / rows !== cell) {
    throw new Error(`charset ${img.w}x${img.h} does not divide into ${cols}x${rows} cells`);
  }
  return { img, cols, rows, cell };
}

// One glyph as a `cell`-square array of 0/1 rows.
function glyphMask(cs, index) {
  const { img, cols, cell } = cs;
  const gx = (index % cols) * cell;
  const gy = Math.floor(index / cols) * cell;
  const m = [];
  for (let y = 0; y < cell; y++) {
    const row = new Uint8Array(cell);
    for (let x = 0; x < cell; x++) {
      row[x] = img.px[((gy + y) * img.w + (gx + x)) * img.nch + 3] ? 1 : 0;
    }
    m.push(row);
  }
  return m;
}

// ---------------------------------------------------------------- compile

function compileMap(id, spec, table, cs) {
  const src = path.join(SRC, spec.file);
  const art = JSON.parse(fs.readFileSync(src, "utf8"));
  const W = art.width;
  const H = art.height;
  const layers = art.frames[0].layers;
  if (layers.length < 5) throw new Error(`${spec.file}: expected 5 layers, found ${layers.length}`);

  const channelOf = table.channels;
  const problems = [];
  const unknownFg = new Map();

  // --- the art. Layer 5 (index 4) is the node layer and is never drawn.
  // A cell is [index, slot, channel]: `slot` already carries the transform,
  // so there is nothing left for a renderer to rotate.
  const used = new Set(); // "<char>:<xform>"
  const artLayers = [];
  let voidChannel = null;
  const rockAt = [];
  for (let li = 0; li < 4; li++) {
    rockAt.push(new Set());
    for (let i = 0; i < layers[li].tiles.length; i++) {
      if (layers[li].tiles[i].char === ROCK_GLYPH) rockAt[li].add(i);
    }
  }
  const buried = [];
  for (let li = 0; li < 4; li++) {
    const cells = [];
    for (let i = 0; i < layers[li].tiles.length; i++) {
      const t = layers[li].tiles[i];
      if (li === 0 && voidChannel === null) voidChannel = channelOf[t.bg] ?? null;
      if (!t.char) continue;
      const ch = channelOf[t.fg];
      if (ch === undefined) unknownFg.set(t.fg, (unknownFg.get(t.fg) ?? 0) + 1);
      for (let above = li + 1; above < 4; above++) {
        if (rockAt[above].has(i)) { buried.push([i % W, Math.floor(i / W), ch ?? `fg${t.fg}`]); break; }
      }
      used.add(`${t.char}:${t.xform}`);
      cells.push([i, `${t.char}:${t.xform}`, ch ?? `fg${t.fg}`]);
    }
    artLayers.push(cells);
  }

  // --- the nodes, off layer 5
  const zoneOfFg = new Map();
  const wanted = new Map(); // "fg:code" -> { zone, code, name, slug }
  for (const group of spec.groups) {
    zoneOfFg.set(group.fg, group);
    for (const [code, entry] of Object.entries(group.nodes)) {
      const name = typeof entry === "string" ? entry : entry.name;
      const slug = (typeof entry === "string" ? null : entry.slug) ?? `${group.zone}-${slugify(name)}`;
      wanted.set(`${group.fg}:${code}`, { zone: group.zone, code, name, slug });
    }
  }

  const nodes = [];
  const seen = new Set();
  for (let i = 0; i < layers[4].tiles.length; i++) {
    const t = layers[4].tiles[i];
    if (!t.char) continue;
    const drawn = codeOfGlyph(t.char);
    if (drawn === null) {
      problems.push(`marker at (${i % W},${Math.floor(i / W)}) uses glyph ${t.char}, which is not a 1-9/A-Z code`);
      continue;
    }
    const group = zoneOfFg.get(t.fg);
    if (!group) {
      problems.push(`marker "${drawn}" at (${i % W},${Math.floor(i / W)}) is colour ${t.fg}, which nodes.yaml does not name`);
      continue;
    }
    const code = group.recode?.[drawn] ?? drawn;
    const key = `${t.fg}:${code}`;
    const meta = wanted.get(key);
    if (!meta) {
      problems.push(`marker "${drawn}"${code !== drawn ? ` (recoded to "${code}")` : ""} in ${group.zone} at (${i % W},${Math.floor(i / W)}) has no entry in nodes.yaml`);
      continue;
    }
    const dupe = `${meta.zone}:${code}`;
    if (seen.has(dupe)) problems.push(`two markers claim ${meta.zone} code "${code}"`);
    seen.add(dupe);
    wanted.delete(key);
    nodes.push({ code, zone: meta.zone, slug: meta.slug, name: meta.name, x: i % W, y: Math.floor(i / W) });
  }
  for (const [, meta] of wanted) {
    problems.push(`nodes.yaml names ${meta.zone} "${meta.code}" (${meta.name}) but no marker is drawn for it`);
  }

  const slugs = new Map();
  for (const n of nodes) {
    if (slugs.has(n.slug)) problems.push(`two nodes share the slug "${n.slug}" (${slugs.get(n.slug)} and ${n.name})`);
    slugs.set(n.slug, n.name);
  }

  // --- the glyphs actually used, transformed, as a packed 1-bit mask
  const order = [...used].sort();
  const index = {};
  const N = cs.cell;
  const bits = Buffer.alloc(order.length * ((N * N) / 8));
  order.forEach((key, slot) => {
    index[key] = slot;
    const [g, t] = key.split(":").map(Number);
    const m = glyphMask(cs, g);
    const fn = XFORM[t] ?? XFORM[0];
    const base = slot * ((N * N) / 8);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (!fn(m, x, y, N)) continue;
        const bit = y * N + x;
        bits[base + (bit >> 3)] |= 0x80 >> (bit & 7);
      }
    }
  });
  // Re-key the cells onto slot numbers now that every key has one.
  for (const cells of artLayers) for (const c of cells) c[1] = index[c[1]];

  nodes.sort((a, b) => (a.zone === b.zone ? a.code.localeCompare(b.code) : a.zone.localeCompare(b.zone)));

  // Which slots ARE the solid rock block, in every orientation it was painted
  // in. The renderer stipples these as the vignette thins them, and it can no
  // longer ask "is this glyph 168" because cells carry slots now.
  const stoneSlots = order
    .map((key, slot) => (Number(key.split(":")[0]) === (table.stoneBlock ?? ROCK_GLYPH) ? slot : -1))
    .filter((s) => s >= 0);

  return {
    doc: {
      id,
      name: spec.name,
      w: W,
      h: H,
      cell: cs.cell,
      voidChannel: voidChannel ?? "void",
      stoneSlots,
      glyphs: { cell: cs.cell, count: order.length, index, bits: bits.toString("base64") },
      layers: artLayers,
      nodes,
    },
    problems,
    unknownFg,
    buried,
  };
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function main() {
  const report = process.argv.includes("--report");
  const table = yaml.load(fs.readFileSync(path.join(SRC, "nodes.yaml"), "utf8"));
  const cs = loadCharset();
  fs.mkdirSync(OUT, { recursive: true });

  let failed = false;
  for (const [id, spec] of Object.entries(table.maps)) {
    const { doc, problems, unknownFg, buried } = compileMap(id, spec, table, cs);
    const outPath = path.join(OUT, `${id}.json`);
    fs.writeFileSync(outPath, JSON.stringify(doc));

    const byZone = {};
    for (const n of doc.nodes) byZone[n.zone] = (byZone[n.zone] ?? 0) + 1;
    const cells = doc.layers.reduce((a, l) => a + l.length, 0);
    console.log(
      `${id.padEnd(8)} ${doc.w}x${doc.h}  ${cells} cells  ${doc.glyphs.count} glyphs  ` +
        `${doc.nodes.length} nodes (${Object.entries(byZone).map(([z, n]) => `${z} ${n}`).join(", ")})  ` +
        `-> ${path.relative(ROOT, outPath)} ${(fs.statSync(outPath).size / 1024).toFixed(1)}KB`,
    );
    if (report) {
      const chans = {};
      for (const l of doc.layers) for (const c of l) chans[c[2]] = (chans[c[2]] ?? 0) + 1;
      console.log(`         channels: ${Object.entries(chans).map(([c, n]) => `${c} ${n}`).join(", ")}`);
      for (const n of doc.nodes) console.log(`         ${n.zone.padEnd(12)} ${n.code}  ${n.name.padEnd(18)} (${n.x},${n.y})  ${n.slug}`);
    }
    for (const [fg, n] of unknownFg) {
      console.warn(`         note: ${n} cells painted with palette slot ${fg}, which nodes.yaml does not map to a channel`);
    }
    // Not culled on purpose: the rust river at the east end of barony1 is
    // buried rock-side and Bascinet wants it reading through the stone. A
    // rule that dropped every buried cell would drop the river too, so this
    // only says what is down there. `npm run map:scrub` is the tidy-up.
    if (buried.length) {
      const what = {};
      for (const b of buried) what[b[2]] = (what[b[2]] ?? 0) + 1;
      console.warn(`         note: ${buried.length} cells sit under solid rock and only show once the vignette thins it ` +
        `(${Object.entries(what).map(([c, n]) => `${c} ${n}`).join(", ")}) — ` +
        `${buried.slice(0, 6).map((b) => `(${b[0]},${b[1]})`).join(" ")}${buried.length > 6 ? " …" : ""}`);
    }
    for (const p of problems) {
      console.error(`         ERROR ${p}`);
      failed = true;
    }
  }
  if (failed) {
    console.error("\nthe node table and the art disagree — nothing downstream should trust this output");
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { readPng, loadCharset, glyphMask, compileMap, codeOfGlyph, XFORM, ROOT, SRC, OUT };
