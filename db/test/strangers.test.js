// Strangers (docs/systemdocs/STRANGERS.md): what counts as speech, the labels
// that tell lookalikes apart, and the per-reader lens on the feed. Pure, or
// against small fakes; hearVoice and the rolls against a real database are
// covered by the branch's end-to-end check instead.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_SECRET ||= "test-secret-for-hood-tokens";

const { spokenText, hasSpeech } = require("../lib/speech");
const {
  STRANGER_LABELS,
  pickLabel,
  labelAliases,
  settlePresence,
  attachSpeaker,
  createLens,
  lensRow,
  keptSpeaker,
  lensTyping,
  knownSubjects,
} = require("../lib/strangers");
const { hoodToken, sceneSpeakerKey } = require("../lib/hoodToken");
const { whosHere } = require("../lib/whosHere");
const { lessonsFrom } = require("../lib/memoryLessons");

// ------------------------------------------------------------------ speech

test("only words inside quotation marks are speech", () => {
  assert.equal(spokenText('"Hello there," he said.'), "Hello there,");
  assert.equal(spokenText("*nods at the door*"), "");
  assert.equal(hasSpeech("*nods at the door*"), false);
  assert.equal(spokenText('she says "Hi." then "bye"'), "Hi.\nbye");
  assert.equal(spokenText("“curly” works too"), "curly");
});

test("the browser's rules for a quote hold here too", () => {
  // A lone mark mid-sentence is punctuation, not a quote.
  assert.equal(hasSpeech('he said " and left'), false);
  // An opening mark must sit against a word.
  assert.equal(hasSpeech('" spaced"'), false);
  // No line break inside a quote.
  assert.equal(hasSpeech('"one\ntwo"'), false);
  // Two marks with nothing between are not a quote.
  assert.equal(hasSpeech('""'), false);
  // No length cap: a long speech is still speech.
  assert.equal(hasSpeech(`"${"x".repeat(5000)}"`), true);
  // Code is literal.
  assert.equal(hasSpeech('`"not speech"`'), false);
});

test("no character inside a quote stops it being speech", () => {
  // A phone types an opening “ after a dash, so a cut-off line ends on one.
  assert.equal(spokenText("“Wait-“ he said"), "Wait-");
  assert.equal(spokenText('"Wait-" he said'), "Wait-");
  assert.equal(spokenText("”Backwards”"), "Backwards");
  assert.equal(spokenText("„Hallo“"), "Hallo");
  for (const ch of "-—–…!?*_~|#>+=.,:;'`\\/()[]{}<>@&%$^😀") {
    assert.equal(hasSpeech(`"Wait${ch}"`), true, `ends on ${ch}`);
    assert.equal(hasSpeech(`"${ch}wait"`), true, `starts on ${ch}`);
  }
  assert.equal(spokenText('"`code`"'), "`code`");
});

test("a name said only in narration teaches nothing", () => {
  const marrow = { id: "m", firstName: "Marrow", lastName: "Kell", name: "Marrow Kell", roleTitle: "Sheriff", role: { slug: "sheriff", name: "Sheriff" } };
  const lessons = (content) => lessonsFrom({ content: spokenText(content), speaker: marrow, candidates: [marrow] });
  assert.deepEqual(lessons("*Marrow waves*"), []);
  assert.equal(lessons('"I\'m Marrow."').length, 1);
});

// ------------------------------------------------------------------ labels

test("a label comes off Bascinet's list, and never one somebody here holds", () => {
  assert.equal(STRANGER_LABELS.length, 11);
  assert.ok(STRANGER_LABELS.includes("in front"), "the doc's \"Infront\" reads as two words");
  const taken = new Set(STRANGER_LABELS.slice(0, 10));
  assert.equal(pickLabel(taken, () => 0.99), STRANGER_LABELS[10]);
  // All eleven gone: a crowded room repeats one rather than giving none.
  assert.ok(STRANGER_LABELS.includes(pickLabel(new Set(STRANGER_LABELS), () => 0.5)));
});

