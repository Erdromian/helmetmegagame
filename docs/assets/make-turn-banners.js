#!/usr/bin/env node
/**
 * Builds the eight banners #turns posts above each turn announcement — four
 * dawn, four dusk (see db/lib/turnBanner.js).
 *
 *     node docs/assets/make-turn-banners.js <dir-of-source-plates> [--sheet]
 *
 * Sources are named `yesdawn1..4` / `yesdusk1..4` in any of png/jpg/webp, and
 * become dawn-1..4.jpg / dusk-1..4.jpg in docs/assets/turn/.
 *
 * Node with sharp rather than Python with Pillow (which make-banner.py uses):
 * Pillow is not installed here and sharp already is, as a Next.js dependency.
 *
 * Two things this does that a plain centre-crop cannot.
 *
 * 1. CROP WINDOW. Some plates arrive letterboxed, and two carry a publisher's
 *    logo and copyright line along the bottom. So the crop is taken from a
 *    "safe band": black bars are detected and dropped, CUT_BELOW pushes the
 *    band's floor above a watermark, and the largest frame-aspect rectangle
 *    inside what's left is what gets resized. Every output is the same size;
 *    only the window differs.
 *
 * 2. GRADE. The plates were shot under wildly different light — mean
 *    brightness ran from 14 to 123 out of 255 — so GRADE pulls them into one
 *    band. Unlike the weather banners this replaces, these are graded on
 *    purpose: there is no per-plate weather for them to carry any more, so
 *    they have to read as one set.
 *
 * JPEG at quality 92, subsampling off, in the same 2446x1122 frame the #info
 * banner works in — eight PNGs would be ~18MB of binary for no visible gain.
 */
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const HERE = __dirname;
const OUT_W = 2446, OUT_H = 1122;      // same frame as docs/assets/info-banner.png
const TARGET = OUT_W / OUT_H;
const JPEG_QUALITY = 92;
const OUT = path.join(HERE, "turn");
const PHASES = ["dawn", "dusk"];
const N = 4;

// A row is a letterbox bar only if its BRIGHTEST pixel is near black. Testing
// the mean instead reports a dark foreground as a bar — yesdawn2's bottom 349
// rows average under 8 and are entirely real scenery.
const BAR_MAX = 10;

// Rows at or below this fraction of source height are dropped before the crop,
// because a watermark sits there. Keyed by source stem.
const CUT_BELOW = {
  yesdawn3: 0.80,   // HUNT SHOWDOWN logo from ~row 855 of 1056
  yesdusk1: 0.79,   // HUNT SHOWDOWN logo from ~row 871 of 1080
};

// brightness/saturation go through modulate(); slope/offset through linear()
// as out = slope * in + offset. Omitted keys mean "leave that alone".
const GRADE = {
  yesdawn1: { brightness: 0.90, saturation: 0.92 },
  yesdawn2: {},
  yesdawn3: { brightness: 0.72, saturation: 0.82 },
  yesdawn4: { brightness: 0.34, saturation: 0.55, slope: 0.85, offset: 2 },
  yesdusk1: { brightness: 0.91, slope: 1.25, offset: -6 },
  yesdusk2: { brightness: 0.58, saturation: 0.32 },
  yesdusk3: { brightness: 0.82 },
  yesdusk4: { brightness: 0.70, saturation: 0.35, slope: 0.80, offset: 4 },
};

function sourceFor(dir, stem) {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const p = path.join(dir, stem + ext);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`No source plate for ${stem} in ${dir}`);
}

// The rows worth keeping: inside any black bars, and above a watermark.
async function safeBand(file, stem) {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const rowMax = [];
  for (let y = 0; y < h; y++) {
    let m = 0;
    for (let x = 0; x < w; x++) if (data[y * w + x] > m) m = data[y * w + x];
    rowMax.push(m);
  }
  let top = 0;
  while (top < h && rowMax[top] < BAR_MAX) top++;
  let bottom = h - 1;
  while (bottom > top && rowMax[bottom] < BAR_MAX) bottom--;
  const cut = CUT_BELOW[stem];
  if (cut != null) bottom = Math.min(bottom, Math.round(h * cut));
  return { w, h, top, bottom };
}

