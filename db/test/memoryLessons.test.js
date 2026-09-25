// What a line said in a room teaches the people who heard it
// (db/lib/memoryLessons.js, docs/systemdocs/MEMORIES.md §2b). Pure, no Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const { lessonsFrom, sentencesOf, speechText } = require("../lib/memoryLessons");

const person = (id, firstName, lastName, roleName, { roleTitle = roleName, examineVisible = true, slug } = {}) => ({
  id,
  firstName,
  lastName,
  name: [firstName, lastName].filter(Boolean).join(" "),
  roleTitle,
  role: roleName ? { slug: slug ?? roleName.toLowerCase().replace(/\s+/g, "-"), name: roleName, examineVisible } : null,
});

const MARROW = person("m", "Marrow", "Kell", "Sheriff");
const ADA = person("a", "Ada", "Vask", "Baroness");
const OTTO = person("o", "Otto", "Vask", "Heir");
const HAND = person("h", "Jorren", "Pike", "Hand");
const TRIBUNE = person("t", "Silas", "Wren", "Tribune", { examineVisible: false });
const WILL = person("w", "Will", "Asher", "Soiler");

// The speaker knows Marrow's name and seat — a Friends entry of their own.
const KNOWS_MARROW = new Map([["m", { name: "Marrow Kell", roleSlug: "sheriff" }]]);

const lessons = (content, speaker, candidates, speakerKnows = new Map()) =>
  lessonsFrom({ content, speaker, candidates, speakerKnows });
const only = (list) => {
  assert.equal(list.length, 1);
  return list[0];
};

test("introducing yourself teaches your name", () => {
  const l = only(lessons("Hello. I'm Marrow.", MARROW, [MARROW, ADA]));
  assert.equal(l.subjectId, "m");
  assert.equal(l.name, true);
  assert.equal(l.role, false);
  assert.equal(l.entry.name, "Marrow Kell");
});

test("saying your own role teaches it, with or without your name", () => {
  const l = only(lessons("I am the Sheriff here.", MARROW, [MARROW, ADA]));
  assert.equal(l.role, true);
  assert.equal(l.name, false);
  assert.equal(l.entry.roleText, "Sheriff");
  assert.equal(l.entry.roleSlug, "sheriff");
});

test("name and role in one sentence make a whole entry", () => {
  const l = only(lessons("Marrow Kell, Sheriff of this town.", MARROW, [MARROW]));
  assert.equal(l.name, true);
  assert.equal(l.role, true);
});

test("somebody who knows teaches the name and the role", () => {
  const l = only(lessons("This is the Sheriff, Marrow.", ADA, [MARROW, ADA], KNOWS_MARROW));
  assert.equal(l.subjectId, "m");
  assert.equal(l.name, true);
  assert.equal(l.role, true);
});

test("a guess teaches nothing — even a right one", () => {
  assert.deepEqual(lessons("Is Marrow the Sheriff?", ADA, [MARROW, ADA]), []);
});

test("knowing the name but not the seat teaches only the name", () => {
  const knows = new Map([["m", { name: "Marrow Kell", roleSlug: null }]]);
  const l = only(lessons("Marrow is the Sheriff.", ADA, [MARROW, ADA], knows));
  assert.equal(l.name, true);
  assert.equal(l.role, false);
});

test("a name the speaker's entry does not hold is not theirs to teach", () => {
  // Ada wrote Marrow down under a nickname; "Marrow" is not in it.
  const knows = new Map([["m", { name: "The tall one", roleSlug: "sheriff" }]]);
  const l = lessons("Marrow, over here.", ADA, [MARROW, ADA], knows);
  assert.deepEqual(l, []);
});

test("role and name must share the sentence", () => {
  const l = only(lessons("That's Marrow. The Sheriff is out today.", ADA, [MARROW, ADA], KNOWS_MARROW));
  assert.equal(l.name, true);
  assert.equal(l.role, false);
});

test("a role word that opens a sentence only counts right beside the name", () => {
  // "Hand me the knife" is not a title.
  const knows = new Map([["h", { name: "Jorren Pike", roleSlug: "hand" }]]);
  const l = only(lessons("Hand me the knife, Jorren.", ADA, [HAND, ADA], knows));
  assert.equal(l.name, true);
  assert.equal(l.role, false);
  const titled = only(lessons("Hand Jorren, a word.", ADA, [HAND, ADA], knows));
  assert.equal(titled.role, true);
});

test("a role word must be capitalised", () => {
  const knows = new Map([["h", { name: "Jorren Pike", roleSlug: "hand" }]]);
  const l = only(lessons("Jorren lent me a hand.", ADA, [HAND, ADA], knows));
  assert.equal(l.role, false);
});

test("names are matched case-sensitively and capitalised", () => {
  assert.deepEqual(lessons("i'm marrow", MARROW, [MARROW]), []);
});

test("a shared surname names nobody in particular", () => {
  // The Baron's house: "Vask" said in a room with two Vasks.
  assert.deepEqual(lessons("I'm a Vask.", ADA, [ADA, OTTO]), []);
  // But with one Vask present, it is hers.
  const l = only(lessons("I'm a Vask.", ADA, [ADA, MARROW]));
  assert.equal(l.name, true);
});

test("an honorific is never a name form", () => {
  const sir = { ...MARROW, name: "Sir Marrow Kell" };
  assert.deepEqual(lessons("Sir, a word.", ADA, [sir, ADA], KNOWS_MARROW), []);
});

test("a name that is also a common opening word only counts mid-sentence", () => {
  assert.deepEqual(lessons("Will you come?", WILL, [WILL]), []);
  const l = only(lessons("They call me Will.", WILL, [WILL]));
  assert.equal(l.name, true);
});

test("a seat that lives on not being known never teaches its role", () => {
  const l = only(lessons("I am Silas, a Tribune.", TRIBUNE, [TRIBUNE]));
  assert.equal(l.name, true);
  assert.equal(l.role, false);
  assert.equal(l.entry.roleText, null);
});

test("a mention chip reads as the name it froze", () => {
  const l = only(lessons("Ask {char:m|Marrow Kell} about it.", ADA, [MARROW, ADA], KNOWS_MARROW));
  assert.equal(l.name, true);
});

test("a chip frozen under a hood's alias names nobody", () => {
  assert.deepEqual(lessons("Ask {char:m|Young Man} about it.", ADA, [MARROW, ADA], KNOWS_MARROW), []);
});

test("sentences break on stops and on line breaks", () => {
  assert.deepEqual(sentencesOf("One. Two!\nThree? Four"), ["One.", "Two!", "Three?", "Four"]);
  assert.equal(speechText("see https://x.y/Marrow"), "see  ");
});
