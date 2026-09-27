// node --test over the Black Market terminal's pure half (db/lib/blackMarket.js,
// docs/systemdocs/DEPOT.md §0n), and the YAML that wires it up. Nothing here
// touches Prisma. Run with `npm test --workspace=db`.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const {
  BLACK_MARKET_ROOM_SLUG,
  BLACK_MARKET_TOKEN,
  MAX_ORDER_LINES,
  ringWorksTerminal,
  priceOrder,
  orderSummary,
} = require("../lib/blackMarket");
const { roomAffordances } = require("../lib/placeAffordances");
const { wornRingAccess } = require("../lib/rings");

const heroin = { id: "t-heroin", slug: "heroin", name: "Heroin", depotPrice: 2, stackable: true };
const machete = { id: "t-machete", slug: "machete", name: "Machete", depotPrice: 11, stackable: true };
const monkey = { id: "t-monkey", slug: "monkey", name: "Monkey", depotPrice: 40, stackable: false };
const SHELF = [heroin, machete, monkey];

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

test("the terminal answers to a worn ring carrying the token, and nothing else", () => {
  const exactor = ["den-key", "exactors-key", "collar-key", BLACK_MARKET_TOKEN];
  const pusher = ["den-key", "collar-key", BLACK_MARKET_TOKEN];
  assert.equal(ringWorksTerminal(wornRingAccess([ring(exactor)])), true);
  assert.equal(ringWorksTerminal(wornRingAccess([ring(pusher)])), true);
  // A ring in a pocket, or one the Meister never registered, opens nothing.
  assert.equal(ringWorksTerminal(wornRingAccess([ring(pusher, { equipped: false })])), false);
  assert.equal(ringWorksTerminal(wornRingAccess([ring(pusher, { registered: false })])), false);
  // Somebody else's ring, and a held tag of the token's slug, both fail.
  assert.equal(ringWorksTerminal(wornRingAccess([ring(["den-key", "collar-key"])])), false);
  assert.equal(ringWorksTerminal(wornRingAccess([{ equipped: false, tag: { slug: BLACK_MARKET_TOKEN } }])), false);
});

test("an order is priced off the shelf, with duplicate lines merged before the clamp", () => {
  const priced = priceOrder(SHELF, [
    { tagId: heroin.id, quantity: 2 },
    { tagId: machete.id, quantity: 1 },
    { tagId: heroin.id, quantity: "3" },
  ]);
  assert.equal(priced.ok, true);
  assert.equal(priced.total, 5 * 2 + 11);
  assert.deepEqual(
    priced.lines.map((l) => [l.slug, l.quantity, l.unitPrice]),
    [
      ["heroin", 5, 2],
      ["machete", 1, 11],
    ],
  );
  assert.equal(orderSummary(priced.lines), "Heroin x 5, Machete");

  // Two lines of 99 are 198, past the Depot's own cap.
  assert.equal(priceOrder(SHELF, [{ tagId: heroin.id, quantity: 99 }, { tagId: heroin.id, quantity: 99 }]).ok, false);
});

test("an order is refused for anything the terminal does not list, or no order at all", () => {
  assert.equal(priceOrder(SHELF, []).ok, false);
  assert.equal(priceOrder(SHELF, null).ok, false);
  assert.equal(priceOrder(SHELF, [{ tagId: "t-pistol", quantity: 1 }]).ok, false);
  assert.equal(priceOrder(SHELF, [{ tagId: heroin.id, quantity: 0 }]).ok, false);
  assert.equal(priceOrder(SHELF, [{ tagId: heroin.id, quantity: -2 }]).ok, false);
  assert.equal(priceOrder(SHELF, [{ tagId: heroin.id, quantity: 1.5 }]).ok, false);
  const tooMany = Array.from({ length: MAX_ORDER_LINES + 1 }, () => ({ tagId: heroin.id, quantity: 1 }));
  assert.equal(priceOrder(SHELF, tooMany).ok, false);
});

test("a non-stackable ware is one at a time, and never a second one", () => {
  assert.equal(priceOrder(SHELF, [{ tagId: monkey.id, quantity: 2 }]).ok, false);
  assert.equal(priceOrder(SHELF, [{ tagId: monkey.id, quantity: 1 }]).ok, true);
  const held = [{ tagId: monkey.id, quantity: 1, tag: monkey }];
  const again = priceOrder(SHELF, [{ tagId: monkey.id, quantity: 1 }], held);
  assert.equal(again.ok, false);
  assert.match(again.error, /already have Monkey/);
});

test("the terminal is a button on the Exactor's Office and nowhere else", () => {
  const ids = (room) => roomAffordances(room).map((a) => a.id);
  assert.ok(ids({ id: "r1", slug: BLACK_MARKET_ROOM_SLUG }).includes("blackMarket"));
  assert.ok(!ids({ id: "r2", slug: "undertown-8-3" }).includes("blackMarket"));
});

// The YAML half: the design doc's gate is "the Exactor and pusher's ring", and
// the Pusher has to be able to reach the office the terminal stands in.
const DOCS = path.join(__dirname, "../../docs");
const load = (name) => yaml.load(fs.readFileSync(path.join(DOCS, name), "utf8"));

test("the Exactor's and the Pusher's rings carry the token, and only the Exactor's fires the collar remote", () => {
  const roles = load("roles.yaml");
  const find = (slug) => {
    for (const group of Object.values(roles.groups ?? {})) {
      if (group && typeof group === "object" && group[slug]) return group[slug];
    }
    return null;
  };
  const exactor = find("exactor");
  const pusher = find("pusher");
  assert.ok(exactor?.ring?.opens?.includes(BLACK_MARKET_TOKEN));
  assert.ok(pusher?.ring?.opens?.includes(BLACK_MARKET_TOKEN));
  assert.ok(!pusher.ring.opens.includes("exactors-key"));
});

test("the office door opens to the token, the Silver Chip is gone, and no Black Market ware ships sealed", () => {
  const zones = fs.readFileSync(path.join(DOCS, "zones.yaml"), "utf8");
  const office = zones.split(/\r?\n/).findIndex((l) => l.trim() === `${BLACK_MARKET_ROOM_SLUG}:`);
  assert.ok(office >= 0);
  const block = zones.split(/\r?\n/).slice(office, office + 8).join("\n");
  assert.match(block, /access: \[exactors-key, black-market-key\]/);
  assert.doesNotMatch(zones, /silver-chip/);

  const tags = load("tags.yaml").tags;
  assert.equal(tags["silver-chip"], undefined);
  assert.ok(tags[BLACK_MARKET_TOKEN]);
  const sealed = Object.entries(tags).filter(([, t]) => t?.manifest === "black-market" && t.sealedShipping);
  assert.deepEqual(sealed.map(([slug]) => slug), []);
});