test("a label shows only when somebody else in the list looks the same", () => {
  const rows = [
    { alias: "a young man", label: "hunched" },
    { alias: "a young man", label: "on the left" },
    { alias: "an old woman", label: "fidgeting" },
  ];
  assert.deepEqual(
    labelAliases(rows, (r) => r.alias, (r) => r.label),
    ["a young man, hunched", "a young man, on the left", "an old woman"],
  );
});

function presenceFake(rows) {
  const writes = [];
  return {
    writes,
    character: {
      updateMany: async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id && (r.presenceNonce ?? null) === where.presenceNonce);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        writes.push({ id: where.id, ...data });
        return { count: 1 };
      },
      findUnique: async ({ where }) => rows.find((r) => r.id === where.id) ?? null,
    },
  };
}

test("stale labels are rolled, avoiding the ones already held here", async () => {
  const rows = [
    { id: "a", status: "ALIVE", presenceLabel: "hunched", presenceNonce: "n-a", presenceHidden: false },
    { id: "b", status: "ALIVE", presenceLabel: null, presenceNonce: null, presenceHidden: null },
  ];
  const db = presenceFake(rows.map((r) => ({ ...r })));
  await settlePresence(db, rows, () => false, { random: () => 0 });
  assert.equal(rows[0].presenceLabel, "hunched", "a fresh label is left alone");
  assert.equal(rows[1].presenceLabel, STRANGER_LABELS[0]);
  assert.notEqual(rows[1].presenceLabel, "hunched");
  assert.ok(rows[1].presenceNonce);
  assert.equal(rows[1].presenceHidden, false);
});

test("covering the face rolls a new label and a new nonce", async () => {
  const rows = [{ id: "a", status: "ALIVE", presenceLabel: "hunched", presenceNonce: "n-a", presenceHidden: false }];
  const db = presenceFake(rows.map((r) => ({ ...r })));
  await settlePresence(db, rows, () => true, { random: () => 0 });
  assert.notEqual(rows[0].presenceNonce, "n-a");
  assert.equal(rows[0].presenceHidden, true);
});

test("two readers rolling at once agree on one label", async () => {
  const stored = [{ id: "a", status: "ALIVE", presenceLabel: null, presenceNonce: null, presenceHidden: null }];
  const db = presenceFake(stored);
  const first = [{ ...stored[0] }];
  const second = [{ ...stored[0] }];
  await settlePresence(db, first, () => false, { random: () => 0 });
  await settlePresence(db, second, () => false, { random: () => 0.99 });
  assert.equal(second[0].presenceLabel, first[0].presenceLabel, "the loser takes the winner's roll");
  assert.equal(second[0].presenceNonce, first[0].presenceNonce);
});

// ------------------------------------------------------------- who's here

const PLAIN = { status: "ALIVE", updatedAt: new Date(1700000000000), roleTitle: null, concealed: false, tags: [] };
const person = (id, name, extra = {}) => ({
  ...PLAIN,
  id,
  name,
  age: 20,
  gender: "MAN",
  role: { groupSlug: "court" },
  presenceLabel: null,
  presenceNonce: null,
  presenceHidden: null,
  ...extra,
});

function roomFake(rows, knownIds) {
  return {
    character: {
      findMany: async () => rows,
      updateMany: async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id && (r.presenceNonce ?? null) === where.presenceNonce);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      findUnique: async ({ where }) => rows.find((r) => r.id === where.id) ?? null,
    },
    acquaintance: {
      findMany: async ({ where }) => knownIds.filter((id) => where.subjectId.in.includes(id)).map((subjectId) => ({ subjectId })),
    },
    locationLink: { findMany: async () => [] },
    performance: { findMany: async () => [] },
    archiveEntry: { findMany: async () => [], groupBy: async () => [] },
    turn: { findFirst: async () => null },
  };
}

const viewer = { id: "viewer", locationId: "loc" };

