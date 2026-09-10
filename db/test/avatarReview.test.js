// Which uploaded portraits are still waiting on a GM.
//
// WHAT A FAILURE HERE MEANS. A player can put any image they like on their
// character, and the only thing standing behind the "may be approved or
// denied" note on the Browse control is this queue (PORTRAITS.md §1a).
// A predicate that is too narrow does not show an error — it shows an EMPTY
// queue, which reads exactly like "nothing to review". The two ways to get
// that wrong are both asserted below: dropping the never-reviewed rows, and
// letting portrait-maker faces in until the real uploads are buried.
const test = require("node:test");
const assert = require("node:assert/strict");
const { avatarNeedsReview, avatarReviewWhere } = require("../lib/avatarReview");

const BYTES = Buffer.from([1, 2, 3]);
const EARLY = new Date("2026-09-01T00:00:00Z");
const LATE = new Date("2026-09-02T00:00:00Z");

// Only the fields the predicate reads.
function character(over = {}) {
  return { avatarData: BYTES, portrait: null, avatarSetAt: EARLY, avatarReviewedAt: null, ...over };
}

test("a fresh upload nobody has looked at is waiting", () => {
  assert.equal(avatarNeedsReview(character()), true);
});

test("a letter plaque is not a picture and is never in the queue", () => {
  assert.equal(avatarNeedsReview(character({ avatarData: null })), false);
});

test("a portrait-maker face is never in the queue", () => {
  // The maker cannot produce anything to review: the client posts part
  // indices, not pixels, and they are re-rendered from the committed sheets
  // (PORTRAITS.md §4). A non-null `portrait` is what says a face came from it.
  assert.equal(avatarNeedsReview(character({ portrait: '{"nose":3}' })), false);
});

test("a kept picture leaves the queue", () => {
  assert.equal(avatarNeedsReview(character({ avatarSetAt: EARLY, avatarReviewedAt: LATE })), false);
});

test("uploading again after a keep brings it back", () => {
  assert.equal(avatarNeedsReview(character({ avatarSetAt: LATE, avatarReviewedAt: EARLY })), true);
});

test("a picture from before the queue existed, with no set stamp, stays out", () => {
  // The migration backfills avatarSetAt for the uploads already in the game,
  // so this is the shape of a row that backfill missed rather than a normal
  // one. It must not throw, and it must not claim to be waiting.
  assert.equal(avatarNeedsReview(character({ avatarSetAt: null })), false);
});

test("nothing at all is not waiting", () => {
  assert.equal(avatarNeedsReview(null), false);
  assert.equal(avatarNeedsReview(undefined), false);
});

test("the timestamps compare as dates even when they arrive as strings", () => {
  // A row that has been through JSON — a snapshot payload, a test fixture —
  // carries ISO strings rather than Dates, and `"2026-09-02" > "2026-09-01"`
  // happening to work on ISO strings is luck, not a contract.
  assert.equal(
    avatarNeedsReview(character({ avatarSetAt: LATE.toISOString(), avatarReviewedAt: EARLY.toISOString() })),
    true,
  );
  assert.equal(
    avatarNeedsReview(character({ avatarSetAt: EARLY.toISOString(), avatarReviewedAt: LATE.toISOString() })),
    false,
  );
});

// ── The Prisma half ─────────────────────────────────────────────────────────
//
// The `where` cannot be run without a database, but the shape of it is what
// the bug would live in, so that is what is asserted. A stub stands in for the
// client, since all the builder wants from it is a field reference.
const stubPrisma = { character: { fields: { avatarSetAt: Symbol("avatarSetAt") } } };

test("the where keeps both arms — never-reviewed AND reviewed-then-changed", () => {
  const where = avatarReviewWhere(stubPrisma);
  assert.equal(where.portrait, null, "must exclude portrait-maker faces");
  assert.deepEqual(where.avatarData, { not: null });
  assert.deepEqual(where.avatarSetAt, { not: null });

  assert.equal(where.OR.length, 2, "both arms are required");
  // THE ARM THAT IS EASY TO LOSE. A comparison never matches a NULL column, so
  // without this every picture nobody has looked at yet — the whole point of
  // the queue — would be silently absent.
  assert.ok(
    where.OR.some((arm) => arm.avatarReviewedAt === null),
    "the never-reviewed arm is missing: the queue would come back empty",
  );
  assert.ok(
    where.OR.some((arm) => arm.avatarReviewedAt?.lt === stubPrisma.character.fields.avatarSetAt),
    "the reviewed-then-changed arm must compare against avatarSetAt on the same row",
  );
});
