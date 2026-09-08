// node --test over the two pure rules escorting is made of: who may be taken
// along (db/lib/escort.js#escortAuthority) and what taking them costs
// (db/lib/locationTravel.js#freeZoneMoves). Both are where the rules actually
// live — everything else in the feature is plumbing around these answers.
//
// Run with: npm test --workspace=db
const test = require("node:test");
const assert = require("node:assert/strict");
const { escortAuthority, escortReason, ESCORT_SELECT } = require("../lib/escort");
const { freeZoneMoves, fitsMount, CHARACTER_SELECT } = require("../lib/locationTravel");
const { equippedSlugs } = require("../lib/mounts");

const HERE = "loc-1";
const leader = (over = {}) => ({
  id: "L",
  locationId: HERE,
  isLeader: true,
  factionId: "f1",
  faction: { slug: "reeves" },
  ...over,
});
const person = (over = {}) => ({
  id: "P",
  locationId: HERE,
  status: "ALIVE",
  tags: [],
  ...over,
});
const tag = (slug, name) => ({ tag: { slug, name } });

// --- who follows ----------------------------------------------------------

test("a body and the helpless come without asking", () => {
  assert.equal(escortAuthority(leader(), person({ status: "DEAD" })), "FORCED");
  assert.equal(escortAuthority(leader(), person({ tags: [tag("bound", "Bound")] })), "FORCED");
  assert.equal(escortAuthority(leader(), person({ tags: [tag("catatonic-afk", "Catatonic")] })), "FORCED");
});

test("a leader commands their own faction, and nobody else's", () => {
  assert.equal(escortAuthority(leader(), person({ factionId: "f1" })), "FORCED");
  assert.equal(escortAuthority(leader(), person({ factionId: "f2" })), "ASK");
  assert.equal(escortAuthority(leader({ isLeader: false }), person({ factionId: "f1" })), "ASK");
});

test("a Leader of Unaffiliated commands nobody — it is not a faction", () => {
  const unaffiliated = leader({ faction: { slug: "unaffiliated" } });
  assert.equal(escortAuthority(unaffiliated, person({ factionId: "f1" })), "ASK");
});

test("faction authority needs the faction RELATION, not just its id", () => {
  // The trap this guards: locationTravel's CHARACTER_SELECT loaded factionId
  // alone, so isUnaffiliated(undefined) came back true and every faction
  // leader was quietly refused. ESCORT_SELECT loads the relation for this.
  const noRelation = leader({ faction: undefined });
  assert.equal(escortAuthority(noRelation, person({ factionId: "f1" })), "ASK");
});

test("anyone else living gets asked", () => {
  assert.equal(escortAuthority(leader(), person()), "ASK");
});

test("consent counts, and only until its window lapses", () => {
  const willing = person({ escortConsentToId: "L", escortConsentUntilTurn: 12 });
  assert.equal(escortAuthority(leader(), willing, 11), "CONSENTED");
  assert.equal(escortAuthority(leader(), willing, 12), "CONSENTED");
  assert.equal(escortAuthority(leader(), willing, 13), "ASK");
  // A yes said to somebody else is not a yes said to you.
  assert.equal(escortAuthority(leader(), person({ escortConsentToId: "X", escortConsentUntilTurn: 99 }), 1), "ASK");
  // No open turn means no window can be read, which has to fall back to
  // asking rather than to attaching.
  assert.equal(escortAuthority(leader(), willing, null), "ASK");
});

test("nobody is taken from across the map, from the ground, or from somebody else", () => {
  assert.equal(escortAuthority(leader(), person({ locationId: "loc-2" })), null);
  assert.equal(escortAuthority(leader(), person({ status: "DEAD", buriedAt: new Date() })), null);
  assert.equal(escortAuthority(leader(), person({ escortedById: "Z" })), null);
  // Already yours is still yours.
  assert.equal(escortAuthority(leader(), person({ escortedById: "L" })), "ASK");
  assert.equal(escortAuthority(leader(), person({ id: "L" })), null);
  assert.equal(escortAuthority(leader({ locationId: null }), person()), null);
});

