// The pure halves of Intercept (docs/systemdocs/INTERCEPT.md): who a watch
// catches, and whether somebody is still being held. Both are the kind of
// function this repo tests — no prisma, no clock but the one passed in.
const test = require("node:test");
const assert = require("node:assert");

const {
  matchesArrival,
  heldReasonFor,
  anchorHolds,
  originHolds,
  cleanMessage,
  cleanNames,
  seenAs,
  saidWord,
} = require("../lib/intercept");

const GREEBLUS = { name: "Lord Greeblus Vane", firstName: "Greeblus", lastName: "Vane" };
const OPEN = { name: "Lord Greeblus Vane", concealed: false, forced: false };
const HOODED = { name: "Young Man", concealed: true, forced: false };
const BEAST = { name: "Beast", concealed: false, forced: true };

const watch = (over) => ({ targetNames: [], anyConcealed: false, anyPerson: false, ...over });

test("a typed name catches a bare face", () => {
  assert.equal(matchesArrival(watch({ targetNames: ["Lord Greeblus Vane"] }), GREEBLUS, OPEN), "name");
  // The bare First Last counts too — matchesTypedName's rule, so an honorific
  // the watcher never learned is not a wall.
  assert.equal(matchesArrival(watch({ targetNames: ["greeblus vane"] }), GREEBLUS, OPEN), "name");
});

test("A HOOD BEATS A NAME", () => {
  // The load-bearing one. If this ever passes as "name", Intercept has become
  // a hood-defeating radar and the whole concealment system leaks through it.
  assert.equal(matchesArrival(watch({ targetNames: ["Lord Greeblus Vane"] }), GREEBLUS, HOODED), null);
  assert.equal(matchesArrival(watch({ targetNames: ["Beast"] }), GREEBLUS, BEAST), null);
});

test("any concealed person catches a hood and nothing else", () => {
  assert.equal(matchesArrival(watch({ anyConcealed: true }), GREEBLUS, HOODED), "anyConcealed");
  assert.equal(matchesArrival(watch({ anyConcealed: true }), GREEBLUS, OPEN), null);
  // A forced name is not a hood: the Beast is not hiding, it is a Beast.
  assert.equal(matchesArrival(watch({ anyConcealed: true }), GREEBLUS, BEAST), null);
});

test("any person catches everybody", () => {
  for (const face of [OPEN, HOODED, BEAST]) {
    assert.equal(matchesArrival(watch({ anyPerson: true }), GREEBLUS, face), "anyPerson");
  }
});

test("a watch naming nobody catches nobody", () => {
  assert.equal(matchesArrival(watch({}), GREEBLUS, OPEN), null);
  assert.equal(matchesArrival(null, GREEBLUS, OPEN), null);
});

test("a watch works where it was set and nowhere else", () => {
  // The anchor, and it beats everything else the watch says: a dragnet set at
  // the gatehouse catches nobody in the caves. Moving deletes the row, so this
  // is the belt for one left behind by a relocation that skipped the cancel.
  const gate = watch({ anyPerson: true, locationId: "loc-gatehouse" });
  assert.equal(anchorHolds(gate, "loc-gatehouse"), true);
  assert.equal(anchorHolds(gate, "loc-caves"), false);
  // Nowhere is not somewhere, on either side.
  assert.equal(anchorHolds(watch({ anyPerson: true }), "loc-gatehouse"), false);
  assert.equal(anchorHolds(gate, null), false);
  assert.equal(anchorHolds(null, "loc-gatehouse"), false);
});

test("a watch may ignore anybody who was already in the zone", () => {
  const TOWN = "zone-town";
  const local = { id: "c1", fromZoneId: TOWN };
  const stranger = { id: "c2", fromZoneId: "zone-moor" };

  // Off, which is every watch set before the flag existed: everybody who walks in.
  const open = watch({ anyPerson: true });
  assert.equal(originHolds(open, local, TOWN), true);
  assert.equal(originHolds(open, stranger, TOWN), true);

  // On: the gate guard stops the stranger coming up the road and lets the
  // townsfolk crossing their own square walk past.
  const gate = watch({ anyPerson: true, outsideZoneOnly: true });
  assert.equal(originHolds(gate, stranger, TOWN), true);
  assert.equal(originHolds(gate, local, TOWN), false);

  // An unknown origin is a stranger — erring the other way would be a hole in a
  // watch somebody deliberately turned on.
  assert.equal(originHolds(gate, { id: "c3", fromZoneId: null }, TOWN), true);
});

test("the hold lapses on its own", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  assert.equal(heldReasonFor({ heldUntil: null }, now), null);
  assert.equal(heldReasonFor({}, now), null);
  // Exactly at the mark is free — the comparison is strict, so a hold can
  // never round itself one tick longer.
  assert.equal(heldReasonFor({ heldUntil: now }, now), null);
  assert.equal(heldReasonFor({ heldUntil: new Date(now.getTime() - 1000) }, now), null);
});

test("a short hold counts down and a long one does not", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const safe = heldReasonFor({ heldUntil: new Date(now.getTime() + 120_000) }, now);
  assert.match(safe, /another 120s/);
  // An ambush runs to the end of the turn. "43188s" would be worse than
  // saying nothing, so past five minutes it says the turn instead.
  const ambush = heldReasonFor({ heldUntil: new Date(now.getTime() + 12 * 3600_000) }, now);
  assert.match(ambush, /end of the turn/);
  assert.doesNotMatch(ambush, /\ds\./);
});

