// The Combat lens's row for one fight (web/lib/moveRows.js#combatRow, ATTACK.md §8) — what a GM reads a fight
// by before opening it, and what the desk draws from after.
//
// The report this pins (2026-10-03): a character who intervened was not shown properly to the GM. The title
// named only the people the fight started with, so the rail read "Ada vs Bo" while Cy fought beside Bo, and
// "Ada vs nobody" once Bo was gone and Cy carried on; and the desk reloaded snapshots only when the headcount
// changed, so a declined row turning into somebody's place on the defenders kept its old snapshot.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// What Next resolves for us in the app: `@/` is web/, @lifeweb/db is the db package by path, and the app's own
// relative imports go without an extension.
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolvePath(HERE, "../..");
const DB_ROOT = resolvePath(HERE, "../../../db");
const asFile = (file) => pathToFileURL(/\.(m?js|json)$/.test(file) ? file : `${file}.js`).href;
// referenceData.js reaches the auth chain (next-auth, next/server), which only runs inside Next. combatRow uses
// none of it — only the Move rows' tag chips do — so it is stood in for here.
const REFERENCE_DATA_STUB = `data:text/javascript,${encodeURIComponent(
  "export const chipSelect = () => ({}); export const composeChipTag = (t) => t; export const GM_CHIP_CTX = {};",
)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/referenceData") return { url: REFERENCE_DATA_STUB, shortCircuit: true };
    if (specifier === "@lifeweb/db") return { url: asFile(resolvePath(DB_ROOT, "index.js")), shortCircuit: true };
    if (specifier.startsWith("@lifeweb/db/")) {
      return { url: asFile(resolvePath(DB_ROOT, specifier.slice("@lifeweb/db/".length))), shortCircuit: true };
    }
    if (specifier.startsWith("@/")) return { url: asFile(resolvePath(WEB_ROOT, specifier.slice(2))), shortCircuit: true };
    if (/^\.\.?\//.test(specifier) && !/\.\w+$/.test(specifier) && context.parentURL?.startsWith("file:")) {
      return { url: asFile(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier)), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { combatRow } = await import("../moveRows.js");

const T0 = new Date("2026-10-03T10:00:00Z");
const at = (min) => new Date(T0.getTime() + min * 60 * 1000);

function participant(id, name, over = {}) {
  return {
    id: `p-${id}`,
    characterId: id,
    character: { id, name, discordUserId: null, updatedAt: T0, roleTitle: "", status: "ALIVE" },
    side: "ATTACKER",
    role: "INITIATOR",
    status: "JOINED",
    alert: true,
    die: 4,
    rolls: [4],
    advantageSource: null,
    modifiers: [],
    total: 4,
    distance: null,
    fromLocationName: null,
    description: null,
    compelled: false,
    callOffAt: null,
    leftReason: null,
    answeredAt: null,
    escortOfId: null,
    cameBackFrom: null,
    joinedAt: T0,
    snapshotAt: T0,
    ...over,
  };
}

function fight(participants, over = {}) {
  return {
    id: "c1",
    turnId: "t1",
    locationId: "gate",
    locationName: "Gate",
    zoneId: "town",
    location: { name: "Gate", zone: { name: "Town" } },
    fromAmbush: false,
    openingMessage: null,
    endedAt: null,
    endReason: null,
    resultMessage: null,
    resolvedAt: null,
    resolvedByDiscordUserId: null,
    reopenedAt: null,
    startedAt: T0,
    participants,
    ...over,
  };
}

const ctx = { usernameById: new Map() };
const ada = participant("ada", "Ada");
const bo = participant("bo", "Bo", { side: "DEFENDER", role: "TARGET" });
const gus = participant("gus", "Gus", {
  side: "DEFENDER",
  role: "INTERVENER",
  distance: 0,
  escortOfId: "bo",
  joinedAt: at(2),
  snapshotAt: at(2),
});

test("the title names everybody fighting, the people who stepped in after the ones it started with", () => {
  const row = combatRow(fight([gus, ada, bo]), ctx);
  assert.equal(row.title, "Ada vs Bo, Gus");
});

test("a side carried on by interveners alone still names them", () => {
  const left = { ...bo, status: "LEFT", leftReason: "moved" };
  const row = combatRow(fight([ada, left, gus]), ctx);
  assert.equal(row.title, "Ada vs Gus");
});

test("the rail counts the people fighting, and how many of them stepped in", () => {
  const declined = participant("dee", "Dee", { role: "COLLABORATOR", status: "DECLINED" });
  const row = combatRow(fight([ada, bo, gus, declined]), ctx);
  assert.equal(row.fightingCount, 3);
  assert.equal(row.steppedInCount, 1);
});

test("an escort's row names the charge they stepped in for", () => {
  const row = combatRow(fight([ada, bo, gus]), ctx);
  const card = row.people.find((p) => p.characterId === "gus");
  assert.equal(card.escortOfId, "bo");
  assert.equal(card.escortOfName, "Bo");
});

test("the snapshot key moves when a declined row becomes somebody's place on the defenders", () => {
  const dee = participant("dee", "Dee", { role: "COLLABORATOR", status: "DECLINED" });
  const before = combatRow(fight([ada, bo, dee]), ctx);
  const back = { ...dee, side: "DEFENDER", role: "INTERVENER", status: "JOINED", cameBackFrom: "DECLINED", snapshotAt: at(5) };
  const after = combatRow(fight([ada, bo, back]), ctx);
  assert.equal(before.people.length, after.people.length, "nobody new — the headcount alone would not notice");
  assert.notEqual(before.snapshotKey, after.snapshotKey);
  assert.equal(after.people.find((p) => p.characterId === "dee").cameBackFrom, "DECLINED");
});

test("a fight somebody came into after it was solved reads Reopened until it is solved again", () => {
  const reopened = combatRow(fight([ada, bo, gus], { reopenedAt: at(3) }), ctx);
  assert.equal(reopened.reopened, true);
  assert.equal(reopened.statusLabel, "Live");
  const resolved = combatRow(fight([ada, bo, gus], { reopenedAt: at(3), resolvedAt: at(9) }), ctx);
  assert.equal(resolved.reopened, false);
  assert.equal(resolved.statusLabel, "Solved");
});
