// Generates the default character avatars: a teal-tinted stone plaque bearing
// a blackletter capital, one per letter A-Z plus a blank fallback.
//
// A character with no uploaded picture is served one of these by
// web/app/api/avatar/[characterId]/route.js, chosen from the first letter of
// their FIRST name (never the honorific or the granted title). That lookup
// happens at read time, which is why nothing here has to run on a rename.
//
// One-off, with committed output — not a build step. Re-run it after changing
// the tuning constants below or replacing background.png:
//
//   npm run assets:letters --workspace=web
//
// The font is vendored as a TTF because this renders through sharp's pango
// text support, and pango cannot read the .woff2 that next/font/google caches
// into .next. It is UnifrakturMaguntia, the same face --font-display uses for
// the login wordmark, so the plaques and the wordmark match.
//
// **Check the output before committing it.** On a machine with no fontconfig
// setup, pango prints `Fontconfig error: Cannot load default config file`,
// ignores `fontfile`, silently substitutes a default sans face, and the script
// still exits 0 — leaving 27 plaques that say A in Helvetica. It is a warning,
// not an error, so nothing here can catch it; open one plaque and look.

// That trap is live on at least one dev Mac, and FONTCONFIG_FILE does not get
// around it — this sharp build's bundled fontconfig ignores the config and the
// `fontfile` both. It has bitten this file twice, and both times the fix was
// the same: change the constants here for the future, and post-process the
// committed plaques to match.
//
//   1. The shade ramp. Applied over the finished plaques instead of under the
//      glyph, which dims the ink's lower half slightly. It reads fine.
//   2. The 2026-09-06 desaturation (TINT -> null, DARKEN 0.5 -> 0.4). The
//      plate and the helms were rebuilt properly — neither needs a font — but
//      the plaques were mapped in place, which left them 15-25 luma darker
//      than everything else and clipped at the bottom.
//
// That second divergence is now closed, and in the direction of the plaques
// rather than away from them: TONE_GAIN/TONE_OFFSET below reproduce their
// ground from the plate, so the plate, the helms and the built portraits sit
// where the plaques already were. Nothing is owed to the 27 committed files —
// they are the reference, not a debt.
//
// The next successful run on a machine with fonts supersedes all of it and
// nothing needs undoing first; the plaques will come out of this pipeline
// matching what they already are. Use `--plate-only` (see main) to move the
// plate without touching a glyph.

const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const BACKGROUND = path.join(ROOT, "public/assets/background.png");
const FONT_FILE = path.join(ROOT, "assets/fonts/UnifrakturMaguntia.ttf");
const OUT_DIR = path.join(ROOT, "public/assets/letters");
// The same tinted stone, frameless, as the backing plate for a built portrait
// (docs/systemdocs/PORTRAITS.md). It lives here rather than in its own script
// because it is literally the plaque without its glyph and rule — a second
// script would mean a second copy of TINT/DARKEN/BLUR, free to drift, and then
// a portrait and a letter plaque would stop matching in a gallery.
const PORTRAIT_PLATE = path.join(ROOT, "public/assets/portrait/plate.webp");

