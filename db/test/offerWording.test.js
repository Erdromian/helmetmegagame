// Every offer kind refuses and expires in its own words. The decline table in
// db/lib/lessons.js and the expiry table in db/lib/offerExpiryPass.js both used
// to default to the lesson pair, so each kind added after LESSON -- KISS,
// ESCORT, then COLLAR -- spent a while telling somebody who had refused a kiss,
// a ride or a collar that they had "rejected the lesson". The enum is read off
// schema.prisma so a new kind fails here before it ships that way again.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { declineWording } = require("../lib/lessons");
const { expiryNotice } = require("../lib/offerExpiryPass");

const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
const enumBody = schema.match(/enum OfferKind \{([^}]*)\}/)?.[1] ?? "";
const KINDS = enumBody
  .split("\n")
  .map((l) => l.replace(/\/\/.*$/, "").trim())
  .filter((l) => /^[A-Z_]+$/.test(l));

// Refusing the dark god costs something, so its sentence lives with that cost
// in db/lib/conversionRite.js#refuseConversion, and it never expires.
const LAPSING = KINDS.filter((k) => k !== "CONVERSION");

test("the schema's OfferKind enum was found", () => {
  assert.ok(KINDS.includes("LESSON") && KINDS.includes("COLLAR"), `parsed: ${KINDS.join(", ")}`);
});

test("every lapsing kind declines in its own words", () => {
  for (const kind of LAPSING) {
    const w = declineWording(kind, { responderName: "Ada", refusedBy: "A hooded figure" });
    assert.ok(w, `${kind} has no decline wording -- it would read as a plain no`);
    assert.ok(w.content && w.line, `${kind} decline wording is incomplete`);
    if (kind !== "LESSON") {
      assert.doesNotMatch(w.content, /lesson/i, `${kind}'s asker is told about a lesson`);
      assert.doesNotMatch(w.line, /lesson/i, `${kind}'s refuser is told about a lesson`);
    }
  }
  assert.equal(declineWording("CONVERSION", { responderName: "Ada" }), null);
  assert.equal(declineWording("NOT_A_KIND", { responderName: "Ada" }), null);
});

test("every decline opens with the face the asker saw, capitalised", () => {
  for (const kind of LAPSING) {
    const w = declineWording(kind, { responderName: "a young man" });
    assert.match(w.content, /^A young man /, `${kind} opens its sentence in lower case`);
  }
});

test("a refused search names the face the searcher saw, not the row", () => {
  const w = declineWording("SEARCH", { responderName: "Ada", refusedBy: "A hooded figure" });
  assert.match(w.content, /A hooded figure/);
  assert.doesNotMatch(w.content, /Ada/);
});

test("every lapsing kind expires in its own words", () => {
  for (const kind of LAPSING) {
    const offer = { kind, initiatorId: "a", learnerId: "a", tag: { name: "Climbing" } };
    const notice = expiryNotice(offer, { other: "Ada", presented: "A hooded figure" });
    assert.ok(notice, `${kind} has no expiry notice -- it would read as a bare "never answered"`);
    if (kind !== "LESSON") assert.doesNotMatch(notice, /lesson|teach|learn|skill/i, `${kind} expires as a lesson`);
  }
  assert.equal(expiryNotice({ kind: "CONVERSION" }, { other: "Ada" }), null);
});

test("an expired lesson still says which way round it was", () => {
  const tag = { name: "Climbing" };
  assert.match(expiryNotice({ kind: "LESSON", initiatorId: "a", learnerId: "a", tag }, { other: "Ada" }), /to learn Climbing/);
  assert.match(expiryNotice({ kind: "LESSON", initiatorId: "a", learnerId: "b", tag }, { other: "Ada" }), /to teach Climbing/);
});
