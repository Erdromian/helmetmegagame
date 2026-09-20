// Which day-verbs tire you, and how often each can be pressed.
//
// The Tired -> Exhausted ladder (db/lib/fatigue.js) is the only thing that
// rations a day's work beyond the Move itself. This module does not state a
// duty cycle; it PLAYS one out. It walks turn after turn, and at each turn it
//   - asks the game's own gate whether the verb is refused right now,
//   - applies the game's own grant when it is pressed,
//   - runs the close: staged push first, then the tag-expiry sweep, which is the
//     order in db/index.js TURN_PASSES ("stagedPush", then "tagExpiry"),
// with tag durations and `expiresInto` read from docs/tags.yaml.
//
// It also scans the source for every file that reads or writes the ladder, so
// "does Refine tire you?" is answered by the code, not by memory. If somebody
// adds a fatigue check to another verb, it appears in the readers list and the
// report says so.

const fs = require("fs");
const path = require("path");

const ladder = require("../../../lib/fatigue");
const mining = require("../../../lib/mining");
const soilery = require("../../../lib/soilery");
const refinery = require("../../../lib/refinery");
const { TIRED_SLUG, EXHAUSTED_SLUG, SOILERY_SLUG, PICKAXE_SLUG } = require("../../../lib/constants");
const { expiryFrom } = require("../../../lib/turnFormat");

const REPO = path.resolve(__dirname, "../../../..");

// A verb: how the game refuses it, and what it does to the ladder when pressed.
const VERBS = [
  {
    id: "mine",
    label: "Mine",
    // The gate also wants a pickaxe; give the character one so it answers only about fatigue.
    refused: (slugs) => !mining.computeMiningAccess({ tagSlugs: new Set([...slugs, PICKAXE_SLUG]) }).ok,
    // db/lib/moveEffects.js `exhausted`: step up the ladder from Tired, else grant Tired.
    grant: (held, turn, dur) => {
      const target = ladder.nextFatigueSlug(new Set(held.has(TIRED_SLUG) ? [TIRED_SLUG] : []));
      if (!target) return;
      held.delete(TIRED_SLUG);
      if (!held.has(target)) held.set(target, expiryFrom(turn + 1, dur[target]));
    },
    source: "db/lib/mining.js, db/lib/moveEffects.js",
    mechanism: "Steps the ladder: Tired, then Exhausted. Only Exhausted refuses the next press.",
  },
  {
    id: "refine",
    label: "Refine (Factory)",
    refused: (slugs) => refinery.refineFatigueRefusal(slugs) != null,
    // db/lib/moveEffects.js `exhausted`, read off the Refine button's marker: the same step Mine takes,
    // landed at the turn push rather than the press (the sweep still runs after it).
    grant: (held, turn, dur) => {
      const target = ladder.nextFatigueSlug(new Set(held.has(TIRED_SLUG) ? [TIRED_SLUG] : []));
      if (!target) return;
      held.delete(TIRED_SLUG);
      if (!held.has(target)) held.set(target, expiryFrom(turn + 1, dur[target]));
    },
    source: "web/app/(app)/character/actions/refine.js, db/lib/refinery.js, db/lib/moveEffects.js",
    mechanism: "Steps the ladder like Mine: Tired, then Exhausted. Only Exhausted refuses the next shift.",
  },
  {
    id: "farm",
    label: "Farm",
    refused: (slugs) => soilery.farmRefusalFor([SOILERY_SLUG, ...slugs].map((s) => ({ tag: { slug: s } })), false) != null,
    // db/lib/fatigue.js#grantExhaustedOutright: Exhausted at once, replacing any Tired.
    grant: (held, turn, dur) => {
      held.delete(TIRED_SLUG);
      if (!held.has(EXHAUSTED_SLUG)) held.set(EXHAUSTED_SLUG, expiryFrom(turn + 1, dur[EXHAUSTED_SLUG]));
    },
    source: "db/lib/soilery.js, db/lib/fatigue.js",
    mechanism: "Grants Exhausted outright. Tired or Exhausted both refuse the next press.",
  },
];

// Verbs with no ladder in the code. Their duty is 1 unless the scan below
// finds a fatigue reference in their files, in which case the report flags it.
const UNTIRED = [
  { id: "cut", label: "Harvest Godflesh", files: ["db/lib/godflesh.js"], region: ["web/app/(app)/character/actions/misc.js", "extractGodfleshRequestImpl"] },
  { id: "craft", label: "Craft (any recipe)", files: ["web/app/(app)/character/actions/crafting.js", "web/lib/craftBudget.js"] },
  { id: "butcher", label: "Butcher", files: ["web/app/(app)/character/actions/corpse.js"] },
  { id: "cave", label: "Caving Die (walking)", files: ["db/lib/cavingPass.js"] },
];

