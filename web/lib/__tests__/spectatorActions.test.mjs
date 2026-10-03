// What a spectator reads of a pushed turn (web/lib/spectatorActions.js, CHAT.md §5a).
//
// Bascinet's line: outcomes, never dice. The fake database below ignores every `select` and hands back
// whole rows, GM-only columns and all — the die, the rolls, the total, the snapshot, a Vampire's
// compulsion, the GM's notes — so the only thing standing between those and a spectator's browser is
// the row builders. That is the thing under test.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// What Next resolves for us in the app: @lifeweb/db's files by path (moves.js reads rollDie). The
// economicTags.test.mjs hook.
const DB_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../../db");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@lifeweb/db/")) {
      const file = resolvePath(DB_ROOT, specifier.slice("@lifeweb/db/".length));
      return { url: pathToFileURL(file.endsWith(".js") ? file : `${file}.js`).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { loadSpectatorTurn, loadSpectatorTurns } = await import("../spectatorActions.js");

// Never in anything the page ships, at any depth.
const DENIED = new Set([
  "die",
  "rolls",
  "total",
  "modifiers",
  "advantageSource",
  "diceRoll",
  "diceModifier",
  "rollLine",
  "compelled",
  "compelledLine",
  "snapshot",
  "snapshotAt",
  "gmNotes",
  "presentedState",
  "distances",
  "appliedEffects",
  "discordUserId",
]);

function deniedKeys(value, path = "") {
  if (Array.isArray(value)) return value.flatMap((v, i) => deniedKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(DENIED.has(k) ? [`${path}.${k}`] : []),
      ...deniedKeys(v, `${path}.${k}`),
    ]);
  }
  return [];
}

const at = (minute) => new Date(Date.UTC(2026, 9, 3, 12, minute));
const ada = { id: "c-ada", name: "Ada Black", updatedAt: at(0), discordUserId: "111" };
const bo = { id: "c-bo", name: "Bo Grey", updatedAt: at(0), discordUserId: "222" };
const town = { id: "z-town", name: "Town" };
const pub = { id: "l-pub", name: "The Pub" };

function world() {
  return {
    turns: [
      { id: "t1", number: 1, dayNumber: 1, status: "RESOLVED" },
      { id: "t2", number: 2, dayNumber: 2, status: "OPEN" },
    ],
    actions: [
      {
        id: "a-gambit",
        turnId: "t1",
        characterId: ada.id,
        status: "CONFIRMED",
        moveKind: "GAMBIT",
        description: "I pick the lock on the cellar.",
        resultMessage: "The lock gives. The cellar is empty.",
        gmNotes: "rolled low, went easy",
        diceRoll: 2,
        diceModifier: -1,
        appliedEffects: { resources: 5 },
        createdAt: at(1),
        zone: town,
        location: pub,
        character: { ...ada, zone: town, location: pub },
      },
      {
        id: "a-draft",
        turnId: "t1",
        characterId: bo.id,
        status: "PENDING_TYPE",
        moveKind: null,
        description: "half a thought",
        createdAt: at(2),
        zone: town,
        location: pub,
        character: { ...bo, zone: town, location: pub },
      },
      {
        id: "a-travel",
        turnId: "t1",
        characterId: bo.id,
        status: "CONFIRMED",
        moveKind: "ROUTINE",
        description: "Travel to the Square",
        gmNotes: "auto:zone_change",
        createdAt: at(3),
        zone: town,
        location: pub,
        character: { ...bo, zone: town, location: pub },
      },
    ],
    combats: [
      {
        id: "f1",
        turnId: "t1",
        locationName: "The Pub",
        location: { name: "The Pub", zone: { name: "Town" } },
        fromAmbush: false,
        openingMessage: null,
        endReason: "TURN_ENDED",
        resultMessage: "Bo goes down with a broken nose.",
        distances: { [ada.id]: [0, pub.id] },
        startedAt: at(4),
        participants: [
          {
            id: "p-ada",
            characterId: ada.id,
            side: "ATTACKER",
            role: "INITIATOR",
            status: "JOINED",
            description: "I swing a bottle at Bo.",
            die: 6,
            rolls: [6, 2],
            modifiers: [{ label: "Armed", value: 1 }],
            total: 7,
            compelled: true,
            snapshot: { tags: [] },
            snapshotAt: at(4),
            character: ada,
          },
          {
            id: "p-bo",
            characterId: bo.id,
            side: "DEFENDER",
            role: "TARGET",
            status: "JOINED",
            description: "",
            die: 1,
            rolls: [1],
            total: 1,
            character: bo,
          },
          {
            id: "p-declined",
            characterId: "c-cy",
            side: "ATTACKER",
            role: "COLLABORATOR",
            status: "DECLINED",
            description: "",
            character: { id: "c-cy", name: "Cy Never", updatedAt: at(0) },
          },
        ],
      },
    ],
    cavingRolls: [
      {
        id: "r1",
        turnId: "t1",
        characterId: bo.id,
        kind: "TROUBLE",
        die: 1,
        gmNotes: "a rockfall, two turns Bruised",
        presentedState: { tags: [] },
        resolvedAt: at(9),
        createdAt: at(5),
        character: bo,
        zone: { name: "Caves" },
        location: { name: "The Hole" },
      },
      {
        id: "r2",
        turnId: "t1",
        characterId: bo.id,
        kind: "TROUBLE",
        die: 1,
        response: "I brace against the wall.",
        resolvedAt: at(9),
        createdAt: at(6),
        character: bo,
        zone: { name: "Caves" },
        location: { name: "The Hole" },
      },
      {
        id: "r3",
        turnId: "t1",
        characterId: ada.id,
        kind: "FIND",
        die: 6,
        resolvedAt: at(7),
        createdAt: at(7),
        character: ada,
        zone: { name: "Caves" },
        location: { name: "The Hole" },
        lootTag: { name: "Glowcap" },
      },
    ],
    stagedMessages: [
      {
        id: "m-sent",
        moveId: "a-gambit",
        kind: "PRIVATE",
        content: "The cellar is empty.",
        sentAt: at(10),
        createdAt: at(8),
        recipients: [{ character: ada }],
      },
      {
        id: "m-unsent",
        moveId: "a-gambit",
        kind: "PRIVATE",
        content: "A draft nobody sent.",
        sentAt: null,
        createdAt: at(8),
        recipients: [{ character: ada }],
      },
      {
        id: "m-fight",
        combatId: "f1",
        kind: "PUBLIC",
        content: "A brawl spills out of the Pub.",
        sentAt: at(10),
        createdAt: at(8),
        zone: { name: "Town" },
        recipients: [],
      },
      {
        id: "m-cave",
        cavingRollId: "r2",
        kind: "PRIVATE",
        content: "Rocks fall around you.",
        sentAt: at(10),
        createdAt: at(8),
        recipients: [{ character: bo }],
      },
    ],
  };
}

