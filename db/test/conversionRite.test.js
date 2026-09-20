// node --test over the Rite of Conversion's handshake (db/lib/conversionRite.js,
// docs/systemdocs/THANATI.md §4a). Run with `npm test --workspace=db`.
//
// The rite stopped converting people outright and started ASKING, which adds
// three roads out of one chant — accept, refuse, and three hours of silence —
// where there used to be one. What is worth testing here is the two things
// that make this kind unlike every other Offer:
//
//   - refusing COSTS something, so it must not fall through to the generic
//     declineOffer(), and two roads to no must never charge the price twice;
//   - the Pious path writes no Offer row at all, so there is nothing to answer
//     and nothing left to expire.
//
// Prisma is faked the same way db/test/riteSweep.test.js fakes it: a tiny
// in-memory store answering only the queries these paths reach for. It is not
// a Prisma emulator. When a test needs a query it does not answer, teach it
// that one query.
const test = require("node:test");
const assert = require("node:assert/strict");

// These paths really do call sendDm() and roomLine(), which really do reach
// Discord -- and this container happens to have a DISCORD_TOKEN in its
// environment, so without this line the suite fires live REST calls and fails
// on a fixture id that is not a snowflake. Clearing it makes the transport
// throw locally instead; every call site here already catches its own send,
// because a DM that will not go is never a reason to leave somebody
// half-converted. What the DMs SAY is asserted against the exported constants,
// which is where the words live anyway.
process.env.DISCORD_TOKEN = "";

const {
  CONVERSION_WINDOW_MS,
  CONVERTED_MOOD,
  VISION_DM,
  REFUSED_DM,
  DISMISSED_DM,
  REFUSED_LINE,
  dismisses,
  createConversionOffer,
  refuseConversion,
  expireConversionOffers,
} = require("../lib/conversionRite");
const { riteByKey } = require("../lib/rites");
const { EVENTS, MOOD_BANDS, MOOD_MIN, clampMood, bandOf } = require("../lib/mood");

// ---- the fake ---------------------------------------------------------------

