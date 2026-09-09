// node --test over the one pure rule a gate crossing is made of:
// db/lib/locationMove.js#announceLevelFor, which decides what the destination
// zone's #summary is told about somebody walking in.
//
// The rule worth protecting is that Stealth moves the announcement down ONE
// step rather than switching it off. A test that only checked "stealth hides
// you" would pass on an implementation that also silenced the manned gate,
// which is exactly the thing this is not allowed to do.
//
// Run with: npm test --workspace=db
const test = require("node:test");
const assert = require("node:assert/strict");
const { announceLevelFor } = require("../lib/locationMove");

const stealthy = [{ tag: { slug: "stealth" } }];
const ordinary = [{ tag: { slug: "clumsy" } }];

test("an ordinary traveller is announced exactly as the gate says", () => {
  assert.equal(announceLevelFor("TRUE_NAME", ordinary), "TRUE_NAME");
  assert.equal(announceLevelFor("CONCEALED", ordinary), "CONCEALED");
  assert.equal(announceLevelFor("NONE", ordinary), "NONE");
});

test("Stealth empties an unmanned gate: nobody was watching", () => {
  assert.equal(announceLevelFor("CONCEALED", stealthy), "NONE");
});

test("Stealth does NOT beat a manned gate, it only takes the name off", () => {
  // The Cerberus on the Fortress gatehouse is reading papers. A stealthy
  // traveller still gets a line; it just describes them instead of naming
  // them — where an ordinary traveller through a Town gate already lands.
  assert.equal(announceLevelFor("TRUE_NAME", stealthy), "CONCEALED");
});

test("a gate that announces nothing cannot announce less", () => {
  assert.equal(announceLevelFor("NONE", stealthy), "NONE");
});

test("the tag list is read defensively", () => {
  // Callers pass rows of several shapes, and a missing list must not throw
  // inside a move — being announced is the least of that move's problems.
  assert.equal(announceLevelFor("CONCEALED"), "CONCEALED");
  assert.equal(announceLevelFor("CONCEALED", []), "CONCEALED");
  assert.equal(announceLevelFor("CONCEALED", [{ slug: "stealth" }]), "NONE");
  assert.equal(announceLevelFor("CONCEALED", [null]), "CONCEALED");
});
