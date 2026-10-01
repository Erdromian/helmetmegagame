// Staged scales (docs/systemdocs/ADJUDICATION.md §1b): a GM setting or moving
// hunger, mood, blood and humanity from the adjudication desk.
//
// The pure half runs anywhere: the validator the desk and the push share, the
// clamp, who can't take which scale, and the tray's wording.
//
// The rest runs the real writes against a local Postgres — the knock-ons each
// meter brings with it, the skips, the notices, and one row all the way
// through the turn push. It skips unless DATABASE_URL is a local one
// (db/lib/localDatabase.js), makes its own characters and turn, and deletes
// them after.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isLocalDatabase } = require("../lib/localDatabase");
const {
  SCALES,
  SKIP_REASONS,
  normalizeStagedScales,
  resolveScale,
  scaleBlockFor,
  describeScales,
  describeAppliedScales,
  allScalesSkipped,
  heldScalesFrom,
} = require("../lib/stagedScales");

const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

// ─── The validator ───────────────────────────────────────────────────────

test("a Set and a Change pass through as whole numbers", () => {
  const { scales, error } = normalizeStagedScales({
    hunger: { op: "set", value: "40" },
    mood: { op: "add", value: -20 },
  });
  assert.equal(error, undefined);
  assert.deepEqual(scales, { hunger: { op: "set", value: 40 }, mood: { op: "add", value: -20 } });
});

test("nothing, a blank Change and a Change of 0 all mean no change", () => {
  assert.deepEqual(normalizeStagedScales(null), { scales: {} });
  assert.deepEqual(normalizeStagedScales({}), { scales: {} });
  assert.deepEqual(normalizeStagedScales({ mood: { op: "add", value: "" } }), { scales: {} });
  assert.deepEqual(normalizeStagedScales({ mood: { op: "add", value: 0 } }), { scales: {} });
});

test("the validator refuses what can't mean anything, in words a GM can act on", () => {
  const error = (raw) => normalizeStagedScales(raw).error;
  assert.equal(error({ hunger: { op: "set", value: "" } }), "Hunger: say what to set it to.");
  assert.equal(error({ hunger: { op: "set", value: 101 } }), "Hunger runs from 0 to 100.");
  assert.equal(error({ mood: { op: "set", value: 83 } }), "Mood runs from −100 to 82.");
  assert.equal(error({ blood: { op: "set", value: 2.5 } }), "Blood takes a whole number.");
  assert.equal(error({ hunger: { op: "add", value: 101 } }), "Hunger only spans 100, so a change of 101 can't mean anything.");
  assert.equal(error({ hunger: { op: "halve", value: 2 } }), "Hunger: pick Set to or Change by.");
  assert.equal(error({ thirst: { op: "set", value: 2 } }), 'There is no "thirst" scale.');
  assert.equal(error([]), "That isn't a set of scale changes.");
});

test("a change is clamped to the meter's own range", () => {
  assert.equal(resolveScale("hunger", 90, { op: "add", value: 30 }), 100);
  assert.equal(resolveScale("hunger", 10, { op: "add", value: -30 }), 0);
  assert.equal(resolveScale("mood", -90, { op: "add", value: -30 }), -100);
  assert.equal(resolveScale("mood", 70, { op: "add", value: 30 }), 82);
  assert.equal(resolveScale("blood", 50, { op: "set", value: 0 }), 0);
  assert.equal(resolveScale("humanity", 50, null), 50);
});

test("hunger comes before mood, so its onset lands before a GM's own mood figure", () => {
  const order = SCALES.map((s) => s.key);
  assert.ok(order.indexOf("hunger") < order.indexOf("mood"));
  assert.ok(order.indexOf("blood") < order.indexOf("humanity"));
});

// ─── Who can't take which ────────────────────────────────────────────────

test("Hungerless, a pinned dial and a missing Vampire seat each block their own scale", () => {
  assert.equal(scaleBlockFor("hunger", ["hungerless"]), SKIP_REASONS.hungerless);
  assert.equal(scaleBlockFor("mood", ["hungerless"]), null);
  assert.equal(scaleBlockFor("mood", ["imperturbable"]), SKIP_REASONS.imperturbable);
  assert.equal(scaleBlockFor("mood", new Set(["changa-high"])), SKIP_REASONS.changa);
  assert.equal(scaleBlockFor("blood", []), SKIP_REASONS.notVampire);
  assert.equal(scaleBlockFor("humanity", ["hungerless"]), SKIP_REASONS.notVampire);
  assert.equal(scaleBlockFor("blood", ["vampire"]), null);
  assert.equal(scaleBlockFor("hunger", []), null);
});

