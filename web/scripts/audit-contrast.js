// WCAG AA gate for the design tokens in web/app/globals.css.
//
// Run with `npm run audit:contrast --workspace=web`. It parses the token
// values straight out of the stylesheet rather than duplicating them here, so
// it can never drift from what the app actually ships — edit a colour, re-run
// this, and it tells you what you broke.
//
// Two rules are the ones people break by accident:
//
//   * The surface ladder. --bg -> --surface -> --surface-raised must keep
//     ~1.20 contrast per step or .panel stops reading as a container. The one
//     documented exception is a light theme whose --surface is already
//     near-white: there is no headroom above it, so the raised tier is carried
//     by --e-3 shadow instead. See the limestone block in globals.css.
//   * --accent vs --accent-text. Text and outlines must use --accent-text;
//     --accent is a fill. Collapsing them back into one token is what made
//     every button in the app fail AA.
//   * The zone code, --zone-fortress/town/forest/hills/marshes/caves/
//     depths. These are fills
//     only -- the rule down the side of a .zone-chip -- and are gated at 3.0
//     against --surface, not AA. Spending one as a text colour ships a 2.x
//     contrast; that is what the --accent scan below exists to catch for
//     --accent, and the same discipline applies here.

const fs = require("fs");
const path = require("path");

const CSS_PATH = path.join(__dirname, "..", "app", "globals.css");
const THEMES = ["dusk", "dawn", "limestone"];

const AA = 4.5; // WCAG AA, normal-size text
const LADDER_MIN = 1.2; // per-step surface separation
const BORDER_MIN = 1.9; // hairline vs the surface it sits on
const NEAR_WHITE = 0.85; // relative luminance above which raised is shadow-carried
// The zone code (--zone-*) is a 3px chip rule, never text, so it answers to
// the large-graphic floor rather than AA. None of the four map-picked hues
// would ever clear 4.5 -- gating them there would just force them off the
// palette. See the dusk block in globals.css.
const ZONE_MARK_MIN = 3.0;
const ZONE_KEYS = ["fortress", "town", "forest", "hills", "marshes", "caves", "depths"];

function parseColor(value) {
  if (value.startsWith("#")) {
    const h = value.slice(1);
    const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
    return { rgb: [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)), a: 1 };
  }
  const inner = value.match(/rgba?\(([^)]+)\)/);
  if (!inner) return null;
  const parts = inner[1].split(",").map((s) => parseFloat(s.trim()));
  return { rgb: parts.slice(0, 3), a: parts[3] === undefined ? 1 : parts[3] };
}

// Flatten a translucent colour onto an opaque backdrop. Borders and field
// backgrounds are rgba, so comparing them raw would report nonsense.
function composite(fg, backdropRgb) {
  return fg.rgb.map((v, i) => v * fg.a + backdropRgb[i] * (1 - fg.a));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// ── color-mix(in oklab, ...) ────────────────────────────────────────────────
// The Combat tile's eight band colours are not tokens. They are mixes of three
// tokens, so that the red-through-grey-to-green ramp follows whichever theme
// is on instead of being written out as eight hex values per theme — which is
// what CLAUDE.md's no-hardcoded-colour rule requires and what would otherwise
// have put six unaudited colours on the sheet.
//
// A mix has to be reproduced here to be gated, and it has to be reproduced in
// oklab, because oklab is what the stylesheet asks for: mixing the same two
// colours in sRGB lands somewhere visibly different, and a gate on the wrong
// colour is worse than no gate.
function srgbToLinear(v) {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v) {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(s * 255)));
}

function rgbToOklab([r, g, b]) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

// `color-mix(in oklab, A p%, B)` — A at p, B at the remainder.
function mixOklab(rgbA, rgbB, weightA) {
  const a = rgbToOklab(rgbA);
  const b = rgbToOklab(rgbB);
  return oklabToRgb(a.map((v, i) => v * weightA + b[i] * (1 - weightA)));
}

// The ramp, kept in the order and the weights globals.css declares. A band
// added there without a row here goes unaudited, which is the one way this
// gate can quietly stop covering the thing it was written for.
const COMBAT_BANDS = [
  ["pitiful", "--danger", null, 1],
  ["weak", "--danger", "--muted", 0.5],
  ["mediocre", "--muted", null, 1],
  ["capable", "--positive", "--muted", 0.25],
  ["seasoned", "--positive", "--muted", 0.5],
  ["dangerous", "--positive", "--muted", 0.75],
  ["lethal", "--positive", null, 1],
  ["legendary", "--positive", null, 1],
];

function readTokens(css, theme) {
  const block = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!block) throw new Error(`No [data-theme="${theme}"] block in globals.css`);
  const tokens = {};
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s*(--[\w-]+):\s*([^;]+);/);
    if (m) tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

