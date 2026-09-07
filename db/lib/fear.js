// The hidden fear dial (docs/systemdocs/FEAR.md).
//
// Every character carries Character.fear, 0–100, that no player ever sees as a
// number. What they see is ONE status tag projected from the band it falls in:
//
//    0–10  nothing        10–28 Uncomfortable   28–46 Stressed
//   46–64  Anxious        64–82 Afraid (−1)     82–100 Panic (−2)
//
// The world moves the dial: a night in the wilderness or the caves, a wound, a
// bad Caving Die, hunger, being bound or crucified, a death nearby. Comfort
// moves it back: a roof, a haven, a drink, a lavish meal, tea, a smoke, music,
// a confession, a fulfilled Desire. Held tags scale the GAINS — Brave halves
// everything, Rough Camper / Outsider / Spelunker / Pale soften the outdoors and
// the caves, the phobias sharpen one kind each — and GameConfig.fearIntensity
// (k) scales both directions: gains × k, relief ÷ k. k = 0 is the off switch.
//
// Layout. The top half is pure (no Prisma) and is what db/test/fear.test.js
// exercises: the tables, the band and rung derivations, the multiplier stack.
// The bottom half is the Prisma-in-tx surface every hook calls:
//
//   applyFear(tx, id, { kind, base })      one event
//   applyFearTerms(tx, id, terms)          several at once (the turn pass)
//   applyWoundFear(tx, id, tagIds)         "these tag rows just landed"
//   settleFearTag(tx, id, ...)             project the band onto the sheet
//
// Every function takes `tx` first (the db/lib/dm.js convention) so a hook can
// ride inside the transaction that caused it. This module makes no network
// call; a band-change DM is handed back to the caller AND, unless told not to,
// scheduled through the sender db/index.js registers (setFearDmSender) a
// moment after the surrounding transaction has had time to commit. The turn
// pass passes `notify: false` and carries its DMs back for the thunk instead.
//
// Deliberately NOT on the @lifeweb/db barrel — require it by subpath, so
// web/lib code can import the pure half without dragging the client along.
//
// No require of ./tagWrites here, on purpose: tagWrites requires THIS module
// for applyWoundFear, and a cycle would hand one of them a half-built export.
// A band row is non-stackable, so a plain delete is the whole of "drop it".
const { hasAttribute, SAFE_ATTRIBUTE, WILDERNESS_ATTRIBUTE, HAVEN_ATTRIBUTE } = require("./locationAttributes");
const {
  UNCOMFORTABLE_SLUG,
  STRESSED_SLUG,
  ANXIOUS_SLUG,
  AFRAID_SLUG,
  PANIC_SLUG,
  DYING_SLUG,
} = require("./constants");

const FEAR_MAX = 100;

// Half-open [min, max). Below the first row is "nothing".
const FEAR_BANDS = Object.freeze([
  { min: 10, max: 28, slug: UNCOMFORTABLE_SLUG, label: "Uncomfortable" },
  { min: 28, max: 46, slug: STRESSED_SLUG, label: "Stressed" },
  { min: 46, max: 64, slug: ANXIOUS_SLUG, label: "Anxious" },
  { min: 64, max: 82, slug: AFRAID_SLUG, label: "Afraid" },
  { min: 82, max: Infinity, slug: PANIC_SLUG, label: "Panicking" },
]);
const BAND_SLUGS = FEAR_BANDS.map((b) => b.slug);

// What a night somewhere is worth, on top of NIGHTLY_DECAY. Exactly one
// applies, chosen by placeClassOf.
const PLACE_TERMS = Object.freeze({ CAVE: 14, WILDERNESS: 10, OPEN: -4, INDOORS: -6, HAVEN: -12 });
const NIGHTLY_DECAY = -4;

