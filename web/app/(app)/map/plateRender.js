// The plate, drawn.
//
// `npm run map:build` hands the browser a 41x24 grid of cells, each naming a
// glyph slot and a semantic CHANNEL — "stone", "lit", "heat" and so on, never
// a colour. This turns that into one picture. See MAP.md §6f.
//
// Nothing here names a colour either: renderPlate is handed a palette the
// caller read off the live theme, so the map follows --map-* like every other
// surface follows its tokens (DESIGN-SYSTEM.md §2).
//
// The picture depends on the plate and the palette and on NOTHING ELSE — not
// fog, not what is picked, not where the view is. So it is drawn once into an
// offscreen canvas and handed to the board as a data URL, and panning costs
// nothing. The crosshairs over it are SVG, where CSS can still colour them.

// The rock fades outward from the places. Full within `inner` cells, gone by
// `outer`, never quite to nothing — `floor` is what keeps a wall a wall at the
// far corners instead of a hole. Bascinet's settled values off the Barony
// Plate; they are constants rather than controls on purpose.
const VIGNETTE = { inner: 3, outer: 11, floor: 0.06 };
// Light comes off the places and nothing else. There used to be a second term
// lighting everything near the rust, and it is gone rather than switched off:
// the heat channel still PAINTS (the buried river reads through the thinning
// stone, which is the whole point of it) — it just stopped glowing.
const LIGHT = { reach: 7, ambient: 0.45 };
// Below this a cell is not worth the drawImage.
const INVISIBLE = 0.012;

// A 4x4 Bayer dither, which is the ░▒▓ of the vignette. The charset has no
// stipple glyph, and a generated one takes a continuous level rather than
// three fixed steps.
//
// The vignette is spent as COVERAGE, not as alpha, and the two are not
// interchangeable: fewer dots further out is what a thinning wall looks like,
// while the same dots at lower opacity is a grey wash. Only the light touches
// brightness.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// Masks arrive from the build ALREADY TRANSFORMED — one slot per (glyph,
// rotation) the art actually uses. There is no transform code here, and that
// is the point: a renderer carrying its own copy of Playscii's transform
// table got two cases transposed and turned 79 of barony1's cells the wrong
// way round. A renderer that cannot rotate cannot rotate wrongly.
function unpack(doc) {
  if (doc._bits) return doc._bits;
  const raw = atob(doc.glyphs.bits);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  doc._bits = { bytes, per: (doc.cell * doc.cell) / 8, cell: doc.cell };
  return doc._bits;
}

function lit(doc, slot, x, y) {
  const b = unpack(doc);
  const bit = y * b.cell + x;
  const at = slot * b.per + (bit >> 3);
  return ((b.bytes[at] >> (7 - (bit & 7))) & 1) === 1;
}

