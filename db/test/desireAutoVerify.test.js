// Auto-confirmed Desire claims (DESIRES.md §6b): the pure matcher, the grammar
// check the sync runs, and every `autoVerify:` in docs/desires.yaml checked
// against the tag catalog. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { ACTS, validateAutoVerify, matchAutoVerify, autoClaimOutcome } = require("../lib/desireAutoVerify");

const readMaster = (name) => yaml.load(fs.readFileSync(path.join(__dirname, "../../docs", name), "utf8"));
const tagSlugs = new Set(Object.keys(readMaster("tags.yaml").tags ?? {}));
const desires = readMaster("desires.yaml").desires ?? {};

const TURN_START = Date.parse("2026-09-28T04:00:00Z");
const BORN = Date.parse("2026-09-20T00:00:00Z");
const ME = "char-me";
const ACCOUNT = "user-me";

let seq = 0;
function row(actionType, { actor = ACCOUNT, target = ME, details = {}, at = TURN_START + 60_000 } = {}) {
  seq += 1;
  return { id: `row-${seq}`, actionType, actorDiscordUserId: actor, targetCharacterId: target, details, createdAt: new Date(at) };
}

const TAG_IDS = new Map([
  ["sake", "t-sake"],
  ["alcohol", "t-alcohol"],
  ["tea", "t-tea"],
  ["obol", "t-obol"],
  ["jewelry", "t-jewelry"],
  ["lavish-meal", "t-lavish"],
]);

function ctx(rows, extra = {}) {
  return {
    characterId: ME,
    characterName: "Ada Vane",
    discordUserId: ACCOUNT,
    turnStartedAt: TURN_START,
    characterCreatedAt: BORN,
    rows,
    heldTags: [],
    tagIdsBySlug: TAG_IDS,
    usedAuditIds: new Set(),
    ...extra,
  };
}

const rule = (raw) => validateAutoVerify("test", raw, { knownTagSlugs: new Set(TAG_IDS.keys()) });

test("consumed: a sip this turn confirms, and names what was drunk", () => {
  const sip = row("request_consume_tag", { details: { tagId: "t-sake", tagName: "Sake" } });
  const hit = matchAutoVerify(rule({ check: "consumed", tags: ["sake"] }), ctx([sip]));
  assert.deepEqual(hit, { auditLogIds: [sip.id], note: "Consumed Sake" });
});

test("consumed: the wrong drink, or one from last turn, proves nothing", () => {
  const tea = row("request_consume_tag", { details: { tagId: "t-tea", tagName: "Tea" } });
  const early = row("request_consume_tag", { details: { tagId: "t-sake" }, at: TURN_START - 1000 });
  assert.equal(matchAutoVerify(rule({ check: "consumed", tags: ["sake"] }), ctx([tea, early])), null);
});

test("consumed: somebody else drinking does not count for me", () => {
  const theirs = row("request_consume_tag", { actor: "user-them", target: "char-them", details: { tagId: "t-sake" } });
  assert.equal(matchAutoVerify(rule({ check: "consumed", tags: ["sake"] }), ctx([theirs])), null);
});

test("an act already cited by another claim can't confirm a second one", () => {
  const sip = row("request_consume_tag", { details: { tagId: "t-sake", tagName: "Sake" } });
  const r = rule({ check: "consumed", tags: ["sake", "alcohol"] });
  assert.equal(matchAutoVerify(r, ctx([sip], { usedAuditIds: new Set([sip.id]) })), null);
});

test("actor rows from before this character was born belong to a predecessor", () => {
  const reborn = TURN_START + 30 * 60_000;
  const oldKiss = row("kiss_accepted", { target: "char-other", at: TURN_START + 60_000 });
  const r = rule({ check: "kissed" });
  assert.equal(matchAutoVerify(r, ctx([oldKiss], { characterCreatedAt: reborn })), null);
  const newKiss = row("kiss_accepted", {
    target: "char-other",
    at: reborn + 60_000,
    details: { initiator: "Bo Lark", responder: "Ada Vane" },
  });
  assert.deepEqual(matchAutoVerify(r, ctx([oldKiss, newKiss], { characterCreatedAt: reborn })), {
    auditLogIds: [newKiss.id],
    note: "Kissed Bo Lark",
  });
});

