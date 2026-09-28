// What a place sounds like, against the rules the design documents set (docs/sounds.yaml,
// `placement:`). A place is a stack of tiers, most specific first; these hold that stack to
// the document:
//
//   - ONLY ambience that refers to space plays in space, and nothing that refers only to
//     space plays anywhere else.
//   - General ambience is in all six zones that are not space, and fortress ambience in the
//     Keep, the Town and the Undertown.
//   - The fire is not ambience anywhere. `newfireloop.ogg` is far too intense for a hearth,
//     so it is kept for a fire that is out of control (docs/sounds.yaml, `needs`).
//   - The most specific tier wins most of the time, and the others still get a turn.
//
// placeAmbience.js and musicSchedule.js import nothing, so they load from plain Node
// (scripts/audio/sound-report.mjs does the same).

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const { resolveAmbience, placeHas, ALL_PLACES, GHOST, INTERRUPTS, BY_DRUG } = await import(
  "../../app/components/placeAmbience.js"
);
const { pickTiered, TIER_WEIGHTS } = await import("../../app/components/musicSchedule.js");
const { DRUGS } = await import("../drugHighs.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const yaml = createRequire(import.meta.url)("js-yaml");
const SOUNDS = yaml.load(fs.readFileSync(path.join(ROOT, "docs", "sounds.yaml"), "utf8")).sounds;

/** The registry's use case for a served src, by basename. */
const USE = new Map();
for (const entry of Object.values(SOUNDS)) {
  if (entry.served) USE.set(entry.served.slice(entry.served.lastIndexOf("/") + 1), entry.use);
}
const caseOf = (src) => USE.get(src.slice(src.lastIndexOf("/") + 1));
const all = (place) => place.tiers.flat();
const names = (place) => all(place).map((p) => p.src.slice(p.src.lastIndexOf("/") + 1));

// What web/lib/gamePhase.js#standingFor hands the client, trimmed to what matters here.
const INN = {
  locationSlug: "town-7",
  zoneSlug: "town",
  indoors: true,
  attributes: ["haven", "kitchen"],
  rooms: { r1: "town-7-1", r2: "town-7-2", r4: "town-7-4" },
};
const at = (zoneSlug, locationSlug = `${zoneSlug}-x`) => ({ locationSlug, zoneSlug, attributes: [] });
const EARTHBOUND = ["fortress", "town", "undertown", "hills", "caves", "depths"];

test("every piece anywhere is a described, served file", () => {
  for (const pool of ALL_PLACES) {
    for (const p of [...pool.pieces, ...pool.spots]) assert.ok(caseOf(p.src), `${pool.id}: ${p.src}`);
  }
});

test("no pool anywhere plays the fire", () => {
  for (const pool of ALL_PLACES) {
    for (const p of [...pool.pieces, ...pool.spots]) assert.ok(!p.src.endsWith("/newfireloop.ogg"), pool.id);
  }
});

test("space hears only what refers to space, whoever is listening", () => {
  for (const standing of [
    at("space", "space-1"),
    {
      ...at("space", "space-1"),
      attributes: ["offMap", "space"],
      impaired: true,
      robed: true,
      hallucinating: true,
      drugs: DRUGS.map((d) => ({ id: d.id, takenAt: null })),
    },
  ]) {
    const place = resolveAmbience(standing);
    assert.equal(place.tiers.length, 1);
    for (const p of all(place)) assert.match(caseOf(p.src), /space/i, p.src);
    for (const p of place.spots) assert.match(caseOf(p.src), /space/i, p.src);
  }
});

test("nothing that refers only to space plays anywhere else", () => {
  for (const zone of EARTHBOUND) {
    for (const standing of [at(zone), { ...at(zone), impaired: true, hallucinating: true, robed: true }]) {
      for (const p of all(resolveAmbience(standing))) {
        const use = caseOf(p.src);
        // "Ambience in space and the underfort" is the one sentence that names both.
        if (/space/i.test(use)) assert.match(use, /underfort/i, `${zone}: ${p.src}`);
      }
    }
  }
});

test("general ambience is in all six zones, and fortress ambience in the three fortress zones", () => {
  for (const zone of EARTHBOUND) {
    const heard = names(resolveAmbience(at(zone)));
    assert.ok(heard.includes("after-the-party.ogg"), `${zone} lacks the general tier`);
    assert.equal(heard.includes("the-dark-mother.ogg"), ["fortress", "town", "undertown"].includes(zone), zone);
  }
  assert.ok(!names(resolveAmbience(at("space", "space-1"))).includes("after-the-party.ogg"));
});

test("caves/depths ambience plays in the Black Hills, and surfacing plays nowhere", () => {
  const hills = names(resolveAmbience(at("hills")));
  for (const f of ["introspectre.ogg", "rivers-of-glass.ogg", "to_hell.ogg"]) assert.ok(hills.includes(f), f);
  for (const pool of ALL_PLACES) assert.ok(!pool.pieces.some((p) => p.src.endsWith("/surfacing.ogg")), pool.id);
});

test("the Inn stacks its own tracks over the town, the fortress and the general tiers", () => {
  const inn = resolveAmbience(INN);
  assert.deepEqual(
    inn.tiers[0].map((p) => p.src.slice(p.src.lastIndexOf("/") + 1)),
    ["song_game.ogg", "feast-of-the-night.ogg"],
  );
  assert.equal(inn.tiers.length, 4);
  // Every room at the Inn hears the Inn: BY_ROOM is empty.
  for (const key of ["room:r1", "room:r2", "room:r4", null]) assert.equal(resolveAmbience(INN, key), inn, key);
});

test("what the listener IS is the most specific tier, not a wall", () => {
  const hazy = resolveAmbience({ ...INN, hallucinating: true, robed: true });
  const top = hazy.tiers[0].map((p) => p.src.slice(p.src.lastIndexOf("/") + 1));
  assert.deepEqual(top, ["parhelic-triangle.ogg", "fools-village.ogg", "abyssus-abyssum-invocat.ogg"]);
  assert.ok(hazy.tiers.length > 1, "the place still gets a word in");
  assert.ok(names(resolveAmbience({ ...INN, moodTone: "bad" })).includes("loop_airy4.ogg"));
});

test("a drug is one song, heard as the listener's own bed while the high lasts", () => {
  const songs = Object.values(BY_DRUG).map((p) => p.src);
  assert.equal(new Set(songs).size, songs.length, "no song belongs to two drugs");
  for (const [id, p] of Object.entries(BY_DRUG)) {
    assert.ok(DRUGS.some((d) => d.id === id), `${id} is not a drug in web/lib/drugHighs.js`);
    assert.match(caseOf(p.src), /drug|marijuana|hallucinating/i, id);
    const high = resolveAmbience({ ...INN, drugs: [{ id, takenAt: null }] });
    assert.ok(high.tiers[0].includes(p), `${id} is not in the top tier`);
    assert.ok(high.tiers.length > 1, "the place still gets a word in");
    assert.ok(!placeHas(resolveAmbience(INN), p.src), `${id} plays sober`);
  }
  // A drug with no song is simply silent, and a fresh stamp is not a different place.
  assert.equal(resolveAmbience({ ...INN, drugs: [{ id: "no-such-drug", takenAt: 1 }] }), resolveAmbience(INN));
  assert.equal(
    resolveAmbience({ ...INN, drugs: [{ id: "changa", takenAt: 1 }] }),
    resolveAmbience({ ...INN, drugs: [{ id: "changa", takenAt: null }] }),
  );
  // Hallucinating on Bliss: Fool's Village once, not twice.
  const both = names(resolveAmbience({ ...INN, hallucinating: true, drugs: [{ id: "bliss", takenAt: null }] }));
  assert.equal(both.filter((n) => n === "fools-village.ogg").length, 1);
});

test("the same place resolves to the same object, so a re-render is not a move", () => {
  assert.equal(resolveAmbience({ ...INN }), resolveAmbience({ ...INN }));
});

test("a piece is kept across a move it can still play in, and cut by one it cannot", () => {
  const town = resolveAmbience(at("town"));
  const general = all(town).find((p) => p.src.endsWith("/after-the-party.ogg"));
  const fortress = all(town).find((p) => p.src.endsWith("/the-dark-mother.ogg"));
  assert.ok(placeHas(resolveAmbience(at("undertown")), general.src));
  assert.ok(placeHas(resolveAmbience(at("fortress")), fortress.src));
  assert.ok(!placeHas(resolveAmbience(at("caves")), fortress.src));
  assert.ok(!placeHas(resolveAmbience(at("space", "space-1")), general.src));
});

test("a ghost hears the dead, and the two interrupters are described as what they do", () => {
  assert.deepEqual(names(GHOST), ["consciousness-dissolves.ogg", "geist.ogg", "we-fear-no-evil.ogg"]);
  assert.match(caseOf(INTERRUPTS.ghost.src), /becoming a ghost/);
  assert.match(caseOf(INTERRUPTS.charonLaunch.src), /charon has taken off/);
});

test("pickTiered leans on the most specific tier and never repeats the last piece", () => {
  const tiers = [[{ src: "a" }, { src: "b" }], [{ src: "c" }], [{ src: "d" }]];
  const counts = { top: 0, rest: 0 };
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let last = null;
  for (let i = 0; i < 20_000; i++) {
    const p = pickTiered(tiers, last, rand);
    assert.notEqual(p.src, last);
    counts[p.src === "a" || p.src === "b" ? "top" : "rest"] += 1;
    last = p.src;
  }
  const share = counts.top / (counts.top + counts.rest);
  const expected = TIER_WEIGHTS[0] / (TIER_WEIGHTS[0] + TIER_WEIGHTS[1] + TIER_WEIGHTS[2]);
  assert.ok(share > expected - 0.1 && share < expected + 0.1, `top tier share ${share.toFixed(3)}`);
  assert.ok(counts.rest > 0, "the general tiers never played");
  // One piece and nothing else: it plays again rather than never.
  assert.equal(pickTiered([[{ src: "x" }]], "x").src, "x");
  assert.equal(pickTiered([], null), null);
});
