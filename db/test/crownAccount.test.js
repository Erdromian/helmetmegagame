// The Baron's CROWN account: `bank_account: crown` in docs/roles.yaml, and the
// helpers that make its balance the Vault's (db/lib/bankAccounts.js,
// docs/systemdocs/DEPOT.md §0g). Pure, no Prisma beyond a stub.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { parseRolesYaml } = require("../lib/syncRoles");
const { accountBalance, vaultBacked, isCrown, CROWN, TREASURY, OFFSHORE } = require("../lib/bankAccounts");

const seat = (extra) => ({
  groups: {
    court: {
      baron: { name: "Baron", intro: "x", description: [], difficulty: "hard", multiple: false, starting_zone: "fortress", ...extra },
    },
  },
});
const rolesOf = (out) => out.roles ?? out;

test("`bank_account: crown` opens a CROWN account with nothing in it", () => {
  const [baron] = rolesOf(parseRolesYaml(seat({ bank_account: "crown" })));
  assert.equal(baron.bankAccountClass, CROWN);
  assert.equal(baron.startingAccountObols, 0);
});

test("a crown seat may not set a starting balance: its balance is the Vault", () => {
  assert.throws(() => parseRolesYaml(seat({ bank_account: "crown", starting_account: 36 })), /crown account/);
});

test("the Baron's seat in docs/roles.yaml is the Crown's", () => {
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, "../../docs/roles.yaml"), "utf8"));
  const baron = rolesOf(parseRolesYaml(doc)).find((r) => r.slug === "baron");
  assert.equal(baron.bankAccountClass, CROWN);
  assert.equal(baron.startingAccountObols, 0);
});

test("a Crown balance is read off the Vault, never off the stored column", async () => {
  const tx = {
    room: { findUnique: async () => ({ id: "vault", name: "Vault", location: { zoneId: "z" } }) },
    tag: { findUnique: async () => ({ id: "obol", slug: "obol", name: "Obol" }) },
    roomTag: { findUnique: async () => ({ quantity: 342 }) },
  };
  assert.equal(await accountBalance(tx, { class: CROWN, balanceObols: 36 }), 342);
  assert.equal(await accountBalance(tx, { class: TREASURY, balanceObols: 36 }), 36);
  assert.equal(await accountBalance(tx, null), 0);
});

test("the Crown and a Treasury account are both paid from the Vault; Offshore is not", () => {
  assert.equal(vaultBacked({ class: CROWN }), true);
  assert.equal(vaultBacked({ class: TREASURY }), true);
  assert.equal(vaultBacked({ class: OFFSHORE }), false);
  assert.equal(isCrown({ class: CROWN }), true);
  assert.equal(isCrown({ class: TREASURY }), false);
});
