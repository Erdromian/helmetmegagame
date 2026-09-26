// node --test over the Rite of Conversion's handshake (db/lib/conversionRite.js,
// docs/systemdocs/THANATI.md §4a). Run with `npm test --workspace=db`.
//
// The rite stopped converting people outright and started ASKING, which adds
// three roads out of one chant — accept, refuse, and three hours of silence —
// where there used to be one. What is worth testing here is the things that
// make this kind unlike every other Offer:
//
//   - the CULTIST picks the target, off a list rebuilt at pick time rather
//     than the one the DM was drawn from, and only one of the circle may;
//   - refusing is free now, so nothing may quietly reintroduce a price;
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
// A pick option's code is an HMAC under AUTH_SECRET (conversionRite.js#pickCode),
// and with no secret there is no code at all.
process.env.AUTH_SECRET ||= "test-secret";

const {
  CONVERSION_WINDOW_MS,
  VISION_DM,
  REFUSED_DM,
  DISMISSED_DM,
  REFUSED_LINE,
  ASK_REFUSED_DM,
  PICK_DM,
  dismisses,
  conversionPickRow,
  pickCode,
  pickOptions,
  createConversionOffer,
  answerConversionPick,
  refuseConversion,
  expireConversionOffers,
} = require("../lib/conversionRite");
const { riteByKey } = require("../lib/rites");
const { EVENTS, MOOD_MIN, clampMood, bandOf } = require("../lib/mood");

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

// The shape convertCandidates hands the handler: a Set of slugs beside the row.
// Empty by default now — the rite's target is somebody who could walk away.
function victim(overrides = {}) {
  return {
    id: "v1",
    name: "Cass",
    status: "ALIVE",
    age: 30,
    gender: "WOMAN",
    discordUserId: "reachable",
    slugs: new Set(),
    ...overrides,
  };
}

// ---- the catalog ------------------------------------------------------------

test("one cultist is enough, and the description no longer threatens a refuser", () => {
  const rite = riteByKey("conversion");
  assert.equal(rite.minChanters, 1, "the rite takes a single cultist now");
  assert.equal(rite.ingredients[0].kind, "convert-candidate", "no longer a bound-person rite");
  // The Grimoire renders this description verbatim, so it is the promise the
  // cult reads. It must not go on advertising a price nothing charges.
  assert.match(rite.description, /They may refuse/);
  assert.ok(!/finish them off/.test(rite.description));
  assert.ok(!/weakened|distraught/.test(rite.description));
});

test("refusing the dark god costs nothing, and the event that cost is gone", () => {
  // Deleted rather than left at 0: an event still in the table is one a future
  // call site can reach for. The Pious bonus is the only rite event left.
  assert.equal(EVENTS.RITE_REFUSED, undefined);
  assert.ok(EVENTS.RITE_DISMISSED > 0);
  assert.ok(MOOD_MIN < 0);
  assert.equal(bandOf(clampMood(MOOD_MIN)).key, "panicking");
});

// ---- who the vision bounces off ---------------------------------------------

test("dismisses() reads the Pious off either shape of a character row", () => {
  // convertCandidates hands over a Set; a row loaded anywhere else carries the
  // nested tags array. Both reach this function, so both must answer.
  assert.equal(dismisses(victim()), false);
  assert.equal(dismisses(victim({ slugs: new Set(["pious"]) })), true);
  assert.equal(dismisses({ tags: [{ tag: { slug: "pious" } }] }), true);
  assert.equal(dismisses({ tags: [{ tag: { slug: "bound" } }] }), false);
  assert.equal(dismisses({}), false);
  assert.equal(dismisses(null), false);
});

// ---- asking ------------------------------------------------------------------

test("asking writes one PENDING offer with a three-hour clock and the room on it", async () => {
  const db = makeDb({ turn: [TURN] });
  const before = Date.now();

  const out = await createConversionOffer(db, { target: victim(), room: ROOM, askedBy: CHANTERS[0], turn: TURN });

  assert.equal(out.ok, true);
  const offer = db._store.offer[0];
  assert.equal(offer.kind, "CONVERSION");
  assert.equal(offer.status, undefined, "status is left to the column default, PENDING");
  assert.equal(offer.responderId, "v1");
  // The cultist who PICKED, which is a real fact now rather than "whoever
  // chanted first" — refuseConversion reports back to them. Still never shown
  // to the person being asked.
  assert.equal(offer.initiatorId, "c1");
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
  // until the sweep closed it, spending the circle's chant on a question
  // nobody was ever shown.
  const db = makeDb({ turn: [TURN] });
  const out = await createConversionOffer(db, {
    target: victim({ discordUserId: null }),
    room: ROOM,
    askedBy: CHANTERS[0],
    turn: TURN,
  });
  assert.equal(out.ok, false);
  assert.equal(db._store.offer.length, 0);
});

