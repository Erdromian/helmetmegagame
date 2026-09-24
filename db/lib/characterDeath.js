// The DATABASE half of a character's death — shared so the two death paths
// (web/lib/discordGuild.js#killCharacter and db/lib/catatonicDeathPass.js)
// can't drift; each keeps its own Discord half, but what death *means* on the
// row is decided here, once. Takes `prisma` as the first parameter;
// deliberately NOT on the @lifeweb/db barrel, require it by path.
const { recordArchiveEvent } = require("./archive");
const { mintCorpse } = require("./corpseMint");
const { cancelOffersForCharacter } = require("./lessons");
const { SEAT_TAG_SLUGS } = require("./threats");
const { applyMood } = require("./mood");
const { GIBBED_SLUG, METEMPSYCHOSIS_SLUG, HEIGHTENED_PSYCHOSIS_SLUG } = require("./constants");
const { NOT_A_FIGHT } = require("./intercept");
const { closeFightsFor } = require("./attack");
const { stopPerformances } = require("./performance");
const { teardownPartyThread } = require("./partyChat");
const { CONCEALMENT_TAG_FIELDS, concealmentFrom } = require("./presentedIdentity");
const { LOCKED_ON_SLUGS } = require("./equipSlots");

// The concealing piece this character is wearing RIGHT NOW, or null — read off
// the database rather than off `character`, since callers pass varying shapes
// and the claim below is about to unequip everything.
//
// It has to happen before the unequip, because concealment only ever counts an
// EQUIPPED mask: without this, dying took your hood off, and a masked body was
// named in the room's Loot menu a moment after it hit the floor. Only a hood
// that was actually IN EFFECT is remembered — the same `forced || concealed`
// rule the living are judged by (db/lib/whosHere.js#presentRows), so a helmet
// worn with the toggle off stays what it was, a helmet.
async function maskWornNow(prisma, characterId) {
  const row = await prisma.character
    .findUnique({
      where: { id: characterId },
      select: {
        concealed: true,
        tags: {
          where: { equipped: true, tag: { concealsIdentity: true } },
          select: { tagId: true, equipped: true, tag: { select: CONCEALMENT_TAG_FIELDS } },
        },
      },
    })
    .catch(() => null);
  if (!row) return null;
  const piece = concealmentFrom(row.tags);
  if (!piece || !(piece.forced || row.concealed)) return null;
  return piece.tagId ?? null;
}

// Marks one character DEAD. Returns { claimed } — false when no longer ALIVE,
// in which case NOTHING else is written: the update's `status: "ALIVE"`
// where-clause IS the claim, so racing callers can never half-kill or
// double-archive. `expectStatus` is for the web path, which calls this a
// moment AFTER updateCharacterRaw already wrote DEAD. discordRoleId is nulled
// here, so the caller must capture it FIRST — it still owes Discord the role
// delete. `gib` is the vaporised variant — no corpse, every tag replaced by
// one "Gibbed" row (vaporizeTags, CORPSES.md §1a). Returns
// `corpse: { tag, room }` alongside `claimed`; `room` null means it stayed on
// the sheet for want of a public room.
// Vaporised rather than killed: every tag deleted, one "Gibbed" row replaces
// them, no corpse minted. Called with `gib: true` from the two Thanati rites
// and the bomb. SEAT_TAG_SLUGS is the one load-bearing exception: the
// end-of-game reveal reads antagonist seats off live Character rows
// (db/lib/epilogue.js), and the bomb gibs everyone then ends the game.
// Returns how many rows it actually wiped, so the caller can decide whether
// the gib is worth an audit row at all (an already-bare sheet isn't).
async function vaporizeTags(prisma, characterId) {
  const { count } = await prisma.characterTag.deleteMany({
    where: { characterId, tag: { slug: { notIn: SEAT_TAG_SLUGS } } },
  });

  const gibbed = await prisma.tag.findUnique({ where: { slug: GIBBED_SLUG }, select: { id: true } });
  if (!gibbed) {
    console.error(`No "${GIBBED_SLUG}" tag to stamp on ${characterId} — run npm run db:sync-tags.`);
    return count;
  }
  await prisma.characterTag.create({ data: { characterId, tagId: gibbed.id, source: "EVENT" } });
  return count;
}

