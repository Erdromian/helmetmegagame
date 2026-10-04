// node --test over who may open a crate (docs/systemdocs/DEPOT.md §0e): only
// the Merchant's or the Baron's ring, worn and registered, opens a shipped or
// packed crate, sealed or not. Nothing here touches Prisma. Run with
// `npm test --workspace=db`.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { canOpenCrate, CRATE_OPEN_TOKEN } = require("../lib/depotCrates");
const { wornRingAccess } = require("../lib/rings");

function ring(ringAccessSlugs, { equipped = true, registered = true } = {}) {
  return {
    equipped,
    tag: {
      slug: "custom-ring-x",
      ringOfCharacterId: "c1",
      ringRegisteredAt: registered ? new Date() : null,
      ringAccessSlugs,
    },
  };
}

const opens = (characterTags) => canOpenCrate(wornRingAccess(characterTags));

test("the Merchant's or the Baron's ring on the finger opens a crate", () => {
  assert.equal(opens([ring(["depot-keycard", "merchants-terminal-key", CRATE_OPEN_TOKEN])]), true);
  assert.equal(opens([ring(["barons-key", "tower-key", CRATE_OPEN_TOKEN])]), true);
});

test("nothing else opens one: not a pocketed ring, an unregistered one, a Docker's, or a key in hand", () => {
  assert.equal(opens([ring([CRATE_OPEN_TOKEN], { equipped: false })]), false);
  assert.equal(opens([ring([CRATE_OPEN_TOKEN], { registered: false })]), false);
  // The Docker's ring opens the way through and the Cargo Bay, not a crate.
  assert.equal(opens([ring(["depot-keycard"])]), false);
  // A Depot Keycard used to open a sealed crate. It opens no crate now.
  assert.equal(opens([{ tag: { slug: "depot-keycard" } }]), false);
  // Ring only: the token held as a tag opens nothing.
  assert.equal(opens([{ tag: { slug: CRATE_OPEN_TOKEN } }]), false);
  assert.equal(opens([]), false);
});

test("the Merchant's and the Baron's rings carry the crate token, and only theirs", () => {
  const roles = yaml.load(fs.readFileSync(path.join(__dirname, "..", "..", "docs", "roles.yaml"), "utf8"));
  const seats = Object.values(roles.groups).flatMap((g) => Object.entries(g));
  const withToken = seats
    .filter(([, r]) => (r?.ring?.opens ?? []).includes(CRATE_OPEN_TOKEN))
    .map(([slug]) => slug)
    .sort();
  assert.deepEqual(withToken, ["baron", "merchant"]);
});
