#!/usr/bin/env node
// Bascinet's own sound picks -> assets/osw-sounds/. See assets/osw-sounds/README.md.
//
// The OpenSourceWeb half of the library came out of a clone (scripts/osw/export-sounds.py).
// This half comes out of E:\Bascinet\V3\Sounds\, four folders of tracks Bascinet chose and
// described in "New Music and Sounds.docx". The files there are named the way the downloader
// named them — artist, title, YouTube id in brackets, full-width colons and all — which is no
// name to serve over a URL. So each one gets a library name here, keyed on its YouTube id,
// which is the one part of the filename that cannot be spelled two ways.
//
// NOT byte-for-byte, unlike the OSW half: Bascinet chose to keep these re-encoded (stereo
// Vorbis at -q:a 2, about 96 kbps) rather than spend another 290 MB of history on masters.
// The originals stay on E:. scripts/audio/build-assets.sh still makes the served copies from
// these, the same way it does from the OSW files.
//
//   node scripts/audio/import-bascinet-sounds.mjs [--src "<Sounds folder>"] [--force]
//
// Writes assets/osw-sounds/bascinet-sources.json, which scripts/audio/import-sound-doc.mjs
// reads to match the document's rows to these files. Skips a file already encoded unless
// --force. Needs ffmpeg on PATH, or FFMPEG=<path>.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIBRARY = path.join(ROOT, "assets", "osw-sounds");
const MANIFEST = path.join(LIBRARY, "bascinet-sources.json");
const FFMPEG = process.env.FFMPEG || "ffmpeg";

const argv = process.argv.slice(2);
const FORCE = argv.includes("--force");
const srcArg = argv.indexOf("--src");
const SRC = srcArg === -1 ? "E:\\Bascinet\\V3\\Sounds" : argv[srcArg + 1];

