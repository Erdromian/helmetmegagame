// A GM's look at a face (db/lib/gmPresentation.js) names the piece over it and the disguise under a hood:
// exactly what the room cannot see. It belongs on GM surfaces only. This is a tripwire, not a proof: every
// web file that READS looks (anything from gmPresentation but the writers' presentationStamp, or the
// GmLook component) must be on the list below, so a new reader is added on purpose, by somebody who has
// checked that the page it feeds is GM-gated. The writers stamp a row and show nothing, so they are free.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("../..", import.meta.url));

// Each behind requireGm / getGmSession / requireDev, or rendered only inside one.
const GM_READERS = new Set([
  "app/(app)/chat/GmAside.js",
  "app/(app)/chat/GmNameCard.js",
  "app/(app)/chat/actions.js", // gmCardOf, gated on getGmSession().isGm
  "app/(app)/chat/next/GmAside.js",
  "app/(app)/gm/dev/characters/[characterId]/DevBand.js",
  "app/(desk)/gm/players/PlayerRail.js",
  "app/(desk)/gm/players/RosterTable.js",
  "app/(desk)/gm/players/[[...selection]]/page.js",
  "app/(desk)/gm/players/layout.js",
  "app/(desk)/gm/turns/CavingDesk.js",
  "app/(desk)/gm/turns/CombatDesk.js",
  "app/(desk)/gm/turns/DesireDesk.js",
  "app/(desk)/gm/turns/MoveDesk.js",
  "app/(desk)/gm/turns/MoveHistoryDesk.js",
  "app/(desk)/gm/turns/OocDesk.js",
  "app/(desk)/gm/turns/QueueRail.js",
  "app/(desk)/gm/turns/StagedItems.js",
  "app/(desk)/gm/turns/actions.js",
  "app/components/GmLook.js",
  "app/components/InspectorColumn.js", // the GM desks' inspector, /gm/turns and /gm/players only
  "lib/deskRows.js",
  "lib/devPanelData.js",
  "lib/moveRows.js",
]);

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(m?js|jsx)$/.test(name)) yield path;
  }
}

// What a file takes from gmPresentation, or null when it imports nothing from it.
function gmPresentationImports(text) {
  const names = [];
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@lifeweb\/db\/lib\/gmPresentation["']/g)) {
    names.push(...m[1].split(",").map((s) => s.trim()).filter(Boolean));
  }
  return names.length ? names : null;
}

test("only GM-gated files read a GM look", () => {
  const strays = [];
  for (const file of [...sources(join(WEB, "app")), ...sources(join(WEB, "lib"))]) {
    const rel = relative(WEB, file).split(sep).join("/");
    const text = readFileSync(file, "utf8");
    const taken = gmPresentationImports(text);
    const reads = (taken && taken.some((name) => name !== "presentationStamp")) || /from\s*["'](?:@\/app\/components|\.)\/GmLook["']/.test(text);
    if (reads && !GM_READERS.has(rel)) strays.push(rel);
  }
  assert.deepEqual(strays, [], "a new reader of GM looks: check its page is GM-gated, then add it to GM_READERS");
});

test("the list has no stale entries", () => {
  for (const rel of GM_READERS) {
    assert.ok(statSync(join(WEB, rel)).isFile(), `${rel} is gone; take it off GM_READERS`);
  }
});