test("a second rite cannot stack a second vision on the same person", async () => {
  const db = makeDb({ turn: [TURN] });
  await createConversionOffer(db, { target: victim(), room: ROOM, askedBy: CHANTERS[0], turn: TURN });
  db._store.offer[0].status = "PENDING";

  const again = await createConversionOffer(db, { target: victim(), room: ROOM, askedBy: CHANTERS[0], turn: TURN });

  assert.equal(again.ok, false);
  assert.equal(db._store.offer.length, 1, "one question at a time");
});

test("no open turn is a no-op, not a throw", async () => {
  // Offer.turnId is required and the sweep is an independent minute cron, so
  // it lands between turns routinely — the same window that broke the Rite of
  // Madness on 2026-09-08. By here the floor is already eaten.
  const db = makeDb({});
  const out = await createConversionOffer(db, { target: victim(), room: ROOM, askedBy: CHANTERS[0], turn: null });
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
  assert.match(REFUSED_LINE, /The rite has failed/);
});

test("two roads to no cannot answer the same question twice", async () => {
  // The Refuse button, the three-hour sweep and the turn-close pass all reach
  // the same function, and a rolling deploy runs two bot containers. Refusing
  // is free now, so what the guarded updateMany defends is the telling: a
  // racing pair would say it twice to the room and twice to the cultist.
  const offer = pendingOffer();
  const db = makeDb({ offer: [offer], character: [victim({ mood: 0 })] });

  const first = await refuseConversion(db, offer);
  const second = await refuseConversion(db, offer);

  assert.equal(first.ok, true);
  assert.equal(second.ok, false, "the second road finds the row already closed");
});

test("refusing charges the refuser nothing at all", async () => {
  // The whole point of the rework. If a mood write or a tag grant ever comes
  // back here, it must come back with a change to the rite's description too.
  const offer = pendingOffer();
  const target = victim({ mood: 0 });
  const db = makeDb({ offer: [offer], character: [target] });

  await refuseConversion(db, offer);

  assert.equal(target.mood, 0, "the dial did not move");
  assert.equal(db._store.characterTag.length, 0, "no Depressed, and no tag of any kind");
  assert.equal(db._store.moodEvent.length, 0);
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
  // is somebody turning the truth down.
  assert.notEqual(REFUSED_DM, DISMISSED_DM);
  assert.match(DISMISSED_DM, /hallucination/);
  // It used to say "You are shocked and traumatized", which described the -140
  // and the Depressed tag. Nothing happens to them now, so nothing may claim to.
  assert.ok(!/traumatized|shocked/.test(REFUSED_DM));
  // Straight apostrophes and no double dagger anywhere (CLAUDE.md).
  for (const line of [VISION_DM, REFUSED_DM, DISMISSED_DM, REFUSED_LINE, ASK_REFUSED_DM, PICK_DM]) {
    assert.ok(!line.includes("‡"), line);
    assert.ok(!line.includes("’"), line);
  }
});

