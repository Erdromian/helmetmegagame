// The strength gate on the Attack button (docs/systemdocs/ATTACK.md).
//
// WHAT A FAILURE HERE MEANS. This is the only thing standing between a bum and
// a whole day of the Tribunal Ordinator's time, and it is also the only thing
// a player ever learns about somebody else's fighting band (COMBAT.md §5). Too
// loose and the verb is a griefing tool; too tight and it refuses ordinary
// fights and leaks more than it should.
//
// The capped-champion case at the bottom is the one that decided the whole
// shape: floor:/cap: tags move the BAND after the points are summed, so a
// bound Expert still scores 55. A score-based gate would let a tied-up
// champion refuse to be attacked, which is exactly backwards.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const { attackRefusal, bestBandRank, cancelAttack, closeFightsFor, fileAttack, MAX_BAND_GAP, TOO_STRONG } = require("../lib/attack");
const { bandRank } = require("../lib/fightingSkill");

// A held row in the shape every surface passes: `{ tag, equipped }`.
function row(slug, fighting, extra = {}) {
  return { equipped: true, ...extra, tag: { slug, name: slug, fighting } };
}
// Rungs: Basic 1, Trained 2, Skilled 3, Expert 4. Untrained is no row at all.
const rung = (n) => row(`melee-${n}`, { tree: "melee", rung: n });

test("everybody starts Weak, on both halves", () => {
  assert.equal(bestBandRank([]), bandRank("weak"));
});

test("a peasant may attack a peasant", () => {
  assert.equal(attackRefusal([], []), null);
});

test("a peasant may attack two bands up, and no further", () => {
  // Weak(1) -> Capable(3) is exactly MAX_BAND_GAP.
  assert.equal(bestBandRank([rung(2)]), bandRank("capable"));
  assert.equal(attackRefusal([], [rung(2)]), null);
  // Weak(1) -> Seasoned(4) is one past it.
  assert.equal(bestBandRank([rung(3)]), bandRank("seasoned"));
  assert.equal(attackRefusal([], [rung(3)]), TOO_STRONG);
});

test("the gap is what matters, not the height", () => {
  // A Seasoned fighter may attack a Lethal one: still two bands.
  assert.equal(attackRefusal([rung(3)], [rung(5)]), null);
  assert.equal(attackRefusal([rung(3)], [rung(6)]), TOO_STRONG);
});

test("punching down is never refused", () => {
  assert.equal(attackRefusal([rung(4)], []), null);
});

test("the better half of the tree answers for each side", () => {
  // A marksman with no melee at all is not a free target: their ranged band is
  // what a would-be attacker is measured against.
  const marksman = [row("ranged-expert", { tree: "ranged", rung: 4 })];
  assert.equal(bestBandRank(marksman), bandRank("dangerous"));
  assert.equal(attackRefusal([], marksman), TOO_STRONG);
  // And it works the other way: the marksman may attack a Seasoned swordsman.
  assert.equal(attackRefusal(marksman, [rung(3)]), null);
});

test("a CAPPED champion is attackable — the case bands exist for", () => {
  // Bound caps the band at Pitiful while leaving the score at Expert's 55. A
  // gate reading scores would refuse; a gate reading bands lets a peasant tie
  // into somebody who is already tied up.
  const boundExpert = [rung(4), row("bound", { tree: "both", cap: "pitiful" })];
  assert.equal(bestBandRank(boundExpert), bandRank("pitiful"));
  assert.equal(attackRefusal([], boundExpert), null);
});

test("a FLOORED champion is refused, however little they hold", () => {
  const apex = [row("apex-form", { tree: "both", floor: "legendary" })];
  assert.equal(bestBandRank(apex), bandRank("legendary"));
  assert.equal(attackRefusal([], apex), TOO_STRONG);
});

test("the tunable is a band count, and it is two", () => {
  assert.equal(MAX_BAND_GAP, 2);
});

// ─── Against the catalog as written ─────────────────────────────────────────

// The synthetic cases above pin the arithmetic; this one pins the GAME RULE
// that falls out of it, off docs/tags.yaml rather than off a made-up tag.
//
// Every state that takes a character out of the fight caps their band at
// Pitiful, so a helpless champion is attackable by anybody — which is the
// whole reason the gate reads bands. Add an incapacitating tag without a cap
// and this fails rather than quietly making somebody untouchable while they
// lie there unconscious.
const CATALOG = yaml.load(
  fs.readFileSync(path.join(__dirname, "..", "..", "docs", "tags.yaml"), "utf8"),
);
const catalogTags = CATALOG.tags ?? CATALOG;
const { normalizeFighting } = require("../lib/tagShapes");
const catalogRow = (slug) => ({
  equipped: true,
  tag: { slug, name: slug, fighting: normalizeFighting(catalogTags[slug]?.fighting) },
});

test("a helpless champion is attackable by anybody", () => {
  const champion = ["melee-expert", "melee-swords", "broadsword"].map(catalogRow);
  // Untouchable on his feet.
  assert.equal(attackRefusal([], champion), TOO_STRONG);
  // And not, the moment he is out of it. Every one of these, not just Bound.
  for (const slug of ["bound", "crucified", "dying", "catatonic-afk", "paralyzed", "asleep", "unconscious", "seizure"]) {
    assert.equal(
      attackRefusal([], [...champion, catalogRow(slug)]),
      null,
      `a ${slug} champion should be attackable`,
    );
  }
});

