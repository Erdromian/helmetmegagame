// Builds the world the visual goldens are taken in: a local Postgres of its
// own (bascinet_visual, never the shared bascinet), migrated and synced from
// the YAML masters exactly the way dev:setup builds the ordinary local one,
// then the fixtures from fixtures.mjs on top. Safe to re-run; every step is
// idempotent, and the seed removes its own rows before writing them again.
//
//   npm run dev:visual:setup             # build, or bring up to date
//   npm run dev:visual:setup -- --fresh  # drop the database first
//
// Needs the root .env that `npm run dev:setup` writes (AUTH_SECRET is what
// the minted session cookies are signed with), so run that once first.

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VISUAL_DATABASE_URL } from "./fixtures.mjs";
import { run as seed } from "./seed.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function log(msg) {
  console.log(`\n== ${msg}`);
}

function envHas(key) {
  const path = resolve(REPO_ROOT, ".env");
  if (!existsSync(path)) return false;
  return new RegExp(`^\\s*${key}\\s*=\\s*\\S`, "m").test(readFileSync(path, "utf8"));
}

function dbName(url) {
  const parsed = new URL(url);
  if (!/^(localhost|127\.0\.0\.1|::1)$/.test(parsed.hostname)) {
    throw new Error(`VISUAL_DATABASE_URL's host is "${parsed.hostname}", not localhost — refusing to build a throwaway world there.`);
  }
  return parsed.pathname.replace(/^\//, "") || "bascinet_visual";
}

// createdb/dropdb connect as the OS user unless told otherwise, which only
// works where the OS user is a Postgres superuser (Postgres.app). On a
// Windows install the superuser is `postgres` and the OS user is somebody
// else entirely ("role does not exist"), so pass the URL's host, port and user.
function connectionArgs(url) {
  const parsed = new URL(url);
  const args = ["-h", parsed.hostname];
  if (parsed.port) args.push("-p", parsed.port);
  if (parsed.username) args.push("-U", decodeURIComponent(parsed.username));
  return args;
}

function pg(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: "pipe" });
    return null;
  } catch (err) {
    if (err.code === "ENOENT") return `${cmd} is not on PATH (it ships in Postgres's bin folder)`;
    return err.stderr?.toString().trim() || err.message;
  }
}

function ensureDatabase(url, name, { fresh }) {
  const conn = connectionArgs(url);
  if (fresh) {
    log(`Dropping "${name}"`);
    const err = pg("dropdb", [...conn, "--if-exists", name]);
    if (err) throw new Error(`dropdb failed: ${err}`);
  }
  log(`Ensuring "${name}" exists`);
  const err = pg("createdb", [...conn, name]);
  if (!err) console.log(`  + created`);
  else if (/already exists/.test(err)) console.log(`  = already there`);
  else throw new Error(`createdb failed: ${err}\n  Is Postgres running? See LOCAL-DEV.md §1.`);
}

// The same steps as scripts/dev/setup-local.mjs, in the same order, against
// this database instead. LOCAL_MODE is forced so the mirror pass at the end of
// db:sync writes to the local outbox rather than a guild.
function build(url) {
  const env = {
    ...process.env,
    DATABASE_URL: url,
    LOCAL_MODE: "true",
    DISCORD_TOKEN: "local",
    DISCORD_GUILD_ID: "local",
  };
  const step = (label, cmd) => {
    log(label);
    execSync(cmd, { cwd: REPO_ROOT, stdio: "inherit", env });
  };
  step("Applying migrations", "npm run db:migrate:deploy");
  step("Syncing tags", "npm run db:sync-tags");
  step("Importing zones, locations and rooms", "npm run db:import-zones -- --apply");
  step("Syncing roles, desires and documents", "npm run db:sync");
}

async function main() {
  const argv = process.argv.slice(2);

  if (!envHas("AUTH_SECRET")) {
    throw new Error(
      "No AUTH_SECRET in the root .env. Run `npm run dev:setup` once — it writes the .env " +
        "the session cookies are signed with, and links web/.env.local to it.",
    );
  }

  const url = VISUAL_DATABASE_URL;
  const name = dbName(url);
  console.log(`visual world: ${url}`);

  ensureDatabase(url, name, { fresh: argv.includes("--fresh") });
  build(url);

  log("Seeding the fixtures");
  process.env.DATABASE_URL = url;
  await seed();

  log("Done");
  console.log(
    "\nNext:\n" +
      "  npm run dev:visual                          compare every screen to its golden\n" +
      '  npm run dev:visual -- -g " <screen>$" --update-snapshots    re-baseline a screen you meant to change\n',
  );
}

main().catch((err) => {
  console.error("\nvisual setup failed:", err.message ?? err);
  process.exit(1);
});