// Base values, signed: a gain is positive, relief negative. applyFear defaults
// to the entry for its kind, so most callers name the kind and nothing else.
// See FEAR.md for the table with prose. BOUND_HELD and the two moves are
// passed as `base` by their callers because they share a kind with another row.
const EVENTS = Object.freeze({
  WILDERNESS_MOVE: 2,
  CAVE_MOVE: 3,
  DYING: 40,
  CAVE_TROUBLE: 10,
  BOUND: 15,
  BOUND_HELD: 10,
  CRUCIFIED: 80,
  TORTURED: 40,
  DEATH_SEEN: 15,
  CORPSE: 5,
  TURRET: 25,
  HUNGER: 5,
  NOBLE_MEAL: 10,
  ROBBED: 10,
  CONFESSION: -15,
  MUSIC: -10,
  CATHEDRAL: -10,
});
const DESIRE_RELIEF_PER_POINT = 10;
const DRINK_RELIEF = 30;

// What one consume eases, by the STATUS it lands you in (a drink or a drug —
// keyed this way so a brew added to the catalog later is soothing the day it
// ships) or, for the three that grant nothing distinctive, by the item itself.
// consumeReliefFor takes the MAX across all of it, never a sum: Bliss lands
// both euphoric and high and is one drink. A fine meal is deliberately absent —
// it feeds a noble, it calms nobody.
const CONSUME_RELIEF = Object.freeze({
  tipsy: DRINK_RELIEF,
  wasted: DRINK_RELIEF,
  unconscious: DRINK_RELIEF,
  "blind-drunk": DRINK_RELIEF,
  high: DRINK_RELIEF,
  euphoric: DRINK_RELIEF,
  "lavish-meal": 30,
  tea: 15,
  cigarette: 8,
});

// Which Health groups frighten when they land. Illness, mind, minor and
// recovery do not — a cold is not a wound.
const WOUND_GROUPS = new Set(["health-wounds", "health-maiming", "health-infection"]);
const BURN_SLUGS = new Set(["burned", "severe-burns"]);
// Cure-ladder rung (TAGS.md §5c) -> fear. The half rungs are the six named
// exceptions the ladder documents.
const WOUND_FEAR_BY_RUNG = Object.freeze({ 0: 0, 0.5: 4, 1: 8, 2: 15, 3: 30, 3.5: 35, 4: 40, 5: 45, 6: 55, 7: 65 });

// slug -> which kinds it scales, and by how much. "*" is every gain. `when`
// is an extra predicate on the event's ctx (Pyrophobia only bites on a burn).
// Relief is never multiplied; resolveDelta only consults this for base > 0.
const MULTIPLIERS = Object.freeze([
  { slug: "brave", kinds: "*", factor: 0.5 },
  { slug: "rough-camper", kinds: ["WILDERNESS", "CAVE"], factor: 0.5 },
  { slug: "outsider", kinds: ["WILDERNESS"], factor: 0 },
  { slug: "spelunker", kinds: ["CAVE"], factor: 0 },
  { slug: "pale", kinds: ["CAVE"], factor: 0.5 },
  { slug: "hemophobia", kinds: ["WOUND"], factor: 2 },
  { slug: "agoraphobia", kinds: ["WILDERNESS"], factor: 2 },
  { slug: "claustrophobia", kinds: ["CAVE"], factor: 2 },
  { slug: "teratophobia", kinds: ["CAVE_TROUBLE"], factor: 3 },
  { slug: "pyrophobia", kinds: ["WOUND"], factor: 3, when: (ctx) => Boolean(ctx?.burn) },
  // Pain you cannot feel is not frightening. Both are two-turn statuses, so a
  // torturer who waits a day gets the full +40 (db/lib/torture.js).
  { slug: "pain-immunity", kinds: ["TORTURED"], factor: 0 },
  { slug: "opium-high", kinds: ["TORTURED"], factor: 0 },
  // A chrism's anointing steadies the whole dial for its three turns —
  // half of Brave's own rule, on a status instead of a build.
  { slug: "blessed", kinds: "*", factor: 0.5 },
  // The blade quenched in an Aberrant's heart: the wielder's dial does not
  // climb AT ALL while it is in hand. `equipped` rules only fire when the
  // caller can say what is equipped (equippedSlugs below); a caller that
  // cannot simply never applies them, which fails safe — no free immunity.
  { slug: "heartforged-blade", kinds: "*", factor: 0, equipped: true },
]);
// Every slug the tables above read, so a caller loading a sheet knows what to
// select — and so the turn pass can filter its candidate query.
const MULTIPLIER_SLUGS = MULTIPLIERS.map((m) => m.slug);