test("slots: any pull counts to play, and minWin reads the payout", () => {
  const lose = row("slot_machine", { details: { payout: 0 } });
  const pair = row("slot_machine", { details: { payout: 6 } });
  assert.equal(matchAutoVerify(rule({ check: "slots" }), ctx([lose])).note, "Played the slots");
  assert.equal(matchAutoVerify(rule({ check: "slots", minWin: 10 }), ctx([lose, pair])), null);
  assert.deepEqual(matchAutoVerify(rule({ check: "slots", minWin: 5 }), ctx([lose, pair])).auditLogIds, [pair.id]);
});

test("bought: vending buys, filtered by tag when the rule names one", () => {
  const ring = row("vending_buy", { details: { tagId: "t-jewelry", name: "Jewelry" } });
  const tea = row("vending_buy", { details: { tagId: "t-tea", name: "Tea" } });
  assert.deepEqual(matchAutoVerify(rule({ check: "bought", tags: ["jewelry"] }), ctx([tea, ring])).auditLogIds, [ring.id]);
  assert.ok(matchAutoVerify(rule({ check: "bought" }), ctx([tea])));
});

test("crafted: a one-shot craft or a staged yield both count", () => {
  const made = row("request_craft_tag", { details: { tagId: "t-lavish", tagName: "Lavish Meal" } });
  assert.equal(matchAutoVerify(rule({ check: "crafted", tags: ["lavish-meal"] }), ctx([made])).note, "Made Lavish Meal");
  const landed = row("craft_yield_arrived", {
    details: { tags: [{ tagId: "t-lavish", tagName: "Lavish Meal", op: "add", quantity: 1 }] },
  });
  assert.deepEqual(matchAutoVerify(rule({ check: "crafted", tags: ["lavish-meal"] }), ctx([landed])).auditLogIds, [landed.id]);
});

test("gave: needs that many DIFFERENT people, and cites every hand-off", () => {
  const give = (to) =>
    row("request_transfer_tag", {
      target: to,
      details: { tagId: "t-alcohol", tagName: "Alcohol", from: { kind: "character", id: ME }, to: { kind: "character", id: to } },
    });
  const r = rule({ check: "gave", tags: ["alcohol"], people: 3 });
  const a = give("c1");
  const b = give("c2");
  const again = give("c2");
  assert.equal(matchAutoVerify(r, ctx([a, b, again])), null);
  const c = give("c3");
  const hit = matchAutoVerify(r, ctx([a, b, again, c]));
  assert.equal(hit.auditLogIds.length, 3);
  assert.equal(hit.note, "Gave Alcohol to 3 people");
});

test("gave: a pickpocket's haul is not a gift", () => {
  const lifted = row("request_transfer_tag", {
    details: { tagId: "t-alcohol", via: "pickpocket", from: { kind: "character", id: ME }, to: { kind: "character", id: "c1" } },
  });
  assert.equal(matchAutoVerify(rule({ check: "gave", tags: ["alcohol"], people: 1 }), ctx([lifted])), null);
});

test("holds: reads the sheet, not the log", () => {
  const r = rule({ check: "holds", tags: ["obol"], quantity: 100 });
  assert.equal(matchAutoVerify(r, ctx([], { heldTags: [{ tagId: "t-obol", quantity: 99, name: "Obol" }] })), null);
  assert.deepEqual(matchAutoVerify(r, ctx([], { heldTags: [{ tagId: "t-obol", quantity: 112, name: "Obol" }] })), {
    auditLogIds: [],
    note: "Held 112 Obol when claiming",
  });
});