// `cause` names who/what is responsible for the gib's tag wipe, for the audit
// row below: { kind: "player" | "gm" | "system", actorDiscordUserId?, system? }.
// Optional and defaults to a generic system cause — every caller SHOULD pass
// one for accuracy, but a caller that doesn't must not lose the wipe entirely.
// Everything this character was TANGLED IN with other people, let go of. Split out
// of the death path because going to sleep aboard the Charon needs exactly this and
// none of the rest of dying (docs/systemdocs/CHARON.md): no corpse, no death mask,
// no witnesses to frighten, but a party that must stop following somebody who is no
// longer in the game, and a held prisoner who must not stay pinned by a hand that
// has left the planet.
//
// Every step is wrapped and logged rather than thrown, the way the rest of this
// file is: a half-released character is worse than a slow one.
async function releaseEntanglements(prisma, characterId) {
  // Somebody out of the game leads nobody; everyone following them lets go. NOT cleared:
  // `escortedById` on this row — a corpse can still be carried (db/lib/escort.js gives a body
  // FORCED), and a sleeper aboard the Charon is not going anywhere either way.
  await prisma.character
    .updateMany({
      where: { escortedById: characterId },
      data: { escortedById: null },
    })
    .catch((err) => console.error(`Failed to release the party leaving play for ${characterId}:`, err));

  // The party chat (db/lib/partyChat.js) is keyed on this character as its
  // creator. Leaving play dissolves the party, so the thread and the row go with it.
  await teardownPartyThread(prisma, characterId).catch((err) =>
    console.error(`Failed to tear down party thread leaving play for ${characterId}:`, err),
  );

  // A man who is gone holds nobody (INTERCEPT.md). Their OWN heldUntil is left alone — costs a
  // corpse nothing and lapses on its own. A FIGHT comes off first, through the row not heldById
  // (ATTACK.md §2): both attacker and target release, or settleHold would keep pinning the survivor.
  await closeFightsFor(prisma, characterId).catch((err) =>
    console.error(`Failed to close fights leaving play for ${characterId}:`, err),
  );
  // Nobody out of the game is still playing (SOUND.md, "Performances").
  await stopPerformances(prisma, [characterId], "status").catch((err) =>
    console.error(`Failed to stop the song leaving play for ${characterId}:`, err),
  );
  // Guarded away from a fight (like releaseHeldBy): heldById names one opponent but a brawl has several.
  await prisma.character
    .updateMany({
      where: { heldById: characterId, ...NOT_A_FIGHT },
      data: { heldUntil: null, heldById: null, heldReason: null },
    })
    .catch((err) => console.error(`Failed to release held characters leaving play for ${characterId}:`, err));
  await prisma.character
    .update({
      where: { id: characterId },
      data: { escortConsentToId: null, escortConsentUntilTurn: null },
    })
    .catch((err) => console.error(`Failed to clear escort consent leaving play for ${characterId}:`, err));

  // A pending handshake is void either way (LESSONS.md, CRAFTING.md); an ACCEPTED lesson still resolves.
  await cancelOffersForCharacter(prisma, characterId).catch((err) =>
    console.error(`Failed to void offers leaving play for ${characterId}:`, err),
  );
  await prisma.craftProject
    .updateMany({ where: { characterId: characterId, status: "ACTIVE" }, data: { status: "CANCELLED" } })
    .catch((err) => console.error(`Failed to cancel craft projects leaving play for ${characterId}:`, err));
}