function matches(row, where = {}) {
  for (const [key, cond] of Object.entries(where)) {
    const value = row[key];
    if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
      if ("in" in cond && !cond.in.includes(value)) return false;
      if ("not" in cond && value === cond.not) return false;
      if ("gt" in cond && !(value > cond.gt)) return false;
      if ("lte" in cond && !(value <= cond.lte)) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

function makeDb(seed = {}) {
  const store = new Proxy({ gameState: [{ id: 1 }], ...seed }, {
    get: (target, key) => {
      if (!(key in target)) target[key] = [];
      return target[key];
    },
  });
  const model = (name) => ({
    findUnique: async ({ where }) => store[name].find((r) => matches(r, where)) ?? null,
    findFirst: async ({ where = {} } = {}) => store[name].find((r) => matches(r, where)) ?? null,
    findMany: async ({ where = {} } = {}) => store[name].filter((r) => matches(r, where)),
    create: async ({ data }) => {
      const row = { id: `${name}-${store[name].length + 1}`, ...data };
      store[name].push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = store[name].find((r) => matches(r, where));
      if (!row) throw new Error(`fake prisma: no ${name} matching ${JSON.stringify(where)}`);
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where = {}, data }) => {
      const rows = store[name].filter((r) => matches(r, where));
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
    deleteMany: async ({ where = {} }) => {
      const keep = store[name].filter((r) => !matches(r, where));
      const count = store[name].length - keep.length;
      store[name] = keep;
      return { count };
    },
  });
  const db = new Proxy(
    { $transaction: async (fn) => fn(db), _store: store },
    { get: (target, key) => (key in target ? target[key] : model(String(key))) },
  );
  return db;
}

const ROOM = { id: "r1", name: "The Basements", discordThreadId: null };
const CHANTERS = [
  { characterId: "c1", name: "Ash", discordUserId: null },
  { characterId: "c2", name: "Bell", discordUserId: null },
];
const TURN = { id: "t1", number: 4, status: "OPEN" };

// The shape boundCandidates hands the handler: a Set of slugs beside the row.
function victim(overrides = {}) {
  return {
    id: "v1",
    name: "Cass",
    status: "ALIVE",
    age: 30,
    gender: "WOMAN",
    discordUserId: "reachable",
    slugs: new Set(["bound"]),
    ...overrides,
  };
}

// ---- the catalog ------------------------------------------------------------

test("the rite takes two cultists and warns what refusing costs", () => {
  const rite = riteByKey("conversion");
  assert.equal(rite.minChanters, 2, "one cultist may no longer convert somebody alone");
  // The Grimoire renders this description verbatim, so the promise the cult
  // reads and the price refuseConversion charges are the same feature.
  assert.match(rite.description, /They may refuse/);
  assert.match(rite.description, /finish them off/);
});

test("the two mood events exist and point the right way", () => {
  assert.ok(EVENTS.RITE_REFUSED < 0);
  assert.ok(EVENTS.RITE_DISMISSED > 0);
  // -140 against a floor of -100 is deliberate, not an overflow: refusing is
  // meant to put anybody at all into the bottom band.
  assert.ok(EVENTS.RITE_REFUSED < MOOD_MIN);
  assert.equal(bandOf(clampMood(EVENTS.RITE_REFUSED)).key, "panicking");
});

test("accepting lands on the FLOOR of Pleased, not its middle", () => {
  // A rescue, not a reward (docs/systemdocs/THANATI.md §4a). If the band is
  // ever re-cut, this should move with it rather than silently drift into
  // whatever band 28 has become.
  const pleased = MOOD_BANDS.find((b) => b.key === "pleased");
  assert.equal(CONVERTED_MOOD, pleased.min);
  assert.equal(bandOf(CONVERTED_MOOD).key, "pleased");
});

// ---- who the vision bounces off ---------------------------------------------

test("dismisses() reads the Pious off either shape of a character row", () => {
  // boundCandidates hands over a Set; a row loaded anywhere else carries the
  // nested tags array. Both reach this function, so both must answer.
  assert.equal(dismisses(victim()), false);
  assert.equal(dismisses(victim({ slugs: new Set(["bound", "pious"]) })), true);
  assert.equal(dismisses({ tags: [{ tag: { slug: "pious" } }] }), true);
  assert.equal(dismisses({ tags: [{ tag: { slug: "bound" } }] }), false);
  assert.equal(dismisses({}), false);
  assert.equal(dismisses(null), false);
});

// ---- asking ------------------------------------------------------------------

test("asking writes one PENDING offer with a three-hour clock and the room on it", async () => {
  const db = makeDb({ turn: [TURN] });
  const before = Date.now();

  const out = await createConversionOffer(db, { target: victim(), room: ROOM, participants: CHANTERS, turn: TURN });

  assert.equal(out.ok, true);
  const offer = db._store.offer[0];
  assert.equal(offer.kind, "CONVERSION");
  assert.equal(offer.status, undefined, "status is left to the column default, PENDING");
  assert.equal(offer.responderId, "v1");
  assert.equal(offer.initiatorId, "c1", "the first chanter carries the row; no surface reads it back");
  assert.ok(offer.expiresAt.getTime() - before >= CONVERSION_WINDOW_MS - 50);
  // The answer arrives hours later with no room in hand, so the room the rite
  // fired in rides along on `outcome`.
  assert.equal(offer.outcome.room.id, "r1");
});

test("the vision asks a question and names nobody", () => {
  assert.match(VISION_DM, /horrifying vision/);
  // The whole point of the handshake: it is a question, and the person being
  // converted is never told who is asking it.
  assert.match(VISION_DM, /Do you wish to accept/);
  assert.ok(!/\bAsh\b|\bBell\b/.test(VISION_DM));
});

test("somebody with no Discord account is never asked", async () => {
  // The offer is answered by a DM button, so a character nobody can reach has
  // no way to say yes -- and writing the row anyway would leave one PENDING
  // until the sweep refused it, charging them -140 for a question they were
  // never shown.
  const db = makeDb({ turn: [TURN] });
  const out = await createConversionOffer(db, {
    target: victim({ discordUserId: null }),
    room: ROOM,
    participants: CHANTERS,
    turn: TURN,
  });
  assert.equal(out.ok, false);
  assert.equal(db._store.offer.length, 0);
});

test("a second rite cannot stack a second vision on the same person", async () => {
  const db = makeDb({ turn: [TURN] });
  await createConversionOffer(db, { target: victim(), room: ROOM, participants: CHANTERS, turn: TURN });
  db._store.offer[0].status = "PENDING";

  const again = await createConversionOffer(db, { target: victim(), room: ROOM, participants: CHANTERS, turn: TURN });

  assert.equal(again.ok, false);
  assert.equal(db._store.offer.length, 1, "one question at a time");
});

test("no open turn is a no-op, not a throw", async () => {
  // Offer.turnId is required and the sweep is an independent minute cron, so
  // it lands between turns routinely — the same window that broke the Rite of
  // Madness on 2026-09-08. By here the floor is already eaten.
  const db = makeDb({});
  const out = await createConversionOffer(db, { target: victim(), room: ROOM, participants: CHANTERS, turn: null });
  assert.equal(out.ok, false);
  assert.equal(db._store.offer.length, 0);
});

// ---- refusing ----------------------------------------------------------------

function pendingOffer(overrides = {}) {
  return {
    id: "o1",
    kind: "CONVERSION",
    status: "PENDING",
    responderId: "v1",
    initiatorId: "c1",
    expiresAt: new Date(Date.now() - 1000),
    outcome: { room: { id: "r1", name: "The Basements", discordThreadId: null } },
    ...overrides,
  };
}

test("refusing closes the row, tells them, and tells the room", async () => {
  const offer = pendingOffer();
  const db = makeDb({ offer: [offer], character: [victim({ mood: 0 })] });

  const out = await refuseConversion(db, offer);

  assert.equal(out.ok, true);
  assert.equal(offer.status, "DECLINED");
  assert.ok(offer.respondedAt instanceof Date);
  assert.ok(offer.resolvedAt instanceof Date);
  assert.match(REFUSED_LINE, /denied the ritual/);
});

test("two roads to no cannot charge the price twice", async () => {
  // The Refuse button, the three-hour sweep and the turn-close pass all reach
  // the same function, and a rolling deploy runs two bot containers. The
  // guarded updateMany is the whole defence; without it a racing pair would
  // apply -140 and Depressed twice over.
  const offer = pendingOffer();
  const db = makeDb({ offer: [offer], character: [victim({ mood: 0 })] });

  const first = await refuseConversion(db, offer);
  const second = await refuseConversion(db, offer);

  assert.equal(first.ok, true);
  assert.equal(second.ok, false, "the second road finds the row already closed");
});

test("a refuser who died in the three hours closes the row and nothing else", async () => {
  const offer = pendingOffer();
  const db = makeDb({ offer: [offer], character: [victim({ status: "DEAD" })] });

  const out = await refuseConversion(db, offer);

  assert.equal(out.ok, true);
  assert.equal(offer.status, "DECLINED");
});

// ---- the clock ---------------------------------------------------------------

test("three hours of silence is a refusal, and only for the ones that are due", async () => {
  const due = pendingOffer({ id: "o-due", expiresAt: new Date(Date.now() - 1000) });
  const fresh = pendingOffer({ id: "o-fresh", responderId: "v2", expiresAt: new Date(Date.now() + 60_000) });
  const db = makeDb({
    offer: [due, fresh],
    character: [victim({ mood: 0 }), victim({ id: "v2", name: "Dane", mood: 0 })],
  });

  const refused = await expireConversionOffers(db, new Date());

  assert.equal(refused, 1);
  assert.equal(due.status, "DECLINED", "going quiet is an answer, not a way out");
  assert.equal(fresh.status, "PENDING", "still has time to answer");
});

test("the sweep leaves other offer kinds alone", async () => {
  // Every other kind expires at turn close and refuses for free. This sweep
  // must never reach one.
  const kiss = { id: "o-kiss", kind: "KISS", status: "PENDING", responderId: "v1", expiresAt: null };
  const db = makeDb({ offer: [kiss], character: [victim()] });

  assert.equal(await expireConversionOffers(db, new Date()), 0);
  assert.equal(kiss.status, "PENDING");
});

// ---- the words ---------------------------------------------------------------

test("every line is Bascinet's, and the two refusals read differently", () => {
  // The Pious dismissal and the ordinary refusal are different events and must
  // not converge on one string: one is a hallucination shrugged off, the other
  // is somebody broken by it.
  assert.notEqual(REFUSED_DM, DISMISSED_DM);
  assert.match(DISMISSED_DM, /hallucination/);
  assert.match(REFUSED_DM, /shocked and traumatized/);
  // Straight apostrophes and no double dagger anywhere (CLAUDE.md).
  for (const line of [VISION_DM, REFUSED_DM, DISMISSED_DM, REFUSED_LINE]) {
    assert.ok(!line.includes("‡"), line);
    assert.ok(!line.includes("’"), line);
  }
});

// ---- who the rite reaches for -----------------------------------------------

test("the Pious are a valid target, but only when nobody else is lying there", async () => {
  // They used to be dropped from the candidate list outright, so the rite
  // quietly passed over them. Now they sort LAST -- behind the leaders too,
  // since a Pious leader is the worst target in the room rather than the best
  // one -- and the cult can waste a chant discovering it.
  const { boundCandidates } = require("../lib/riteIngredients");

  const rows = [
    { id: "p1", name: "Aldo", role: { requiresWhitelist: true }, tags: [{ tag: { slug: "bound" } }, { tag: { slug: "pious" } }] },
    { id: "n1", name: "Zeb", role: null, tags: [{ tag: { slug: "bound" } }] },
    { id: "l1", name: "Mira", role: { requiresWhitelist: true }, tags: [{ tag: { slug: "bound" } }] },
  ];
  // Everything but `character` answers empty, which is what "nobody holds a
  // key and nobody is a guest" looks like -- and a PUBLIC room needs neither.
  const db = new Proxy(
    { character: { findMany: async () => rows } },
    {
      get: (target, key) =>
        key in target
          ? target[key]
          : { findMany: async () => [], findUnique: async () => null, findFirst: async () => null },
    },
  );
  const room = { id: "r1", kind: "PUBLIC", locationId: "loc1", accessTagSlugs: [] };

  const out = await boundCandidates(db, room, { deprioritizeSlugs: ["pious"] });

  assert.deepEqual(
    out.map((c) => c.name),
    ["Mira", "Zeb", "Aldo"],
    "leader first, then the ordinary bound, and the Pious leader last of all",
  );
});
