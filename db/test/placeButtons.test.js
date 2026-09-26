// The Discord buttons this change put on places (db/lib/placeAffordances.js):
// Actions on every Location anchor, Send money and Merchant credit on the
// Depot's Railway, Sell tax in the Meister's Study. They are Discord's own —
// the web has the same verbs elsewhere — so the web's place panel must not
// draw them. And a starter post splits into rows of five, or Discord rejects
// the whole message.
const test = require("node:test");
const assert = require("node:assert/strict");
const { locationAffordances, roomAffordances } = require("../lib/placeAffordances");
const { roomStarterRows, ROW_BUTTON_LIMIT } = require("../lib/roomStarterRow");
const { ACTIONS_OPEN_ID } = require("../lib/turnsConsoleRow");
const { ACTION_START_PREFIX, actionFor } = require("../lib/actionCatalog");

// The Railway, as the sync reads it: the Depot's counter room, with a phone on the wall.
const RAILWAY = { id: "r-railway", slug: "undertown-5-1", phone: "Depot", questId: null, vendingMachine: false };
const STUDY = { id: "r-study", slug: "fortress-5-2", phone: "the Meister's Phone", questId: null, vendingMachine: false };

test("every anchor has Actions, straight after Travel — on Discord only", () => {
  const discord = locationAffordances({ id: "loc-1", slug: "town-2", attributes: {} });
  assert.deepEqual(discord.slice(0, 2).map((a) => a.id), ["travel", "actions"]);
  assert.equal(discord[1].customId, ACTIONS_OPEN_ID);
  const web = locationAffordances({ id: "loc-1", slug: "town-2", attributes: {} }, { web: true });
  assert.ok(!web.some((a) => a.id === "actions"));
});

test("the Railway carries Send money and Merchant credit, and splits into rows of five", () => {
  const ids = roomAffordances(RAILWAY).map((a) => a.id);
  assert.ok(ids.includes("sendMoney") && ids.includes("merchantCredit"), ids.join(", "));
  const rows = roomStarterRows(RAILWAY);
  assert.ok(rows.length >= 2, "seven buttons need two rows");
  for (const row of rows) assert.ok(row.components.length <= ROW_BUTTON_LIMIT);
  const customIds = rows.flatMap((r) => r.components.map((c) => c.custom_id));
  assert.ok(customIds.includes(`${ACTION_START_PREFIX}sendmoney`));
  assert.ok(customIds.includes(`${ACTION_START_PREFIX}credit`));
  // Each starts a verb the catalog knows.
  for (const id of customIds.filter((c) => c.startsWith(ACTION_START_PREFIX))) {
    assert.ok(actionFor(id.slice(ACTION_START_PREFIX.length)), id);
  }
});

test("the Meister's Study carries Sell tax; no other room does", () => {
  assert.ok(roomAffordances(STUDY).some((a) => a.id === "sellTax"));
  assert.ok(!roomAffordances(RAILWAY).some((a) => a.id === "sellTax"));
});

test("the web's room panel never draws Discord's own buttons", () => {
  const web = roomAffordances(RAILWAY, null, { web: true }).map((a) => a.id);
  for (const id of ["sendMoney", "merchantCredit", "sellTax"]) assert.ok(!web.includes(id), id);
  assert.ok(web.includes("atm"), "the ATM is a web fixture too");
});

test("a room with five buttons or fewer is still one row, so its post hash does not move", () => {
  const plain = { id: "r-plain", slug: "town-2-1", phone: null, questId: null, vendingMachine: false };
  assert.equal(roomStarterRows(plain).length, 1);
});