// --- the pure half --------------------------------------------------------

function clampFear(value) {
  const n = Number.isFinite(value) ? value : 0;
  return Math.round(Math.min(FEAR_MAX, Math.max(0, n)) * 100) / 100;
}

function bandOf(value) {
  const v = clampFear(value);
  return FEAR_BANDS.find((b) => v >= b.min && v < b.max) ?? null;
}

// Where somebody is, as the dial sees it. Haven wins over its own roof; a
// `safe` cave Location (Customs) is a lit room with a sentry, so it reads as
// a roof rather than as the dark.
function placeClassOf(location) {
  if (!location) return "OPEN";
  if (hasAttribute(location, HAVEN_ATTRIBUTE)) return "HAVEN";
  if (location.zone?.kind === "CAVE_LEVEL") return hasAttribute(location, SAFE_ATTRIBUTE) ? "INDOORS" : "CAVE";
  if (location.indoors) return "INDOORS";
  if (hasAttribute(location, WILDERNESS_ATTRIBUTE)) return "WILDERNESS";
  return "OPEN";
}

// The turn-end term for a place class: { kind, base }. Gains carry their own
// kind so Rough Camper and friends can find them; relief is plain PLACE.
function placeTermFor(placeClass) {
  const base = PLACE_TERMS[placeClass];
  return { kind: base > 0 ? placeClass : "PLACE", base };
}

// What walking INTO a place costs, or null when it costs nothing.
function arrivalTermFor(location) {
  const cls = placeClassOf(location);
  if (cls === "CAVE") return { kind: "CAVE", base: EVENTS.CAVE_MOVE };
  if (cls === "WILDERNESS") return { kind: "WILDERNESS", base: EVENTS.WILDERNESS_MOVE };
  return null;
}

// The cure-ladder rung a wound sits on, read off its requirement block the
// way a doctor reads the bill — or null for anything that is not a wound at
// all. A wound with no requirement block is tier 0: real, untreatable, and
// too small to frighten (a scrape, a hangover-shaped thing).
function woundRungOf(tag) {
  const group = tag?.group?.slug ?? tag?.groupSlug ?? null;
  if (!group || !WOUND_GROUPS.has(group)) return null;
  const resources = tag.requirementResources;
  const turns = tag.requirementTurns ?? 0;
  const gambit = Boolean(tag.requirementGambit);
  if (resources == null && tag.requirementTurns == null && !gambit) return 0;
  if (gambit) return 7;
  const r = resources ?? 0;
  if (r >= 8) return 6;
  if (r >= 6) return 5;
  if (r >= 4) return 4;
  if (r === 3) return 3.5;
  if (r === 2) return turns >= 1 ? 3 : 2;
  if (r === 1) return 1;
  return 0.5;
}

function woundFearFor(tag) {
  const rung = woundRungOf(tag);
  if (rung == null) return 0;
  return WOUND_FEAR_BY_RUNG[rung] ?? 0;
}

// The product of every applicable factor. A 0 anywhere wins, whatever else is
// held — Outsider means the wilderness costs nothing, full stop.
function multiplierFor(kind, heldSlugs, ctx = {}, equippedSlugs = null) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  const worn = equippedSlugs instanceof Set ? equippedSlugs : new Set(equippedSlugs ?? []);
  let factor = 1;
  for (const rule of MULTIPLIERS) {
    if (!held.has(rule.slug)) continue;
    // An `equipped` rule reads the sheet's equipped state, not just holding —
    // a Heartforged Blade in a bag steadies nobody.
    if (rule.equipped && !worn.has(rule.slug)) continue;
    if (rule.kinds !== "*" && !rule.kinds.includes(kind)) continue;
    if (rule.when && !rule.when(ctx)) continue;
    factor *= rule.factor;
  }
  return factor;
}

