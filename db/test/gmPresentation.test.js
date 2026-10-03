// What a GM is told about a face (db/lib/gmPresentation.js): hooded, disguised, a public name or a
// masked body, frozen onto a row when somebody acts and read back on the desk.
const test = require("node:test");
const assert = require("node:assert");
const {
  presentationOf,
  stampPresentation,
  readStamp,
  lookPair,
  loadLooks,
  loadPresentations,
  lookText,
  lookWord,
  sameLook,
  lineKindWord,
} = require("../lib/gmPresentation");
const { lineLookKind } = require("../lib/archive");

const HOOD = {
  tagId: "hood",
  equipped: true,
  tag: { name: "Plague Mask", slug: "plague-mask", concealsIdentity: true, concealSprite: "plague", equipSlot: "HEAD" },
};
const SACK = {
  tagId: "sack",
  equipped: true,
  tag: { name: "Sack Hood", slug: "sack-hood", concealsIdentity: true, concealSprite: "sack", forcesConceal: true, equipSlot: "HEAD" },
};
const disguise = (job = {}) => ({
  tagId: "dis",
  equipped: false,
  tag: { forcedName: "Sir Aldric Vask", slug: "custom-disguise-1", disguiseJob: null, disguiseJobSlug: null, ...job },
});
const BEAST = { tagId: "apex", equipped: false, tag: { forcedName: "Beast", slug: "apex-form" } };

const person = (over = {}) => ({ id: "c1", name: "Ann Rowe", status: "ALIVE", age: 22, gender: "WOMAN", concealed: false, tags: [], ...over });

test("a bare face has no presentation", () => {
  assert.equal(presentationOf(person()), null);
  assert.equal(presentationOf(null), null);
});

test("a hood owned but down is their own face", () => {
  assert.equal(presentationOf(person({ tags: [HOOD] })), null);
});

test("a hood up reads as the alias, under the piece", () => {
  const p = presentationOf(person({ concealed: true, tags: [HOOD] }));
  assert.equal(p.kind, "hood");
  assert.equal(p.shownAs, "a young woman");
  assert.equal(p.item, "Plague Mask");
  assert.equal(p.under, null);
  assert.equal(lookText(p), "hooded: a young woman, under a Plague Mask");
});

test("a piece that forces the hood is up whatever the switch says", () => {
  assert.equal(presentationOf(person({ concealed: false, tags: [SACK] })).kind, "hood");
});

test("a disguise reads its name and the job it claims", () => {
  const p = presentationOf(person({ tags: [disguise({ disguiseJob: "Steward", disguiseJobSlug: "steward" })] }));
  assert.equal(p.kind, "disguise");
  assert.equal(p.shownAs, "Sir Aldric Vask");
  assert.deepEqual(p.job, { name: "Steward", slug: "steward" });
  assert.equal(lookText(p), "disguised as Sir Aldric Vask (Steward)");
  assert.equal(lookWord(p), "disguised");
});

test("a made-up job has a name and no seat; no job is null", () => {
  assert.deepEqual(presentationOf(person({ tags: [disguise({ disguiseJob: "Grand Poobah" })] })).job, {
    name: "Grand Poobah",
    slug: null,
  });
  assert.equal(presentationOf(person({ tags: [disguise()] })).job, null);
});

test("a hood over a disguise is a hood, with the disguise kept for the GM underneath", () => {
  const p = presentationOf(person({ concealed: true, tags: [disguise({ disguiseJob: "Steward" }), HOOD] }));
  assert.equal(p.kind, "hood");
  assert.equal(p.under, "Sir Aldric Vask");
  assert.deepEqual(p.underJob, { name: "Steward", slug: null });
  assert.match(lookText(p), /disguised as Sir.Aldric Vask \(Steward\) beneath it$/);
  assert.equal(lookWord(p), "hooded, disguised");
});

test("Apex Form's Beast is a public name, not a disguise", () => {
  const p = presentationOf(person({ tags: [BEAST] }));
  assert.equal(p.kind, "forced");
  assert.equal(lookText(p), "goes by Beast");
});

test("a body is masked only by what it died in, and only while it still holds it", () => {
  const worn = { ...HOOD, equipped: false };
  const dead = person({ status: "DEAD", concealed: true, deathMaskTagId: "hood", tags: [worn, disguise()] });
  const p = presentationOf(dead);
  assert.equal(p.kind, "deathmask");
  assert.equal(p.item, "Plague Mask");
  // Looted: the mask is gone, and a corpse goes by its own name, disguise or not.
  assert.equal(presentationOf({ ...dead, tags: [disguise()] }), null);
});