// YouTube id -> [library path, artist, title]. The folder is what the file is FOR, the same
// rule as the rest of the library, not the folder it sat in on E: — the two "Den music" rows
// Bascinet filed under Effects go in den/ with the other nine songs.
//
// Two of these are already in the library under OSW names, and are the same recordings at a
// better rate (checked by duration): surfacing and a-thousand-empty-rooms. They keep their
// names, so nothing that plays them has to change.
const TRACKS = {
  // ---- Ambience
  "OaVkQ6tIYvc": ["ambience/after-the-party.ogg", null, "After The Party"],
  "N2Qp_n1PV-I": ["ambience/ager-sonus-lost.ogg", "Ager Sonus", "Lost"],
  "yi2fYdXwIG8": ["ambience/derelict-approach.ogg", "Alien: Isolation Soundtrack", "Derelict Approach"],
  "7mONA54WFxs": ["ambience/the-dark-mother.ogg", "Atrium Carceri", "The Dark Mother"],
  "aoM7GlnA7Uw": ["ambience/an-atrementous-city.ogg", "Atrium Carceri & Cities Last Broadcast", "An Atrementous City"],
  "kTperX-_ZrM": ["ambience/laudanum.ogg", "Atrium Carceri & Cities Last Broadcast", "Laudanum"],
  "Eyiorm0F8bM": ["ambience/the-great-order-of-things.ogg", "Atrium Carceri & Cities Last Broadcast", "The Great Order of Things"],
  "m6Qv49Aw5qk": ["ambience/a-curved-blade.ogg", "Atrium Carceri", "A Curved Blade"],
  "1GVINHRiG2w": ["ambience/from-chasms-reborn.ogg", "Atrium Carceri", "From Chasms Reborn"],
  "aAwNyv6nyPw": ["ambience/industrial-district.ogg", "Atrium Carceri", "Industrial District"],
  "2ZZv99VX-5E": ["ambience/maintenance-tunnels.ogg", "Atrium Carceri", "Maintenance Tunnels"],
  "czfaKg8eon4": ["ambience/floor-6-please.ogg", "Atrium Carceri, Cities Last Broadcast, God Body Disconnect", "Floor 6, Please"],
  "x_NeqAGR8pA": ["ambience/sorry-sir-wrong-room.ogg", "Atrium Carceri, Cities Last Broadcast, God Body Disconnect", "Sorry Sir, You Are In The Wrong Room"],
  "QGX1nSR5ymw": ["ambience/parhelic-triangle.ogg", "Autechre", "Parhelic Triangle"],
  "nr7ChveMl8Q": ["ambience/dust-are-all-her-beauties.ogg", "Caul", "Dust Are All Her Beauties"],
  "Jl7x7VSdpVc": ["ambience/consciousness-dissolves.ogg", null, "Consciousness Dissolves into the Emptiness"],
  "vKrLyAgLUbM": ["ambience/such-is-life.ogg", "Cosey Fanni Tutti", "Such Is Life"],
  "Wn9hJbqVy_A": ["ambience/darkwood-untitled-2.ogg", "Artur Kordas (Darkwood OST)", "Untitled 2"],
  "sTYcT_w3DbI": ["ambience/introspectre.ogg", "Depeche Mode", "Introspectre"],
  "UFNAMoRUZts": ["ambience/geist.ogg", "Dronny Darko", "Geist"],
  "P7argRuSus0": ["ambience/rivers-of-glass.ogg", "Dronny Darko", "Rivers of Glass"],
  "8RjXB6zhJ3Q": ["ambience/departure.ogg", "Emra Grid", "Departure"],
  "ODTWtjyYY48": ["ambience/feast-of-the-night.ogg", "Erang", "Feast Of The Night"],
  "WzyBsdAkFBM": ["ambience/fear-insertion.ogg", "F.E.A.R. OST", "Insertion"],
  "tq2BPO_M4wo": ["ambience/shes-afraid-of-you.ogg", "F.E.A.R. OST", "She's Afraid Of You"],
  "Royup6zcPwk": ["ambience/subway-suspense.ogg", "F.E.A.R. 2 OST", "Subway Suspense"],
  "PIns3RutZz0": ["ambience/fear2-city-ambience.ogg", "F.E.A.R. 2 OST", "City Ambience"],
  "6Bz3wBuRpEQ": ["ambience/underground-troubles.ogg", "Fallout 1 Soundtrack", "Underground Troubles (Caves)"],
  "kkLcO87y-qI": ["ambience/there-will-be-lies.ogg", "Flowers for Bodysnatchers", "There Will Be Lies"],
  "AijB2f-iCEg": ["ambience/abyssus-abyssum-invocat.ogg", "Hades", "Abyssus Abyssum Invocat"],
  "UYGIDlywyC0": ["ambience/restless-dreams.ogg", "Silent Hill", "In My Restless Dreams I See That Town (Instrumental)"],
  "xwIBo8NTx1U": ["ambience/the-hierophant.ogg", "Kammarheit", "The Hierophant"],
  "nhee1IdD-m4": ["ambience/locus-meropis.ogg", null, "Locus Meropis"],
  "aZ21watnnY0": ["ambience/mantrap.ogg", null, "Mantrap (Remastered)"],
  "OEpZTp1GJwY": ["ambience/sentient.ogg", "Pharmakon", "Sentient"],
  "3ryH4b4Y5OQ": ["ambience/the-elementary-school.ogg", "Postal 1 (1997) Soundtrack", "The Elementary School"],
  "kRIZyvGRUAU": ["ambience/we-fear-no-evil.ogg", null, "Protection, We Fear No Evil"],
  "jVmJwfj4YYA": ["ambience/horns-of-eden.ogg", "Randal Collier-Ford", "Horns of Eden"],
  "sq3qnC2E7hI": ["ambience/contaminated.ogg", "Resident Evil Remake Soundtrack", "Contaminated"],
  "7fOYSndG3tc": ["ambience/scraped-steel.ogg", null, "Scraped Steel"],
  "3WG4SNOdBY4": ["ambience/heliopolis.ogg", "Sephiroth", "Heliopolis"],
  "vJpWCT3hDgA": ["ambience/slower.ogg", null, "Slower"],
  "U0nuEgp2SBA": ["ambience/overture-for-castration.ogg", "Spiritual Front", "Overture for Castration"],
  "nOzuO-w1Rv8": ["ambience/garden-music.ogg", "System Shock 2", "Garden music"],
  "x9FkiNGE9MI": ["ambience/auldale.ogg", "Thief: Deadly Shadows OST", "Auldale"],
  "9lMArVYkqZ8": ["ambience/rectum.ogg", "Thomas Bangalter", "Rectum"],
  "D2ATW0Edwec": ["ambience/sacrament-and-crucifixion.ogg", "Trepaneringsritualen", "Sacrament & Crucifixion"],

  // ---- Den (and the two Den songs filed under Effects)
  "3e_nJRzCpBE": ["den/blue-monday.ogg", "Orgy", "Blue Monday"],
  "OJm2lSxXrwY": ["den/into-the-void.ogg", "Buzz Kull", "Into The Void"],
  "xa3aAjnBpzw": ["den/red-blood.ogg", "Chad VanGaalen", "Red Blood"],
  "hzRltUL5M3k": ["den/change-in-the-house-of-flies.ogg", null, "Change (In the House of Flies)"],
  "7-ADAr9-Aqs": ["den/i-love-you-mary-jane.ogg", "Cypress Hill & Sonic Youth", "I Love You Mary Jane"],
  "IdEHGXeu4SY": ["den/hardly-wait.ogg", null, "Hardly Wait"],
  "a9qKkG7NDu0": ["den/navy-light.ogg", "Labyrinth Ear", "Navy Light"],
  "ve4vd5FSIrU": ["den/lsd-truth.ogg", "Lords of Acid", "LSD=Truth"],
  "0gsXdT7mjoI": ["den/it-kills.ogg", "The Soft Moon", "It Kills"],
  "nqQD9-1CUuU": ["den/loose-ends.ogg", "Ronnie & The Rainbows", "Loose Ends"],
  "DIUHwSLKe24": ["den/night-creature.ogg", "The Gigolo's", "Night Creature (1960)"],

  // ---- Effects
  "vHt-0LjZmWM": ["effects/mature-raver.ogg", "AFX", "(mature raver)"],
  "7J5JMJ0JHx4": ["effects/hishmaliin.ogg", "Dvar", "Hishmaliin"],
  "RxKzJu1WdVc": ["effects/pipe-organ-ambience.ogg", "Fatal Frame IV OST", "Pipe Organ Ambience"],
  "BBcPpHDJ4yQ": ["effects/choir-of-liberty.ogg", "Freedom Fighters", "Choir Of Liberty"],
  "gATKeoPnlh4": ["effects/hot-plates.ogg", "Judge Bitch", "Hot Plates"],
  "UDGNqgSD2Bc": ["effects/islamic-trance.ogg", "Muhmood", "Islamic Trance - Ed Wood Jr"],
  "oxJ6NCyVsQ4": ["effects/oval-sky.ogg", "Oval", "Sky (2010)"],
  "Wfpc_1bK8ao": ["effects/fools-village.ogg", "Fool's Village OST", "Main Theme"],

  // ---- Music
  "Oktc1HXsvKI": ["music/red-calx.ogg", "Aphex Twin", "Red Calx (medium pitch)"],
  "0H02Y7wpnEU": ["music/surfacing.ogg", "Atrium Carceri", "Surfacing"],
  "aA1AfLJxWjQ": ["music/identity-theft.ogg", "Atrium Carceri", "Identity Theft"],
  "5jfU1HN2pSQ": ["music/a-thousand-empty-rooms.ogg", "Atrium Carceri, Cities Last Broadcast, God Body Disconnect", "A Thousand Empty Rooms"],
  "M-uV_YKgb30": ["music/conflict-and-climax.ogg", null, "Conflict & Climax"],
  "rQUUh0uX_kI": ["music/mission-end.ogg", "Fatal Frame IV: Mask of the Lunar Eclipse OST", "Mission End"],
  "8tFuur4Jk8M": ["music/friction.ogg", null, "Friction"],
  "8pE2a-z5r0k": ["music/manunkind.ogg", null, "Manunkind"],
  "JRL1fqhDV1I": ["music/stone-in-focus.ogg", null, "Stone In Focus"],
};