const FATIGUE_WORDS = /\b(TIRED_SLUG|EXHAUSTED_SLUG|nextFatigueSlug|grantExhaustedOutright|tired|exhausted)\b/;

function scanFile(rel, region) {
  let text;
  try {
    text = fs.readFileSync(path.join(REPO, rel), "utf8");
  } catch {
    return { rel, found: false, missing: true };
  }
  if (region) {
    // Only the named function, so an unrelated 'exhausted' elsewhere in a big file does not count.
    const start = text.indexOf(`function ${region}`);
    if (start >= 0) {
      const next = text.indexOf("\nexport async function", start + 10);
      text = text.slice(start, next > 0 ? next : start + 12000);
    }
  }
  return { rel, found: FATIGUE_WORDS.test(text), missing: false };
}

function readersOfLadder() {
  const hits = [];
  (function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(REPO, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === "test") continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|mjs)$/.test(e.name)) {
        const text = fs.readFileSync(path.join(REPO, rel), "utf8");
        if (/\b(TIRED_SLUG|EXHAUSTED_SLUG|nextFatigueSlug|grantExhaustedOutright)\b/.test(text)) hits.push(rel);
      }
    }
  })("db/lib");
  for (const d of ["web/lib", "web/app", "bot/src"]) {
    (function walk(dir) {
      let entries = [];
      try {
        entries = fs.readdirSync(path.join(REPO, dir), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name === "node_modules" || e.name === ".next") continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.(js|mjs)$/.test(e.name)) {
          const text = fs.readFileSync(path.join(REPO, rel), "utf8");
          if (/\b(TIRED_SLUG|EXHAUSTED_SLUG|nextFatigueSlug|grantExhaustedOutright)\b/.test(text)) hits.push(rel);
        }
      }
    })(d);
  }
  return hits.sort();
}

// The close of turn n: the verb's grant (staged push), then the expiry sweep,
// which turns a lapsed Exhausted into Tired. `held` maps slug -> last live turn.
function closeTurn(held, n, verb, dur, into) {
  if (verb) verb.grant(held, n, dur);
  for (const [slug, last] of [...held]) {
    if (last <= n) {
      held.delete(slug);
      for (const next of into[slug] ?? []) if (!held.has(next)) held.set(next, expiryFrom(n + 1, dur[next]));
    }
  }
}

function simulate(verb, dur, into, turns) {
  const held = new Map(); // slug -> last live turn
  const acted = [];
  for (let n = 1; n <= turns; n++) {
    for (const [slug, last] of held) if (last < n) held.delete(slug); // defensive; the sweep below normally clears them
    const refused = verb.refused([...held.keys()]);
    acted.push(!refused);
    closeTurn(held, n, refused ? null : verb, dur, into);
  }
  return acted;
}

function fatigueModel({ bySlug, gameTurns = 30 }) {
  const dur = {
    [TIRED_SLUG]: bySlug.get(TIRED_SLUG)?.durationTurns ?? 1,
    [EXHAUSTED_SLUG]: bySlug.get(EXHAUSTED_SLUG)?.durationTurns ?? 1,
  };
  const into = { [EXHAUSTED_SLUG]: bySlug.get(EXHAUSTED_SLUG)?.expiresInto ?? [] };

  const rows = [];
  for (const v of VERBS) {
    const long = simulate(v, dur, into, 400);
    const tail = long.slice(40); // past the opening transient
    const game = simulate(v, dur, into, gameTurns);
    rows.push({
      id: v.id,
      label: v.label,
      tires: true,
      mechanism: v.mechanism,
      source: v.source,
      steady: tail.filter(Boolean).length / tail.length,
      overGame: game.filter(Boolean).length / gameTurns,
      pattern: simulate(v, dur, into, 14).map((x) => (x ? "█" : "·")).join(""),
    });
  }
  for (const u of UNTIRED) {
    const scans = u.files.map((f) => scanFile(f)).concat(u.region ? [scanFile(u.region[0], u.region[1])] : []);
    const aware = scans.some((s) => s.found);
    rows.push({
      id: u.id,
      label: u.label,
      tires: aware,
      mechanism: aware
        ? "The code now mentions the fatigue ladder here. Read it and model it."
        : "Never reads or writes Tired or Exhausted. Limited by the Move alone.",
      source: scans.map((s) => s.rel + (s.missing ? " (missing)" : "")).join(", "),
      steady: 1,
      overGame: 1,
      pattern: "█".repeat(14),
      checked: scans.map((s) => s.rel),
    });
  }

  return {
    byId: Object.fromEntries(rows.map((r) => [r.id, r])),
    rows,
    durations: dur,
    into,
    readers: readersOfLadder(),
    gameTurns,
  };
}

module.exports = { fatigueModel, VERBS, closeTurn };