test("a face the viewer has no Friends entry for is listed as what it looks like", async () => {
  const rows = [person("friend", "Ada Vell"), person("s1", "Una Stray"), person("s2", "Bran Holt")];
  const { named, concealed, hoodIds } = await whosHere(roomFake(rows, ["friend"]), viewer, { withHoodIds: true });

  assert.deepEqual(named.map((c) => c.name), ["Ada Vell"]);
  assert.equal(concealed.length, 2);
  for (const row of concealed) {
    assert.ok(row.alias.startsWith("a young man, "), `two lookalikes each carry a label: ${row.alias}`);
    assert.ok(!row.alias.includes("Una") && !row.alias.includes("Bran"));
    assert.equal(row.stranger, true);
    assert.equal(row.roleGroup, "court", "a stranger's estate colour is as public as anyone's");
    assert.equal(row.avatarPath, `/api/avatar/here/${row.token}`, "their own face, by token");
  }
  assert.notEqual(concealed[0].alias, concealed[1].alias);
  // Tokens carry the rolled nonce, and still resolve to the right people.
  assert.deepEqual([...hoodIds.values()].sort(), ["s1", "s2"]);
  for (const [token, id] of hoodIds) {
    const row = rows.find((r) => r.id === id);
    assert.equal(token, hoodToken(id, row.presenceNonce));
    assert.notEqual(token, hoodToken(id), "never the stable token");
  }
});

test("somebody alone under their alias carries no label", async () => {
  const rows = [person("s1", "Una Stray"), person("w1", "Old Wen", { age: 70, gender: "WOMAN" })];
  const { concealed } = await whosHere(roomFake(rows, []), viewer);
  assert.deepEqual(concealed.map((c) => c.alias).sort(), ["a young man", "an old woman"]);
});

test("with no viewer to recognise with, nobody is a stranger", async () => {
  assert.equal(await knownSubjects(roomFake([], []), null, ["a"]), null);
  const { named } = await whosHere(roomFake([person("s1", "Una Stray")], []), { id: null, locationId: "loc" });
  assert.deepEqual(named.map((c) => c.name), ["Una Stray"]);
});

// --------------------------------------------------------------- the lens

const row = (extra = {}) =>
  attachSpeaker(
    {
      seq: "42",
      placeKey: "room:r1",
      turnNumber: 7,
      characterId: "s1",
      speakerKey: null,
      roleGroup: "court",
      name: "Una Stray",
      alias: null,
      avatarPath: null,
      unknownFace: false,
      avatarVersion: 123,
      content: '"Hello."',
      ...extra,
    },
    extra.speaker ?? "s1",
  );

const facts = (entries) => new Map(entries);

test("a stranger's line reads under their alias, with this reader's voice number", () => {
  const lens = {
    characterId: "viewer",
    facts: facts([["s1", { known: false, voice: { number: 3, live: true }, age: 20, gender: "WOMAN" }]]),
  };
  const out = lensRow(row(), lens);
  assert.equal(out.name, "Young Woman (3)");
  assert.equal(out.alias, "Young Woman");
  assert.equal(out.characterId, null, "no id for somebody the reader cannot name");
  assert.equal(out.avatarPath, "/api/avatar/line/42", "the face, by line");
  assert.equal(out.avatarVersion, null);
  assert.equal(out.roleGroup, "court");
  assert.equal(out.speakerKey, sceneSpeakerKey("s1", "room:r1", 7));
  assert.ok(!JSON.stringify(out).includes("Una"));
});

test("a number goes dark when the speaker moves, and a friend is just themselves", () => {
  const dark = { characterId: "viewer", facts: facts([["s1", { known: false, voice: { number: 3, live: false }, age: 20, gender: "MAN" }]]) };
  assert.equal(lensRow(row(), dark).name, "Young Man");

  const friend = { characterId: "viewer", facts: facts([["s1", { known: true, voice: null }]]) };
  const out = lensRow(row(), friend);
  assert.equal(out.name, "Una Stray");
  assert.equal(out.characterId, "s1");
});

test("a hood keeps its alias, gains the number, and loses the stable key", () => {
  const hooded = row({ characterId: null, name: "Young Man", alias: "Young Man", speakerKey: hoodToken("s1") });
  const lens = { characterId: "viewer", facts: facts([["s1", { known: true, voice: { number: 1, live: true } }]]) };
  const out = lensRow(hooded, lens);
  assert.equal(out.name, "Young Man (1)", "known or not, a hood is an alias");
  assert.notEqual(out.speakerKey, hoodToken("s1"));
});