// One term -> the signed change to the dial. Gains: base × multipliers × k.
// Relief and decay: base ÷ k, untouched by any tag. k = 0 zeroes both.
function resolveDelta({ kind, base, heldSlugs, intensity = 1, ctx = {}, equippedSlugs = null }) {
  const k = Number.isFinite(intensity) && intensity > 0 ? intensity : 0;
  if (!base || k === 0) return 0;
  const raw = base > 0 ? base * multiplierFor(kind, heldSlugs, ctx, equippedSlugs) * k : base / k;
  return Math.round(raw * 100) / 100;
}

// Plain, as asked: the band's name and nothing about the number.
function fearBandDm(previousBand, band) {
  if ((previousBand?.slug ?? null) === (band?.slug ?? null)) return null;
  if (!band) return "You've calmed down. ‡";
  return `You are now ${band.label}. ‡`;
}

// --- the Prisma half ------------------------------------------------------

let dmSender = null;
// db/index.js registers the logged REST sender once at load, so a hook deep
// inside a tag write can notify without threading a DM back through five
// callers. Delayed a beat so the transaction that moved the dial has
// committed before the player hears about it.
function setFearDmSender(fn) {
  dmSender = fn;
}
const DM_DELAY_MS = 1500;
function scheduleFearDm(dm) {
  if (!dm || !dmSender) return;
  setTimeout(() => {
    Promise.resolve()
      .then(() => dmSender(dm.discordUserId, dm.content))
      .catch((err) => console.error(`Fear DM to ${dm.discordUserId} failed:`, err.message ?? err));
  }, DM_DELAY_MS).unref?.();
}

async function loadIntensity(tx) {
  const config = await tx.gameConfig.findUnique({ where: { id: 1 }, select: { fearIntensity: true } });
  const k = config?.fearIntensity;
  return Number.isFinite(k) ? k : 1;
}

let warnedMissingBandTag = false;

// Projects the dial onto the sheet. A row on one of the five band slugs with
// source CONDITION is ours; any other source — a GM's grant, timed or "never"
// — is a person's, and is left entirely alone (it is also what keeps
// @@unique([characterId, tagId]) from ever colliding). A character who is not
// ALIVE wants nothing, so a corpse's band row is swept here too.
//
// `rows` is the character's CharacterTag rows on the band slugs, shaped
// { tagId, source, tag: { slug } }; pass them if already loaded.
async function settleFearTag(tx, characterId, { status, fear, rows = null } = {}) {
  let bandRows = rows;
  if (!bandRows || status == null || fear == null) {
    const character = await tx.character.findUnique({
      where: { id: characterId },
      select: {
        status: true,
        fear: true,
        tags: {
          where: { tag: { slug: { in: BAND_SLUGS } } },
          select: { tagId: true, source: true, tag: { select: { slug: true } } },
        },
      },
    });
    if (!character) return { granted: null, removed: [] };
    bandRows = character.tags;
    status = character.status;
    fear = character.fear;
  }
  const wanted = status === "ALIVE" ? bandOf(fear)?.slug ?? null : null;
  const ours = bandRows.filter((ct) => ct.source === "CONDITION");
  const theirs = new Set(bandRows.filter((ct) => ct.source !== "CONDITION").map((ct) => ct.tag.slug));

  let granted = null;
  const removed = [];
  for (const ct of ours) {
    if (ct.tag.slug === wanted) continue;
    await tx.characterTag.deleteMany({ where: { characterId, tagId: ct.tagId, source: "CONDITION" } });
    removed.push(ct.tag.slug);
  }
  if (wanted && !ours.some((ct) => ct.tag.slug === wanted) && !theirs.has(wanted)) {
    const tag = await tx.tag.findUnique({ where: { slug: wanted }, select: { id: true } });
    if (!tag) {
      if (!warnedMissingBandTag) {
        warnedMissingBandTag = true;
        console.error(`settleFearTag: no "${wanted}" tag — run npm run db:sync-tags. Fear won't show on sheets.`);
      }
    } else {
      await tx.characterTag.create({
        data: { characterId, tagId: tag.id, source: "CONDITION", quantity: 1, expiresTurn: null },
      });
      granted = wanted;
    }
  }
  return { granted, removed };
}