test("a hood is off the list, the way it is off every other picker", () => {
  assert.equal(escortAuthority(leader(), person({ concealed: true })), null);
  // But a corpse cannot hold a hood up, so the dead still show.
  assert.equal(escortAuthority(leader(), person({ status: "DEAD", concealed: true })), "FORCED");
});

test("the reason says why they follow, not why they cannot", () => {
  assert.equal(escortReason(person({ status: "DEAD" }), "FORCED"), "a body");
  assert.equal(escortReason(person({ tags: [tag("bound", "Bound")] }), "FORCED"), "bound");
  assert.equal(escortReason(person({ factionId: "f1" }), "FORCED"), "your faction");
  assert.equal(escortReason(person(), "CONSENTED"), "willing");
});

// --- what they cost -------------------------------------------------------

const held = (...slugs) => ({ tags: slugs.map((slug) => ({ equipped: true, tag: { slug, name: slug } })) });
const CONFIG = { freeZoneMovesPerTurn: 1 };
const allowance = (character, partySize) => freeZoneMoves(character, CONFIG, null, partySize);

test("on foot, any number of people is free", () => {
  // There is no bonus to lose without a mount, so the seat rule never bites.
  assert.equal(allowance(held(), 0), 1);
  assert.equal(allowance(held(), 1), 1);
  assert.equal(allowance(held(), 12), 1);
});

test("a mount buys its extra crossing only while the party fits its seats", () => {
  // fastTravelCapacity counts the RIDER, so a horse's 2 seats are one saddle
  // for you and one for somebody else.
  assert.equal(allowance(held("horse"), 0), 2);
  assert.equal(allowance(held("horse"), 1), 2);
  assert.equal(allowance(held("horse"), 2), 1);
  assert.equal(allowance(held("motorcycle"), 1), 2);
  assert.equal(allowance(held("motorcycle"), 2), 1);
});

test("a cart upgrades the horse's pair to six, and cannot reach the motorcycle", () => {
  assert.equal(allowance(held("horse", "cart"), 5), 2);
  assert.equal(allowance(held("horse", "cart"), 6), 1);
  // A hand-cart towed behind a motorcycle is not a thing (db/lib/mounts.js).
  assert.equal(allowance(held("motorcycle", "cart"), 2), 1);
});

test("an overloaded mount is never WORSE than legs, only no better", () => {
  assert.equal(allowance(held("horse"), 9), allowance(held(), 9));
});

test("a stowed mount seats nobody, because it is not out", () => {
  const stowed = { tags: [{ equipped: false, tag: { slug: "horse", name: "horse" } }] };
  assert.equal(allowance(stowed, 0), 1);
});

test("Overburdened still takes the lot, party or no party", () => {
  assert.equal(allowance(held("horse", "overburdened"), 0), 0);
});

test("fitsMount says nothing is overfull when there are no seats", () => {
  assert.equal(fitsMount(equippedSlugs([]), 40), true);
  assert.equal(fitsMount(equippedSlugs(held("horse").tags), 1), true);
  assert.equal(fitsMount(equippedSlugs(held("horse").tags), 2), false);
});

// --- the select ----------------------------------------------------------

test("ESCORT_SELECT stays a superset of what performLocationMove needs", () => {
  // Every caller now loads a mover with ESCORT_SELECT and hands that row to
  // performLocationMove. Drop a field and the failure is silent and ugly:
  // without travelToLocationId a character on the road walks away from their
  // own journey, and without zoneMoves* the free-crossing claim reads zero
  // spent every time and never runs out.
  const missing = Object.keys(CHARACTER_SELECT).filter((key) => !(key in ESCORT_SELECT));
  assert.deepEqual(missing, []);
});