// Applies the filters the loader actually writes, and ignores every select — whole rows come back.
function fakeDb(w = world()) {
  const inList = (cond, value) => cond == null || (cond.in ? cond.in.includes(value) : cond === value);
  const byTurn = (rows) => ({
    findMany: async ({ where }) =>
      rows.filter((r) => inList(where.turnId, r.turnId) && inList(where.status, r.status)),
  });
  return {
    turn: {
      findMany: async ({ where }) =>
        w.turns.filter((t) => inList(where.status, t.status)).sort((a, b) => b.number - a.number),
      findUnique: async ({ where }) => w.turns.find((t) => t.id === where.id) ?? null,
    },
    action: byTurn(w.actions),
    combat: byTurn(w.combats),
    cavingRoll: byTurn(w.cavingRolls),
    stagedMessage: {
      findMany: async ({ where }) =>
        w.stagedMessages.filter((m) => {
          if (where.sentAt && "not" in where.sentAt && where.sentAt.not === null && m.sentAt == null) return false;
          return where.OR.some((clause) => {
            const [key, cond] = Object.entries(clause)[0];
            return m[key] != null && cond.in.includes(m[key]);
          });
        }),
    },
  };
}

test("only pushed turns are offered, newest first", async () => {
  const turns = await loadSpectatorTurns(fakeDb());
  assert.deepEqual(
    turns.map((t) => t.id),
    ["t1"],
  );
  assert.equal(turns[0].label, "Turn 1 · Day 1");
});

test("the open turn, or no turn at all, reads as nothing", async () => {
  assert.equal(await loadSpectatorTurn(fakeDb(), "t2"), null);
  assert.equal(await loadSpectatorTurn(fakeDb(), "nope"), null);
  assert.equal(await loadSpectatorTurn(fakeDb(), ""), null);
});

test("no die, roll, total, snapshot, compulsion or GM note reaches the page", async () => {
  const turn = await loadSpectatorTurn(fakeDb(), "t1");
  assert.deepEqual(deniedKeys(turn), []);
});

test("Moves: confirmed only, no travel, with the Result and the sent messages", async () => {
  const { moves } = await loadSpectatorTurn(fakeDb(), "t1");
  assert.deepEqual(
    moves.map((m) => m.id),
    ["a-gambit"],
  );
  const [gambit] = moves;
  assert.equal(gambit.characterName, "Ada Black");
  assert.equal(gambit.kindLabel, "Gambit");
  assert.equal(gambit.where, "Town · The Pub");
  assert.equal(gambit.result, "The lock gives. The cellar is empty.");
  assert.deepEqual(
    gambit.messages.map((m) => m.content),
    ["The cellar is empty."],
  );
  assert.equal(gambit.messages[0].to, "Ada Black");
});

test("Fights: who was in it, what they wrote, how it ended and the Result", async () => {
  const { fights } = await loadSpectatorTurn(fakeDb(), "t1");
  assert.equal(fights.length, 1);
  const [fight] = fights;
  assert.equal(fight.title, "Ada Black vs Bo Grey");
  assert.equal(fight.where, "Town · The Pub");
  assert.equal(fight.endLabel, "Ended at the push");
  assert.equal(fight.result, "Bo goes down with a broken nose.");
  // Somebody who declined never fought.
  assert.deepEqual(
    fight.sides.flatMap((s) => s.people.map((p) => p.name)),
    ["Ada Black", "Bo Grey"],
  );
  assert.equal(fight.sides[0].people[0].description, "I swing a bottle at Bo.");
  assert.deepEqual(fight.messages, [
    { id: "m-fight", kind: "PUBLIC", content: "A brawl spills out of the Pub.", to: "Town" },
  ]);
});

test("Caving: every result, a caver's 1s folded into one with its severity", async () => {
  const { caving } = await loadSpectatorTurn(fakeDb(), "t1");
  assert.equal(caving.length, 2);
  const trouble = caving.find((c) => c.kind === "TROUBLE");
  assert.equal(trouble.characterName, "Bo Grey");
  assert.equal(trouble.severity, "Severity 2");
  assert.equal(trouble.response, "I brace against the wall.");
  // A message staged on either of the folded rolls belongs to the one result.
  assert.deepEqual(
    trouble.messages.map((m) => m.content),
    ["Rocks fall around you."],
  );
  const find = caving.find((c) => c.kind === "FIND");
  assert.equal(find.lootName, "Glowcap");
  assert.equal(find.where, "Caves · The Hole");
});