// --- Tuning -----------------------------------------------------------------
const SIZE = 256; // matches AVATAR_SIZE in character/actions.js
// Dusk's --surface-raised and --surface (web/app/globals.css). The plaque is
// meant to sit in the same lamplit green as the panels behind it.
// NEUTRAL as of 2026-09-06, Bascinet's call: the plate is fully desaturated
// and no longer teal. `null` rather than a grey triple, because sharp's
// .tint() on a greyscale image is a colorize and there is no such thing as
// tinting something its own colour — the pass is skipped entirely instead.
// Put a { r, g, b } back here to bring a hue back.
const TINT = null;
// Brightness multiplier; the plate has to stay well under the ink. Taken down
// 20% from 0.5 on 2026-09-06, in the same pass that dropped the tint.
const DARKEN = 0.4;
const BLUR = 2.5; // abstracts the source photo into mottled stone rather than a legible forest
// The plate used to be evenly lit, which made anything standing on it look
// pasted onto a slab rather than sitting on one. A vertical darkening ramp
// gives it a floor: the subject is in the light at the top and its base sinks
// into shade. Black rather than the teal, so this deepens the stone instead of
// shifting its hue — and it rides on the shared plate, so a built portrait, a
// helm avatar and a letter plaque all get it without one of them opting in.
const SHADE_TOP = 0.0; // opacity where the ramp begins
const SHADE_BOTTOM = 0.5; // opacity at the bottom edge
const SHADE_START = 0.15; // fraction down the plate the ramp begins
// The final tone map, applied to the finished ground and nothing else. It
// raises contrast and subtracts, which is why it is a linear() and not a
// smaller DARKEN — modulate({ brightness }) is a pure multiply and cannot
// express a negative offset or the black crush at the bottom edge.
//
// SOLVED, not eyeballed: a least-squares fit over all 240 unclipped rows of the
// committed plaques against the plate they were cut from, max residual 2.2
// luma. It exists because the 2026-09-06 desaturation could not re-render the
// plaques (the fontconfig trap at the top of this file), so they were mapped in
// place and ended up 15-25 luma darker than the plate, helms and portraits.
// Rather than lighten 27 files that had already been clipped to black, the
// pipeline was moved onto THEIR look — Bascinet's call — so the plate, the
// helms and the built portraits now all land where the plaques already were.
//
// Note where this sits in buildPlate(): last, on the ground alone. The glyph,
// the helm sprite and the portrait bust are all composited AFTER, so the ground
// darkens and the foreground does not. That is the property the original
// hand-rolled map was built to preserve, and the reason a plain brightness
// multiply was rejected then — it dimmed the letter into its own plate.
const TONE_GAIN = 1.4041;
const TONE_OFFSET = -39.17;
// Dusk's --text. Warmer against the teal than pure white; set to "#ffffff" for
// a colder, harder plaque.
const INK = "#efe7d6";
const GLYPH_BOX = 132; // the square the trimmed glyph is fitted into
const FRAME_INSET = 18; // white rule, echoing the frame on an illuminated initial
const FRAME_WIDTH = 2;
const FRAME_OPACITY = 0.85;
// WebP, matching what updateCharacterProfile already stores for an uploaded
// avatar — so the route serves one content type either way, and 27 plates
// cost ~145KB in the repo instead of ~1MB as PNG.
const WEBP_QUALITY = 88;
// ----------------------------------------------------------------------------

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// The tinted stone tile, shared by every letter — rendered once.
//
// Two passes, with the tint LAST and alone, deliberately: chaining .tint()
// and .modulate() in a single pipeline silently drops the tint and returns a
// flat greyscale plate (sharp applies modulate after tint and it clears the
// chroma). Splitting them is the whole reason this reads teal.
async function buildPlate() {
  const stone = await sharp(BACKGROUND)
    .resize(SIZE, SIZE, { fit: "cover" })
    .greyscale()
    // The source is a photograph of a hillside; blurred, it stops reading as
    // trees and starts reading as the mottling in a slab of green marble.
    .blur(BLUR)
    .modulate({ brightness: DARKEN })
    .png()
    .toBuffer();

  // A third pass, not a link in either chain above: the tint has to be last
  // and alone (see the comment on this function), so the shade goes on after
  // it. Skipped entirely when TINT is null — the stone is already greyscale
  // from the first pass, and .tint() with a grey would only flatten it again.
  const tinted = TINT ? await sharp(stone).tint(TINT).png().toBuffer() : stone;
  // The tone map goes last, over a plate that already carries its shade ramp —
  // it is graded against the FINISHED ground, so it cannot be folded into
  // DARKEN above without changing what it was fitted to.
  return sharp(tinted)
    .composite([{ input: shadeSvg() }])
    .linear(TONE_GAIN, TONE_OFFSET)
    .png()
    .toBuffer();
}

