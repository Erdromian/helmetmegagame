// Disguises fool the people who know the name (docs/systemdocs/STRANGERS.md §10). Against small fakes:
// the name parts, who each reader takes a disguise for, Who's here and its tokens, the chat lens, DMs,
// Intercept, learning a disguise's name and job by hearing them, the job's colour, and the rule that
// age and gender stay the wearer's.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_SECRET ||= "test-secret-for-hood-tokens";

const {
  disguiseParts,
  disguiseKey,
  namesCharacter,
  typedNameMatches,
  disguiseNameFrom,
  disguiseJobFrom,
  looksAlike,
  readDisguises,
  ownersWhoKnow,
  DISGUISE_STRANGER_FACE,
} = require("../lib/disguises");
const { normalizeDisguiseName } = require("../lib/disguiseMint");
const { whosHere, whosHereLines, resolveHoodToken, hiddenFrom } = require("../lib/whosHere");
const { attachSpeaker, attachDisguised, createLens, lensTyping, keptSpeaker } = require("../lib/strangers");
const { feedRowShape } = require("../lib/archive");
const { matchesArrival, seenByMany } = require("../lib/intercept");
const { presentedIdentity } = require("../lib/presentedIdentity");
const { learnFromSpeech } = require("../lib/memoryHearing");
const { renderPeopleLine } = require("../lib/peopleLine");
const { sceneSpeakerKey } = require("../lib/hoodToken");

// ------------------------------------------------------------------ fixtures

const disguiseTag = (name, job = null) => ({
  tagId: `t-${name}`,
  equipped: false,
  tag: {
    slug: `custom-disguise-abc-${name.length}`,
    name: `Disguised (${name})`,
    forcedName: name,
    disguiseJobSlug: job,
    concealsIdentity: false,
    concealSprite: null,
    forcesConceal: false,
    equipLayer: null,
  },
});
const beastTag = () => ({
  tagId: "t-apex",
  equipped: false,
  tag: { slug: "apex-form", name: "Apex Form", forcedName: "Beast", concealsIdentity: false, concealSprite: null, forcesConceal: false, equipLayer: null },
});

const person = (id, first, last, extra = {}) => ({
  id,
  name: [first, last].filter(Boolean).join(" "),
  firstName: first,
  lastName: last ?? null,
  age: 20,
  gender: "MAN",
  status: "ALIVE",
  concealed: false,
  roleTitle: null,
  role: { groupSlug: "court", slug: "courtier", name: "Courtier" },
  locationId: "loc",
  discordUserId: `u-${id}`,
  updatedAt: new Date(1700000000000),
  presenceLabel: null,
  presenceNonce: null,
  presenceHidden: null,
  tags: [],
  ...extra,
});

// The real Aldric, away somewhere; Xan wearing his name; Wren who knows Aldric; Mia a migrant who knows
// nobody; Pell who learned the made-up "Bob Fakename".
const aldric = person("aldric", "Aldric", "Vask", { locationId: "elsewhere", role: { groupSlug: "clergy", slug: "priest", name: "Priest" } });
const xan = person("xan", "Xan", "Quorble", { tags: [disguiseTag("Sir Aldric Vask")] });
const wren = person("wren", "Wren", "Holt");
const mia = person("mia", "Mia", "Dune", { gender: "WOMAN" });
const pell = person("pell", "Pell", "Orr");
const bob = person("bob", "Tam", "Rook", { tags: [disguiseTag("Bob Fakename")] });

// The jobs a disguise may claim.
const ROLES = [
  { slug: "bishop", name: "Bishop", groupSlug: "clergy" },
  { slug: "migrant", name: "Migrant", groupSlug: "outsiders" },
];

