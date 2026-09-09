// node --test over the rule every send path has to reach the same answer on:
// db/lib/presentedIdentity.js, which decides the name and face a room sees.
//
// There was no coverage here at all. What these lock down is the resolver
// itself: chiefly that a hood the player CHOSE conceals exactly as hard as one
// tied on for them, since that is the distinction every send path has to carry
// through unchanged and the one the web -> Discord relay dropped —
// db/lib/discordRest.js#postAsCharacter kept a concealment only when the gear
// FORCED it, so a voluntary hood went into the archive row correctly and then
// reached the channel under the speaker's own name.
//
// These tests would NOT have caught that: the resolver was right and the
// plumbing around it was wrong, and postAsCharacter can't be exercised here
// without a webhook. What they protect is the answer the plumbing has to
// preserve.
//
// Run with: npm test --workspace=db
const test = require("node:test");
const assert = require("node:assert/strict");
const { concealmentFrom, presentedIdentity } = require("../lib/presentedIdentity");

const speaker = { id: "c1", name: "Semyun Varyutskaya", age: 30, gender: "WOMAN", concealed: true };
const bareFaced = { ...speaker, concealed: false };

// CharacterTag rows, the shape concealmentFrom is fed everywhere.
const hood = { equipped: true, tag: { name: "Hood", concealsIdentity: true, concealSprite: "hood", forcesConceal: false, equipLayer: 1 } };
const helm = { equipped: true, tag: { name: "Great Helm", concealsIdentity: true, concealSprite: "greathelm", forcesConceal: false, equipLayer: 2 } };
const sack = { equipped: true, tag: { name: "Sack", concealsIdentity: true, concealSprite: "sack", forcesConceal: true, equipLayer: 3 } };
const carried = { ...hood, equipped: false };

test("a hood the player chose conceals, and says so with the item's own face", () => {
  const identity = presentedIdentity(speaker, { forcedName: null, concealment: concealmentFrom([hood]) });
  assert.equal(identity.concealed, true);
  assert.equal(identity.name, "Woman");
  assert.equal(identity.alias, "Woman");
  assert.equal(identity.avatarPath, "/assets/helms/hood.webp");
});

test("the same hood carried rather than worn conceals nothing", () => {
  assert.equal(concealmentFrom([carried]), null);
  const identity = presentedIdentity(speaker, { forcedName: null, concealment: concealmentFrom([carried]) });
  assert.equal(identity.concealed, false);
  assert.equal(identity.name, "Semyun Varyutskaya");
});

test("gear worn by somebody who never asked to hide leaves them named", () => {
  const identity = presentedIdentity(bareFaced, { forcedName: null, concealment: concealmentFrom([hood]) });
  assert.equal(identity.concealed, false);
  assert.equal(identity.name, "Semyun Varyutskaya");
});

test("a sack tied on overrides the column — there is no choice to make", () => {
  const piece = concealmentFrom([sack]);
  assert.equal(piece.forced, true);
  const identity = presentedIdentity(bareFaced, { forcedName: null, concealment: piece });
  assert.equal(identity.concealed, true);
  assert.equal(identity.avatarPath, "/assets/helms/sack.webp");
});

test("the outermost piece is the one an onlooker sees", () => {
  assert.equal(concealmentFrom([hood, helm]).sprite, "greathelm");
  assert.equal(concealmentFrom([helm, hood]).sprite, "greathelm");
});

test("a forced name beats a hood, and a forced name is not hiding", () => {
  const identity = presentedIdentity(speaker, { forcedName: "Beast", concealment: concealmentFrom([hood]) });
  assert.equal(identity.name, "Beast");
  assert.equal(identity.alias, "Beast");
  assert.equal(identity.forced, true);
  assert.equal(identity.concealed, false);
});

test("a caller that loaded no tags falls back to the column, never to the name", () => {
  const identity = presentedIdentity(speaker);
  assert.equal(identity.concealed, true);
  assert.equal(identity.name, "Woman");
  // No idea what by, so the blank plaque rather than a sprite it cannot name.
  assert.equal(identity.avatarPath, "/assets/letters/_default.webp");
});

// --- reading a row back ----------------------------------------------------
//
// wasHooded is the half that used to break on its own. The archive column
// holds a hood's alias and a forced name alike, and both call sites told them
// apart by asking what the speaker holds NOW — so a Disguise Kit, which lasts
// three turns and is then swept, silently turned every line said under it into
// a hood once it expired.
const { wasHooded } = require("../lib/presentedIdentity");

test("a line said under a hood still reads as one — the sprite is frozen on the row", () => {
  assert.equal(wasHooded({ concealedAlias: "Woman", presentedAvatarPath: "/assets/helms/hood.webp" }), true);
});

test("a line said under an EXPIRED disguise is still not a hood", () => {
  const row = { concealedAlias: "Beast", presentedAvatarPath: "/assets/letters/B.webp" };
  // Nobody holds that name any more — the tag was swept three turns later.
  assert.equal(wasHooded(row, { forcedName: null }), false);
  // And it read the same while it was still held.
  assert.equal(wasHooded(row, { forcedName: "Beast" }), false);
});

test("an ordinary line was never hidden at all", () => {
  assert.equal(wasHooded({ concealedAlias: null, presentedAvatarPath: null }), false);
  assert.equal(wasHooded(null), false);
});

test("an alias outside the nine settles it with no sprite to go on", () => {
  assert.equal(wasHooded({ concealedAlias: "Beast", presentedAvatarPath: null }), false);
});

test("a row too old to carry a face errs toward the hood", () => {
  // "Old Woman" is both a hood's alias and, just possibly, somebody's forced
  // name. With no sprite frozen and no live name to match, stay covered.
  assert.equal(wasHooded({ concealedAlias: "Old Woman", presentedAvatarPath: null }), true);
  assert.equal(wasHooded({ concealedAlias: "Old Woman", presentedAvatarPath: null }, { forcedName: "Old Woman" }), false);
});
