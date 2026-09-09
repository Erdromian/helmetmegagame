// The DATABASE half of a character's death — shared so the two death paths
// can't drift: web/lib/discordGuild.js#killCharacter (a GM's Kill button, the
// lethal-outcome request path) and db/lib/catatonicDeathPass.js (the turn
// engine's one auto-kill). Each caller keeps its own Discord half — the web
// one inline, the pass via returned side effects — but what death *means* on
// the row is decided here, once.
//
// Takes `prisma` as the first parameter (the db/lib/dm.js convention) and is
// deliberately NOT on the @lifeweb/db barrel; require it by path.
const { recordArchiveEvent } = require("./archive");
const { mintCorpse } = require("./corpseMint");
const { cancelOffersForCharacter } = require("./lessons");
const { CATATONIC_SLUG, GIBBED_SLUG } = require("./constants");
const { SEAT_TAG_SLUGS } = require("./threats");
const { applyMood } = require("./mood");

// Marks one character DEAD. Returns { claimed } — false when the character
// was no longer ALIVE, in which case NOTHING else was written: the update's
// own `status: "ALIVE"` where-clause is the claim, so two racing callers (or
// a resumed turn re-running the death pass) can never half-kill or
// double-archive the same character. `expectStatus` exists for the web path,
// which calls this a moment AFTER updateCharacterRaw already wrote DEAD.
//
// What it does when it claims: status DEAD, discordRoleId nulled (the caller
// must capture the role id FIRST — it still owes Discord the role delete),
// catatonicSinceTurn nulled (a corpse has no countdown), every equipped tag
// unequipped (a corpse doesn't wield things — frees the equip slots for a
// Revive and keeps the loot panel honest), and one DEATH row in the
// transcript. `content` is the archive line; `turn` pins the archive row to a
// specific turn (the death pass hands the closing turn) rather than whatever
// happens to be open.
//
// `gib` is the vaporised variant — no corpse at all, and every tag replaced by
// one "Gibbed" row. See vaporizeTags below and docs/systemdocs/CORPSES.md §1a.
//
// Returns `corpse` alongside `claimed` — { tag, room } — so a caller that owes
// Discord an announcement knows which Room the body landed in. `room` is null
// when it stayed on the dead sheet for want of a public room to fall in.
// Takes the officer seats off a dead character and, if they led, hands the
// Leader's seat to the longest-standing living member — a Treasurer first,
// since they already held office, and a Catatonic member LAST, because
// crowning somebody who has left the Discord server is no better than leaving
// the seat with a corpse.
//
// Membership itself is untouched: a body stays in its faction, the way it
// stays in its Location.
async function vacateFactionOffice(prisma, character) {
  const row = await prisma.character.findUnique({
    where: { id: character.id },
    select: { factionId: true, isLeader: true, isTreasurer: true },
  });
  if (!row || (!row.isLeader && !row.isTreasurer)) return;

  await prisma.character.update({
    where: { id: character.id },
    data: { isLeader: false, isTreasurer: false },
  });
  if (!row.isLeader || !row.factionId) return;

  const successors = await prisma.character.findMany({
    where: { factionId: row.factionId, status: "ALIVE", isLeader: false },
    orderBy: [{ isTreasurer: "desc" }, { createdAt: "asc" }],
    select: { id: true, tags: { where: { tag: { slug: CATATONIC_SLUG } }, select: { id: true } } },
  });
  const heir = successors.find((c) => c.tags.length === 0) ?? successors[0];
  if (!heir) return;
  await prisma.character.update({ where: { id: heir.id }, data: { isLeader: true } });
}

// Vaporised rather than killed: every tag the character owned is deleted and
// one "Gibbed" row replaces them, and no corpse is minted at all. Called only
// with `gib: true` set, from the two Thanati rites and the bomb.
//
// SEAT_TAG_SLUGS is the one exception to the wipe, and it is load-bearing. The
// end-of-game reveal reads antagonist seats straight off live Character rows
// (db/lib/epilogue.js). The bomb gibs everyone above ground and then ends the
// game, so a blind delete here would leave the ending naming nobody.
async function vaporizeTags(prisma, characterId) {
  await prisma.characterTag.deleteMany({
    where: { characterId, tag: { slug: { notIn: SEAT_TAG_SLUGS } } },
  });

  const gibbed = await prisma.tag.findUnique({ where: { slug: GIBBED_SLUG }, select: { id: true } });
  if (!gibbed) {
    console.error(`No "${GIBBED_SLUG}" tag to stamp on ${characterId} — run npm run db:sync-tags.`);
    return;
  }
  await prisma.characterTag.create({ data: { characterId, tagId: gibbed.id, source: "EVENT" } });
}

