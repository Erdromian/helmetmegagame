// The prompt an alert caver gets on a failed Caving roll (Combat Mode.docx; COMBAT-MODE.md §6, CAVING.md §5b),
// and what the GM's Caving lens says about combat mode across a result.
//
// The DM's shape and the desk's fold are pure. The roll and the write run against a real Postgres, with the die
// pinned to 1 — skipped unless DATABASE_URL is a local one (db/lib/localDatabase.js). That half makes its own
// character, puts the game's phase back after, and deletes what it made.
process.env.LOCAL_MODE = "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { isLocalDatabase } = require("../lib/localDatabase");

const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

// Pinned before cavingPass is loaded: it destructures it at require time.
const advantage = require("../lib/advantage");
advantage.rollWithAdvantage = () => ({ die: 1 });
const { rollCaving } = require("../lib/cavingPass");
const { troubleDmParts, respondToCaving, cavingResultFor, CAVING_WRITE_PREFIX } = require("../lib/cavingResponse");
const { CAVING_PROMPT, CAVING_SURPRISED, CAVING_STANDS, CAVING_LOCKED_ON, DESCRIPTION_LIMIT } = require("../lib/combatMode");
const { DM_ACTION, dmActionOf } = require("../lib/dmActions");

const loadLabels = () => import(pathToFileURL(path.join(__dirname, "..", "..", "web", "lib", "cavingLabels.js")).href);

test("an alert caver's trouble DM carries the prompt and its button; anybody else's says they were caught off guard", () => {
  const alert = troubleDmParts("roll1", { alert: true });
  assert.equal(alert.line, CAVING_PROMPT);
  assert.equal(alert.components[0].components[0].custom_id, `${CAVING_WRITE_PREFIX}roll1`);
  assert.equal(alert.components[0].components[0].label, "Write your response");
  // The web draws its own button off the descriptor, the COMBAT shape.
  assert.deepEqual(dmActionOf({ meta: alert.meta }), { kind: DM_ACTION.CAVING, id: "roll1" });

  const surprised = troubleDmParts("roll1", { alert: false });
  assert.equal(surprised.line, CAVING_SURPRISED);
  assert.deepEqual(surprised.components, []);
  assert.equal(surprised.meta, undefined, "nothing to write, so nothing for the web to draw");
});

test("the prompt goes out once per result, not again every time the severity climbs", () => {
  // An earlier 1 already asked: no prompt, no button, nothing for the web to draw.
  const unwritten = troubleDmParts("roll2", { alert: true, asked: true });
  assert.equal(unwritten.line, null, "the first DM's button and the turn card are still asking");
  assert.deepEqual(unwritten.components, []);
  assert.equal(unwritten.meta, undefined);

  // Once they have written, a later 1 only says their answer still covers it.
  const written = troubleDmParts("roll3", { alert: true, asked: true, written: true });
  assert.equal(written.line, CAVING_STANDS);
  assert.deepEqual(written.components, []);
  assert.equal(written.meta, undefined);
});

const row = (id, createdAtMs, extra = {}) => ({
  id,
  characterId: "ada",
  zoneId: "caves",
  zoneName: "caves",
  createdAtMs,
  kind: "TROUBLE",
  die: 1,
  locationName: `room-${id}`,
  resolvedAt: null,
  gmNotes: "",
  alert: false,
  response: "",
  respondedAtMs: null,
  ...extra,
});

test("the desk counts combat mode at every 1 of the result, not just the newest", async () => {
  const { foldCavingRolls } = await loadLabels();
  const [some] = foldCavingRolls([row("a", 10), row("b", 20, { alert: true }), row("c", 30)]).rows;
  assert.equal(some.count, 3);
  assert.equal(some.alertCount, 1, "turned it on, failed, turned it off: still one on guard");
  assert.equal(some.latestAlert, false, "the newest roll alone would have said off");

  const [none] = foldCavingRolls([row("a", 10), row("b", 20)]).rows;
  assert.equal(none.alertCount, 0);
});

test("the response is the oldest roll's, and one written after the ruling reopens the result", async () => {
  const { foldCavingRolls } = await loadLabels();
  const resolvedAt = new Date(1000).toISOString();
  const ruled = { resolvedAt, resolvedByUsername: "gm", resolvedAtLabel: "x" };

  const [before] = foldCavingRolls([
    row("a", 10, { ...ruled, alert: true, response: "I hide.", respondedAtMs: 500 }),
    row("b", 20, ruled),
  ]).rows;
  assert.equal(before.response, "I hide.");
  assert.equal(before.statusLabel, "Resolved", "written before the ruling: nothing new");
  assert.equal(before.respondedSinceResolved, false);

  const [after] = foldCavingRolls([
    row("a", 10, { ...ruled, alert: true, response: "I fight back.", respondedAtMs: 2000 }),
    row("b", 20, ruled),
  ]).rows;
  assert.equal(after.statusLabel, "Needs attention");
  assert.equal(after.respondedSinceResolved, true);
  assert.equal(after.resolvedAt, null, "so Mark resolved is offered again");
  assert.equal(after.newSinceResolved, 0, "and it isn't counted as a new failed roll");

  // The push's own release is final: the turn is over, so nothing reopens it.
  const [pushed] = foldCavingRolls([
    row("a", 10, { resolvedAt, autoResolved: true, alert: true, response: "Late.", respondedAtMs: 2000 }),
  ]).rows;
  assert.equal(pushed.statusLabel, "Resolved");
});

