const test = require("node:test");
const assert = require("node:assert");
const { ephemeralLine } = require("../src/lib/ephemeralLine");

test("wraps a plain notice in the chevron and italics", () => {
  assert.equal(ephemeralLine("You're not here."), "» *You're not here.*");
});

test("lifts a trailing dagger outside the italics", () => {
  assert.equal(ephemeralLine("Moves are locked. ‡"), "» *Moves are locked.* ‡");
});

test("is idempotent on a line that already carries the chevron", () => {
  assert.equal(ephemeralLine("» *GMs only.*"), "» *GMs only.*");
  assert.equal(ephemeralLine(ephemeralLine("Gone.")), "» *Gone.*");
});

test("leaves subtext alone", () => {
  const line = "-# 3 ⬢ | **Tags**: rope";
  assert.equal(ephemeralLine(line), line);
});

test("leaves a multi-line readout alone", () => {
  const readout = "» *The Depot.*\nA long counter.";
  assert.equal(ephemeralLine(readout), readout);
  assert.equal(ephemeralLine("Where?\n-# Speak privately."), "Where?\n-# Speak privately.");
});

test("leaves the prompt above a picker alone", () => {
  assert.equal(ephemeralLine("Where?", { components: [{}] }), "Where?");
});

test("still formats when components is empty — that is buttons coming off", () => {
  assert.equal(ephemeralLine("Gone.", { components: [] }), "» *Gone.*");
});

test("passes empty and non-string content straight through", () => {
  assert.equal(ephemeralLine(""), "");
  assert.equal(ephemeralLine("   "), "   ");
  assert.equal(ephemeralLine(undefined), undefined);
  assert.equal(ephemeralLine(null), null);
});

test("leaves a line that already opens with markdown alone", () => {
  // whosHereLines returns this shape, one line when nobody is concealed.
  const here = "**Here:** Ada, Quartermaster | Bob";
  assert.equal(ephemeralLine(here), here);
  // Italics inside italics renders as bold, which says the opposite of quiet.
  assert.equal(ephemeralLine("*Blank paper.*"), "*Blank paper.*");
});