// Already in the library as OSW files, and replaced here on purpose.
const REPLACES_OSW = new Set(["music/surfacing.ogg", "music/a-thousand-empty-rooms.ogg"]);

const ID = /\[([A-Za-z0-9_-]{11})\]\.ogg$/;

function main() {
  const found = new Map();
  for (const folder of fs.readdirSync(SRC, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    for (const name of fs.readdirSync(path.join(SRC, folder.name))) {
      const m = ID.exec(name);
      if (!m) continue;
      if (!TRACKS[m[1]]) throw new Error(`No library name for ${folder.name}/${name} — add its id to TRACKS`);
      if (found.has(m[1])) throw new Error(`Two files carry the id ${m[1]}`);
      found.set(m[1], { folder: folder.name, name });
    }
  }
  const missing = Object.keys(TRACKS).filter((id) => !found.has(id));
  if (missing.length) throw new Error(`In TRACKS but not on disk: ${missing.join(", ")}`);

  const paths = new Set();
  for (const [rel] of Object.values(TRACKS)) {
    if (paths.has(rel)) throw new Error(`Two tracks share ${rel}`);
    paths.add(rel);
  }

  const manifest = {};
  for (const [id, [rel, artist, title]] of Object.entries(TRACKS).sort((a, b) => a[1][0].localeCompare(b[1][0]))) {
    const { folder, name } = found.get(id);
    const out = path.join(LIBRARY, ...rel.split("/"));
    const inLibrary = fs.existsSync(out);
    const ours = inLibrary && readManifest()[rel];
    if (inLibrary && !ours && !REPLACES_OSW.has(rel)) {
      throw new Error(`${rel} is already an OSW file — pick another name`);
    }
    if (!inLibrary || FORCE || (REPLACES_OSW.has(rel) && !ours)) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const r = spawnSync(
        FFMPEG,
        ["-v", "error", "-y", "-i", path.join(SRC, folder, name), "-vn", "-map_metadata", "-1", "-c:a", "libvorbis", "-q:a", "2", out],
        { stdio: "inherit" },
      );
      if (r.status !== 0) throw new Error(`ffmpeg failed on ${name}`);
      console.log(`  ${rel.padEnd(44)} ${Math.round(fs.statSync(out).size / 1024)} KB`);
    }
    manifest[rel] = {
      youtube: id,
      ...(artist ? { artist } : {}),
      title,
      doc: `${folder}/${name}`,
      ...(REPLACES_OSW.has(rel) ? { replaces: "the OpenSourceWeb file of the same recording" } : {}),
    };
  }

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + "\n");
  console.log(`\n${Object.keys(manifest).length} tracks -> assets/osw-sounds/bascinet-sources.json`);
}

let cached = null;
function readManifest() {
  if (cached) return cached;
  cached = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
  return cached;
}

main();