test("your own lines, and a GM's view, are left as they were built", () => {
  const own = row({ speaker: "viewer", characterId: "viewer" });
  assert.equal(lensRow(own, { characterId: "viewer", facts: new Map() }).name, "Una Stray");
  const gm = lensRow(row(), { gm: true, characterId: null, facts: new Map() });
  assert.equal(gm.name, "Una Stray");
  assert.equal(gm.characterId, "s1");
});

test("a forced name stays the name everyone reads", () => {
  const beast = row({ characterId: null, name: "Beast", alias: "Beast", speakerKey: hoodToken("s1") });
  const out = lensRow(beast, { characterId: "viewer", facts: facts([["s1", { known: false }]]) });
  assert.equal(out.name, "Beast");
  assert.notEqual(out.speakerKey, hoodToken("s1"));
});

test("the real speaker never serialises", () => {
  // A hooded row as built: no id on it, and the hidden speaker stays hidden
  // even if the row were sent without the lens.
  const shaped = row({ characterId: null, name: "Young Man", alias: "Young Man" });
  assert.ok(!JSON.stringify(shaped).includes("s1"));
  const copy = { ...shaped };
  assert.equal(Object.getOwnPropertySymbols(copy).length, 0, "a spread copy drops it");
});

// A Highlight (web/lib/starNote.js) is filed under the name its keeper saw on
// the line. `stored` is the ArchiveEntry as written; the second argument is the
// same line through the keeper's lens.
const stored = (extra = {}) => ({
  characterId: "s1",
  characterName: "Una Stray",
  concealedAlias: null,
  presentedAvatarPath: null,
  ...extra,
});

test("a kept line from a stranger is filed under their alias, with no face and no number", () => {
  const lens = {
    characterId: "viewer",
    facts: facts([["s1", { known: false, voice: { number: 3, live: true }, age: 20, gender: "WOMAN" }]]),
  };
  assert.deepEqual(keptSpeaker(stored(), lensRow(row(), lens)), { name: "Young Woman", avatarPath: null });
});

test("a kept line from a friend, or your own, keeps the name", () => {
  const friend = { characterId: "viewer", facts: facts([["s1", { known: true, voice: null }]]) };
  assert.deepEqual(keptSpeaker(stored(), lensRow(row(), friend)), { name: "Una Stray", avatarPath: null });
  const own = row({ speaker: "viewer", characterId: "viewer" });
  const mine = keptSpeaker(stored({ characterId: "viewer" }), lensRow(own, { characterId: "viewer", facts: new Map() }));
  assert.equal(mine.name, "Una Stray");
});

test("a kept line said under a hood or a forced name keeps that name and the face the room saw", () => {
  const helm = "/assets/helms/hood.webp";
  const hooded = stored({ concealedAlias: "Young Man", presentedAvatarPath: helm });
  const friend = { characterId: "viewer", facts: facts([["s1", { known: true }]]) };
  const shown = lensRow(row({ characterId: null, name: "Young Man", alias: "Young Man" }), friend);
  assert.deepEqual(keptSpeaker(hooded, shown), { name: "Young Man", avatarPath: helm }, "a friend's hood is still a hood");
  const beast = stored({ concealedAlias: "Beast", presentedAvatarPath: "/assets/letters/b.webp" });
  assert.equal(keptSpeaker(beast, null).name, "Beast");
});

test("createLens reads every speaker in a batch in one round", async () => {
  let calls = 0;
  const db = {
    acquaintance: { findMany: async () => (calls++, [{ subjectId: "k1" }]) },
    // Nobody here is a Skinless (db/lib/skinless.js).
    characterTag: { findMany: async () => [] },
    voiceMemory: { findMany: async () => [{ subjectId: "s1", number: 2, live: true }] },
    character: { findMany: async () => [{ id: "s1", age: 60, gender: "MAN" }, { id: "k1", age: 30, gender: "WOMAN" }] },
  };
  const lens = createLens(db, { characterId: "viewer" });
  const out = await lens.all([row(), row({ speaker: "k1", characterId: "k1", name: "Kay" })]);
  assert.equal(calls, 1);
  assert.equal(out[0].name, "Old Man (2)");
  assert.equal(out[1].name, "Kay");
});

