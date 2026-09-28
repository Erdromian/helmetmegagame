// What characters DO reaches the archive only through logAudit
// (db/lib/archiveActions.js, ARCHIVE.md). A raw auditLog.create writes the
// audit row and nothing else, so a verb written that way goes missing from the
// transcript and nobody notices. The scan below holds every source file to it:
// a raw create is allowed only for an action type the archive leaves out.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { archiveRoleOf } = require("../lib/archiveActions");
const { isLocalDatabase } = require("../lib/localDatabase");

const REPO = path.join(__dirname, "..", "..");
const ROOTS = ["db/lib", "bot/src", "web/lib", "web/app"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "generated", "migrations", "__tests__"]);

// A raw create whose type is worked out at run time. Each is read by hand and
// listed with every type it can write, so the scan can still judge it.
const DYNAMIC = {
  // gm/turns resolveMoveImpl: `move_${mode}`, mode save | solve | unsolve.
  "web/app/(desk)/gm/turns/actions.js:move_": ["move_save", "move_solve", "move_unsolve"],
  // The engine's own tag passes (logSystemTagChange): system_tag_<pass>.
  "db/lib/tagAudit.js:system_tag_": ["system_tag_"],
};

// A GM's own write of a type a character can also do. Raw on purpose: through
// logAudit it would be filed on the GM's character, if they had one.
const GM_WRITES = new Set([
  // /gm/dev setting the Meister's tax by hand; the Meister's own is logAudit.
  "web/app/(app)/gm/dev/actions.js:sell_tax_rate_set",
]);