test("the cultist is told, in words that also fit three hours of silence", () => {
  // Both roads reach this one line — a pressed Decline and somebody who never
  // opened Discord — so it names both: defiance, or an inability to accept.
  assert.match(ASK_REFUSED_DM, /renounced Tzchernobog/);
  assert.match(ASK_REFUSED_DM, /inability to accept/);
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

test("convertCandidates asks for the opposite set, and drops the cult's own", async () => {
  // The Sacrifice's victim must be bound; this rite's target must NOT be, nor
  // dying, catatonic, crucified, paralyzed or any of the rest of the ACT list.
  // That is one predicate, not a hand-rolled pair — the query carries it as a
  // `none`, so the fake below records the where rather than filtering on it.
  const { convertCandidates } = require("../lib/riteIngredients");
  const { slugsBlocking, ACT } = require("../lib/incapacitation");

  const rows = [
    { id: "p1", name: "Aldo", role: null, tags: [{ tag: { slug: "pious" } }] },
    { id: "n1", name: "Zeb", role: null, tags: [] },
    { id: "t1", name: "Cull", role: null, tags: [{ tag: { slug: "thanati" } }] },
  ];
  let seen = null;
  const db = new Proxy(
    { character: { findMany: async ({ where }) => { seen = where; return rows; } } },
    {
      get: (target, key) =>
        key in target
          ? target[key]
          : { findMany: async () => [], findUnique: async () => null, findFirst: async () => null },
    },
  );
  const room = { id: "r1", kind: "PUBLIC", locationId: "loc1", accessTagSlugs: [] };

  const out = await convertCandidates(db, room);

  assert.deepEqual(seen.tags.none.tag.slug.in, slugsBlocking(ACT), "the shared ACT predicate, not a local copy");
  assert.ok(seen.tags.none.tag.slug.in.includes("bound"), "bound is one of the ways to be unable to answer");
  assert.deepEqual(
    out.map((c) => c.name),
    ["Zeb", "Aldo"],
    "the cultist is dropped outright and the Pious sorts last",
  );
});

// ---- the picker --------------------------------------------------------------

test("the select carries one option per candidate, valued by its code", () => {
  const row = conversionPickRow("a1", [
    { code: "k1", label: "Cass" },
    { code: "k2", label: "a young woman" },
  ]);
  const select = row[0].components[0];
  assert.equal(select.type, 3, "a string select, not a button pair");
  assert.equal(select.custom_id, "rite:convert:a1", "the id on the wire is the ATTEMPT");
  assert.deepEqual(
    select.options.map((o) => o.value),
    ["k1", "k2"],
  );
  // A hood is not undone by the picker: the alias is what the cultist picks.
  assert.equal(select.options[1].label, "a young woman");
});

// The people the candidates are, as rows the picker loads by id.
const CASS = { id: "v1", name: "Cass", firstName: "Cass", age: 20, gender: "WOMAN", status: "ALIVE", tags: [] };
const DORA = { id: "v2", name: "Dora", firstName: "Dora", age: 20, gender: "WOMAN", status: "ALIVE", tags: [] };
const HOOD = {
  equipped: true,
  tag: { slug: "hood", name: "Hood", concealsIdentity: true, concealSprite: "hood", forcesConceal: true, equipLayer: 3 },
};

test("each chanter's list names the candidates the way that chanter knows them", async () => {
  // Ash knows Cass; Bell has never met her.
  const db = makeDb({ character: [CASS], acquaintance: [{ ownerId: "c1", subjectId: "v1" }] });
  const [ash] = await pickOptions(db, [{ id: "v1" }], { attemptId: "a1", readerId: "c1" });
  const [bell] = await pickOptions(db, [{ id: "v1" }], { attemptId: "a1", readerId: "c2" });
  assert.equal(ash.label, "Cass");
  assert.equal(bell.label, "a young woman", "a bare face nobody introduced is what it looks like");
});

test("a hood is its alias on every chanter's list, even a friend's", async () => {
  const db = makeDb({ character: [{ ...CASS, tags: [HOOD] }], acquaintance: [{ ownerId: "c1", subjectId: "v1" }] });
  const [ash] = await pickOptions(db, [{ id: "v1" }], { attemptId: "a1", readerId: "c1" });
  assert.equal(ash.label, "a young woman");
});

test("no option carries a character id, and each chanter's codes are their own", async () => {
  const db = makeDb({ character: [CASS] });
  const [ash] = await pickOptions(db, [{ id: "v1" }], { attemptId: "a1", readerId: "c1" });
  const [bell] = await pickOptions(db, [{ id: "v1" }], { attemptId: "a1", readerId: "c2" });
  assert.deepEqual(Object.keys(ash).sort(), ["code", "label"]);
  assert.notEqual(ash.code, "v1");
  assert.ok(!ash.code.includes("v1"));
  assert.notEqual(ash.code, bell.code, "one chanter's code means nothing on another's list");
  assert.notEqual(ash.code, pickCode("a2", "c1", "v1"), "nor in the next rite");
});

test("two lookalikes are told apart by the label every observer shares", async () => {
  const labelled = makeDb({
    character: [
      { ...CASS, presenceLabel: "hunched" },
      { ...DORA, presenceLabel: "on the left" },
    ],
  });
  const both = await pickOptions(labelled, [{ id: "v1" }, { id: "v2" }], { attemptId: "a1", readerId: "c1" });
  assert.deepEqual(both.map((o) => o.label), ["a young woman, hunched", "a young woman, on the left"]);

  // No label rolled yet: a number, so the two options still differ.
  const bare = makeDb({ character: [CASS, DORA] });
  const numbered = await pickOptions(bare, [{ id: "v1" }, { id: "v2" }], { attemptId: "a1", readerId: "c1" });
  assert.deepEqual(numbered.map((o) => o.label), ["a young woman (1)", "a young woman (2)"]);
});

test("only somebody who chanted may pick, and only once", async () => {
  const attempt = {
    id: "a1",
    riteKey: "conversion",
    status: "AWAITING",
    roomId: "r1",
    participants: [{ characterId: "c1", name: "Ash", discordUserId: "ash" }],
    result: {},
  };
  const db = makeDb({
    riteAttempt: [attempt],
    turn: [TURN],
    room: [{ id: "r1", name: "The Basements", kind: "PUBLIC", locationId: "loc1", accessTagSlugs: [], discordThreadId: null }],
    character: [
      { id: "c1", name: "Ash", status: "ALIVE", discordUserId: "ash", locationId: "loc1", tags: [] },
      { ...victim(), locationId: "loc1", tags: [] },
    ],
  });

  // Somebody who was never in the circle.
  const outsider = await answerConversionPick(db, { attemptId: "a1", discordUserId: "nobody", pick: pickCode("a1", "c1", "v1") });
  assert.equal(outsider.ok, false);
  assert.equal(attempt.status, "AWAITING", "a stranger's pick does not spend the rite");

  // A bare character id is not a pick: the list never carried one.
  const byId = await answerConversionPick(db, { attemptId: "a1", discordUserId: "ash", pick: "v1" });
  assert.equal(byId.ok, false);
  // Nor is another chanter's code for the same person.
  const borrowed = await answerConversionPick(db, { attemptId: "a1", discordUserId: "ash", pick: pickCode("a1", "c2", "v1") });
  assert.equal(borrowed.ok, false);
  assert.equal(attempt.status, "AWAITING");

  const picked = await answerConversionPick(db, { attemptId: "a1", discordUserId: "ash", pick: pickCode("a1", "c1", "v1") });
  assert.equal(picked.ok, true);
  assert.equal(attempt.status, "FIRED", "the claim is what stops two cultists both calling somebody");
  assert.equal(db._store.offer.length, 1);
  assert.equal(db._store.offer[0].responderId, "v1");
  assert.equal(db._store.offer[0].initiatorId, "c1");

  const again = await answerConversionPick(db, { attemptId: "a1", discordUserId: "ash", pick: pickCode("a1", "c1", "v1") });
  assert.equal(again.ok, false, "the rite is spent");
  assert.equal(db._store.offer.length, 1);
});

test("a pick nobody can still convert is refused without spending the rite", async () => {
  const attempt = {
    id: "a1",
    riteKey: "conversion",
    status: "AWAITING",
    roomId: "r1",
    participants: [{ characterId: "c1", name: "Ash", discordUserId: "ash" }],
    result: {},
  };
  const db = makeDb({
    riteAttempt: [attempt],
    turn: [TURN],
    room: [{ id: "r1", name: "The Basements", kind: "PUBLIC", locationId: "loc1", accessTagSlugs: [], discordThreadId: null }],
    character: [{ id: "c1", name: "Ash", status: "ALIVE", discordUserId: "ash", locationId: "loc1", tags: [] }],
  });

  // The DM's labels are minutes old; the eligible set is rebuilt at pick time,
  // so somebody bound or converted in the gap is simply not there any more.
  const out = await answerConversionPick(db, { attemptId: "a1", discordUserId: "ash", pick: pickCode("a1", "c1", "gone") });

  assert.equal(out.ok, false);
  assert.equal(attempt.status, "AWAITING", "still answerable, so the circle can pick somebody else");
  assert.equal(db._store.offer.length, 0);
});

test("a rite that is not Conversion cannot be answered by this picker", async () => {
  // The other AWAITING rite is Panic, which is answered by SPEAKING a zone
  // name. The two must not be able to claim each other's rows.
  const attempt = { id: "a1", riteKey: "panic", status: "AWAITING", roomId: "r1", participants: [{ characterId: "c1" }] };
  const db = makeDb({ riteAttempt: [attempt] });

  const out = await answerConversionPick(db, { attemptId: "a1", discordUserId: "ash", pick: pickCode("a1", "c1", "v1") });

  assert.equal(out.ok, false);
  assert.equal(attempt.status, "AWAITING");
});