test("typing: a stranger types as their alias, under a key that is not their id", () => {
  const event = { placeKey: "room:r1", characterId: "s1", name: "Una Stray", hidden: false, forced: false, alias: "Young Woman" };
  const shown = lensTyping(event, { characterId: "viewer", known: new Set() });
  assert.equal(shown.name, "Young Woman");
  assert.notEqual(shown.characterId, "s1");
  assert.deepEqual(Object.keys(shown).sort(), ["characterId", "name", "placeKey"]);

  const friend = lensTyping(event, { characterId: "viewer", known: new Set(["s1"]) });
  assert.equal(friend.name, "Una Stray");

  const hood = lensTyping({ ...event, name: "Young Woman", hidden: true }, { characterId: "viewer", known: new Set(["s1"]) });
  assert.notEqual(hood.characterId, "s1", "a hood's id never rides a typing notice");
});

// ------------------------------------------------ the GM's switch (§9)

const switchedOff = (db) => ({ ...db, gameConfig: { findUnique: async () => ({ anonymizeStrangers: false }) } });

test("switched off, nobody is a stranger: knownSubjects says the rule does not apply", async () => {
  assert.equal(await knownSubjects(switchedOff(roomFake([], [])), "viewer", ["s1"]), null);
  const on = { ...roomFake([], []), gameConfig: { findUnique: async () => ({ anonymizeStrangers: true }) } };
  assert.deepEqual([...(await knownSubjects(on, "viewer", ["s1"]))], ["viewer"]);
  const noRow = { ...roomFake([], []), gameConfig: { findUnique: async () => null } };
  assert.notEqual(await knownSubjects(noRow, "viewer", ["s1"]), null, "a missing row counts as on");
});

test("switched off, Who's here names every uncovered face, and a hood stays a hood", async () => {
  const hoodTag = { quantity: 1, equipped: true, tag: { slug: "plebeian-hood", name: "Plebeian Hood", concealsIdentity: true, concealSprite: "hood" } };
  const rows = [person("s1", "Una Stray"), person("h1", "Hal Hidden", { tags: [hoodTag], concealed: true })];
  const { named, concealed } = await whosHere(switchedOff(roomFake(rows, [])), viewer);
  assert.deepEqual(named.map((c) => c.name), ["Una Stray"]);
  assert.equal(concealed.length, 1);
  assert.ok(!concealed[0].alias.includes("Hal"), "the hood still hides who is under it");
});

test("switched off, the lens shows a bare face by name, and a hood keeps its alias and number", async () => {
  const db = switchedOff({
    acquaintance: { findMany: async () => [] },
    voiceMemory: { findMany: async () => [{ subjectId: "s1", number: 2, live: true }, { subjectId: "h1", number: 3, live: true }] },
    characterTag: { findMany: async () => [] },
    character: { findMany: async () => [{ id: "s1", age: 60, gender: "MAN" }, { id: "h1", age: 20, gender: "MAN" }] },
  });
  const lens = createLens(db, { characterId: "viewer" });
  const hooded = row({ speaker: "h1", characterId: null, name: "Young Man", alias: "Young Man", speakerKey: hoodToken("h1") });
  const [bare, hood] = await lens.all([row(), hooded]);
  assert.equal(bare.name, "Una Stray");
  assert.equal(bare.characterId, "s1");
  assert.equal(hood.name, "Young Man (3)");
});

test("switched off, a DM names the unknown face", async () => {
  const { seenBy } = require("../lib/intercept");
  const target = { id: "s1", name: "Una Stray", age: 20, gender: "MAN", concealed: false, tags: [] };
  const db = { acquaintance: { findMany: async () => [] } };
  assert.equal(await seenBy(db, "viewer", target), "a young man");
  assert.equal(await seenBy(switchedOff(db), "viewer", target), "Una Stray");
});
