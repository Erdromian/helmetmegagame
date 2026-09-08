// The confirm-inside-a-transition deadlock, as a test.
//
// WHAT A FAILURE HERE MEANS. A component is doing
//
//     startTransition(async () => { const ok = await confirm({…}); … })
//
// and the control it belongs to will hang forever. `confirm()` resolves on a
// click, so the state update that mounts the dialog has to render immediately;
// inside an async transition React schedules it at transition priority, the
// transition cannot commit until the promise settles, and the promise cannot
// settle until somebody clicks a dialog that was never committed. The dialog
// never appears, `isPending` stays true, every control bound to it sits
// disabled, and the server action is never called. Only a refresh escapes.
//
// The fix is always the same shape — confirm FIRST, outside the transition:
//
//     const ok = await confirm({…});
//     if (!ok) return;
//     startTransition(async () => { … });
//
// This is written down in DESIGN-SYSTEM.md §8 and in the comments of the files
// that hit it. It still happened five times, which is why prose was not
// enough and this exists instead.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const WEB_APP = path.join(__dirname, "..", "..", "web", "app");
const SKIP = new Set(["node_modules", ".next"]);

function jsFilesUnder(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

// The transition's OWN callback body, by brace matching from its opening `{`.
// A fixed-size window was tried first and it accused ObjectivesPanel.js, whose
// transition is three lines long and whose correctly-written confirm sits in
// the next function down. Braces inside strings could in principle skew the
// count; in practice these bodies are ordinary code, and a false positive here
// is loud and easy to read rather than silent.
function transitionBody(source, from) {
  const open = source.indexOf("{", from);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

test("no component awaits confirm() inside startTransition", () => {
  const files = jsFilesUnder(WEB_APP);
  assert.ok(files.length > 200, `only scanned ${files.length} files — has web/app moved?`);

  const offences = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const re = /startTransition\(\s*async/g;
    let m;
    while ((m = re.exec(source)) !== null) {
      if (!transitionBody(source, m.index).includes("await confirm(")) continue;
      offences.push(`${path.relative(path.join(__dirname, "..", ".."), file)}:${source.slice(0, m.index).split("\n").length}`);
    }
  }

  assert.deepEqual(
    offences,
    [],
    `confirm() awaited inside startTransition — these controls will hang:\n${offences.join("\n")}\n` +
      "Move the confirm ABOVE the transition (DESIGN-SYSTEM.md §8).",
  );
});