// ─── The tray's wording ──────────────────────────────────────────────────

test("a staged row reads as what it will do, with the word the number means", () => {
  assert.deepEqual(
    describeScales({
      humanity: { op: "set", value: 0 },
      hunger: { op: "set", value: 40 },
      mood: { op: "add", value: -20 },
      blood: { op: "set", value: 0 },
    }),
    ["Hunger → 40 (Hungry)", "Mood −20", "Blood → 0 (Bloodcrazed)", "Humanity → 0 (Bestial)"],
  );
  assert.deepEqual(describeScales({ mood: { op: "add", value: 15 } }), ["Mood +15"]);
  assert.deepEqual(describeScales({ mood: { op: "set", value: -70 } }), ["Mood → −70 (Afraid)"]);
});

test("an applied row says what moved, the knock-ons, and what was skipped", () => {
  const applied = {
    hunger: { skipped: SKIP_REASONS.hungerless },
    mood: { from: 0, to: -60, onset: -60 },
    humanity: { from: 100, to: 40, bloodcrazedLoss: 60 },
  };
  assert.deepEqual(describeAppliedScales(applied), [
    "Hunger skipped — Hungerless",
    "Mood 0 → −60 (−60 hunger onset)",
    "Humanity 100 → 40 (−60 Bloodcrazed)",
  ]);
  // Mood is stored to two places; the desk prints it whole, minus sign and all.
  assert.deepEqual(describeAppliedScales({ mood: { from: 12.4, to: -70.25 } }), ["Mood 12 → −70"]);
  assert.equal(allScalesSkipped(applied), false);
  assert.equal(allScalesSkipped({ blood: { skipped: SKIP_REASONS.notVampire } }), true);
  assert.equal(allScalesSkipped(null), false);
});

test("the nightly passes hold only the meters a GM asked for and actually moved", () => {
  const held = heldScalesFrom([
    {
      // Hunger asked for and moved; the mood its onset cost is a knock-on.
      targetCharacterId: "a",
      payload: { scales: { hunger: { op: "set", value: 40 } } },
      appliedEffect: { scales: { hunger: { from: 90, to: 40 }, mood: { from: 0, to: -30, onset: -30 } } },
    },
    {
      // Blood asked for but skipped; humanity asked for and moved.
      targetCharacterId: "b",
      payload: { scales: { blood: { op: "set", value: 20 }, humanity: { op: "add", value: -10 } } },
      appliedEffect: { scales: { blood: { skipped: SKIP_REASONS.notVampire }, humanity: { from: 80, to: 70 } } },
    },
    // A row with no scales, a room row, and a row that failed at the push.
    { targetCharacterId: "c", payload: { resources: 2 }, appliedEffect: { resources: 2 } },
    { targetCharacterId: null, payload: { scales: { mood: { op: "set", value: 1 } } }, appliedEffect: { scales: { mood: { from: 0, to: 1 } } } },
    { targetCharacterId: "d", payload: { scales: { mood: { op: "set", value: 1 } } }, appliedEffect: { error: "boom" } },
  ]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(held).map(([k, v]) => [k, [...v]])),
    { hunger: ["a"], mood: [], blood: [], humanity: ["b"] },
  );
  assert.deepEqual(Object.keys(heldScalesFrom(null)), SCALES.map((s) => s.key));
});

// ─── Against a real database ─────────────────────────────────────────────

const NEEDED = [
  "vampire", "hungerless", "bestial", "wight",
  "full", "hungry", "starving",
  "flush", "satiated", "thirsty", "famished", "bloodcrazed", "pale", "black-sclera",
  "humane", "estranged", "disturbed", "warped",
];

async function setUp(t) {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const tags = await prisma.tag.findMany({ where: { slug: { in: NEEDED } }, select: { id: true, slug: true } });
  const tagId = Object.fromEntries(tags.map((tag) => [tag.slug, tag.id]));
  const missing = NEEDED.filter((slug) => !tagId[slug]);
  if (missing.length) {
    await prisma.$disconnect();
    t.skip(`the local tag catalog is missing ${missing.join(", ")} — run npm run db:sync-tags`);
    return null;
  }

  const run = Math.random().toString(36).slice(2, 8);
  const made = [];
  t.after(async () => {
    // CharacterTag does not cascade from Character.
    await prisma.characterTag.deleteMany({ where: { characterId: { in: made } } });
    await prisma.auditLog.deleteMany({ where: { targetCharacterId: { in: made } } }).catch(() => {});
    await prisma.character.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  });

  async function person(key, { slugs = [], ...data } = {}) {
    const row = await prisma.character.create({
      data: {
        discordUserId: `ss-test-${run}-${key}`,
        firstName: key,
        lastName: "Test",
        name: `${key} Test`,
        status: "ALIVE",
        ...data,
      },
    });
    made.push(row.id);
    for (const slug of slugs) {
      await prisma.characterTag.create({ data: { characterId: row.id, tagId: tagId[slug], source: "EVENT" } });
    }
    return row;
  }

  async function heldSlugs(characterId) {
    const rows = await prisma.characterTag.findMany({
      where: { characterId },
      select: { tag: { select: { slug: true } } },
    });
    return new Set(rows.map((r) => r.tag.slug));
  }

  return { prisma, run, made, person, heldSlugs };
}

