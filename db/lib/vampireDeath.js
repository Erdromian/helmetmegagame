// The Vampire's own death (docs/systemdocs/VAMPIRE.md §7 — design doc pages
// 4-5): "Vampires do not die from regular injuries expiring into the dying
// tag, or from the turret, or any other form of physical injury short of a
// blow to the heart, decapitation and burning." db/lib/dyingDeathPass.js is
// the code half of "regular injuries expiring into the dying tag" — it skips
// a vampire outright (see its own header), so the only way a vampire dies is
// a GM finishing them off by hand (HARM_CHARACTER's lethal half, or a
// GM-staged death on the turn push) — exactly "a blow to the heart,
// decapitation and burning," GM narrative judgment call by design, the same
// posture VAMPIRE.md §2b gives feeding.
//
// When that happens: "they are immediately gibbed, turning into ash... Their
// items will be dropped on the ground as well as a pile of ash tag." This is
// its own third death shape, distinct from both of db/lib/characterDeath.js's
// existing ones — an ordinary death mints a buryable corpse; `gib: true`
// wipes every tag (items included) and mints nothing. A vampire's ash death
// wants neither: no buryable body (there's nothing left to bury or butcher),
// but the items must survive, lootable off the ground, same as an ordinary
// death leaves them unequipped-but-held. So `applyDeathToRow`'s new
// `noCorpse` option (skip minting, keep the plain unequip) is what this
// module calls with `gib: false`, then mints one static `pile-of-ash` item
// into the room itself, and posts the public line — the two things a plain
// `noCorpse` death doesn't do on its own.
//
// Takes `prisma`/`tx` as a parameter — db/lib/dm.js's reason.
const { VAMPIRE_SLUG, PILE_OF_ASH_SLUG } = require("./secretSlugs");
const { applyDeathToRow } = require("./characterDeath");
const { pickRandomPublicRoom } = require("./roomStash");
const { addToRoomStack } = require("./tagWrites");
const { locationLine } = require("./placeLine");

async function characterIsVampire(db, characterId) {
  const held = await db.characterTag.findFirst({
    where: { characterId, tag: { slug: VAMPIRE_SLUG } },
    select: { id: true },
  });
  return Boolean(held);
}

// Mints the pile-of-ash room drop. Best-effort: a missing tag (db:sync-tags
// hasn't run) logs and moves on rather than aborting a death already
// committed to the row.
async function mintPileOfAsh(tx, locationId) {
  const ashTag = await tx.tag.findUnique({ where: { slug: PILE_OF_ASH_SLUG }, select: { id: true } });
  if (!ashTag) {
    console.error(`Vampire ash death: no "${PILE_OF_ASH_SLUG}" tag — run npm run db:sync-tags.`);
    return null;
  }
  const room = await pickRandomPublicRoom(tx, locationId);
  if (!room) return null;
  await addToRoomStack(tx, room.id, ashTag.id, 1, {});
  return room;
}

// Called wherever `applyDeathToRow` is about to run, with the GM's REQUESTED
// gib choice — returns the options to actually pass. A vampire always ashes,
// overriding whatever the GM's Gib checkbox said: the design doc leaves no
// "died normally" branch for a vampire's own body once a GM finishes them.
async function resolveDeathOptions(tx, characterId, { gib = false } = {}) {
  const vampire = await characterIsVampire(tx, characterId);
  if (!vampire) return { gib, noCorpse: false, isVampireAsh: false };
  return { gib: false, noCorpse: true, isVampireAsh: true };
}

// Runs applyDeathToRow with ash semantics when the target is a vampire, else
// falls through to the ordinary path unchanged — the one call site every
// death path should route through instead of calling applyDeathToRow raw.
// `character` needs at least { id, name, locationId }. Returns
// applyDeathToRow's own { claimed, corpse } shape.
async function applyDeathWithVampireOverride(tx, character, opts = {}) {
  const resolved = await resolveDeathOptions(tx, character.id, { gib: opts.gib === true });
  const result = await applyDeathToRow(tx, character, {
    ...opts,
    gib: resolved.gib,
    noCorpse: resolved.noCorpse,
  });
  if (!result.claimed || !resolved.isVampireAsh) return result;

  const room = await mintPileOfAsh(tx, character.locationId ?? null).catch((err) => {
    console.error(`Vampire ash death: pile-of-ash mint failed for ${character.id}:`, err);
    return null;
  });
  return { ...result, ash: { room: room?.id ?? null } };
}

// The public line (CORPSES.md-style ambient scenery) — posted AFTER the
// transaction commits, same ordering db/lib/characterDeath.js's own callers
// use for Discord side effects, so a channel outage never rolls back a
// death already on the row. Caller passes the location row this character
// died at (read before death, since a dead character's own locationId can
// still be read off the row — death never relocates anyone).
async function announceVampireAsh(db, name, location) {
  if (!location) return;
  await locationLine(db, location, `${name} disintegrates into a pile of ash!`, { sfx: "gib" });
}

module.exports = {
  characterIsVampire,
  resolveDeathOptions,
  applyDeathWithVampireOverride,
  announceVampireAsh,
};
