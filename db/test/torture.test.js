// node --test over the pure half of db/lib/torture.js — the threshold table,
// the bonuses, the natural-1 rule and the reveal filter. Run with
// `npm test --workspace=db`. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TORTURE_BASE_THRESHOLD,
  thresholdFor,
  tortureBonuses,
  resolveTorture,
  revealedTags,
  formatTortureRoll,
  buildTortureEmbed,
} = require("../lib/torture");

const outcomes = (opts) => [1, 2, 3, 4, 5, 6].map((die) => resolveTorture({ die, ...opts }).success);

test("base: 4, 5 and 6 break; 1, 2 and 3 hold", () => {
  assert.equal(TORTURE_BASE_THRESHOLD, 4);
  assert.deepEqual(outcomes({}), [false, false, false, true, true, true]);
});

test("the target's tags move the bar", () => {
  assert.equal(thresholdFor(["relentless"]), 6);
  assert.equal(thresholdFor(["brave"]), 5);
  assert.equal(thresholdFor(["craven"]), 2);
  assert.equal(thresholdFor([]), 4);
  assert.deepEqual(outcomes({ targetSlugs: ["relentless"] }), [false, false, false, false, false, true]);
  assert.deepEqual(outcomes({ targetSlugs: ["brave"] }), [false, false, false, false, true, true]);
  assert.deepEqual(outcomes({ targetSlugs: ["craven"] }), [false, true, true, true, true, true]);
});

test("hardest wins when a target holds several", () => {
  assert.equal(thresholdFor(["relentless", "brave"]), 6);
  assert.equal(thresholdFor(["relentless", "craven"]), 6);
  assert.equal(thresholdFor(["brave", "craven"]), 5);
  assert.equal(thresholdFor(new Set(["craven", "relentless"])), 6);
});

test("each bonus is +1 and named once", () => {
  assert.deepEqual(tortureBonuses({}), []);
  assert.deepEqual(tortureBonuses({ equipmentInReach: true }), [{ label: "Torturing Equipment", value: 1 }]);
  assert.deepEqual(tortureBonuses({ torturerSlugs: ["trench-knife"] }), [{ label: "Trench Knife", value: 1 }]);
  assert.deepEqual(tortureBonuses({ torturerSlugs: ["cruel"] }), [{ label: "Cruel", value: 1 }]);
  // Holding the equipment tag is not the same as having it in reach — the
  // caller resolves reach, the resolver only reads the boolean.
  assert.deepEqual(tortureBonuses({ torturerSlugs: ["torturing-equipment"] }), []);
});

test("bonuses add to the die", () => {
  const r = resolveTorture({ die: 3, torturerSlugs: ["cruel", "trench-knife"], equipmentInReach: true });
  assert.equal(r.total, 6);
  assert.equal(r.modifiers.length, 3);
  assert.equal(r.success, true);
  // Nothing applies: the total is the die and the list is empty.
  const bare = resolveTorture({ die: 5 });
  assert.equal(bare.total, 5);
  assert.deepEqual(bare.modifiers, []);
});

test("a natural 1 always fails, whatever the bonuses", () => {
  const r = resolveTorture({ die: 1, torturerSlugs: ["cruel", "trench-knife"], equipmentInReach: true });
  assert.equal(r.total, 4);
  assert.equal(r.threshold, 4);
  assert.equal(r.success, false);
  // Even against a Craven target, who breaks on a 2.
  assert.equal(resolveTorture({ die: 1, targetSlugs: ["craven"], equipmentInReach: true }).success, false);
});

test("the general Gambit penalties count too", () => {
  const r = resolveTorture({ die: 4, gambitMods: [{ label: "Hungry", value: -1 }] });
  assert.equal(r.total, 3);
  assert.equal(r.success, false);
  assert.deepEqual(r.modifiers, [{ label: "Hungry", value: -1 }]);
  // Bonuses first, then the penalties, so the DM reads the same way every time.
  const both = resolveTorture({ die: 4, torturerSlugs: ["cruel"], gambitMods: [{ label: "Afraid", value: -1 }] });
  assert.deepEqual(
    both.modifiers.map((m) => m.label),
    ["Cruel", "Afraid"],
  );
  assert.equal(both.success, true);
});

test("the reveal drops wounds and statuses and keeps everything else", () => {
  const rows = [
    { tag: { name: "Broken Arm", category: "Health" } },
    { tag: { name: "Bound", category: "Status" } },
    { tag: { name: "Thanati", category: "General" } },
    { tag: { name: "Revolver", category: "Items" } },
    { tag: { name: "Smithing", category: "Skills" } },
    { tag: { name: "Demoness", category: "Demoness" } },
    { tag: null },
  ];
  assert.deepEqual(
    revealedTags(rows).map((ct) => ct.tag.name),
    ["Thanati", "Revolver", "Smithing", "Demoness"],
  );
});

test("the roll line and the embed read as expected", () => {
  const r = resolveTorture({ die: 5, torturerSlugs: ["cruel"], gambitMods: [{ label: "Hungry", value: -2 }] });
  assert.equal(formatTortureRoll(r), "Rolled a 5 +1 Cruel −2 Hungry against 4");
  const embed = buildTortureEmbed({
    name: "Ada",
    avatarUrl: "https://x/api/avatar/1",
    tags: [{ name: "Thanati", detail: null }, { name: "Revolver", detail: "3 turns left" }],
    desires: [{ text: "Kill a man", points: 4 }],
    thanatiNames: ["Bob", "Cy"],
  });
  assert.equal(embed.thumbnail.url, "https://x/api/avatar/1");
  assert.equal(embed.fields.length, 3);
  assert.equal(embed.fields[0].value, "Thanati • Revolver (3 turns left)");
  assert.match(embed.fields[2].value, /Bob • Cy/);
  // No desires and no Thanati: one field.
  assert.equal(buildTortureEmbed({ name: "A", avatarUrl: null, tags: [], desires: [], thanatiNames: null }).fields.length, 1);
});