function main() {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  let failures = 0;

  for (const theme of THEMES) {
    const t = readTokens(css, theme);
    const bg = parseColor(t["--bg"]).rgb;
    const surface = parseColor(t["--surface"]).rgb;
    const raised = parseColor(t["--surface-raised"]).rgb;

    const results = [];
    const gate = (label, actual, min) => {
      const ok = actual >= min;
      if (!ok) failures += 1;
      results.push(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(31)}${actual.toFixed(2)}  (min ${min})`);
    };

    gate("bg -> surface", contrast(bg, surface), LADDER_MIN);

    if (luminance(surface) > NEAR_WHITE) {
      results.push(
        `  n/a   ${"surface -> surface-raised".padEnd(31)}${contrast(surface, raised).toFixed(2)}  (shadow-carried: surface is near-white)`,
      );
    } else {
      gate("surface -> surface-raised", contrast(surface, raised), LADDER_MIN);
    }

    gate("border vs surface", contrast(composite(parseColor(t["--border"]), surface), surface), BORDER_MIN);

    for (const token of ["--text", "--muted", "--speech", "--accent-text", "--danger", "--positive", "--warning"]) {
      gate(`${token} on surface`, contrast(composite(parseColor(t[token]), surface), surface), AA);
    }

    // The Combat tile's ramp (COMBAT.md). Every step is body text on a panel,
    // so every step owes full AA — a band nobody can read is a band that says
    // nothing, and the whole point of the ramp is that the word and its colour
    // say the same thing twice.
    for (const [key, tokenA, tokenB, weight] of COMBAT_BANDS) {
      const a = composite(parseColor(t[tokenA]), surface);
      const rgb = tokenB ? mixOklab(a, composite(parseColor(t[tokenB]), surface), weight) : a;
      gate(`combat "${key}" on surface`, contrast(rgb, surface), AA);
    }

    gate(
      "--on-accent on --accent-solid",
      contrast(parseColor(t["--on-accent"]).rgb, parseColor(t["--accent-solid"]).rgb),
      AA,
    );

    // Missing token throws on .rgb rather than silently scoring 0 -- which is
    // exactly what should happen when someone adds a theme block and forgets
    // the zone code.
    for (const key of ZONE_KEYS) {
      gate(
        `--zone-${key} on surface`,
        contrast(parseColor(t[`--zone-${key}`]).rgb, surface),
        ZONE_MARK_MIN,
      );
    }

    console.log(`\n=== ${theme} ===`);
    console.log(results.join("\n"));
  }

  // The token gates above can only see globals.css. But --accent's rule is
  // about how JS *uses* it, and that is exactly where it broke: 14 call sites
  // were colouring text with --accent (2.96 on dusk's --surface, under even
  // the 3.0 large-text floor) and no gate here could see any of them. So scan
  // the source too, and make the header's rule 2 enforceable rather than
  // aspirational.
  failures += auditAccentUsage();

  if (failures) {
    console.error(`\n${failures} contrast gate(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll contrast gates hold.");
}

// Walks web/app and web/lib for var(--accent) used as anything other than a
// fill or a rule (background, borderColor, boxShadow). That is the whole of
// what the token is for; text and outlines take --accent-text.
function auditAccentUsage() {
  const roots = [path.join(__dirname, "..", "app"), path.join(__dirname, "..", "lib")];
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
      } else if (entry.name.endsWith(".js")) {
        fs.readFileSync(full, "utf8")
          .split("\n")
          .forEach((line, i) => {
            // Allowlist, not denylist. A line can legitimately carry both --
            // `{ borderColor: "var(--accent)", color: "var(--accent-text)" }` --
            // so each var(--accent) is attributed to the property it sits
            // under. But the property is often absent: costColor() used to
            // `return "var(--accent)"` and let its six callers spend it as a
            // text colour, which no denylist could see. So anything that is not
            // demonstrably a fill or a rule is a finding, and a helper that
            // hands the token out for the caller to decide is exactly the case
            // worth flagging.
            let from = 0;
            for (;;) {
              const at = line.indexOf("var(--accent)", from);
              if (at === -1) break;
              from = at + 1;
              const keys = [...line.slice(0, at).matchAll(/([-\w]+)\s*:/g)];
              const prop = keys.length ? keys[keys.length - 1][1] : "";
              if (!/^(background|backgroundColor|border|borderColor|borderLeftColor|borderTopColor|borderRightColor|borderBottomColor|boxShadow|caretColor|accentColor)$/.test(prop)) {
                offenders.push(`${path.relative(path.join(__dirname, ".."), full)}:${i + 1}`);
                break;
              }
            }
          });
      }
    }
  };

  for (const root of roots) if (fs.existsSync(root)) walk(root);

  console.log("\n=== --accent usage ===");
  if (!offenders.length) {
    console.log("  PASS  var(--accent) is only ever a fill or a rule");
    return 0;
  }
  console.log(`  FAIL  var(--accent) outside a fill/rule -- use var(--accent-text):`);
  for (const o of offenders) console.log(`          ${o}`);
  return offenders.length;
}

main();
