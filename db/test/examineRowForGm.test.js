// What a GM's hover card reads off a line (db/lib/examineRow.js#examineRowForGm):
// the room's view of the speaker, frozen at the line, with no body behind the
// look. So no memories are read, a hood still reads as the hood, the chips are
// the ones the line froze, and the GM's own zones are the gate. Run with
// `npm test --workspace=db`. No database: the zone gate and the wipe floor are
// stubbed in the require cache, and Prisma is a hand-made fake.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { presentedStateFrom } = require("../lib/examineSnapshot");

const gateCalls = [];
function stub(rel, exports) {
  const file = require.resolve(path.join("..", "lib", rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: { ...require(file), ...exports } };
}
stub("feedAccess", {
  // The GM "gm1" watches loc:square and nothing else.
  mayReadPlace: async (_prisma, viewer, placeKey, options) => {
    gateCalls.push({ viewer, placeKey, options });
    return Boolean(options?.gm) && options.discordUserId === "gm1" && placeKey === "loc:square";
  },
});
stub("feedWipe", { feedWipeFloors: async () => ({ turn: 0n, summary: 0n, persist: 0n }), floorForPlace: () => 0n });

const { examineRowForGm } = require("../lib/examineRow");

const HOOD = {
  name: "Sackcloth Hood",
  slug: "hood",
  category: "Items",
  inspectVisibility: "WORN",
  concealsIdentity: true,
  concealSprite: "hood.webp",
  forcesConceal: false,
  equipLayer: 3,
  requirementSkills: [],
};
const DAGGER = { name: "Dagger", slug: "dagger", category: "Items", inspectVisibility: "WORN", requirementSkills: [] };

const held = (tag, equipped = true) => ({ tagId: tag.slug, equipped, expiresTurn: null, quantity: 1, tag });

// One line, said by Ivo, hooded or not, with what the room saw frozen onto it.
function fakePrisma({ hooded = false, placeKey = "loc:square" } = {}) {
  const tags = [held(DAGGER), ...(hooded ? [held(HOOD)] : [])];
  const state = presentedStateFrom({ name: "Ivo Brandt", appearance: "Heavyset.", concealed: hooded, tags });
  return {
    archiveEntry: {
      findUnique: async () => ({
        kind: "MESSAGE",
        seq: 5n,
        turnNumber: 9,
        characterId: "ivo",
        concealedAlias: hooded ? "Man" : null,
        disguised: false,
        presentedAvatarPath: hooded ? "/assets/helms/hood.webp" : null,
        presentedState: state,
        deletedAt: null,
        placeKey,
      }),
    },
    turn: { findFirst: async () => ({ number: 9, dayNumber: 3 }) },
    character: {
      findUnique: async () => ({ id: "ivo", name: "Ivo Brandt", age: 44, gender: "MAN", updatedAt: new Date(0) }),
    },
    tag: { findMany: async () => tags.map((ct) => ({ id: ct.tag.slug, ...ct.tag })) },
    desire: { findFirst: async () => null },
    // A GM has no Friends list; reading one would be a bug.
    acquaintance: {
      findUnique: async () => {
        throw new Error("a GM's look read somebody's memories");
      },
    },
    gameConfig: { findUnique: async () => ({ anonymizeStrangers: true }) },
  };
}

test("a named line reads the speaker's name and the gear the room saw", async () => {
  const look = await examineRowForGm(fakePrisma(), "gm1", "5");
  assert.equal(look.readout.name, "Ivo Brandt");
  assert.equal(look.readout.concealed, false);
  assert.deepEqual(
    look.readout.tags.map((t) => t.name),
    ["Dagger"],
  );
  // Not a stranger to a GM, whatever the stranger switch says.
  assert.equal(look.readout.avatarPath?.startsWith("/api/avatar/line/") ?? false, false);
});

test("a hooded line still reads as the hood the room saw", async () => {
  const look = await examineRowForGm(fakePrisma({ hooded: true }), "gm1", "5");
  assert.equal(look.readout.concealed, true);
  assert.notEqual(look.readout.name, "Ivo Brandt");
  assert.ok(look.readout.equipment.includes("Dagger"));
});

test("the gate is the GM's own zones, asked as a GM", async () => {
  gateCalls.length = 0;
  assert.equal(await examineRowForGm(fakePrisma({ placeKey: "loc:keep" }), "gm1", "5"), null);
  assert.equal(gateCalls[0].options.gm, true);
  assert.equal(gateCalls[0].options.discordUserId, "gm1");
  assert.equal(await examineRowForGm(fakePrisma(), "gm2", "5"), null);
});

test("no Discord account, no look", async () => {
  assert.equal(await examineRowForGm(fakePrisma(), null, "5"), null);
});