// One fake for all of it. `entries` are Acquaintance rows: { ownerId, subjectId, disguiseKey }.
function fakeDb({ people = [], entries = [], anonymize = true, room = null } = {}) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const writes = [];
  const lower = (s) => (s ?? "").toLowerCase();
  const matches = (row, where = {}) => {
    if (where.ownerId !== undefined) {
      if (typeof where.ownerId === "string" && row.ownerId !== where.ownerId) return false;
      if (where.ownerId?.in && !where.ownerId.in.includes(row.ownerId)) return false;
    }
    if (where.subjectId !== undefined) {
      if (where.subjectId === null && row.subjectId !== null) return false;
      if (where.subjectId?.in && !where.subjectId.in.includes(row.subjectId)) return false;
      if (where.subjectId?.not === null && row.subjectId == null) return false;
    }
    if (where.disguiseKey !== undefined) {
      if (typeof where.disguiseKey === "string" && row.disguiseKey !== where.disguiseKey) return false;
      if (where.disguiseKey?.in && !where.disguiseKey.in.includes(row.disguiseKey)) return false;
    }
    const firstName = where.subject?.firstName;
    if (firstName) {
      const subject = byId.get(row.subjectId);
      if (!subject) return false;
      if (firstName.in && !firstName.in.map(lower).includes(lower(subject.firstName))) return false;
      if (firstName.equals !== undefined && lower(firstName.equals) !== lower(subject.firstName)) return false;
    }
    return true;
  };
  const shaped = (row) => ({ ...row, subject: row.subjectId ? (byId.get(row.subjectId) ?? null) : null });
  return {
    writes,
    entries,
    gameConfig: { findUnique: async () => ({ anonymizeStrangers: anonymize }) },
    acquaintance: {
      findMany: async ({ where }) => entries.filter((row) => matches(row, where)).map(shaped),
      createMany: async ({ data }) => {
        let count = 0;
        for (const row of data) {
          const clash = entries.some(
            (e) =>
              e.ownerId === row.ownerId &&
              ((row.subjectId && e.subjectId === row.subjectId) || (row.disguiseKey && e.disguiseKey === row.disguiseKey)),
          );
          if (clash) continue;
          entries.push({ ...row });
          writes.push(row);
          count += 1;
        }
        return { count };
      },
      findUnique: async ({ where }) => {
        const key = where.ownerId_disguiseKey;
        return key ? (entries.find((e) => e.ownerId === key.ownerId && e.disguiseKey === key.disguiseKey) ?? null) : null;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of entries.filter((e) => matches(e, where) && !e.roleText)) {
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
    },
    role: { findMany: async ({ where }) => ROLES.filter((r) => where.slug.in.includes(r.slug)) },
    character: {
      findUnique: async ({ where }) => byId.get(where.id) ?? null,
      findMany: async ({ where } = {}) => {
        if (where?.id?.in) return where.id.in.map((id) => byId.get(id)).filter(Boolean);
        return room ?? people.filter((p) => p.locationId === (where?.locationId ?? "loc") && p.status === "ALIVE");
      },
      updateMany: async ({ where, data }) => {
        const row = byId.get(where.id);
        if (!row || (row.presenceNonce ?? null) !== (where.presenceNonce ?? null)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    characterTag: { findMany: async () => [] },
    playerThread: {
      findUnique: async () => ({ locationId: "loc", members: people.filter((p) => p.locationId === "loc").map((p) => ({ characterId: p.id })) }),
    },
    locationLink: { findMany: async () => [] },
    performance: { findMany: async () => [] },
    archiveEntry: { findMany: async () => [], groupBy: async () => [] },
    turn: { findFirst: async () => null },
    voiceMemory: { findMany: async () => [] },
  };
}

const knowsAldric = { ownerId: "wren", subjectId: "aldric", disguiseKey: null };
const learnedBob = { ownerId: "pell", subjectId: null, disguiseKey: "bob fakename" };

// ------------------------------------------------------------------- names

test("a disguise's name splits like a character's, and its title never decides who it is", () => {
  assert.deepEqual(disguiseParts("Sir Aldric Vask"), { name: "Sir Aldric Vask", honorific: "Sir", firstName: "Aldric", lastName: "Vask" });
  assert.deepEqual(disguiseParts("Bob"), { name: "Bob", honorific: null, firstName: "Bob", lastName: null });
  assert.equal(disguiseKey("Sir Aldric Vask"), "aldric vask");
  assert.equal(disguiseKey("Lady  aldric VASK"), "aldric vask");
  assert.ok(namesCharacter("Lord Aldric Vask", aldric), "any title, same person");
  assert.ok(!namesCharacter("Aldric", aldric), "a first name alone is not the full name");
  assert.ok(typedNameMatches("Sir Aldric Vask", "Aldric Vask"));
  assert.ok(typedNameMatches("Sir Aldric Vask", "sir aldric vask"));
  assert.ok(!typedNameMatches("Sir Aldric Vask", "Xan Quorble"));
});

test("the Kit takes a title, a first name and a last name, and refuses a title that is not one", () => {
  assert.equal(normalizeDisguiseName({ honorific: "sir", firstName: " Aldric ", lastName: "Vask" }, { gender: "MAN" }), "Sir Aldric Vask");
  assert.equal(normalizeDisguiseName({ honorific: "", firstName: "Bob", lastName: "" }), "Bob");
  assert.equal(normalizeDisguiseName({ honorific: "Emperor", firstName: "Bob" }), null);
  assert.equal(normalizeDisguiseName({ firstName: "  " }), null);
  assert.equal(normalizeDisguiseName("  Bob   Fakename "), "Bob Fakename", "one typed string from an older page");
});

test("only a Disguise Kit's forced name is a disguise; Apex Form's Beast is a public name", () => {
  assert.equal(disguiseNameFrom(xan.tags), "Sir Aldric Vask");
  assert.equal(disguiseNameFrom([beastTag()]), null);
  assert.equal(disguiseNameFrom([beastTag(), disguiseTag("Bob")]), null, "the first forced name wins, as forcedNameFrom's does");
  assert.equal(presentedIdentity(xan, { forcedName: "Sir Aldric Vask", disguised: true }).disguised, true);
  assert.equal(presentedIdentity(xan, { forcedName: "Beast" }).disguised, false);
});

// ------------------------------------------------------------- recognition

test("fooled, recognised, a stranger, or yourself", async () => {
  const db = fakeDb({ people: [aldric, xan, wren, mia, pell], entries: [knowsAldric, learnedBob] });
  const names = ["Sir Aldric Vask", "Bob Fakename"];
  const wrens = await readDisguises(db, "wren", names);
  assert.deepEqual(wrens.get("Sir Aldric Vask"), { known: true, fooledAs: "aldric", fooledLook: { age: 20, gender: "MAN" } });
  assert.equal(wrens.get("Bob Fakename").known, false);
  const pells = await readDisguises(db, "pell", names);
  assert.deepEqual(pells.get("Bob Fakename"), { known: true, fooledAs: null, fooledLook: null });
  assert.equal(pells.get("Sir Aldric Vask").known, false);
  const mias = await readDisguises(db, "mia", names);
  assert.equal(mias.get("Sir Aldric Vask").known, false);
  const own = await readDisguises(db, "aldric", ["Sir Aldric Vask"]);
  assert.deepEqual(own.get("Sir Aldric Vask"), { known: true, fooledAs: null, fooledLook: null }, "you are never fooled by your own name");
  assert.equal(await readDisguises(fakeDb({ anonymize: false }), "mia", names), null, "the rule off: everybody reads it");

  const room = await ownersWhoKnow(db, ["wren", "mia", "pell", "aldric"], "Sir Aldric Vask");
  assert.deepEqual([...room].sort(), ["aldric", "wren"]);
});

// ------------------------------------------------------------- who's here

test("a disguise is always under a token, named to who knows it and a stranger to the rest", async () => {
  const db = fakeDb({ people: [aldric, xan, wren, mia], entries: [knowsAldric] });

  const fooled = await whosHere(db, wren, { withHoodIds: true });
  assert.ok(!fooled.named.some((c) => c.characterId === "xan"), "never by id");
  const seen = fooled.concealed.find((c) => c.alias === "Sir Aldric Vask");
  assert.ok(seen, "Wren takes Xan for Aldric");
  assert.equal(seen.avatarPath, `/api/avatar/here/${seen.token}`, "Aldric's face, served per viewer");
  assert.equal(seen.roleGroup, null, "no job claimed, so no estate's colour, even to the fooled");
  assert.equal(seen.stranger, false);
  assert.equal(fooled.hoodIds.get(seen.token), "xan");

  const stranger = await whosHere(db, mia, { withHoodIds: true });
  const row = stranger.concealed.find((c) => c.token && stranger.hoodIds.get(c.token) === "xan");
  // Wren is a stranger to Mia too, so the two young men carry labels.
  assert.ok(row.alias.startsWith("a young man, "), row.alias);
  assert.equal(row.avatarPath, DISGUISE_STRANGER_FACE, "a blank face, never Xan's own");
  assert.equal(row.roleGroup, null);
  assert.equal(row.stranger, true);
  assert.ok(!JSON.stringify(stranger).includes("Quorble") && !JSON.stringify(stranger).includes("Aldric"));

  // Every verb reaches them by token, and a plain id is refused like a hood's.
  const none = { sightings: new Map() };
  assert.equal(await resolveHoodToken(db, mia, row.token, none), "xan");
  assert.equal(await hiddenFrom(db, mia, "xan", none), true);
  assert.equal(await hiddenFrom(db, wren, "xan", none), true, "even to somebody it fools");
});

test("the readout lists a disguise you can name with the names, not under 'Also here'", async () => {
  const db = fakeDb({ people: [aldric, xan, wren, mia], entries: [knowsAldric] });
  const lines = whosHereLines(await whosHere(db, wren));
  assert.ok(lines[0].startsWith("**Here:**") && lines[0].includes("Sir Aldric Vask"), lines.join(" / "));
  assert.ok(!lines.some((l) => l.startsWith("**Also here:**") && l.includes("Aldric")));
});

test("you see your own disguise as your name, and nobody to recognise with reads it too", async () => {
  const db = fakeDb({ people: [xan, mia] });
  const own = await whosHere(db, xan);
  assert.deepEqual(own.named.map((c) => c.name), ["Sir Aldric Vask"]);
  const gm = await whosHere(fakeDb({ people: [xan] }), { id: null, locationId: "loc" });
  assert.deepEqual(gm.named.map((c) => c.name), ["Sir Aldric Vask"]);
});

// ---------------------------------------------------------------- the lens

const line = (extra = {}) =>
  attachDisguised(
    attachSpeaker(
      {
        seq: "77",
        placeKey: "room:r1",
        turnNumber: 4,
        characterId: null,
        speakerKey: null,
        roleGroup: null,
        name: "Sir Aldric Vask",
        alias: "Sir Aldric Vask",
        avatarPath: "/assets/letters/S.webp",
        unknownFace: false,
        avatarVersion: null,
        content: '"Good morning."',
        ...extra,
      },
      "xan",
    ),
    true,
  );

test("a disguised line reads by what each reader makes of its name", async () => {
  const db = fakeDb({ people: [aldric, xan, wren, mia], entries: [knowsAldric] });
  db.voiceMemory = { findMany: async () => [{ subjectId: "xan", number: 2, live: true }] };

  const [asWren] = await createLens(db, { characterId: "wren" }).all([line()]);
  assert.equal(asWren.name, "Sir Aldric Vask");
  assert.equal(asWren.avatarPath, "/api/avatar/line/77", "Aldric's face, by the line");
  assert.equal(asWren.roleGroup, null, "no job claimed");
  assert.equal(asWren.speakerKey, sceneSpeakerKey("xan", "room:r1", 4));

  const [asMia] = await createLens(db, { characterId: "mia" }).all([line()]);
  assert.equal(asMia.name, "Young Man (2)", "a stranger, with Xan's own voice number");
  assert.equal(asMia.avatarPath, DISGUISE_STRANGER_FACE);
  assert.equal(asMia.characterId, null);
  assert.ok(!JSON.stringify(asMia).includes("Aldric") && !JSON.stringify(asMia).includes("Quorble"));

  const [asGm] = await createLens(db, { gm: true }).all([line()]);
  assert.equal(asGm.name, "Sir Aldric Vask");

  // Apex Form's Beast is untouched: a public name for everybody.
  const beast = attachSpeaker({ ...line(), name: "Beast", alias: "Beast" }, "xan");
  const [beastAsMia] = await createLens(db, { characterId: "mia" }).all([beast]);
  assert.equal(beastAsMia.name, "Beast");
});

test("the disguise flag never reaches the wire", () => {
  const shaped = line();
  assert.ok(!JSON.stringify(shaped).includes("disguised"));
  assert.equal(Object.getOwnPropertySymbols({ ...shaped }).length, 0);
});

test("a disguise types under a scene key, as an alias to a stranger", () => {
  const event = { placeKey: "room:r1", characterId: "xan", name: "Sir Aldric Vask", disguised: true, forced: true, alias: "Young Man" };
  const known = lensTyping(event, { characterId: "wren", disguiseKnown: true });
  assert.equal(known.name, "Sir Aldric Vask");
  assert.notEqual(known.characterId, "xan", "never the real id beside the false name");
  const stranger = lensTyping(event, { characterId: "mia", disguiseKnown: false });
  assert.equal(stranger.name, "Young Man");
});

test("a Highlight of a disguise keeps what its keeper saw", () => {
  const stored = { characterId: "xan", characterName: "Xan Quorble", concealedAlias: "Sir Aldric Vask", disguised: true, presentedAvatarPath: "/assets/letters/S.webp" };
  assert.deepEqual(keptSpeaker(stored, { alias: "Young Man" }), { name: "Young Man", avatarPath: null });
  assert.deepEqual(keptSpeaker(stored, { alias: "Sir Aldric Vask" }), { name: "Sir Aldric Vask", avatarPath: "/assets/letters/S.webp" });
});

test("a fight's announcement names a disguise only to who knows it", () => {
  const subjects = {
    text: "{0} attacks {1}!",
    people: [
      { id: "xan", name: "Sir Aldric Vask", alias: "a young man", masked: false, disguise: true },
      { id: "wren", name: "Wren Holt", alias: "a young man", masked: false },
    ],
  };
  const wrenReads = renderPeopleLine(subjects, { viewerId: "wren", knowsName: (n) => n === "Sir Aldric Vask" });
  assert.equal(wrenReads, "Sir Aldric Vask attacks Wren Holt!");
  const miaReads = renderPeopleLine(subjects, { viewerId: "mia", knows: () => true, knowsName: () => false });
  assert.equal(miaReads, "A young man attacks Wren Holt!");
});

// -------------------------------------------------------------------- DMs

test("a DM names a disguise the way its reader sees it", async () => {
  const db = fakeDb({ people: [aldric, xan, wren, mia], entries: [knowsAldric] });
  assert.deepEqual(await seenByMany(db, "wren", [xan]), ["Sir Aldric Vask"]);
  assert.deepEqual(await seenByMany(db, "mia", [xan]), ["a young man"]);
  assert.deepEqual(await seenByMany(db, "xan", [xan]), ["Sir Aldric Vask"], "yourself");
});

// ---------------------------------------------------------------- Intercept

test("a watch catches a disguise by the name it goes by, or as somebody unidentified", () => {
  const presented = presentedIdentity(xan, { forcedName: "Sir Aldric Vask", disguised: true });
  const byName = { targetNames: ["Aldric Vask"] };
  assert.equal(matchesArrival(byName, xan, presented, { disguiseKnown: true }), "name", "Wren's watch for Aldric stops the impostor");
  assert.equal(matchesArrival(byName, xan, presented, { disguiseKnown: false }), null);
  assert.equal(matchesArrival({ targetNames: ["Xan Quorble"] }, xan, presented, { disguiseKnown: true }), null, "the real name is under the disguise");
  assert.equal(matchesArrival({ anyUnidentified: true }, xan, presented, { disguiseKnown: false }), "anyUnidentified");
  assert.equal(matchesArrival({ anyUnidentified: true }, xan, presented, { disguiseKnown: true }), null);
  assert.equal(matchesArrival({ anyConcealed: true }, xan, presented, { disguiseKnown: false }), null, "nothing covers the face");

  // A public forced name is still unmatchable by name, as before.
  const beast = presentedIdentity(xan, { forcedName: "Beast" });
  assert.equal(matchesArrival({ targetNames: ["Beast"] }, xan, beast), null);
});

// ------------------------------------------------------------------ learning

test("hearing a made-up disguise's name makes a Friends entry tied to nobody", async () => {
  const listeners = [bob, mia, pell];
  const db = fakeDb({ people: listeners, entries: [{ ...learnedBob }] });
  const row = { placeKey: "conv:c1", content: '"They call me Bob Fakename."' };
  const { taught } = await learnFromSpeech(db, { row, speakerId: "bob" });
  assert.equal(taught, 1, "Mia learns it; Pell already had it");
  assert.deepEqual(db.writes, [
    { ownerId: "mia", subjectId: null, disguiseKey: "bob fakename", name: "Bob Fakename", roleText: null, roleSlug: null, source: "HEARD" },
  ]);
  const reads = await readDisguises(db, "mia", ["Bob Fakename"]);
  assert.equal(reads.get("Bob Fakename").known, true, "and now recognises the disguise");
});

test("a disguised speaker's real name teaches nothing, and the fooled learn no new entry", async () => {
  const db = fakeDb({ people: [aldric, xan, wren, mia], entries: [knowsAldric] });
  await learnFromSpeech(db, { row: { placeKey: "conv:c1", content: '"I am Xan."' }, speakerId: "xan" });
  assert.deepEqual(db.writes, [], "the real name is not on the face");
  await learnFromSpeech(db, { row: { placeKey: "conv:c1", content: '"I am Aldric."' }, speakerId: "xan" });
  assert.deepEqual(
    db.writes.map((w) => [w.ownerId, w.subjectId, w.disguiseKey]),
    [["mia", null, "aldric vask"]],
    "Wren already takes Xan for Aldric; Mia learns the disguise, not the real Aldric",
  );
});

test("somebody else can only teach a disguise's name if they know it", async () => {
  const db = fakeDb({ people: [bob, mia, pell] });
  await learnFromSpeech(db, { row: { placeKey: "conv:c1", content: '"Morning, Bob."' }, speakerId: "mia" });
  assert.deepEqual(db.writes, [], "Mia has never been told the name");
  const db2 = fakeDb({ people: [bob, mia, pell], entries: [{ ...learnedBob }] });
  await learnFromSpeech(db2, { row: { placeKey: "conv:c1", content: '"Morning, Bob."' }, speakerId: "pell" });
  assert.deepEqual(db2.writes.map((w) => w.ownerId), ["mia"]);
});

// ------------------------------------------------------- the wearer's own body

test("a title is worn in the form the wearer's own gender takes", () => {
  assert.equal(normalizeDisguiseName({ honorific: "Sir", firstName: "Aldric", lastName: "Vask" }, { gender: "WOMAN" }), "Dame Aldric Vask");
  assert.equal(normalizeDisguiseName({ honorific: "lady", firstName: "Ann", lastName: "Vask" }, { gender: "MAN" }), "Lord Ann Vask");
  assert.equal(normalizeDisguiseName({ honorific: "Father", firstName: "Ann" }, { gender: "NEUTRAL" }), "Reverend Ann");
  assert.equal(normalizeDisguiseName({ honorific: "Bishop", firstName: "Ann" }, { gender: "WOMAN" }), "Bishop Ann", "an ungendered title is itself");
  // The title never decides who is fooled, so Dame Aldric Vask still fools Aldric's friends.
  assert.ok(namesCharacter("Dame Aldric Vask", aldric));
});

test("looking alike is the same gender and the same age band", () => {
  assert.ok(looksAlike({ age: 20, gender: "MAN" }, { age: 24, gender: "MAN" }), "both young men");
  assert.ok(looksAlike({ age: 30, gender: "WOMAN" }, { age: 50, gender: "WOMAN" }), "both grown");
  assert.ok(!looksAlike({ age: 20, gender: "MAN" }, { age: 40, gender: "MAN" }), "young is not grown");
  assert.ok(!looksAlike({ age: 60, gender: "MAN" }, { age: 40, gender: "MAN" }), "old is not grown");
  assert.ok(!looksAlike({ age: 20, gender: "WOMAN" }, { age: 20, gender: "MAN" }));
  assert.ok(!looksAlike({ age: null, gender: "MAN" }, { age: 20, gender: "MAN" }), "an unknown age never passes");
});

test("the fooled see the real person's portrait only when the wearer looks like them", async () => {
  // Ada, a young woman, and Otto, an old man, both going by Aldric's name. Wren knows Aldric.
  const ada = person("ada", "Ada", "Venn", { gender: "WOMAN", tags: [disguiseTag("Sir Aldric Vask")] });
  const otto = person("otto", "Otto", "Brenn", { age: 70, tags: [disguiseTag("Sir Aldric Vask")] });
  for (const wearer of [ada, otto]) {
    const db = fakeDb({ people: [aldric, wearer, wren], entries: [knowsAldric] });
    const seen = (await whosHere(db, wren)).concealed[0];
    assert.equal(seen.alias, "Sir Aldric Vask", `${wearer.id}: still taken for Aldric by name`);
    assert.equal(seen.avatarPath, "/assets/letters/S.webp", `${wearer.id}: the name's plaque, not Aldric's face`);

    const [asWren] = await createLens(db, { characterId: "wren" }).all([attachSpeaker({ ...line(), seq: "78" }, wearer.id)]);
    assert.equal(asWren.name, "Sir Aldric Vask");
    assert.equal(asWren.avatarPath, "/assets/letters/S.webp", `${wearer.id}: the line keeps its plaque`);
  }
  // Xan is a young man, as Aldric is: the portrait.
  const db = fakeDb({ people: [aldric, xan, wren], entries: [knowsAldric] });
  const seen = (await whosHere(db, wren, { withHoodIds: true })).concealed[0];
  assert.equal(seen.avatarPath, `/api/avatar/here/${seen.token}`);
});

test("a stranger's alias for a disguise is the wearer's age and gender, never the named person's", async () => {
  const ada = person("ada", "Ada", "Venn", { gender: "WOMAN", tags: [disguiseTag("Sir Aldric Vask")] });
  const db = fakeDb({ people: [aldric, ada, mia] });
  const row = (await whosHere(db, mia)).concealed[0];
  assert.equal(row.alias, "a young woman");
  assert.deepEqual(await seenByMany(db, "mia", [ada]), ["a young woman"]);
});

// -------------------------------------------------------------------- jobs

test("a claimed job's estate is the colour everybody sees the disguise in", async () => {
  const cleric = person("xan", "Xan", "Quorble", { tags: [disguiseTag("Sir Aldric Vask", "bishop")] });
  assert.equal(disguiseJobFrom(cleric.tags), "bishop");
  assert.equal(disguiseJobFrom([beastTag()]), null);

  const db = fakeDb({ people: [aldric, cleric, wren, mia], entries: [knowsAldric] });
  const asWren = (await whosHere(db, wren)).concealed.find((c) => c.alias === "Sir Aldric Vask");
  assert.equal(asWren.roleGroup, "clergy", "fooled");
  const asMia = (await whosHere(db, mia)).concealed.find((c) => c.stranger && c.avatarPath === DISGUISE_STRANGER_FACE);
  assert.equal(asMia.roleGroup, "clergy", "a stranger sees the same colour");

  // A line freezes it, and the lens keeps it for every reader.
  const shaped = feedRowShape({
    seq: 90n,
    placeKey: "room:r1",
    turnNumber: 4,
    characterId: "xan",
    characterName: "Xan Quorble",
    concealedAlias: "Sir Aldric Vask",
    disguised: true,
    disguiseGroup: "clergy",
    presentedAvatarPath: "/assets/letters/S.webp",
    content: "hello",
  }, { roleGroup: "court" });
  assert.equal(shaped.roleGroup, "clergy", "the job's, never the wearer's own court");
  const [lineAsMia] = await createLens(db, { characterId: "mia" }).all([shaped]);
  assert.equal(lineAsMia.roleGroup, "clergy");
  const [lineAsWren] = await createLens(db, { characterId: "wren" }).all([shaped]);
  assert.equal(lineAsWren.roleGroup, "clergy");

  // An uncoloured estate is no colour.
  const drifter = person("xan", "Xan", "Quorble", { tags: [disguiseTag("Bob Fakename", "migrant")] });
  const plain = await whosHere(fakeDb({ people: [drifter, mia] }), mia);
  assert.equal(plain.concealed[0].roleGroup, null);
});

test("hearing a disguise's job said with its name teaches it, like any role", async () => {
  const cleric = person("bob", "Tam", "Rook", { tags: [disguiseTag("Bob Fakename", "bishop")] });
  const db = fakeDb({ people: [cleric, mia, pell], entries: [{ ...learnedBob }] });
  await learnFromSpeech(db, { row: { placeKey: "conv:c1", content: '"I am Bob Fakename, the Bishop."' }, speakerId: "bob" });
  const mias = db.entries.find((e) => e.ownerId === "mia");
  assert.deepEqual([mias.name, mias.roleText, mias.roleSlug, mias.subjectId], ["Bob Fakename", "Bishop", "bishop", null]);
  const pells = db.entries.find((e) => e.ownerId === "pell");
  assert.deepEqual([pells.roleText, pells.roleSlug], ["Bishop", "bishop"], "an entry learned earlier gets the job filled in");

  // The wearer's real seat is never what a disguise teaches.
  const db2 = fakeDb({ people: [cleric, mia] });
  await learnFromSpeech(db2, { row: { placeKey: "conv:c1", content: '"I am Bob Fakename, a Courtier."' }, speakerId: "bob" });
  assert.equal(db2.entries.find((e) => e.ownerId === "mia").roleText, null);
});