function jsFilesUnder(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (/\.(c|m)?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

// The argument text of the call that opens at `from`, by counting brackets.
// Strings are not parsed; a bracket inside one is rare enough in an audit
// payload that the worst it costs is a wider slice.
function callBody(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  return src.slice(from);
}

// Every `const NAME = "an_action_type"` in the scanned code, so a write that
// names its type through a constant (KISS_AUDIT_ACTION) can still be judged.
function actionConstants(files) {
  const map = new Map();
  for (const { src } of files) {
    for (const m of src.matchAll(/\b([A-Z][A-Z0-9_]+)\s*=\s*["']([a-z0-9_:]+)["']/g)) map.set(m[1], m[2]);
  }
  return map;
}

// Every raw `auditLog.create(` / `createMany(` in the repo, with the types it
// can write. `types: null` means the type arrives as a parameter (a helper
// like /gm/dev's audit()), which the scan leaves to that helper's callers.
function rawAuditWrites() {
  const files = [];
  for (const root of ROOTS) {
    for (const file of jsFilesUnder(path.join(REPO, root))) {
      files.push({ rel: path.relative(REPO, file).split(path.sep).join("/"), src: fs.readFileSync(file, "utf8") });
    }
  }
  const constants = actionConstants(files);
  const found = [];
  for (const { rel, src } of files) {
    const re = /auditLog\.create(Many)?\(/g;
    let m;
    while ((m = re.exec(src))) {
      const body = callBody(src, m.index + m[0].length - 1);
      const line = src.slice(0, m.index).split("\n").length;
      // The engine writing as itself has no character to file an act on, only
      // an outcome's target.
      const system = /actorDiscordUserId:\s*["']system["']/.test(body);
      // The type's expression, up to the next property (it may wrap a line).
      const at = body.match(/actionType\s*(:\s*([\s\S]*?)(,\s*\n\s*[A-Za-z_]+\s*[:,}]|\n\s*\})|,)/);
      if (!at || !at[2]) {
        found.push({ rel, line, types: null });
        continue;
      }
      // A string compared against (`mode === "save" ? …`) is not a type.
      const expr = at[2].replace(/[!=]==\s*["'][^"']*["']/g, "");
      const template = expr.match(/^`([a-z0-9_:]*)\$\{/);
      if (template) {
        found.push({ rel, line, types: DYNAMIC[`${rel}:${template[1]}`] ?? null, prefix: template[1] });
        continue;
      }
      const types = [...expr.matchAll(/["']([a-z0-9_:]+)["']/g)].map((x) => x[1]);
      for (const id of expr.matchAll(/\b[A-Z][A-Z0-9_]+\b/g)) if (constants.has(id[0])) types.push(constants.get(id[0]));
      found.push({ rel, line, system, types: types.length ? types : null, unread: types.length ? undefined : expr.trim() });
    }
  }
  return found;
}

test("the archive's roles: a verb, an outcome and the machine", () => {
  assert.equal(archiveRoleOf("request_farm"), "actor");
  assert.equal(archiveRoleOf("steal"), "actor");
  assert.equal(archiveRoleOf("vending_buy"), "actor");
  assert.equal(archiveRoleOf("move_submitted"), "actor");
  // A verb nobody has listed yet is archived by default.
  assert.equal(archiveRoleOf("request_some_new_verb"), "actor");

  assert.equal(archiveRoleOf("move_solve"), "target");
  assert.equal(archiveRoleOf("move_rejected"), "target");
  assert.equal(archiveRoleOf("caving_loot_granted"), "target");
  assert.equal(archiveRoleOf("gm_staged_tag_applied"), "target");

  assert.equal(archiveRoleOf("gm_heal"), null);
  assert.equal(archiveRoleOf("superadmin_game_wipe"), null);
  assert.equal(archiveRoleOf("staged_effects_created"), null);
  assert.equal(archiveRoleOf("system_tag_hunger"), null);
  assert.equal(archiveRoleOf("character_created"), null);
  assert.equal(archiveRoleOf("move_save"), null);
  assert.equal(archiveRoleOf(""), null);
  assert.equal(archiveRoleOf(undefined), null);
});

test("every character's act goes through logAudit, so it reaches the archive", () => {
  const writes = rawAuditWrites();
  assert.ok(writes.length > 20, `the scan found only ${writes.length} raw audit writes; is it still looking in the right place?`);

  const bad = [];
  for (const w of writes) {
    // A type worked out at run time that nobody has read: say so, rather than
    // passing it on trust. List it in DYNAMIC above with what it can write.
    if (!w.types) {
      if (w.prefix !== undefined) bad.push(`${w.rel}:${w.line} writes \`${w.prefix}\${…}\`; list its types in DYNAMIC`);
      else if (w.unread) bad.push(`${w.rel}:${w.line} writes a type the scan cannot read (${w.unread}); name it with a string or a constant`);
      continue;
    }
    for (const type of w.types) {
      const role = archiveRoleOf(type);
      if (!role || (w.system && role === "actor") || GM_WRITES.has(`${w.rel}:${type}`)) continue;
      bad.push(`${w.rel}:${w.line} writes "${type}" with a raw auditLog.create`);
    }
  }
  assert.deepEqual(bad, [], `Route these through logAudit (db/lib/auditLog.js) so they reach the archive:\n${bad.join("\n")}`);
});

// Against a real Postgres: one ACTION row, off every feed, and gone with the
// transaction when the act rolls back.
const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

test("logAudit files an act in the archive, inside the caller's transaction", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const { logAudit } = require("../lib/auditLog");
  const { forgetGameId } = require("../lib/archive");
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());

  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { gameId: true } });
  if (!state?.gameId) return t.skip("no GameState.gameId in the local database — run npm run dev:setup");
  const location = await prisma.location.findFirst({ select: { id: true, name: true, zone: { select: { name: true } } } });
  if (!location) return t.skip("no Location in the local database — run npm run dev:setup");
  forgetGameId();

  const run = `aa-test-${Date.now()}`;
  const character = await prisma.character.create({
    data: { discordUserId: run, name: "Archive Tester", firstName: "Archive", locationId: location.id },
  });
  t.after(async () => {
    await prisma.archiveEntry.deleteMany({ where: { characterId: character.id } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { actorDiscordUserId: run } }).catch(() => {});
    await prisma.character.delete({ where: { id: character.id } }).catch(() => {});
  });

  await prisma.$transaction((tx) =>
    logAudit(tx, {
      actorDiscordUserId: run,
      actionType: "request_farm",
      targetCharacterId: character.id,
      details: { farmPlan: { planted: 3 } },
      place: { locationId: location.id, roomId: null },
    }),
  );
  const rows = await prisma.archiveEntry.findMany({ where: { characterId: character.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "ACTION");
  assert.equal(rows[0].placeKey, null);
  assert.equal(rows[0].zoneName, location.zone?.name ?? null);
  assert.equal(rows[0].action.type, "request_farm");
  assert.equal(rows[0].action.locationName, location.name);
  // Witnessed by the one who did it, and nobody standing around them.
  assert.deepEqual(rows[0].witnessIds, [character.id]);
  assert.deepEqual(rows[0].witnessNames, ["Archive Tester"]);

  // An act done to somebody is witnessed by both of them.
  const victim = await prisma.character.create({
    data: { discordUserId: `${run}-v`, name: "Archive Victim", firstName: "Archive", locationId: location.id },
  });
  t.after(async () => {
    await prisma.archiveEntry.deleteMany({ where: { characterId: victim.id } }).catch(() => {});
    await prisma.character.delete({ where: { id: victim.id } }).catch(() => {});
  });
  const done = await prisma.$transaction((tx) =>
    logAudit(tx, { actorDiscordUserId: run, actionType: "steal", targetCharacterId: victim.id, details: {}, place: null }),
  );
  const theft = await prisma.archiveEntry.findFirst({ where: { characterId: character.id, action: { path: ["type"], equals: "steal" } } });
  assert.ok(done && theft, "the steal was filed");
  assert.deepEqual(theft.witnessIds, [character.id, victim.id]);
  assert.deepEqual(theft.witnessNames, ["Archive Tester", "Archive Victim"]);
  await prisma.archiveEntry.delete({ where: { id: theft.id } });

  // The act fails after its audit row: neither row survives.
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await logAudit(tx, { actorDiscordUserId: run, actionType: "steal", details: {}, place: null });
      throw new Error("the act failed");
    }),
    /the act failed/,
  );
  assert.equal(await prisma.archiveEntry.count({ where: { characterId: character.id } }), 1);

  // A GM's own tool is not a character's act, even with a character to hand.
  await logAudit(prisma, { actorDiscordUserId: run, actionType: "gm_heal", details: {} });
  assert.equal(await prisma.archiveEntry.count({ where: { characterId: character.id } }), 1);
});
