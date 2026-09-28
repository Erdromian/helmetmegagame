// The archive's text export (web/lib/archiveText.js, ARCHIVE.md §5 Export): the
// file has to break into days and scenes where the page does, name a hood the
// way the page does, and write an act as the sentence /gm/audit prints.
//
// The resolve hook only supplies what Next resolves for us in the app: the
// extension on a sibling import, and @lifeweb/db's files by path.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB_LIB = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const DB_ROOT = resolvePath(WEB_LIB, "../../db");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@lifeweb/db/")) {
      const file = resolvePath(DB_ROOT, specifier.slice("@lifeweb/db/".length));
      return { url: pathToFileURL(file.endsWith(".js") ? file : `${file}.js`).href, shortCircuit: true };
    }
    if (specifier.startsWith("./") && !/\.[cm]?js$/.test(specifier) && context.parentURL?.startsWith(pathToFileURL(WEB_LIB).href)) {
      return nextResolve(`${specifier}.js`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { actionSentence, archiveFileName, archiveTranscriptText, flattenMentions, safeTimeZone } = await import("../archiveText.js");
const { parseArchiveParams } = await import("../archiveQuery.js");

const GAME = { id: "game-abc1234", label: "Spring Playtest" };
const at = (hhmm, day = "2026-09-20") => new Date(`${day}T${hhmm}:00Z`);

function row(over) {
  return {
    id: over.id,
    kind: "MESSAGE",
    source: "WEB",
    sentAt: at("10:00"),
    turnNumber: 1,
    dayNumber: 1,
    zoneName: "Town",
    locationName: "Old Town",
    threadName: null,
    placeKey: "loc:old-town",
    channelKind: "location",
    characterId: null,
    characterName: null,
    concealedAlias: null,
    content: "",
    editedAt: null,
    action: null,
    ...over,
  };
}

const ROWS = [
  row({ id: "t1", kind: "TURN_START", content: "Day 1 begins", placeKey: "zone:town" }),
  row({ id: "m1", characterId: "c-ada", characterName: "Ada Vance", content: "Good morning, {char:c-bo|Bo}." }),
  row({ id: "m2", sentAt: at("10:05"), characterId: "c-bo", characterName: "Bo Hale", concealedAlias: "Young Man", content: "Line one\nline two" }),
  row({ id: "w1", sentAt: at("10:06"), source: "SYSTEM", channelKind: "scene", content: "A bell rings." }),
  row({
    id: "a1",
    kind: "ACTION",
    source: "SYSTEM",
    sentAt: at("10:07"),
    placeKey: null,
    characterId: "c-ada",
    characterName: "Ada Vance",
    content: "Ada Vance — Room search",
    action: { type: "some_unregistered_verb", details: {}, actorName: "Ada Vance" },
  }),
  row({ id: "d1", kind: "DEATH", sentAt: at("09:00", "2026-09-21"), turnNumber: 3, dayNumber: 2, placeKey: "loc:tavern", locationName: "Tavern", content: "Bo Hale died." }),
];

test("days and scenes break where the page breaks them, and TURN_START is never a line", () => {
  const text = archiveTranscriptText({ game: GAME, status: "The current game", rows: ROWS, filters: parseArchiveParams({}), tz: "UTC", generatedAt: at("12:00") });
  const lines = text.split("\n");
  assert.equal(lines.filter((l) => l === "== Day 1 ==").length, 1);
  assert.equal(lines.filter((l) => l === "== Day 2 ==").length, 1);
  assert.ok(!text.includes("Day 1 begins"));
  assert.ok(lines.includes("-- Town · Old Town --"));
  assert.ok(lines.includes("-- Town · Tavern --"));
  assert.match(text, /5 entries/);

  // A day with nothing in it but its own start gets no heading.
  const quiet = row({ id: "t9", kind: "TURN_START", turnNumber: 9, dayNumber: 5, content: "Day 5 begins" });
  const withQuiet = archiveTranscriptText({ game: GAME, rows: [...ROWS, quiet], filters: parseArchiveParams({}), tz: "UTC" });
  assert.ok(!withQuiet.includes("== Day 5 =="));
});

test("a hooded line names the hood, then who wore it; continuation lines are indented", () => {
  const text = archiveTranscriptText({ game: GAME, rows: ROWS, filters: parseArchiveParams({}), tz: "UTC" });
  assert.ok(text.includes("10:05  Young Man (Bo Hale): Line one\n       line two"));
  assert.ok(text.includes("10:00  Ada Vance: Good morning, Bo."));
  assert.ok(text.includes("10:06  * A bell rings."));
  assert.ok(text.includes("09:00  † Bo Hale died."));
});

test("times follow the reader's timezone, and an unknown one reads as UTC", () => {
  const text = archiveTranscriptText({ game: GAME, rows: ROWS, filters: parseArchiveParams({}), tz: "Asia/Tokyo" });
  assert.ok(text.includes("19:00  Ada Vance: Good morning"));
  assert.equal(safeTimeZone("Not/AZone"), "UTC");
  assert.equal(safeTimeZone(""), "UTC");
});

test("an act reads as the audit sentence, with the leading name dropped when it is the row's own", () => {
  assert.equal(actionSentence(ROWS[4]), "Some unregistered verb");
  const text = archiveTranscriptText({ game: GAME, rows: ROWS, filters: parseArchiveParams({ actions: "1" }), tz: "UTC" });
  assert.ok(text.includes("10:07  Ada Vance ▸ Some unregistered verb"));
  // A GM's act on somebody keeps its opening name.
  const outcome = { ...ROWS[4], action: { type: "some_unregistered_verb", details: {}, actorName: "A GM", targetId: "c-ada", targetName: "Ada Vance" } };
  assert.equal(actionSentence(outcome), "A GM — Some unregistered verb on Ada Vance");
  // A Move's words ride along when the sentence does not quote them.
  const move = { ...ROWS[4], action: { ...ROWS[4].action, moveText: "I climb the wall" } };
  assert.equal(actionSentence(move), 'Some unregistered verb — "I climb the wall"');
  // No audit row behind it: the plain line.
  assert.equal(actionSentence({ ...ROWS[4], action: null }), "Ada Vance — Room search");
});

test("mentions print the frozen name, else the live one, else someone", () => {
  const names = new Map([["c-old", "Cara"]]);
  assert.equal(flattenMentions("{char:c-1|Ada} and {char:c-old} and {char:c-gone}", names), "Ada and Cara and someone");
});

test("the header says what was shown and what narrowed it", () => {
  const filters = parseArchiveParams({ zone: ["Town"], character: ["c-ada"], from: "1", to: "2", q: "bell", show: "all", actions: "1" });
  const text = archiveTranscriptText({ game: GAME, status: "A past game", rows: [], filters, names: new Map([["c-ada", "Ada Vance"]]), tz: "UTC" });
  const head = text.split("\n");
  assert.equal(head[0], "Archive — Spring Playtest");
  assert.equal(head[1], "A past game");
  assert.equal(head[2], "Showing: Everything · Actions on");
  assert.equal(head[3], "Narrowed to: “bell” · Days 1–2 · Town · Ada Vance");
  assert.equal(head[4], "Order: oldest first");
  assert.ok(text.includes("No line in this game matches that."));
});

test("a whole-game export says so instead of listing filters", () => {
  const text = archiveTranscriptText({ game: GAME, rows: ROWS, whole: true, tz: "UTC", epilogue: { closingNote: "It ended.", facts: "It lasted 2 days.", antagonists: [], roster: ["pub as Ada Vance, Baker"] } });
  assert.ok(text.includes("Showing: the whole game, every line and every act"));
  assert.ok(!text.includes("Narrowed to:"));
  assert.ok(text.includes("» It ended."));
  assert.ok(text.includes("  pub as Ada Vance, Baker"));
});

test("the file is named after the game", () => {
  assert.equal(archiveFileName(GAME), "archive-spring-playtest.txt");
  assert.equal(archiveFileName(GAME, { filtered: true }), "archive-spring-playtest-filtered.txt");
  // The month's short name is the runtime's ICU ("Sep" or "Sept"); the shape is the point.
  assert.match(
    archiveFileName({ id: "x", startedAt: "2026-09-01T00:00:00Z", endedAt: "2026-09-30T00:00:00Z" }),
    /^archive-1-sept?-2026-30-sept?-2026[.]txt$/,
  );
});