// Largest frame-aspect rectangle inside the band, centred horizontally and
// within the band vertically.
function window_(band) {
  const bandH = band.bottom - band.top + 1;
  let cw = band.w, ch = Math.round(cw / TARGET);
  if (ch > bandH) { ch = bandH; cw = Math.round(ch * TARGET); }
  return {
    left: Math.round((band.w - cw) / 2),
    top: band.top + Math.round((bandH - ch) / 2),
    width: cw,
    height: ch,
  };
}

function grade(pipe, g) {
  const mod = {};
  if (g.brightness != null) mod.brightness = g.brightness;
  if (g.saturation != null) mod.saturation = g.saturation;
  if (Object.keys(mod).length) pipe = pipe.modulate(mod);
  if (g.slope != null) pipe = pipe.linear(g.slope, g.offset ?? 0);
  return pipe;
}

async function build(srcDir) {
  fs.mkdirSync(OUT, { recursive: true });
  const made = [];
  for (const phase of PHASES) {
    for (let i = 1; i <= N; i++) {
      const stem = `yes${phase}${i}`;
      const file = sourceFor(srcDir, stem);
      const band = await safeBand(file, stem);
      const win = window_(band);
      const out = path.join(OUT, `${phase}-${i}.jpg`);
      await grade(sharp(file).extract(win).resize(OUT_W, OUT_H, { kernel: "lanczos3" }), GRADE[stem] ?? {})
        .jpeg({ quality: JPEG_QUALITY, chromaSubsampling: "4:4:4" })
        .toFile(out);
      const st = await sharp(out).stats();
      const [r, g, b] = st.channels.slice(0, 3).map((c) => c.mean);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const sd = st.channels.slice(0, 3).reduce((s, c, k) => s + [0.2126, 0.7152, 0.0722][k] * c.stdev, 0);
      console.log(
        `${path.basename(out).padEnd(11)} from ${stem.padEnd(9)}` +
        ` band ${String(band.top).padStart(4)}..${String(band.bottom).padStart(4)} of ${band.h}` +
        ` crop ${win.width}x${win.height}+${win.left}+${win.top}` +
        ` | lum ${lum.toFixed(1).padStart(5)} sd ${sd.toFixed(1).padStart(5)}` +
        ` ${String(Math.round(fs.statSync(out).size / 1024)).padStart(4)} KB`,
      );
      made.push(out);
    }
  }
  return made;
}

// Two columns, dawn beside dusk, so the set can be judged as a set.
async function sheet(made) {
  const tw = 760, th = Math.round(tw * OUT_H / OUT_W), pad = 14;
  const W = pad + 2 * (tw + pad), H = pad + N * (th + pad);
  const tiles = [];
  for (let i = 0; i < made.length; i++) {
    const col = i < N ? 0 : 1, row = i % N;
    tiles.push({
      input: await sharp(made[i]).resize(tw, th, { kernel: "lanczos3" }).png().toBuffer(),
      left: pad + col * (tw + pad),
      top: pad + row * (th + pad),
    });
  }
  const out = path.join(OUT, "contact-sheet.png");
  await sharp({ create: { width: W, height: H, channels: 3, background: { r: 16, g: 16, b: 18 } } })
    .composite(tiles).png().toFile(out);
  console.log("wrote", out, `${W}x${H}`);
}

(async () => {
  const args = process.argv.slice(2);
  const srcDir = args.find((a) => !a.startsWith("--")) ?? path.join(process.env.HOME, "Downloads", "ss");
  const made = await build(srcDir);
  if (args.includes("--sheet")) await sheet(made);
})().catch((err) => { console.error(err.message); process.exit(1); });