// Moves one character's dial by several terms at once and settles the band
// tag, all on `tx`. terms: [{ kind, base, ctx? }]. Returns null for an
// unknown character, otherwise
//   { characterId, before, after, delta, band, previousBand, dm, granted, removed }
// where `dm` is { discordUserId, content } or null. A character who is not
// ALIVE takes no fear (the settle still runs, to sweep a corpse's row).
//
// `character` may be passed in already loaded — { id, status, fear,
// discordUserId, tags: [{ tagId, source, tag: { slug } }] } — by a caller that
// has a hundred of them in hand (the turn pass); its tags must then cover the
// multiplier slugs AND the band slugs. Otherwise the row is read here.
const FEAR_CHARACTER_SELECT = {
  id: true,
  status: true,
  fear: true,
  discordUserId: true,
  tags: { select: { tagId: true, source: true, equipped: true, tag: { select: { slug: true } } } },
};
async function applyFearTerms(tx, characterId, terms, { intensity = null, notify = true, character = null } = {}) {
  if (!character) {
    character = await tx.character.findUnique({ where: { id: characterId }, select: FEAR_CHARACTER_SELECT });
  }
  if (!character) return null;

  const heldSlugs = new Set(character.tags.map((ct) => ct.tag.slug));
  // A caller that pre-loaded tags without `equipped` yields an empty set,
  // and the equipped-only rules simply sit out — see MULTIPLIERS.
  const equippedSlugs = new Set(character.tags.filter((ct) => ct.equipped).map((ct) => ct.tag.slug));
  const before = character.fear ?? 0;
  let delta = 0;
  if (character.status === "ALIVE" && terms?.length) {
    const k = intensity ?? (await loadIntensity(tx));
    for (const term of terms) {
      if (!term || !term.base) continue;
      delta += resolveDelta({ kind: term.kind, base: term.base, heldSlugs, intensity: k, ctx: term.ctx, equippedSlugs });
    }
    delta = Math.round(delta * 100) / 100;
  }

  let after = before;
  if (delta !== 0) {
    // Clamped in the database itself, so two hooks landing in the same tick
    // cannot race a stale read past 100 or below 0.
    const rows = await tx.$queryRaw`
      UPDATE "Character"
      SET "fear" = LEAST(${FEAR_MAX}::double precision, GREATEST(0::double precision, "fear" + ${delta}::double precision))
      WHERE "id" = ${characterId}
      RETURNING "fear"`;
    after = clampFear(Number(rows?.[0]?.fear ?? before + delta));
  }

  const bandRows = character.tags.filter((ct) => BAND_SLUGS.includes(ct.tag.slug));
  const { granted, removed } = await settleFearTag(tx, characterId, { status: character.status, fear: after, rows: bandRows });

  const previousBand = bandOf(before);
  const band = bandOf(after);
  let dm = null;
  if (character.status === "ALIVE" && character.discordUserId) {
    const content = fearBandDm(previousBand, band);
    if (content) dm = { discordUserId: character.discordUserId, content };
  }
  if (dm && notify) scheduleFearDm(dm);

  return { characterId, before, after, delta: Math.round((after - before) * 100) / 100, band, previousBand, dm, granted, removed };
}

// One event. `base` may be omitted for the kinds GAINS knows.
async function applyFear(tx, characterId, { kind, base = EVENTS[kind], ctx = {}, intensity = null, notify = true } = {}) {
  return applyFearTerms(tx, characterId, [{ kind, base, ctx }], { intensity, notify });
}