// ─── The hold, end to end ───────────────────────────────────────────────────
//
// WHAT A FAILURE HERE MEANS. The hold is two columns on Character and a table,
// and heldById names ONE opponent while a brawl has several. Every bug this
// section pins is the same bug: a pointer left naming somebody who has walked
// out of the fight, and then something that clears "everyone A is holding"
// freeing a person A no longer has anything to do with. None of it is visible
// in play — the victim just walks away — so it has to be visible here.
//
// A small in-memory stand-in rather than a database: these are the two tables
// db/lib/attack.js touches and nothing else, and db/test has no Postgres.
function fakeDb(ids) {
  let rows = [];
  const chars = Object.fromEntries(ids.map((id) => [id, { heldUntil: null, heldById: null, heldReason: null }]));
  const matchRow = (w, r) => {
    for (const [k, v] of Object.entries(w)) {
      if (k === "OR") {
        if (!v.some((o) => matchRow(o, r))) return false;
        continue;
      }
      if (k === "id" && v && v.in) {
        if (!v.in.includes(r.id)) return false;
        continue;
      }
      if (v === null) {
        if (r[k] !== null && r[k] !== undefined) return false;
        continue;
      }
      if (r[k] !== v) return false;
    }
    return true;
  };
  const db = {
    attack: {
      create: async ({ data }) => {
        const clash = rows.some(
          (r) =>
            r.attackerId === data.attackerId &&
            r.targetCharacterId === data.targetCharacterId &&
            r.turnId === data.turnId,
        );
        if (clash) {
          const err = new Error("unique");
          err.code = "P2002";
          throw err;
        }
        rows.push({ id: `r${rows.length}`, cancelledAt: null, ...data });
      },
      findMany: async ({ where }) => rows.filter((r) => matchRow(where, r)),
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const r of rows) if (matchRow(where, r)) { Object.assign(r, data); count += 1; }
        return { count };
      },
    },
    character: {
      updateMany: async ({ where, data }) => {
        const c = chars[where.id];
        if (!c) return { count: 0 };
        if (where.heldReason?.in && !where.heldReason.in.includes(c.heldReason)) return { count: 0 };
        // fileAttack's clock guard: never shorten a hold already running longer.
        if (where.OR) {
          const ok = where.OR.some(
            (o) => "heldUntil" in o && (o.heldUntil === null ? c.heldUntil == null : c.heldUntil < o.heldUntil.lt),
          );
          if (!ok) return { count: 0 };
        }
        Object.assign(c, data);
        return { count: 1 };
      },
    },
    turn: { findFirst: async () => ({ id: "t1" }) },
  };
  return {
    db,
    chars,
    live: () => rows.filter((r) => !r.cancelledAt).map((r) => `${r.attackerId}->${r.targetCharacterId}`),
    held: () =>
      Object.fromEntries(
        Object.entries(chars).map(([k, v]) => [k, v.heldReason ? `${v.heldReason}<-${v.heldById}` : "free"]),
      ),
  };
}
const TURN = { id: "t1", startedAt: new Date() };
const who = (id) => ({ id, name: id.toUpperCase(), discordUserId: null, firstName: id, lastName: null, age: 30, gender: "MAN", concealed: false, status: "ALIVE", locationId: "L", updatedAt: new Date(), tags: [] });

test("an attack holds both sides, and they read different reasons", async () => {
  const f = fakeDb(["a", "b"]);
  await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN });
  // The one who started it must never be told "somebody attacked you".
  assert.deepEqual(f.held(), { a: "attacking<-b", b: "attack<-a" });
});

test("attacking is permanent for the turn, before AND after breaking off", async () => {
  const f = fakeDb(["a", "b"]);
  assert.equal((await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN })).ok, true);
  assert.equal((await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN })).already, true);
  await cancelAttack(f.db, { attackerId: "a", targetCharacterId: "b", turnId: "t1" });
  assert.equal((await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN })).already, true);
});

test("fighting back is its own row, and the roles flip when one side stops", async () => {
  const f = fakeDb(["a", "b"]);
  await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN });
  await fileAttack(f.db, { attacker: who("b"), target: who("a"), openTurn: TURN });
  await cancelAttack(f.db, { attackerId: "a", targetCharacterId: "b", turnId: "t1" });
  // Only b->a is left, so a is the one being attacked now — and both stay held.
  assert.deepEqual(f.held(), { a: "attack<-b", b: "attacking<-a" });
  await cancelAttack(f.db, { attackerId: "b", targetCharacterId: "a", turnId: "t1" });
  assert.deepEqual(f.held(), { a: "free", b: "free" });
});

test("one man leaving a brawl does not unpick it, now or later", async () => {
  const f = fakeDb(["a", "b", "c"]);
  await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN });
  await fileAttack(f.db, { attacker: who("c"), target: who("b"), openTurn: TURN });
  await cancelAttack(f.db, { attackerId: "a", targetCharacterId: "b", turnId: "t1" });
  // a is out; b is still held BY C, not by the pointer to a that a's row left.
  assert.deepEqual(f.held(), { a: "free", b: "attack<-c", c: "attacking<-b" });
  // THE BUG THIS EXISTS FOR: with a stale heldById of "a", a dying here wiped
  // b's hold and walked them out of c's fight.
  await closeFightsFor(f.db, "a");
  assert.equal(f.held().b, "attack<-c");
  assert.deepEqual(f.live(), ["c->b"]);
});

test("a death closes the fight from EITHER end", async () => {
  const f = fakeDb(["a", "b"]);
  await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN });
  // The TARGET dies. A row left live on the far side would pin the attacker
  // for the rest of the turn, and show as "Holding" over a corpse.
  await closeFightsFor(f.db, "b");
  assert.deepEqual(f.held(), { a: "free", b: "free" });
  assert.deepEqual(f.live(), []);
});
