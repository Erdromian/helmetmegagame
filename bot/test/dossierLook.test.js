const test = require("node:test");
const assert = require("node:assert");
const { dossierLookFields, gmWhosHereLines } = require("../src/lib/dossierLook");

const HOODED_NOW = { kind: "hood", shownAs: "a young man", item: "Plague Mask" };

test("a bare face, then and now, adds nothing to the dossier", () => {
  assert.deepEqual(dossierLookFields({ alias: null }, null), []);
});

test("a hooded line, read when the hood is down, says both", () => {
  assert.deepEqual(dossierLookFields({ alias: "Young Man", concealed: true }, null), [
    { name: "On this line", value: "Hooded: a young man", inline: true },
    { name: "Now", value: "Own face", inline: true },
  ]);
});

test("the same look then and now reads the fuller live text once", () => {
  assert.deepEqual(dossierLookFields({ alias: "Young Man", concealed: true }, HOODED_NOW), [
    { name: "On this line", value: "Hooded: a young man, under a Plague Mask", inline: true },
  ]);
});

test("a disguise is told apart from a public name", () => {
  const disguise = dossierLookFields({ alias: "Sir Aldric Vask", disguised: true }, null);
  assert.equal(disguise[0].value, "Disguised as Sir Aldric Vask");
  const beast = dossierLookFields({ alias: "Beast" }, { kind: "forced", shownAs: "Beast" });
  assert.deepEqual(beast, [{ name: "On this line", value: "Goes by Beast", inline: true }]);
});

test("a GM's Who's here names everybody, the look beside the hidden ones", () => {
  assert.deepEqual(gmWhosHereLines([]), []);
  assert.deepEqual(gmWhosHereLines([{ name: "Ada Vane" }, { name: "Bo Reed", look: HOODED_NOW }]), [
    "**Here** (real names):",
    "Ada Vane",
    "Bo Reed — hooded: a young man, under a Plague Mask",
  ]);
});