// The darkening ramp, over the full canvas. Starts at SHADE_START rather than
// the top edge so the lit half stays lit and only the lower plate falls away.
function shadeSvg() {
  return Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
       <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0" stop-color="#000" stop-opacity="${SHADE_TOP}" />
         <stop offset="${SHADE_START}" stop-color="#000" stop-opacity="${SHADE_TOP}" />
         <stop offset="1" stop-color="#000" stop-opacity="${SHADE_BOTTOM}" />
       </linearGradient></defs>
       <rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="url(#s)" />
     </svg>`,
  );
}

function frameSvg() {
  const inset = FRAME_INSET;
  const side = SIZE - inset * 2;
  return Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
       <rect x="${inset}" y="${inset}" width="${side}" height="${side}"
             fill="none" stroke="${INK}" stroke-width="${FRAME_WIDTH}"
             stroke-opacity="${FRAME_OPACITY}" />
     </svg>`,
  );
}

// Blackletter capitals differ wildly in width and in how far they overshoot
// the baseline, so rendering every glyph at one point size makes some tower
// over others. Render big, trim to the actual ink, then fit that into a fixed
// box — every letter then reads as the same visual weight.
async function renderGlyph(letter) {
  const raw = await sharp({
    text: {
      text: `<span foreground="${INK}">${letter}</span>`,
      font: "UnifrakturMaguntia 200",
      fontfile: FONT_FILE,
      rgba: true,
    },
  })
    .png()
    .toBuffer();

  return sharp(raw)
    .trim()
    .resize(GLYPH_BOX, GLYPH_BOX, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// `--plate-only` rebuilds portrait/plate.webp and stops, leaving the 27
// plaques alone. It exists for the fontconfig trap at the top of this file: on
// a machine where pango silently substitutes Helvetica, a full run would
// replace every blackletter plaque with a sans one, and the script would still
// exit 0. The plate needs no font, so this half is always safe to run — which
// is what lets the plate's tuning change without a font-capable machine.
//
// After a plate-only run, re-run `npm run assets:helms` (they composite onto
// it) and post-process the existing plaques to match, since they cannot be
// re-rendered. See PORTRAITS.md.
const PLATE_ONLY = process.argv.includes("--plate-only");

async function main() {
  for (const file of PLATE_ONLY ? [BACKGROUND] : [BACKGROUND, FONT_FILE]) {
    try {
      await fs.access(file);
    } catch {
      console.error(`Missing required asset: ${path.relative(ROOT, file)}`);
      process.exit(1);
    }
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const plate = await buildPlate();
  const frame = frameSvg();

  await fs.mkdir(path.dirname(PORTRAIT_PLATE), { recursive: true });
  await sharp(plate).webp({ quality: WEBP_QUALITY }).toFile(PORTRAIT_PLATE);

  if (PLATE_ONLY) {
    console.log(`done (plate only -> ${path.relative(ROOT, PORTRAIT_PLATE)})`);
    return;
  }

  // The fallback: plaque and frame, no glyph. Served for an initial that is
  // not a plain A-Z — an accented or non-Latin first letter, a digit, or a
  // character whose firstName is somehow empty.
  await sharp(plate)
    .composite([{ input: frame }])
    .webp({ quality: WEBP_QUALITY })
    .toFile(path.join(OUT_DIR, "_default.webp"));

  for (const letter of LETTERS) {
    const glyph = await renderGlyph(letter);
    await sharp(plate)
      .composite([{ input: frame }, { input: glyph, gravity: "centre" }])
      .webp({ quality: WEBP_QUALITY })
      .toFile(path.join(OUT_DIR, `${letter}.webp`));
  }

  console.log(
    `done (${LETTERS.length} letters + _default -> ${path.relative(ROOT, OUT_DIR)}, ` +
      `plate -> ${path.relative(ROOT, PORTRAIT_PLATE)})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