test("a caught thief reads their own sentence, and nobody is named as holding them", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const { HELD_REASON, CAUGHT_HOLD_MS } = require("../lib/intercept");
  const caught = heldReasonFor(
    { heldUntil: new Date(now.getTime() + CAUGHT_HOLD_MS), heldReason: HELD_REASON.CAUGHT },
    now,
  );
  assert.match(caught, /caught stealing/);
  assert.match(caught, /another 300s/);
  // "Somebody" is an intercept's word — nobody has hold of a caught thief, the room does.
  assert.doesNotMatch(caught, /Somebody/);
  // The whole hold fits under the countdown ceiling, so it never says "end of the turn".
  assert.doesNotMatch(caught, /end of the turn/);
  // And it lapses on its own clock like every other hold.
  assert.equal(
    heldReasonFor({ heldUntil: now, heldReason: HELD_REASON.CAUGHT }, now),
    null,
  );
});

// Just enough of Prisma's `where` to run holdWhereTheyStand's against one row.
function matchesWhere(row, where) {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return cond.every((w) => matchesWhere(row, w));
    if (key === "OR") return cond.some((w) => matchesWhere(row, w));
    const value = row[key];
    if (cond === null) return value == null;
    if (typeof cond !== "object" || cond instanceof Date) return value === cond;
    if ("lt" in cond) return value != null && value < cond.lt;
    if ("lte" in cond) return value != null && value <= cond.lte;
    if ("notIn" in cond) return value != null && !cond.notIn.includes(value);
    throw new Error(`matchesWhere: no rule for ${key}`);
  });
}

function fakeDb(row) {
  return {
    character: {
      updateMany: async ({ where, data }) => {
        if (!matchesWhere(row, where)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };
}

test("a caught hold never lands on a running fight, however soon it ends", async () => {
  const { HELD_REASON, CAUGHT_HOLD_MS, holdWhereTheyStand } = require("../lib/intercept");
  const now = new Date("2026-09-14T12:00:00Z");
  const until = new Date(now.getTime() + CAUGHT_HOLD_MS);
  const hold = (row) => holdWhereTheyStand(fakeDb(row), "thief", { until, reason: HELD_REASON.CAUGHT, now });

  // Free: held by nobody, for five minutes.
  const free = { id: "thief", heldUntil: null, heldById: null, heldReason: null };
  assert.equal(await hold(free), true);
  assert.deepEqual(free, { id: "thief", heldUntil: until, heldById: null, heldReason: HELD_REASON.CAUGHT });

  // A fight in its last minute: the clock rule alone would take it. It must not.
  const fighting = {
    id: "thief",
    heldUntil: new Date(now.getTime() + 60_000),
    heldById: "victim",
    heldReason: HELD_REASON.ATTACKING,
  };
  assert.equal(await hold(fighting), false);
  assert.equal(fighting.heldReason, HELD_REASON.ATTACKING);
  assert.equal(fighting.heldById, "victim");

  // Yesterday's fight, lapsed on its own clock but still carrying its reason, is no fight.
  const lapsed = { id: "thief", heldUntil: new Date(now.getTime() - 1), heldById: "victim", heldReason: HELD_REASON.ATTACK };
  assert.equal(await hold(lapsed), true);
  assert.equal(lapsed.heldReason, HELD_REASON.CAUGHT);

  // A longer hold of any kind is left where it is.
  const ambushed = { id: "thief", heldUntil: new Date(now.getTime() + 3600_000), heldById: "x", heldReason: null };
  assert.equal(await hold(ambushed), false);
  assert.equal(ambushed.heldById, "x");
});

test("a player's line cannot ping the room", () => {
  assert.equal(cleanMessage("Halt! @everyone"), "Halt! everyone");
  assert.equal(cleanMessage("@here now"), "here now");
  // The sanctioned vocabulary survives — db/test/discordMarkup.test.js pins it
  // and both faces render it.
  assert.equal(cleanMessage("meet <@123> at <t:1757700120:F>"), "meet <@123> at <t:1757700120:F>");
  assert.equal(cleanMessage("x".repeat(400)).length, 300);
  assert.equal(cleanMessage(null), "");
});

test("names are deduped the way they are matched", () => {
  assert.deepEqual(cleanNames(["Ada", "  ada  ", "Bo"]), ["Ada", "Bo"]);
  assert.deepEqual(cleanNames(["Ada   Vane"]), ["Ada Vane"]);
  assert.deepEqual(cleanNames(["", "   ", null]), []);
  assert.equal(cleanNames(Array.from({ length: 40 }, (_, i) => `N${i}`)).length, 12);
});

test("both sides of every line are named by the face the room saw", () => {
  assert.equal(seenAs(OPEN), "Lord Greeblus Vane");
  assert.equal(seenAs(HOODED), "a young man");
  assert.equal(seenAs(null), "somebody");
});

test("the said-word agrees with who is saying it", () => {
  assert.equal(saidWord({ gender: "MAN" }), "He said");
  assert.equal(saidWord({ gender: "WOMAN" }), "She said");
  assert.equal(saidWord({ gender: "NEUTRAL" }), "They said");
  assert.equal(saidWord({}), "They said");
});
