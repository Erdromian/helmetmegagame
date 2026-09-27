// The Combat Overhaul's pure pieces (docs/systemdocs/ATTACK.md): the roll and its modifiers, how far
// everybody is from a fight through the ways they can actually walk, who a watch catches now that a
// typed name only reaches somebody the watcher knows, the two new hold sentences, and the line that
// keeps the rolls away from players. The database half is exercised end to end against a real Postgres
// (the harness in the PR's verification), since its guarantees are row locks and unique claims.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { rollCombat, combatModifiers, SURPRISE_PENALTY, MAX_INTERVENE_DISTANCE } = require("../lib/combatRoll");
const { distancesFrom } = require("../lib/locationGraph");
const { matchesArrival, heldReasonFor, HELD_REASON, FIGHT_REASONS } = require("../lib/intercept");
const { PUBLIC_PARTICIPANT_SELECT } = require("../lib/combat");

// ─── The roll ────────────────────────────────────────────────────────────────

function withDie(n, fn) {
  const real = Math.random;
  Math.random = () => (n - 1) / 6 + 0.01;
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

test("an alert fighter rolls a plain Gambit die", () => {
  const roll = withDie(4, () => rollCombat([], { mood: 0, alert: true }));
  assert.equal(roll.die, 4);
  assert.equal(roll.total, 4);
  assert.deepEqual(roll.modifiers, []);
});

test("caught by surprise is -3", () => {
  assert.equal(SURPRISE_PENALTY, -3);
  const roll = withDie(5, () => rollCombat([], { alert: false }));
  assert.equal(roll.total, 2);
  assert.deepEqual(roll.modifiers, [{ label: "Surprised", value: -3 }]);
});

test("an intervener pays the Locations they came, 1 to 3", () => {
  for (const d of [1, 2, 3]) {
    const mods = combatModifiers([], { alert: true, distance: d });
    assert.equal(mods.reduce((s, m) => s + m.value, 0), -d);
  }
  // Standing right there when it started costs nothing.
  assert.deepEqual(combatModifiers([], { alert: true, distance: 0 }), []);
  assert.equal(MAX_INTERVENE_DISTANCE, 3);
});

test("the Gambit's own modifiers ride along: Starving, a mood band, a Trinket", () => {
  const tags = [
    { tag: { slug: "starving", name: "Starving" } },
    { tag: { slug: "arkenstone-ring", name: "Ring of Dawn", gambitBonus: 1 } },
  ];
  const mods = combatModifiers(tags, { mood: 0, alert: false });
  const labels = mods.map((m) => m.label);
  assert.ok(labels.includes("Starving"));
  assert.ok(labels.includes("Ring of Dawn"));
  assert.ok(labels.includes("Surprised"));
});

test("Lucky rolls two and keeps the better", () => {
  let calls = 0;
  const real = Math.random;
  Math.random = () => [0.01, 0.9][calls++ % 2];
  try {
    const roll = rollCombat([{ tag: { slug: "lucky" } }], {});
    assert.deepEqual(roll.rolls.length, 2);
    assert.equal(roll.die, 6);
    assert.equal(roll.advantageSource, "lucky");
  } finally {
    Math.random = real;
  }
});

// ─── Distance ────────────────────────────────────────────────────────────────

// A line of Locations A - B - C - D - E, with one locked door between B and C.
function line({ lockBC = false, squeezeAB = false, hiddenCD = false, shutDE = false } = {}) {
  const link = (aId, bId, extra = {}) => ({ aId, bId, hidden: false, modular: false, isOpen: true, ...extra });
  return {
    links: [
      link("A", "B", squeezeAB ? { tightSqueeze: true } : {}),
      link("B", "C", lockBC ? { requiredTagSlug: "barons-key" } : {}),
      link("C", "D", hiddenCD ? { hidden: true, requiredTagSlug: "thief-mark" } : {}),
      link("D", "E", shutDE ? { modular: true, isOpen: false } : {}),
    ],
  };
}
const traveller = (id, locationId, slugs = []) => ({ id, locationId, accessSlugs: new Set(slugs) });

test("distance is counted in Locations from the fight", () => {
  const out = distancesFrom(line(), "A", [traveller("here", "A"), traveller("b", "B"), traveller("d", "D")]);
  assert.equal(out.get("here").hops, 0);
  assert.equal(out.get("b").hops, 1);
  assert.equal(out.get("d").hops, 3);
  assert.equal(out.get("d").fromLocationId, "D");
});

test("4 or more, or no way at all, is capped at 4", () => {
  const out = distancesFrom(line(), "A", [traveller("e", "E"), traveller("nowhere", null)]);
  assert.equal(out.get("e").hops, 4);
  assert.equal(out.get("nowhere").hops, 4);
});

test("a locked door counts only for whoever holds its key", () => {
  const g = line({ lockBC: true });
  const out = distancesFrom(g, "A", [traveller("stranger", "C"), traveller("baron", "C", ["barons-key"])]);
  assert.equal(out.get("stranger").hops, 4);
  assert.equal(out.get("baron").hops, 2);
});

test("a hidden way, a shut gate and a squeeze a Giant cannot fit through all cost what they cost on foot", () => {
  const hidden = distancesFrom(line({ hiddenCD: true }), "A", [traveller("x", "D"), traveller("thief", "D", ["thief-mark"])]);
  assert.equal(hidden.get("x").hops, 4);
  assert.equal(hidden.get("thief").hops, 3);
  const shut = distancesFrom(line({ shutDE: true }), "D", [traveller("y", "E")]);
  assert.equal(shut.get("y").hops, 4);
  const squeeze = distancesFrom(line({ squeezeAB: true }), "A", [traveller("small", "B"), traveller("giant", "B", ["giant"])]);
  assert.equal(squeeze.get("small").hops, 1);
  assert.equal(squeeze.get("giant").hops, 4);
});

// ─── Who a watch catches ─────────────────────────────────────────────────────

const open = { name: "Ada Vane", concealed: false, forced: false };
const hood = { name: "A young woman", concealed: true, forced: false };
const beast = { name: "Beast", concealed: false, forced: true };
const ada = { name: "Ada Vane", firstName: "Ada", lastName: "Vane" };

test("a typed name catches only somebody the watcher knows", () => {
  const watch = { targetNames: ["Ada Vane"] };
  assert.equal(matchesArrival(watch, ada, open, { known: true }), "name");
  assert.equal(matchesArrival(watch, ada, open, { known: false }), null);
  assert.equal(matchesArrival(watch, ada, hood, { known: true }), null);
});

test("anyone I can't identify: hoods, forced names and strangers, never a known face", () => {
  const watch = { anyUnidentified: true };
  assert.equal(matchesArrival(watch, ada, hood), "anyUnidentified");
  assert.equal(matchesArrival(watch, ada, beast), "anyUnidentified");
  assert.equal(matchesArrival(watch, ada, open, { known: false }), "anyUnidentified");
  assert.equal(matchesArrival(watch, ada, open, { known: true }), null);
});

test("the old dragnets are unchanged", () => {
  assert.equal(matchesArrival({ anyPerson: true }, ada, open, { known: false }), "anyPerson");
  assert.equal(matchesArrival({ anyConcealed: true }, ada, hood), "anyConcealed");
  assert.equal(matchesArrival({ anyConcealed: true }, ada, open, { known: false }), null);
});

// ─── The holds ───────────────────────────────────────────────────────────────

test("an invitee and a withdrawing attacker each read their own sentence", () => {
  const soon = new Date(Date.now() + 29 * 60 * 1000);
  assert.match(heldReasonFor({ heldUntil: soon, heldReason: HELD_REASON.INVITED }), /asked to join a fight/);
  assert.match(heldReasonFor({ heldUntil: soon, heldReason: HELD_REASON.WITHDRAWING }), /called off the attack.*29 min/);
  // Withdrawing is not a fight: nothing that clears "a fight" must touch it, and a Release never reaches it
  // because it is held by nobody.
  assert.ok(!FIGHT_REASONS.includes(HELD_REASON.WITHDRAWING));
  assert.ok(FIGHT_REASONS.includes(HELD_REASON.INVITED));
});

// ─── The rolls never reach a player ──────────────────────────────────────────

test("no player-facing select carries a roll", () => {
  for (const field of ["die", "rolls", "modifiers", "total", "advantageSource", "snapshot"]) {
    assert.ok(!(field in PUBLIC_PARTICIPANT_SELECT), `PUBLIC_PARTICIPANT_SELECT selects ${field}`);
  }
  // And combatViewFor's own select of the viewer's row names none of them either. Read off the source, so
  // a field added there later fails here rather than in a player's browser.
  const src = fs.readFileSync(path.join(__dirname, "../lib/combat.js"), "utf8");
  const view = src.slice(src.indexOf("async function combatViewFor"), src.indexOf("async function combatsHere"));
  for (const field of ["die:", "rolls:", "modifiers:", "total:", "advantageSource:"]) {
    assert.ok(!view.includes(field), `combatViewFor mentions ${field}`);
  }
});

// ─── The announcement, told per reader ───────────────────────────────────────

const { renderPeopleLine, slotList } = require("../lib/peopleLine");
const { lensRow, attachSubjects } = require("../lib/strangers");
const { participantData } = require("../lib/combat");

const announcement = {
  text: `{0} attacks ${slotList(1, 2)}!`,
  people: [
    { id: "A", name: "Ada Vane", alias: "a young woman", masked: false },
    { id: "B", name: "Bo Reed", alias: "an old man", masked: false },
    { id: "H", name: "a young man", alias: "a young man", masked: true },
  ],
};

test("the stored line names nobody by a bare face", () => {
  assert.equal(renderPeopleLine(announcement), "A young woman attacks an old man and a young man!");
});

test("each reader reads the names they know, and themselves by name", () => {
  const bo = renderPeopleLine(announcement, { viewerId: "B", knows: (id) => id === "A" });
  assert.equal(bo, "Ada Vane attacks Bo Reed and a young man!");
  const stranger = renderPeopleLine(announcement, { viewerId: "X", knows: () => false });
  assert.equal(stranger, "A young woman attacks an old man and a young man!");
  // A hood is its alias even to a GM's all-names view: the row never held the name behind it.
  assert.equal(renderPeopleLine(announcement, { everyone: true }), "Ada Vane attacks Bo Reed and a young man!");
});

test("the feed lens renders the line for its reader, and a GM reads every name", () => {
  const row = attachSubjects({ seq: "1", content: renderPeopleLine(announcement), characterId: null }, announcement);
  const facts = new Map([["A", { known: true }], ["B", { known: false }]]);
  assert.equal(lensRow(row, { characterId: "R", facts }).content, "Ada Vane attacks an old man and a young man!");
  assert.equal(lensRow(row, { gm: true }).content, "Ada Vane attacks Bo Reed and a young man!");
  // The template never reaches the wire: JSON drops the symbol.
  assert.ok(!JSON.stringify(row).includes("Bo Reed"));
});

// ─── A collaborator is snapshotted and rolled when asked ─────────────────────

test("a collaborator out of combat mode is snapshotted when asked, and surprised like a target", () => {
  const asked = new Date("2026-09-27T12:00:00Z");
  const row = { id: "C", name: "Col", mood: 0, combatModeSinceTurn: null, tags: [] };
  const data = withDie(5, () =>
    participantData(row, { side: "ATTACKER", role: "COLLABORATOR", status: "INVITED", turnId: "t", now: asked }),
  );
  assert.equal(data.alert, false);
  assert.equal(data.snapshotAt, asked);
  assert.equal(data.answeredAt, null);
  assert.deepEqual(data.modifiers, [{ label: "Surprised", value: -3 }]);
  assert.equal(data.total, 2);
  const target = withDie(5, () => participantData(row, { side: "DEFENDER", role: "TARGET", status: "JOINED", turnId: "t", now: asked }));
  assert.deepEqual(target.modifiers, data.modifiers);
});
