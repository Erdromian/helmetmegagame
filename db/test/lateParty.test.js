// db/lib/lateParty.js decides, while a late party is live, which fates anybody
// may be made as. A wrong answer is either creation locked shut for the rest of
// the game or a party that never lets anybody in. The pure half needs nothing;
// loadLiveParty runs against a fake holding just the queries it makes.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  latePartyCap,
  partyHasRoom,
  latePartyGate,
  normalizePartyFates,
  loadLiveParty,
  MAX_PARTY_SLOTS,
} = require("../lib/lateParty");

const ROLE = { id: "r1", slug: "guard" };
const fate = (over = {}) => ({ roleSlug: "guard", role: ROLE, slots: 2, seated: 0, taken: 0, ...over });

test("a fate's cap is its slots, and blank slots are unlimited", () => {
  assert.equal(latePartyCap({ slots: 3 }), 3);
  assert.equal(latePartyCap({ slots: null }), Infinity);
});

test("a party has room while any fate has a chair nobody sits in", () => {
  assert.equal(partyHasRoom([fate({ seated: 1 })]), true);
  assert.equal(partyHasRoom([fate({ seated: 2 })]), false);
  assert.equal(partyHasRoom([fate({ seated: 2 }), fate({ roleSlug: "bum", slots: null, seated: 40 })]), true);
  assert.equal(partyHasRoom([]), false);
});

test("a wizard hold does not fill a party -- only seated characters do", () => {
  // Two chairs, one sat in and one held: still live, so an abandoned hold
  // cannot end a party that was never filled.
  assert.equal(partyHasRoom([fate({ seated: 1, taken: 2 })]), true);
});

test("a fate with no Role row never keeps a party live", () => {
  assert.equal(partyHasRoom([fate({ role: null, slots: null })]), false);
});

test("the gate: no party, one of its fates, or locked", () => {
  const live = { fates: [fate()] };
  assert.equal(latePartyGate(null, "guard"), "none");
  assert.equal(latePartyGate(live, "guard"), "open");
  assert.equal(latePartyGate(live, "merchant"), "locked");
  assert.equal(latePartyGate({ fates: [fate({ role: null })] }, "guard"), "locked");
});

test("the start form is cleaned: known slugs, once each, slots 1-999 or unlimited", () => {
  const known = ["guard", "bum", "tribune"];
  assert.deepEqual(
    normalizePartyFates(
      [
        { roleSlug: "guard", slots: "3" },
        { roleSlug: "guard", slots: "9" }, // a repeat is dropped
        { roleSlug: "bum", slots: "" }, // blank is unlimited
        { roleSlug: "nobody", slots: "1" }, // unknown slug
        { roleSlug: "tribune", slots: "0" }, // zero chairs is no fate at all
      ],
      known,
    ),
    [
      { roleSlug: "guard", slots: 3 },
      { roleSlug: "bum", slots: null },
    ],
  );
  assert.deepEqual(normalizePartyFates([{ roleSlug: "guard", slots: 5000 }], known), [
    { roleSlug: "guard", slots: MAX_PARTY_SLOTS },
  ]);
});

// ---- loadLiveParty over a fake ----------------------------------------------

function makeDb({ party, characters = [], holds = [] }) {
  const now = Date.now();
  const stamped = [];
  return {
    stamped,
    lateParty: {
      findFirst: async () => party,
      updateMany: async ({ where, data }) => (stamped.push({ where, data }), { count: 1 }),
    },
    role: { findMany: async ({ where }) => [ROLE, { id: "r2", slug: "bum" }].filter((r) => where.slug.in.includes(r.slug)) },
    character: {
      groupBy: async ({ where }) => {
        const counts = new Map();
        for (const c of characters.filter((c) => c.latePartyId === where.latePartyId)) {
          counts.set(c.roleId, (counts.get(c.roleId) ?? 0) + 1);
        }
        return [...counts].map(([roleId, _count]) => ({ roleId, _count }));
      },
    },
    roleReservation: {
      groupBy: async ({ where }) => {
        const counts = new Map();
        for (const h of holds) {
          if (h.expiresAt <= now || !where.roleId.in.includes(h.roleId)) continue;
          if (where.discordUserId && h.discordUserId === where.discordUserId.not) continue;
          counts.set(h.roleId, (counts.get(h.roleId) ?? 0) + 1);
        }
        return [...counts].map(([roleId, _count]) => ({ roleId, _count }));
      },
    },
  };
}

const PARTY = { id: "p1", endedAt: null, fates: [{ roleSlug: "guard", slots: 2 }] };

test("no open party is no live party", async () => {
  assert.equal(await loadLiveParty(makeDb({ party: null })), null);
});

test("a party counts only the characters it made, dead ones included", async () => {
  const live = await loadLiveParty(
    makeDb({
      party: PARTY,
      characters: [
        { latePartyId: "p1", roleId: "r1" },
        { latePartyId: null, roleId: "r1" }, // a Guard the game already had
      ],
    }),
  );
  assert.equal(live.fates[0].seated, 1);
});

test("a party whose every chair is sat in is not live, and is closed as filled", async () => {
  const db = makeDb({
    party: PARTY,
    characters: [
      { latePartyId: "p1", roleId: "r1" },
      { latePartyId: "p1", roleId: "r1" },
    ],
  });
  assert.equal(await loadLiveParty(db), null);
  // Stamped, so a GM deleting one of its characters later cannot bring it back.
  assert.equal(db.stamped.length, 1);
  assert.deepEqual(db.stamped[0].where, { id: "p1", endedAt: null });
  assert.equal(db.stamped[0].data.endedBy, null);
});

test("a live party is not stamped", async () => {
  const db = makeDb({ party: PARTY });
  assert.ok(await loadLiveParty(db));
  assert.equal(db.stamped.length, 0);
});

test("others' holds count as taken, the viewer's own does not", async () => {
  const later = Date.now() + 60_000;
  const db = makeDb({
    party: PARTY,
    holds: [
      { roleId: "r1", discordUserId: "me", expiresAt: later },
      { roleId: "r1", discordUserId: "them", expiresAt: later },
    ],
  });
  const live = await loadLiveParty(db, { excludeDiscordUserId: "me" });
  assert.equal(live.fates[0].seated, 0);
  assert.equal(live.fates[0].taken, 1);
});

test("an unlimited fate keeps a party live however many it has made", async () => {
  const db = makeDb({
    party: { ...PARTY, fates: [{ roleSlug: "bum", slots: null }] },
    characters: Array.from({ length: 50 }, () => ({ latePartyId: "p1", roleId: "r2" })),
  });
  const live = await loadLiveParty(db);
  assert.equal(live.fates[0].seated, 50);
});
