// The guard that stands between a scratch script and somebody's real game.
// See db/lib/localDatabase.js for what it is doing here.
const test = require("node:test");
const assert = require("node:assert");
const {
  isLocalDatabase,
  requireLocalDatabase,
  assertRawSqlAllowed,
  rawSqlText,
} = require("../lib/localDatabase");

const PROD = "postgresql://u:p@altaria.proxy.rlwy.net:36736/railway";
const LOCAL = "postgresql://me@localhost:5432/lifeweb_local";

test("only localhost counts as local", () => {
  assert.equal(isLocalDatabase(LOCAL), true);
  assert.equal(isLocalDatabase("postgresql://me@127.0.0.1:5432/x"), true);
  assert.equal(isLocalDatabase("postgresql://me@[::1]:5432/x"), true);
  assert.equal(isLocalDatabase(PROD), false);
  // Guilty until named: an unfamiliar host is somebody's real data, and an
  // unparseable or missing URL is not a licence to proceed.
  assert.equal(isLocalDatabase("postgresql://me@db.internal:5432/x"), false);
  assert.equal(isLocalDatabase("not a url"), false);
  assert.equal(isLocalDatabase(""), false);
  // Called with no argument it reads process.env.DATABASE_URL, which is the
  // only thing that actually decides where a query lands — a .env file sitting
  // beside a script proves nothing if the variable is already exported.
});

test("the irreversible verbs are refused off a non-local database", () => {
  for (const sql of [
    'TRUNCATE TABLE "Character" CASCADE',
    'truncate table "Character"',
    'DROP TABLE "Foo"',
    'DROP SCHEMA public CASCADE',
    'DROP DATABASE railway',
  ]) {
    assert.throws(() => assertRawSqlAllowed([sql], PROD), /Refused/, sql);
  }
});

test("the raw SQL this codebase actually runs is untouched", () => {
  // Every one of these is a real call site: pg_notify (feedNotify,
  // presenceNotify, typingNotify), tagWrites' UPDATE, depotState's SELECT and
  // the wipe's LocationLink reset. If this test ever fails, the pattern got
  // greedy and is about to break production writes.
  for (const sql of [
    "SELECT pg_notify($1, $2)",
    'UPDATE "LocationLink" SET "isOpen" = "authoredOpen", "openUntil" = NULL',
    'SELECT id FROM "Tag" WHERE slug = $1',
    'DELETE FROM "CharacterTag" WHERE "characterId" = $1',
    'INSERT INTO "Turn" ("number") VALUES (1)',
  ]) {
    assert.doesNotThrow(() => assertRawSqlAllowed([sql], PROD), sql);
  }
});

test("a local database may still be truncated — that is the whole point", () => {
  assert.doesNotThrow(() => assertRawSqlAllowed(['TRUNCATE TABLE "Character"'], LOCAL));
  assert.doesNotThrow(() => assertRawSqlAllowed(['DROP TABLE "Character"'], LOCAL));
});

test("every shape Prisma hands a raw query is read, not just plain strings", () => {
  // $executeRawUnsafe gives a string; a tagged template gives a
  // TemplateStringsArray; Prisma.sql gives an object with .strings.
  assert.match(rawSqlText(['TRUNCATE TABLE "X"']), /TRUNCATE/);
  assert.match(rawSqlText([["TRUNCATE TABLE ", " CASCADE"]]), /TRUNCATE/);
  assert.match(rawSqlText([{ strings: ["DROP TABLE ", ""] }]), /DROP TABLE/);
  assert.equal(rawSqlText([undefined]), "");
  // A tagged template must be caught the same as the unsafe string form.
  assert.throws(() => assertRawSqlAllowed([["TRUNCATE TABLE ", ""]], PROD), /Refused/);
});

test("requireLocalDatabase names the host it refused, and says so loudly", () => {
  const before = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = PROD;
    assert.throws(() => requireLocalDatabase("The seed script"), /altaria\.proxy\.rlwy\.net/);
    // The message has to name the trap that actually caused this, not a
    // plausible-sounding one: an exported DATABASE_URL beats every .env file.
    assert.throws(() => requireLocalDatabase(), /exported variable wins/);
    process.env.DATABASE_URL = LOCAL;
    assert.doesNotThrow(() => requireLocalDatabase());
    delete process.env.DATABASE_URL;
    assert.throws(() => requireLocalDatabase(), /unset/);
  } finally {
    if (before === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = before;
  }
});
