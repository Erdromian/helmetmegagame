// Where the adjudication desk says a Move happened (web/lib/moveWhere.js).
//
// A Gambit is filed from one Location, and a free zone move costs no Action, so by the time a GM
// rules the character may be standing somewhere else. The desk used to label every Move with the
// character's LIVE zone and Location, which put a Gambit about "picking the lock at the Pub" under
// "Undertown · The Hole". It reads what was stamped on the Move now.

import assert from "node:assert/strict";
import test from "node:test";

import { moveWhere, moveLocationId } from "../moveWhere.js";

const town = { id: "z-town", name: "Town" };
const under = { id: "z-under", name: "Undertown" };
const pub = { id: "l-pub", name: "The Pub" };
const hole = { id: "l-hole", name: "The Hole" };

test("a stamped Move reads where it was filed, not where the character stands now", () => {
  const where = moveWhere({ zone: town, location: pub, character: { zone: under, location: hole } });
  assert.equal(where.label, "Town · The Pub");
  assert.equal(where.zoneName, "Town");
  assert.equal(where.zoneId, "z-town");
  assert.equal(where.locationId, "l-pub");
});

test("an unstamped Move falls back to the live pair", () => {
  const where = moveWhere({ zone: null, location: null, character: { zone: under, location: hole } });
  assert.equal(where.label, "Undertown · The Hole");
  assert.equal(where.zoneName, "Undertown");
  assert.equal(where.zoneId, "z-under");
  assert.equal(where.locationId, "l-hole");
});

test("the pair is never mixed: a stamped zone with no stamped Location falls back whole", () => {
  // Travel stubs and rows from before the Location stamp carry a zone and no Location.
  const where = moveWhere({ zone: town, location: null, character: { zone: under, location: hole } });
  assert.equal(where.label, "Undertown · The Hole");
  assert.equal(where.zoneId, "z-under");
});

test("a stamped Location whose zone is gone still prints, with a question mark for the zone", () => {
  const where = moveWhere({ zone: null, location: pub, character: { zone: under, location: hole } });
  assert.equal(where.label, "? · The Pub");
  assert.equal(where.locationId, "l-pub");
});

test("a character with no Location reads as their zone, and with nothing as Unassigned", () => {
  assert.equal(moveWhere({ zone: null, location: null, character: { zone: under, location: null } }).label, "Undertown");
  const none = moveWhere({ zone: null, location: null, character: { zone: null, location: null } });
  assert.equal(none.label, "Unassigned");
  assert.equal(none.zoneName, "");
  assert.equal(none.zoneId, null);
  assert.equal(none.locationId, null);
});

test("the structures lookup follows the same place the label prints", () => {
  assert.equal(moveLocationId({ zone: town, location: pub, character: { zone: under, location: hole } }), "l-pub");
  assert.equal(moveLocationId({ zone: null, location: null, character: { zone: under, location: hole } }), "l-hole");
  assert.equal(moveLocationId({ zone: null, location: null, character: { zone: null, location: null } }), null);
});