async function applyDeathToRow(prisma, character, { turn = null, content = null, expectStatus = "ALIVE", gib = false } = {}) {
  const claimed = await prisma.character.updateMany({
    where: { id: character.id, status: expectStatus },
    // travelTo* cleared with it: dying on the road ends the journey, and the
    // body stays where it fell for the corpse to be found (a corpse someone
    // is DRAGGING keeps its own pending destination — nothing dies twice).
    data: {
      status: "DEAD",
      discordRoleId: null,
      catatonicSinceTurn: null,
      travelToLocationId: null,
      travelTurnId: null,
    },
  });
  if (claimed.count === 0) return { claimed: false };

  // A gib deletes the tags outright, which makes unequipping them moot; an
  // ordinary death only drops them out of their slots. Either way a corpse
  // wields nothing.
  if (gib) {
    await vaporizeTags(prisma, character.id).catch((err) =>
      console.error(`Failed to vaporize tags for ${character.id}:`, err),
    );
  } else {
    await prisma.characterTag
      .updateMany({ where: { characterId: character.id, equipped: true }, data: { equipped: false } })
      .catch((err) => console.error(`Failed to unequip on death for ${character.id}:`, err));
  }

  // A dead leader leads nobody, so everyone following them lets go — and
  // their own standing agreement to follow somebody dies with them. What is
  // deliberately NOT cleared is `escortedById` on this row: a corpse is still
  // something a person can carry (db/lib/escort.js gives a body FORCED), so
  // dying in somebody's arms leaves you in them.
  await prisma.character
    .updateMany({
      where: { escortedById: character.id },
      data: { escortedById: null },
    })
    .catch((err) => console.error(`Failed to release the party on death for ${character.id}:`, err));
  await prisma.character
    .update({
      where: { id: character.id },
      data: { escortConsentToId: null, escortConsentUntilTurn: null },
    })
    .catch((err) => console.error(`Failed to clear escort consent on death for ${character.id}:`, err));

  // A pending handshake either way is void, and a half-made thing stays
  // half-made (docs/systemdocs/LESSONS.md, CRAFTING.md). An ACCEPTED lesson
  // still resolves — it happened when it was accepted.
  await cancelOffersForCharacter(prisma, character.id).catch((err) =>
    console.error(`Failed to void offers on death for ${character.id}:`, err),
  );
  // The same rule for a faction handshake (FACTIONS.md): an application or an
  // invitation nobody can answer any more is withdrawn rather than left in a
  // queue for an officer to trip over.
  await prisma.factionApplication
    .updateMany({
      where: { characterId: character.id, status: "PENDING" },
      data: { status: "WITHDRAWN" },
    })
    .catch((err) => console.error(`Failed to void faction applications on death for ${character.id}:`, err));

  // And the office itself. A dead Leader used to keep the seat, which froze
  // the faction solid: rename, secede and every officer verb require
  // `isLeader`, and a Treasurer may not remove the Leader they answer to — so
  // only a GM could unstick it. Since catatonicDeathPass auto-kills AFK
  // characters, that would have happened without anybody dying dramatically.
  //
  // Same succession as walking out (FACTIONS.md §2): the seat passes rather
  // than vanishing.
  await vacateFactionOffice(prisma, character).catch((err) =>
    console.error(`Failed to vacate faction office on death for ${character.id}:`, err),
  );
  await prisma.craftProject
    .updateMany({ where: { characterId: character.id, status: "ACTIVE" }, data: { status: "CANCELLED" } })
    .catch((err) => console.error(`Failed to cancel craft projects on death for ${character.id}:`, err));

  // The body itself, as a real object: one Tag row, dropped into a random
  // public Room at the Location they fell in (docs/systemdocs/CORPSES.md). It
  // is a HANDLE to this sheet, not a container — nothing moves off the row, so
  // LOOT_CHARACTER is unaffected — but from here on the sheet follows the tag,
  // which is what makes a body draggable by carrying it.
  //
  // Wrapped, and deliberately after the claim: a catalog that has not been
  // synced yet must not turn a death into a throw. A missing corpse is
  // recoverable by hand; a half-applied death is not.
  // A gib leaves no body at all, so there is nothing to mint. This is the
  // whole difference on the world side: no corpse means nothing to loot,
  // carry, butcher, bury or engrave, and corpseFollow never has a tag to
  // follow.
  const corpse = gib
    ? { tag: null, room: null }
    : await mintCorpse(prisma, character, turn).catch((err) => {
        console.error(`Failed to mint a corpse for ${character.id}:`, err);
        return { tag: null, room: null };
      });

  // Everyone standing where they fell saw it (docs/systemdocs/MOOD.md). The
  // location is re-read rather than trusted off `character`, since callers
  // pass rows of every shape. Wrapped, and after the claim: a death is never
  // aborted by a witness's nerves.
  await frightenWitnesses(prisma, character.id).catch((err) =>
    console.error(`Failed to frighten witnesses of ${character.id}:`, err.message ?? err),
  );

  // recordArchiveEvent already swallows its own failures (a lost transcript
  // line must never abort a death), so no catch here.
  await recordArchiveEvent(prisma, {
    kind: "DEATH",
    character,
    turn,
    zoneId: character.zoneId ?? null,
    content: content ?? `${character.name} died.`,
  });

  return { claimed: true, corpse };
}

async function frightenWitnesses(prisma, deadCharacterId) {
  const dead = await prisma.character.findUnique({ where: { id: deadCharacterId }, select: { locationId: true } });
  if (!dead?.locationId) return;
  const witnesses = await prisma.character.findMany({
    where: { locationId: dead.locationId, status: "ALIVE", id: { not: deadCharacterId } },
    select: { id: true },
  });
  // Sequential on purpose: a dozen witnesses is the most a room holds, and a
  // burst of parallel transactions at turn close competes for pool slots.
  for (const { id } of witnesses) {
    await applyMood(prisma, id, { kind: "DEATH_SEEN" }).catch((err) =>
      console.error(`Death-seen mood failed for ${id}:`, err.message ?? err),
    );
  }
}

module.exports = { applyDeathToRow };