async function applyDeathToRow(
  prisma,
  character,
  { turn = null, content = null, expectStatus = "ALIVE", gib = false, noCorpse = false, cause = null } = {},
) {
  // Read BEFORE the claim, off the database not `character` (callers pass varying shapes, and a
  // gib deletes the rows outright below).
  const reborn = await prisma.characterTag
    .count({ where: { characterId: character.id, tag: { slug: METEMPSYCHOSIS_SLUG } } })
    .catch(() => 0);
  // Same reason, same timing: how many lives this soul has already spent, off
  // the dying character's own stack — a gib would otherwise erase the count
  // it is about to carry forward.
  const priorPsychosis = reborn
    ? await prisma.characterTag
        .findFirst({
          where: { characterId: character.id, tag: { slug: HEIGHTENED_PSYCHOSIS_SLUG } },
          select: { quantity: true },
        })
        .catch(() => null)
    : null;

  // Same reason, same moment: what is over the face has to be read before the
  // unequip below takes it off. A gib keeps none of it — vaporizeTags deletes
  // the row, so there is nothing left for a face to be derived from.
  const deathMaskTagId = gib ? null : await maskWornNow(prisma, character.id);

  // The turn this body fell on, for db/lib/curse.js's lapse and nothing else. Most callers already
  // hold the turn; the ones that don't are looked up here rather than left to guess. No open turn
  // (between turns, or before the game starts) stamps null, which that rule reads as "no clock".
  const deathTurn =
    turn?.number ??
    (await prisma.turn
      .findFirst({ where: { status: "OPEN" }, select: { number: true } })
      .catch(() => null))?.number ??
    null;

  const claimed = await prisma.character.updateMany({
    where: { id: character.id, status: expectStatus },
    data: {
      status: "DEAD",
      discordRoleId: null,
      catatonicSinceTurn: null,
      deathMaskTagId,
      deathTurn,
    },
  });
  if (claimed.count === 0) return { claimed: false };

  // A gib deletes the tags outright; an ordinary death only drops them out of their slots.
  if (gib) {
    const wiped = await vaporizeTags(prisma, character.id).catch((err) => {
      console.error(`Failed to vaporize tags for ${character.id}:`, err);
      return 0;
    });
    if (wiped > 0) {
      const kind = cause?.kind ?? "system";
      const actionType =
        kind === "player" ? "request_tag_wipe_gib" : kind === "gm" ? "gm_tag_wipe_gib" : "system_tag_wipe_gib";
      const actorDiscordUserId = cause?.actorDiscordUserId ?? `system:${cause?.system ?? "death"}`;
      await prisma.auditLog
        .create({
          data: {
            actorDiscordUserId,
            actionType,
            targetCharacterId: character.id,
            details: { tagCount: wiped, cause: cause?.system ?? kind },
          },
        })
        .catch((err) => console.error(`Failed to audit the gib wipe for ${character.id}:`, err));
    }
  } else {
    // A locked-on thing (the bomb collar) stays round the neck of the body: it
    // was never held, and a Revive should not come back with it unbuckled.
    await prisma.characterTag
      .updateMany({
        where: { characterId: character.id, equipped: true, tag: { slug: { notIn: [...LOCKED_ON_SLUGS] } } },
        data: { equipped: false, equippedQuantity: 0 },
      })
      .catch((err) => console.error(`Failed to unequip on death for ${character.id}:`, err));
  }

  await releaseEntanglements(prisma, character.id);

  // One Tag row in a random public Room (CORPSES.md) — a HANDLE to this sheet, so the sheet
  // follows the tag. Wrapped: a missing corpse is recoverable by hand, a half-applied death isn't.
  // `noCorpse` skips ONLY this mint, unlike `gib` — db/lib/vampireDeath.js is the one caller: a
  // vampire's ash death keeps the plain unequip above (items survive, lootable) but leaves
  // nothing bury-able, so there is no body for a corpse tag to represent.
  const corpse =
    gib || noCorpse
      ? { tag: null, room: null }
      : await mintCorpse(prisma, character, turn).catch((err) => {
          console.error(`Failed to mint a corpse for ${character.id}:`, err);
          return { tag: null, room: null };
        });

  // Everyone standing where they fell saw it (MOOD.md). Re-read, not trusted off `character`;
  // wrapped so a death is never aborted by a witness's nerves.
  await frightenWitnesses(prisma, character.id).catch((err) =>
    console.error(`Failed to frighten witnesses of ${character.id}:`, err.message ?? err),
  );

  // recordArchiveEvent already swallows its own failures, so no catch here.
  await recordArchiveEvent(prisma, {
    kind: "DEATH",
    character,
    turn,
    zoneId: character.zoneId ?? null,
    content: content ?? `${character.name} died.`,
  });

  // The soul doesn't wait for a body (db/lib/reincarnate.js). Wrapped: a failed rebirth must not
  // leave the old life half-buried; null is ordinary when no seat is free.
  if (reborn > 0) {
    // Required HERE not at the top: reincarnate -> locationMove -> ... loops back to this file,
    // and a top-level require would resolve to a half-built exports object.
    const { reincarnate } = require("./reincarnate");
    await reincarnate(prisma, character, { turn, priorPsychosisCount: priorPsychosis?.quantity ?? 0 }).catch(
      (err) => console.error(`Reincarnation failed for ${character.id}:`, err.message ?? err),
    );
  }

  return { claimed: true, corpse };
}

async function frightenWitnesses(prisma, deadCharacterId) {
  const dead = await prisma.character.findUnique({ where: { id: deadCharacterId }, select: { locationId: true } });
  if (!dead?.locationId) return;
  const witnesses = await prisma.character.findMany({
    where: { locationId: dead.locationId, status: "ALIVE", id: { not: deadCharacterId } },
    select: { id: true },
  });
  // Sequential: a burst of parallel transactions at turn close competes for pool slots.
  for (const { id } of witnesses) {
    await applyMood(prisma, id, { kind: "DEATH_SEEN" }).catch((err) =>
      console.error(`Death-seen mood failed for ${id}:`, err.message ?? err),
    );
  }
}

module.exports = { applyDeathToRow, releaseEntanglements };