test("act: tests on details decide, and the side has to be mine", () => {
  const own = row("request_donate_blood", { details: { targetCharacterId: ME } });
  const other = row("request_donate_blood", { target: "c9", details: { targetCharacterId: "c9", targetName: "Cal" } });
  assert.deepEqual(matchAutoVerify(rule({ check: "act", action: "donate-own-blood" }), ctx([other, own])).auditLogIds, [own.id]);
  assert.equal(matchAutoVerify(rule({ check: "act", action: "donate-others-blood" }), ctx([other])).note, "Gave Cal's blood to the Lifeweb");

  const failed = row("request_break_restraints", { details: { success: false } });
  assert.equal(matchAutoVerify(rule({ check: "act", action: "escape-bonds" }), ctx([failed])), null);

  const lesson = (succeeded) =>
    row("lesson_accepted", { actor: "user-them", target: "c7", details: { teacherId: ME, learnerName: "Cal", tagName: "Medic", succeeded } });
  assert.equal(matchAutoVerify(rule({ check: "act", action: "taught-skill" }), ctx([lesson(false)])), null);
  assert.equal(matchAutoVerify(rule({ check: "act", action: "taught-skill" }), ctx([lesson(true)])).note, "Taught Cal Medic");

  const selfHeal = row("request_heal_character", { details: { selfHeal: true } });
  const gambit = row("request_heal_character", { actor: "user-doc", details: { selfHeal: false, pending: true } });
  assert.equal(matchAutoVerify(rule({ check: "act", action: "treated" }), ctx([selfHeal, gambit])), null);
});

test("validateAutoVerify refuses a bad shape", () => {
  const known = { knownTagSlugs: new Set(["sake"]) };
  assert.equal(validateAutoVerify("x", undefined, known), null);
  assert.throws(() => validateAutoVerify("x", { check: "sniffed" }, known), /must be one of/);
  assert.throws(() => validateAutoVerify("x", { check: "consumed" }, known), /needs "tags"/);
  assert.throws(() => validateAutoVerify("x", { check: "consumed", tags: ["mead"] }, known), /unknown tag "mead"/);
  assert.throws(() => validateAutoVerify("x", { check: "kissed", tags: ["sake"] }, known), /does not take "tags"/);
  assert.throws(() => validateAutoVerify("x", { check: "gave", tags: ["sake"], people: 0 }, known), /positive whole number/);
  assert.throws(() => validateAutoVerify("x", { check: "act", action: "juggle" }, known), /must be one of/);
  assert.deepEqual(validateAutoVerify("x", { tags: ["sake"], check: "consumed" }, known), { check: "consumed", tags: ["sake"] });
});

test("every autoVerify in docs/desires.yaml is well formed against the tag catalog", () => {
  let count = 0;
  for (const [slug, entry] of Object.entries(desires)) {
    if (entry?.autoVerify == null) continue;
    count += 1;
    const canon = validateAutoVerify(slug, entry.autoVerify, { knownTagSlugs: tagSlugs });
    if (canon.check === "act") assert.ok(Object.hasOwn(ACTS, canon.action), `${slug}: unknown action`);
  }
  assert.ok(count > 0, "no Desire carries an autoVerify — did the block get lost?");
});

// DESIRES.md §6c: the GM switch that rejects a claim with no proof. Only a
// check that ran cleanly inside an open turn and came back empty rejects.
test("autoClaimOutcome: confirm on proof, reject only when the switch is on and the check really ran", () => {
  const rule = { check: "consumed", tags: ["sake"] };
  const openTurn = { number: 3, startedAt: new Date(TURN_START) };
  const evidence = { auditLogIds: ["a1"], note: "Consumed Sake" };
  const on = { rule, openTurn, rejectUnproven: true };

  assert.equal(autoClaimOutcome({ ...on, evidence }), "confirm");
  assert.equal(autoClaimOutcome({ rule, openTurn, evidence }), "confirm");
  assert.equal(autoClaimOutcome({ ...on, evidence: null }), "reject");
  // The switch is off by default: no proof waits for a GM, as before.
  assert.equal(autoClaimOutcome({ rule, openTurn, evidence: null }), "queue");
  assert.equal(autoClaimOutcome({ ...on, rejectUnproven: false, evidence: null }), "queue");
  // A Desire the game can't check is untouched.
  assert.equal(autoClaimOutcome({ ...on, rule: null, evidence: null }), "queue");
  assert.equal(autoClaimOutcome({ ...on, rule: { check: "juggle" }, evidence: null }), "queue");
  // No open turn, no "this turn" to look in.
  assert.equal(autoClaimOutcome({ ...on, openTurn: null, evidence: null }), "queue");
  // A matcher that threw never costs the player their claim.
  assert.equal(autoClaimOutcome({ ...on, evidence: null, checkFailed: true }), "queue");
  // `holds` reads the sheet, but still only rejects inside an open turn.
  assert.equal(autoClaimOutcome({ ...on, rule: { check: "holds", tags: ["obol"] }, evidence: null }), "reject");
});