// "These CharacterTag rows just LANDED on this sheet." Re-reads the tags and
// charges WOUND fear for each one in a wound group by its rung, and DYING for
// the dying tag; anything else is a no-op. Call it only for rows that were
// actually created — a stack increment or an already-held tag is not a new
// wound. Safe with an empty list; returns null when nothing frightened.
async function applyWoundFear(tx, characterId, tagIds, opts = {}) {
  const ids = [...new Set((tagIds ?? []).filter(Boolean))];
  if (!ids.length) return null;
  // Filtered in the query, because this runs on EVERY new tag row — a sheet
  // of paper must cost one indexed read that says no, not a sheet load.
  const tags = await tx.tag.findMany({
    where: { id: { in: ids }, OR: [{ slug: DYING_SLUG }, { group: { slug: { in: [...WOUND_GROUPS] } } }] },
    select: {
      id: true,
      slug: true,
      category: true,
      requirementResources: true,
      requirementTurns: true,
      requirementGambit: true,
      group: { select: { slug: true } },
    },
  });
  const terms = [];
  for (const tag of tags) {
    if (tag.slug === DYING_SLUG) {
      terms.push({ kind: "DYING", base: EVENTS.DYING });
      continue;
    }
    const base = woundFearFor(tag);
    if (base > 0) terms.push({ kind: "WOUND", base, ctx: { burn: BURN_SLUGS.has(tag.slug) } });
  }
  if (!terms.length) return null;
  return applyFearTerms(tx, characterId, terms, opts);
}

// What walking somewhere costs, or earns: a little for open country or the
// dark (arrivalTermFor), and −10 for stepping into the Cathedral, once per
// character per turn — the ration is an AuditLog row with turnId set, the
// REQUESTS.md §1a pattern, and a rare one. A first placement (creation, a
// spawn, a GM dropping somebody in from nowhere) has no `from` and charges
// nothing: nobody walked. Takes the singleton client; opens its own tx.
const CATHEDRAL_LOCATION_SLUG = "cathedral";
const CATHEDRAL_AUDIT_ACTION = "fear_cathedral";
async function applyArrivalFear(prisma, { characterId, fromLocationId, toLocationId }) {
  if (!characterId || !toLocationId || !fromLocationId || fromLocationId === toLocationId) return null;
  const location = await prisma.location.findUnique({
    where: { id: toLocationId },
    select: { id: true, slug: true, indoors: true, attributes: true, zone: { select: { kind: true } } },
  });
  if (!location) return null;
  const terms = [];
  const arrival = arrivalTermFor(location);
  if (arrival) terms.push(arrival);

  if (location.slug === CATHEDRAL_LOCATION_SLUG) {
    const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
    if (openTurn) {
      const already = await prisma.auditLog.count({
        where: { actionType: CATHEDRAL_AUDIT_ACTION, turnId: openTurn.id, targetCharacterId: characterId },
      });
      if (already === 0) {
        terms.push({ kind: "CATHEDRAL", base: EVENTS.CATHEDRAL });
        await prisma.auditLog.create({
          data: {
            actorDiscordUserId: "system",
            actionType: CATHEDRAL_AUDIT_ACTION,
            targetCharacterId: characterId,
            turnId: openTurn.id,
            details: { locationId: location.id },
          },
        });
      }
    }
  }
  if (!terms.length) return null;
  return prisma.$transaction((tx) => applyFearTerms(tx, characterId, terms));
}

// The relief one consume earns: the largest single figure among what it
// granted and what it was. 0 for a stew.
function consumeReliefFor(itemSlug, grantedSlugs = []) {
  let best = CONSUME_RELIEF[itemSlug] ?? 0;
  for (const slug of grantedSlugs) best = Math.max(best, CONSUME_RELIEF[slug] ?? 0);
  return best;
}

module.exports = {
  // Tables and pure functions: the turn pass, the hooks and the test read these.
  FEAR_BANDS,
  BAND_SLUGS,
  PLACE_TERMS,
  NIGHTLY_DECAY,
  EVENTS,
  DESIRE_RELIEF_PER_POINT,
  MULTIPLIER_SLUGS,
  clampFear,
  bandOf,
  placeClassOf,
  placeTermFor,
  woundRungOf,
  woundFearFor,
  multiplierFor,
  resolveDelta,
  fearBandDm,
  consumeReliefFor,
  setFearDmSender,
  loadIntensity,
  settleFearTag,
  applyFearTerms,
  applyFear,
  applyWoundFear,
  applyArrivalFear,
};