test("staged scales apply with their knock-ons, skips and notices", { skip: SKIP }, async (t) => {
  const env = await setUp(t);
  if (!env) return;
  const { prisma, person, heldSlugs } = env;
  const { applyStagedScalesInTx } = require("../lib/stagedScalesApply");
  const apply =(characterId, raw) =>
    prisma.$transaction((tx) =>
      applyStagedScalesInTx(tx, { characterId, scales: normalizeStagedScales(raw).scales }),
    );

  // Hunger, dropped straight from Full into Starving: the descriptor moves at
  // once, both onsets cost mood, and the player is told they're Starving.
  const eater = await person("eater", { hungerValue: 100, mood: 0, slugs: ["full"] });
  const fed = await apply(eater.id, { hunger: { op: "set", value: 20 } });
  assert.deepEqual(fed.snapshot.hunger, { from: 100, to: 20 });
  assert.ok(fed.snapshot.mood.onset < 0, "dropping into Hungry and Starving costs mood");
  const eaterNow = await prisma.character.findUnique({ where: { id: eater.id } });
  assert.equal(eaterNow.hungerValue, 20);
  assert.equal(eaterNow.mood, fed.snapshot.mood.to);
  const eaterTags = await heldSlugs(eater.id);
  assert.ok(eaterTags.has("starving") && !eaterTags.has("full") && !eaterTags.has("hungry"));
  assert.equal(fed.notices.length, 1);
  assert.match(fed.notices[0].content, /Starving/);

  // A GM's mood Set is the number they end on, even beside a hunger onset.
  const both = await person("both", { hungerValue: 100, mood: 0, slugs: ["full"] });
  const set = await apply(both.id, { hunger: { op: "set", value: 50 }, mood: { op: "set", value: 30 } });
  assert.equal(set.snapshot.mood.to, 30);
  assert.equal(set.snapshot.mood.from, 0);
  assert.equal((await prisma.character.findUnique({ where: { id: both.id } })).mood, 30);

  // Into Panicking: the mood dial's own line.
  const scared = await person("scared", { mood: 0 });
  const panic = await apply(scared.id, { mood: { op: "add", value: -90 } });
  assert.deepEqual(panic.snapshot.mood, { from: 0, to: -90 });
  assert.deepEqual(panic.notices.map((n) => n.content), ["You are now Panicking."]);

  // Coming back up says nothing: recovery shows on the sheet.
  const recovering = await person("recovering", { hungerValue: 10, slugs: ["starving"] });
  const ate = await apply(recovering.id, { hunger: { op: "set", value: 100 } });
  assert.deepEqual(ate.snapshot.hunger, { from: 10, to: 100 });
  assert.equal(ate.notices.length, 0);
  assert.ok((await heldSlugs(recovering.id)).has("full"));

  // Skips: Hungerless hunger, blood off a Vampire's seat. Nothing written.
  const hollow = await person("hollow", { hungerValue: 100, vampireBloodLevel: 100, slugs: ["hungerless"] });
  const skipped = await apply(hollow.id, { hunger: { op: "set", value: 5 }, blood: { op: "set", value: 5 } });
  assert.deepEqual(skipped.snapshot, {
    hunger: { skipped: SKIP_REASONS.hungerless },
    blood: { skipped: SKIP_REASONS.notVampire },
  });
  const hollowNow = await prisma.character.findUnique({ where: { id: hollow.id } });
  assert.equal(hollowNow.hungerValue, 100);
  assert.equal(hollowNow.vampireBloodLevel, 100);

  // A body takes nothing.
  const body = await person("body", { status: "DEAD", hungerValue: 100 });
  const dead = await apply(body.id, { hunger: { op: "set", value: 5 } });
  assert.deepEqual(dead.snapshot, { hunger: { skipped: SKIP_REASONS.notAlive } });
  assert.equal(dead.notices.length, 0);

  // A Vampire drained into Bloodcrazed loses 60 humanity with it, and the
  // band tags move at once.
  const vamp = await person("vamp", {
    vampireBloodLevel: 100,
    vampireHumanity: 100,
    slugs: ["vampire", "flush", "humane"],
  });
  const drained = await apply(vamp.id, { blood: { op: "set", value: 0 } });
  assert.deepEqual(drained.snapshot.blood, { from: 100, to: 0 });
  assert.deepEqual(drained.snapshot.humanity, { from: 100, to: 40, bloodcrazedLoss: 60 });
  const vampTags = await heldSlugs(vamp.id);
  for (const slug of ["bloodcrazed", "pale", "black-sclera", "disturbed"]) assert.ok(vampTags.has(slug), slug);
  for (const slug of ["flush", "humane"]) assert.ok(!vampTags.has(slug), slug);
  assert.equal(drained.notices.length, 1, "one DM for the whole ruling");
  const drainedLines = drained.notices[0].content.split("\n");
  assert.equal(drainedLines.length, 2, "the Bloodcrazed line and the Disturbed line");
  assert.match(drainedLines[0], /lost all control/);
  assert.match(drainedLines[1], /remorse/);

  // A humanity Set beside the drop wins over the automatic loss.
  const vamp2 = await person("vamp2", { vampireBloodLevel: 100, vampireHumanity: 100, slugs: ["vampire"] });
  const ruled = await apply(vamp2.id, { blood: { op: "set", value: 0 }, humanity: { op: "set", value: 70 } });
  assert.deepEqual(ruled.snapshot.humanity, { from: 100, to: 70 });

  // Humanity to 0 from above: Bestial and a Wight, for good.
  const lost = await person("lost", { vampireBloodLevel: 80, vampireHumanity: 30, slugs: ["vampire", "disturbed"] });
  const gone = await apply(lost.id, { humanity: { op: "add", value: -30 } });
  assert.deepEqual(gone.snapshot.humanity, { from: 30, to: 0, bestial: true });
  const lostTags = await heldSlugs(lost.id);
  assert.ok(lostTags.has("bestial") && lostTags.has("wight") && !lostTags.has("disturbed"));
  assert.equal(gone.notices.length, 1);
});