// One white canvas per glyph slot, then one tinted copy per (slot, colour)
// actually asked for. Both caches hang off the doc, so a plate switch and
// a theme change drop them together with it.
function glyphCanvas(doc, slot) {
  const cache = (doc._glyphs ??= new Map());
  const held = cache.get(slot);
  if (held) return held;
  const c = doc.cell;
  const cv = document.createElement("canvas");
  cv.width = c;
  cv.height = c;
  const cx = cv.getContext("2d");
  const img = cx.createImageData(c, c);
  const d = img.data;
  for (let y = 0; y < c; y++) {
    for (let x = 0; x < c; x++) {
      if (!lit(doc, slot, x, y)) continue;
      const o = (y * c + x) * 4;
      d[o] = 255;
      d[o + 1] = 255;
      d[o + 2] = 255;
      d[o + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);
  cache.set(slot, cv);
  return cv;
}

function tinted(doc, slot, colour) {
  const cache = (doc._tints ??= new Map());
  const key = `${slot}:${colour}`;
  const held = cache.get(key);
  if (held) return held;
  const c = doc.cell;
  const cv = document.createElement("canvas");
  cv.width = c;
  cv.height = c;
  const cx = cv.getContext("2d");
  cx.drawImage(glyphCanvas(doc, slot), 0, 0);
  cx.globalCompositeOperation = "source-in";
  cx.fillStyle = colour;
  cx.fillRect(0, 0, c, c);
  cache.set(key, cv);
  return cv;
}

function stipple(doc, level, colour) {
  const cache = (doc._stipples ??= new Map());
  const q = Math.max(0, Math.min(15, Math.round(level * 15)));
  const key = `${q}:${colour}`;
  const held = cache.get(key);
  if (held) return held;
  const c = doc.cell;
  const cv = document.createElement("canvas");
  cv.width = c;
  cv.height = c;
  const cx = cv.getContext("2d");
  cx.fillStyle = colour;
  for (let y = 0; y < c; y++) {
    for (let x = 0; x < c; x++) {
      if (BAYER[(y % 4) * 4 + (x % 4)] < q) cx.fillRect(x, y, 1, 1);
    }
  }
  cache.set(key, cv);
  return cv;
}

// How far every cell is from the nearest place ON THE PLATE, which is what
// both the vignette and the light are measured in.
//
// Deliberately the ART's own markers (`lights`, a bare coordinate list) rather
// than the places this character knows: light that followed the fog would recompute on every arrival, and
// would also BE a fog leak — a bright patch is a place, and you would see one
// glowing across the map before you had ever heard of it.
function field(doc) {
  if (doc._dist) return doc._dist;
  const { w, h } = doc;
  const d = new Float32Array(w * h).fill(1e9);
  for (const [nx, ny] of doc.lights ?? []) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - nx;
        const dy = y - ny;
        const v = Math.sqrt(dx * dx + dy * dy);
        const o = y * w + x;
        if (v < d[o]) d[o] = v;
      }
    }
  }
  doc._dist = d;
  return d;
}

// The plate as a data URL, at exactly one image pixel per drawn pixel. The
// board scales it up with image-rendering: pixelated.
export function renderPlate(doc, palette) {
  const c = doc.cell;
  const cv = document.createElement("canvas");
  cv.width = doc.w * c;
  cv.height = doc.h * c;
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = palette[doc.voidChannel] ?? palette.void;
  ctx.fillRect(0, 0, cv.width, cv.height);

  const dist = field(doc);
  const rock = (doc._rock ??= new Set(doc.stoneSlots ?? []));
  const { inner, floor } = VIGNETTE;
  const outer = Math.max(VIGNETTE.outer, inner + 1);

  for (const layer of doc.layers) {
    for (const [cellIdx, slot, channel] of layer) {
      const colour = palette[channel];
      if (!colour) continue;
      const dd = dist[cellIdx];

      let vign = 1;
      const isRock = channel === "stone";
      if (isRock) {
        const v = dd <= inner ? 1 : dd >= outer ? 0 : 1 - (dd - inner) / (outer - inner);
        vign = floor + (1 - floor) * v;
      }
      const light = LIGHT.ambient + (1 - LIGHT.ambient) * Math.max(0, 1 - dd / LIGHT.reach);
      if (vign * light <= INVISIBLE) continue;

      const gx = (cellIdx % doc.w) * c;
      const gy = Math.floor(cellIdx / doc.w) * c;
      if (isRock && rock.has(slot) && vign < 0.985) {
        ctx.globalAlpha = light;
        ctx.drawImage(stipple(doc, vign, colour), gx, gy);
      } else {
        ctx.globalAlpha = vign * light;
        ctx.drawImage(tinted(doc, slot, colour), gx, gy);
      }
    }
  }
  ctx.globalAlpha = 1;
  return cv.toDataURL("image/png");
}

// A glyph as an SVG path, in cell units, one subpath per lit pixel. This is
// what makes a crosshair a shape CSS can colour — so a mark keeps taking its
// colour from --zone-*, and every state the board already draws with
// data-picked / data-state keeps working, on the same marker the art is made
// of. Runs twice per plate (faint and locked) and is cached.
export function glyphPath(doc, slot) {
  const cache = (doc._paths ??= new Map());
  const held = cache.get(slot);
  if (held !== undefined) return held;
  const c = doc.cell;
  const out = [];
  for (let y = 0; y < c; y++) {
    let run = 0;
    for (let x = 0; x <= c; x++) {
      if (x < c && lit(doc, slot, x, y)) {
        run++;
        continue;
      }
      if (run) out.push(`M${x - run} ${y}h${run}v1h-${run}z`);
      run = 0;
    }
  }
  const path = out.join("");
  cache.set(slot, path);
  return path;
}
