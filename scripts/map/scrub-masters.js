#!/usr/bin/env node
// Clears cells out of the Playscii masters that were never meant to show.
//
//   npm run map:scrub               DRY RUN — say what would be cleared
//   npm run map:scrub -- --apply    actually clear them
//
// Two kinds of junk, both invisible in Playscii and so easy to leave behind:
//
//   TRANSPARENT  a glyph painted in palette slot 0. Slot 0 is Playscii's
//                transparent entry, so the glyph draws nothing — it is a
//                drawing nobody can see. barony1 carries a whole
//                neighbourhood of char 608 like this on "Layer 0".
//   BURIED       a glyph underneath the solid rock block (glyph 168), which
//                is the only fully-opaque glyph either map uses. Playscii
//                hides these behind the rock; the web renderer's vignette
//                thins the rock out and exposes them.
//
// The rust pieces buried in the rock at the east end of barony1 are KEPT on
// purpose — that is the rust river, and Bascinet wants it reading through the
// stone as the vignette thins it. That is exactly why the build only WARNS
// about buried cells instead of culling them automatically: a rule that threw
// them all away would have thrown the river away too.
//
// Every cell is matched on its exact current contents before it is touched,
// so re-running this after the art moves cannot damage anything: a cell that
// is no longer what this script expects is reported and skipped.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "docs", "assets", "maps");
const ROCK = 168; // the solid block; see MAP.md 6f
const TRANSPARENT = 0; // palette slot 0

// Channels whose buried cells are kept rather than cleared, by palette index.
// 3 is `heat` — the rust river.
const KEEP_BURIED_FG = new Set([3]);

function scrub(file) {
  const p = path.join(SRC, file);
  const art = JSON.parse(fs.readFileSync(p, "utf8"));
  const W = art.width;
  const layers = art.frames[0].layers;
  const art4 = layers.slice(0, 4);

  // Which cells have opaque rock somewhere above them?
  const rockAt = art4.map((l) => new Set(l.tiles.map((t, i) => (t.char === ROCK ? i : -1)).filter((i) => i >= 0)));

  const cleared = [];
  const kept = [];
  for (let li = 0; li < art4.length; li++) {
    const tiles = art4[li].tiles;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!t.char) continue;
      const at = `(${i % W},${Math.floor(i / W)})`;

      if (t.fg === TRANSPARENT) {
        cleared.push({ li, i, t, why: "transparent", at });
        continue;
      }
      let buriedBy = -1;
      for (let above = li + 1; above < art4.length; above++) {
        if (rockAt[above].has(i)) { buriedBy = above; break; }
      }
      if (buriedBy >= 0) {
        if (KEEP_BURIED_FG.has(t.fg)) kept.push({ li, i, t, at });
        else cleared.push({ li, i, t, why: `under rock on "${art4[buriedBy].name}"`, at });
      }
    }
  }

  return { p, art, layers, cleared, kept, W };
}

function main() {
  const apply = process.argv.includes("--apply");
  let total = 0;

  for (const file of ["barony1.psci", "barony2.psci"]) {
    const { p, art, layers, cleared, kept } = scrub(file);
    console.log(`\n${file}`);
    if (!cleared.length && !kept.length) { console.log("  nothing to do"); continue; }

    const byWhy = {};
    for (const c of cleared) (byWhy[c.why] ??= []).push(c);
    for (const [why, list] of Object.entries(byWhy)) {
      const chars = {};
      for (const c of list) chars[c.t.char] = (chars[c.t.char] ?? 0) + 1;
      console.log(`  clear ${String(list.length).padStart(3)}  ${why}  ` +
        `(${Object.entries(chars).map(([c, n]) => `char ${c}×${n}`).join(", ")})`);
      console.log(`        ${list.slice(0, 12).map((c) => c.at).join(" ")}${list.length > 12 ? ` …+${list.length - 12}` : ""}`);
    }
    if (kept.length) {
      const xs = kept.map((k) => k.i % art.width);
      const ys = kept.map((k) => Math.floor(k.i / art.width));
      console.log(`  keep  ${String(kept.length).padStart(3)}  buried rust — the river ` +
        `(x ${Math.min(...xs)}–${Math.max(...xs)}, y ${Math.min(...ys)}–${Math.max(...ys)})`);
    }

    total += cleared.length;
    if (apply && cleared.length) {
      const before = JSON.stringify(art, null, 1);
      for (const c of cleared) {
        const t = layers[c.li].tiles[c.i];
        if (t.char !== c.t.char || t.fg !== c.t.fg) {
          console.error(`        SKIPPED ${c.at}: contents changed under us`);
          continue;
        }
        t.char = 0;
        t.xform = 0;
      }
      const after = JSON.stringify(art, null, 1);
      if (after !== before) fs.writeFileSync(p, JSON.stringify(art, null, 1));
      console.log(`  written`);
    }
  }

  if (!apply) console.log(`\nDRY RUN — ${total} cells would be cleared. Re-run with -- --apply`);
  else console.log(`\n${total} cells cleared. Rebuild with: npm run map:build`);
}

if (require.main === module) main();

module.exports = { scrub, ROCK, TRANSPARENT, KEEP_BURIED_FG };