test("a staged scale row goes all the way through the turn push", { skip: SKIP }, async (t) => {
  const env = await setUp(t);
  if (!env) return;
  const { prisma, run, person } = env;
  const { runStagedPushPass } = require("../lib/stagedPush");

  // A turn of its own, so the push only ever sees this test's row. Numbered
  // BELOW zero on purpose: other test files, running in parallel, borrow
  // "the latest turn" (stagedDelivery.test.js), and a high number would lend
  // them this one and leave it undeletable.
  const number = -(100000 + Math.floor(Math.random() * 800000));
  const turn = await prisma.turn.create({ data: { number, dayNumber: number, status: "RESOLVED" } });
  t.after(async () => {
    await prisma.stagedEffect.deleteMany({ where: { turnId: turn.id } }).catch(() => {});
    await prisma.turn.delete({ where: { id: turn.id } }).catch(() => {});
  });

  const target = await person("pushed", { hungerValue: 100, mood: 0, slugs: ["full"] });
  const row = await prisma.stagedEffect.create({
    data: {
      turnId: turn.id,
      targetCharacterId: target.id,
      createdByDiscordUserId: `ss-test-${run}-gm`,
      payload: { resources: 0, scales: { hunger: { op: "set", value: 50 } } },
    },
  });

  const result = await runStagedPushPass(prisma, turn);
  assert.equal(result.effectsApplied, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(result.scaleNotices.length, 1, "the Hungry line, handed back for the early notices");
  assert.match(result.scaleNotices[0].content, /Hungry/);

  const applied = await prisma.stagedEffect.findUnique({ where: { id: row.id } });
  assert.ok(applied.appliedAt);
  assert.deepEqual(applied.appliedEffect.scales.hunger, { from: 100, to: 50 });

  const audit = await prisma.auditLog.findFirst({
    where: { actionType: "gm_staged_scales_applied", targetCharacterId: target.id },
  });
  assert.ok(audit, "one audit row for what moved");
  assert.deepEqual(audit.details.scales.hunger, { from: 100, to: 50 });

  // The passes after the push hold that hunger where the GM put it, read back
  // from the applied row so a resumed close holds it too.
  const { loadHeldScales } = require("../lib/stagedScalesApply");
  const held = await loadHeldScales(prisma, turn);
  assert.deepEqual([...held.hunger], [target.id]);
  assert.equal(held.mood.size, 0, "the onset's mood is a knock-on, not the GM's figure");
});