test("a failed roll freezes combat mode, and only an alert result can be written for", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  const location = await prisma.location.findFirst({ where: { zone: { kind: "CAVE_LEVEL" } }, include: { zone: true } });
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  const state = await prisma.gameState.findFirst({ select: { id: true, phase: true } });
  if (!location || !turn || !state) {
    await prisma.$disconnect();
    return t.skip("the local database has no cave Location, open Turn or GameState — run npm run dev:setup");
  }

  const run = Math.random().toString(36).slice(2, 8);
  const made = [];
  t.after(async () => {
    await prisma.gameState.update({ where: { id: state.id }, data: { phase: state.phase } });
    for (const id of made) {
      await prisma.auditLog.deleteMany({ where: { targetCharacterId: id } }).catch(() => {});
      await prisma.character.deleteMany({ where: { id } });
    }
    await prisma.$disconnect();
  });
  // The write goes through the Move gate, which a game that isn't running refuses.
  await prisma.gameState.update({ where: { id: state.id }, data: { phase: "RUNNING" } });

  const mk = async (who) => {
    const c = await prisma.character.create({
      data: {
        discordUserId: `cr-test-${run}-${who}`,
        firstName: "Caver",
        lastName: who,
        name: `Caver ${who} ${run}`,
        status: "ALIVE",
        zoneId: location.zoneId,
        locationId: location.id,
      },
    });
    made.push(c.id);
    return c;
  };
  const caver = await mk("A");
  const stranger = await mk("B");

  // Off guard: no button, and nothing to write.
  const first = await rollCaving(prisma, caver, turn, location);
  assert.equal(first.roll.kind, "TROUBLE");
  assert.equal(first.roll.alert, false);
  assert.deepEqual(first.dm.components, []);
  assert.ok(first.dm.content.endsWith(CAVING_SURPRISED));
  const refused = await respondToCaving(prisma, { characterId: caver.id, text: "I run.", turn });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, CAVING_SURPRISED);

  // Combat mode on, another 1: the button, and the column agrees with the snapshot.
  await prisma.character.update({ where: { id: caver.id }, data: { combatModeSinceTurn: turn.number } });
  const second = await rollCaving(prisma, caver, turn, location);
  assert.equal(second.roll.alert, true);
  assert.equal(second.roll.presentedState?.m, 1);
  assert.equal(second.dm.components[0].components[0].custom_id, `${CAVING_WRITE_PREFIX}${second.roll.id}`);
  assert.deepEqual(second.dm.meta, { action: { kind: DM_ACTION.CAVING, id: second.roll.id } });

  assert.ok(second.dm.content.endsWith(CAVING_PROMPT));

  // Still on guard, a third 1: the same result, already asked — no second prompt, no second button.
  const third = await rollCaving(prisma, caver, turn, location);
  assert.equal(third.roll.alert, true);
  assert.equal(third.dm.content, "Caving Die: 1 — Something is wrong down here. A GM has been notified.");
  assert.deepEqual(third.dm.components, []);
  assert.equal(third.dm.meta, undefined);

  // The second roll's button still writes, and the words land on the result's oldest.
  const ok = await respondToCaving(prisma, { characterId: caver.id, rollId: second.roll.id, text: "  I douse the lamp.  ", turn });
  if (!ok.ok) return t.skip(`the local game refuses Moves right now: ${ok.error}`);
  assert.equal((await prisma.cavingRoll.findUnique({ where: { id: first.roll.id } })).response, "I douse the lamp.");

  // Failed down here this turn, so the caver can't take themselves out of combat mode.
  const { setCombatMode } = require("../lib/verbs/combatMode");
  const held = await setCombatMode(prisma, { character: { id: caver.id }, discordUserId: caver.discordUserId, on: false });
  assert.deepEqual(held, { ok: false, error: CAVING_LOCKED_ON });

  // Combat mode off (as a GM or the push could), a fourth 1: an earlier one gave the chance, so they aren't told they missed it — only that
  // what they wrote still covers this.
  await prisma.character.update({ where: { id: caver.id }, data: { combatModeSinceTurn: null } });
  const fourth = await rollCaving(prisma, caver, turn, location);
  assert.equal(fourth.roll.alert, false);
  assert.ok(fourth.dm.content.endsWith(CAVING_STANDS));
  assert.deepEqual(fourth.dm.components, []);

  const result = await cavingResultFor(prisma, caver.id, turn);
  assert.equal(result.rollId, first.roll.id);
  assert.equal(result.severity, 4);
  assert.equal(result.alert, true);
  assert.equal(result.response, "I douse the lamp.", "one response for the whole result");

  // Somebody else's roll, or too many words, is refused.
  const theirs = await respondToCaving(prisma, { characterId: stranger.id, rollId: second.roll.id, text: "Mine now.", turn });
  assert.equal(theirs.ok, false);
  const long = await respondToCaving(prisma, { characterId: caver.id, text: "x".repeat(DESCRIPTION_LIMIT + 1), turn });
  assert.equal(long.ok, false);
  assert.equal((await prisma.cavingRoll.findUnique({ where: { id: first.roll.id } })).response, "I douse the lamp.");
});