test("a stamp round-trips, and a bad blob reads as no stamp", () => {
  const p = presentationOf(person({ concealed: true, tags: [disguise({ disguiseJob: "Steward", disguiseJobSlug: "steward" }), HOOD] }));
  const stamp = stampPresentation(p);
  assert.equal(stamp.v, 1);
  const back = readStamp(JSON.parse(JSON.stringify(stamp)));
  assert.equal(back.kind, "hood");
  assert.equal(back.under, "Sir Aldric Vask");
  assert.deepEqual(back.underJob, { name: "Steward", slug: "steward" });
  assert.equal(stampPresentation(null), null);
  for (const bad of [null, undefined, "hood", [], {}, { v: 2, kind: "hood" }, { v: 1, kind: "wig" }]) {
    assert.equal(readStamp(bad), null, JSON.stringify(bad));
  }
});

test("lookPair: frozen and live, with the frozen job painted in its estate", () => {
  const stamp = stampPresentation(presentationOf(person({ tags: [disguise({ disguiseJob: "Steward", disguiseJobSlug: "steward" })] })));
  const looks = { now: new Map(), groupBySlug: new Map([["steward", "court"]]) };
  const pair = lookPair(stamp, "c1", looks);
  assert.equal(pair.then.kind, "disguise");
  assert.equal(pair.then.job.group, "court");
  assert.equal(pair.now, null);
  assert.equal(sameLook(pair.then, pair.now), false);
  // No moment to freeze (an inspector, a roster): only today's look ships.
  assert.deepEqual(Object.keys(lookPair(undefined, "c1", looks)), ["now"]);
  // A row from before the stamp reads as no frozen look.
  assert.equal(lookPair(null, "c1", looks).then, null);
});

test("sameLook ignores the piece and the job, and only cares what the room read", () => {
  assert.equal(sameLook(null, null), true);
  assert.equal(sameLook({ kind: "hood", shownAs: "a young man", item: "A" }, { kind: "hood", shownAs: "a young man", item: "B" }), true);
  assert.equal(sameLook({ kind: "hood", shownAs: "a young man" }, { kind: "disguise", shownAs: "a young man" }), false);
  assert.equal(sameLook({ kind: "hood", shownAs: "a young man" }, null), false);
});

test("an archived line's alias is told apart by what the row froze", () => {
  assert.equal(lineLookKind({ concealedAlias: null }), null);
  assert.equal(lineLookKind({ concealedAlias: "Sir Aldric Vask", disguised: true }), "disguise");
  assert.equal(lineLookKind({ concealedAlias: "Young Man", presentedAvatarPath: "/assets/helms/plague.webp" }), "hood");
  assert.equal(lineLookKind({ concealedAlias: "Beast", presentedAvatarPath: "/assets/letters/B.webp" }), "forced");
  assert.equal(lineKindWord("disguise"), "in disguise");
  assert.equal(lineKindWord(null), null);
});

// A fake client that answers the two queries loadLooks/loadPresentations make.
function fakeDb(characters, roles = []) {
  const calls = { character: 0, role: 0 };
  return {
    calls,
    character: {
      findMany: async ({ where }) => {
        calls.character += 1;
        return characters.filter((c) => where.id.in.includes(c.id));
      },
    },
    role: {
      findMany: async ({ where }) => {
        calls.role += 1;
        return roles.filter((r) => where.slug.in.includes(r.slug));
      },
    },
  };
}

test("loadPresentations: one query, nobody bare in the map, jobs painted", async () => {
  const db = fakeDb(
    [
      person({ id: "a" }),
      person({ id: "b", concealed: true, tags: [HOOD] }),
      person({ id: "c", tags: [disguise({ disguiseJob: "Steward", disguiseJobSlug: "steward" })] }),
    ],
    [{ slug: "steward", name: "Steward", groupSlug: "court" }],
  );
  const looks = await loadPresentations(db, ["a", "b", "c", "a", null]);
  assert.deepEqual([...looks.keys()].sort(), ["b", "c"]);
  assert.equal(looks.get("c").job.group, "court");
  assert.equal(db.calls.character, 1);
  assert.equal(db.calls.role, 1);
  assert.equal((await loadPresentations(db, [])).size, 0);
});

test("loadLooks paints the jobs frozen on stamps too", async () => {
  const stamp = stampPresentation(presentationOf(person({ tags: [disguise({ disguiseJob: "Steward", disguiseJobSlug: "steward" })] })));
  const db = fakeDb([person({ id: "c1" })], [{ slug: "steward", name: "Steward", groupSlug: "court" }]);
  const looks = await loadLooks(db, { ids: ["c1"], stamps: [stamp] });
  assert.equal(looks.now.size, 0);
  assert.equal(looks.groupBySlug.get("steward"), "court");
});
