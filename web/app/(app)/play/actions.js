"use server";

import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { affordancesFor } from "@lifeweb/db/lib/placeAffordances";
import { toggleGate, holdKeyedOpen, GATE_CHARACTER_SELECT } from "@lifeweb/db/lib/gates";
import { fileMove, editMove, filedByPlayer, kindChangeUsed } from "@lifeweb/db/lib/moves";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { confirmMove } from "@lifeweb/db/lib/moveConfirm";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockFrozen } from "@lifeweb/db/lib/gameState";
import { loadDesireView } from "@/lib/selfPools";
import { withoutDmNoise, PLAYER_DM_SELECT, playerDmRow } from "@/lib/dmThread";
import { PLAYER_DM_MAX_LENGTH } from "@/lib/constants";
import { whosHere, resolveHoodToken } from "@lifeweb/db/lib/whosHere";
import { travelOptions } from "@lifeweb/db/lib/locationGraph";
import { blocksOnFoot, equippedSlugs, fastTravelCapacity } from "@lifeweb/db/lib/mounts";
import {
  performLocationMove,
  freeMovesLeft,
  freeZoneMovesReason,
} from "@lifeweb/db/lib/locationTravel";
import {
  ESCORT_SELECT as MOVER_SELECT,
  escortAuthority,
  escortCandidates,
  partyOf,
  attach,
  detach,
  createEscortOffer,
  acceptEscort,
  escortReason,
} from "@lifeweb/db/lib/escort";
import { accessibleRooms, roomAccessKeys, syncCharacterRoomAccess } from "@lifeweb/db/lib/roomAccess";
import { applyLocationMoveSideEffects } from "@lifeweb/db/lib/locationMove";
import { dismountedMessage } from "@lifeweb/db/lib/indoors";
import { boardFor, boardText, pinnedLine, tornLine, BOARD_OPTION_LIMIT } from "@lifeweb/db/lib/noticeboard";
import { paperDescription, paperView } from "@lifeweb/db/lib/paper";
import { readBlock } from "@lifeweb/db/lib/reading";
import { addToStack, dropCharacterTag } from "@lifeweb/db/lib/tagWrites";
import { expiryFrom } from "@lifeweb/db/lib/turnFormat";
import { ambientLine } from "@lifeweb/db/lib/ambientLine";
import { sceneLineAt } from "@lifeweb/db/lib/scene";
import { postMessage, startPrivateThread, addThreadMember } from "@lifeweb/db/lib/discordRest";
import {
  addConversationMember,
  removeConversationMember,
  conversationMembers,
} from "@lifeweb/db/lib/conversations";
import { toggleConceal as concealRule } from "@lifeweb/db/lib/conceal";
import { shout } from "@lifeweb/db/lib/shout";
import { castDie } from "@lifeweb/db/lib/roll";
import { addRoomGuest, removeRoomGuest, roomGuests } from "@lifeweb/db/lib/roomGuests";
import { notifyPresence } from "@lifeweb/db/lib/presenceNotify";
import { sceneLine } from "@lifeweb/db/lib/scene";
import { parsePlaceKey, discordTargetForPlaceKey } from "@lifeweb/db/lib/placeKey";
import { removeThreadMember } from "@lifeweb/db/lib/discordRest";
import { BELL_ROOM_SLUG, RING_WORD, bellWordMatches, bellCooldown, broadcastBell } from "@lifeweb/db/lib/bell";
import {
  ARM_WORD,
  DISARM_WORD,
  turretWordMatches,
  gatehouseTurretArmed,
  GATEHOUSE_LOCATION_SLUG,
  TURRET_ARMED_LINE,
  TURRET_DISARMED_LINE,
} from "@lifeweb/db/lib/gatehouseTurret";
import { INTERCOM_ROOM_SLUG, broadcastIntercom } from "@lifeweb/db/lib/intercom";
import { loadVoiceState } from "@lifeweb/db/lib/say";
import { recordArchiveMessage } from "@lifeweb/db/lib/archive";
import { acceptLesson, declineOffer } from "@lifeweb/db/lib/lessons";
import { acceptBind } from "@lifeweb/db/lib/bind";
import { acceptConfession } from "@lifeweb/db/lib/confession";
import { settleCarry, deliverCarryDrop } from "@lifeweb/db/lib/carry";
import { acceptThreatSpawn, declineThreatSpawn, applySpawnSideEffects } from "@lifeweb/db/lib/threatSpawn";
import { declineAssignment } from "@lifeweb/db/lib/lobby";
import { mayReadPlace, mayWritePlace } from "@lifeweb/db/lib/feedAccess";
import { EXAMINE_SUBJECT_SELECT, examineReadout } from "@lifeweb/db/lib/examine";
import { BLIND_SLUG } from "@lifeweb/db/lib/examineVision";
import { getMyFactionRole } from "@lifeweb/db/lib/factionPermissions";
import { photoCaption } from "@lifeweb/db/lib/photo";
import { CAMERA_SLUG, mintPhoto } from "@lifeweb/db/lib/photoMint";
import { sendDm } from "@/lib/discordGuild";
import { examineCharacter } from "@/app/(app)/character/examineActions";
import { thingGroups } from "./thingRows";

// Every button in Chat's right column, as a server action.
//
// THE CONTRACT, and it is the same one for all of them: the acting character
// is resolved from the session, never from anything posted; every gate the
// panel drew is re-checked here, because a disabled button is a hint and not
// a lock; the answer is `{ ok: true, … }` or `{ ok: false, error }`, and
// nothing throws out to the client (web/app/components/useActionRunner.js
// turns a transport failure into a sentence, and a thrown one into the wrong
// sentence).
//
// The GAME logic lives in db/lib, so the Discord button and the web dialog
// run one implementation: db/lib/gates.js, db/lib/moves.js,
// db/lib/whosHere.js, db/lib/examine.js, db/lib/locationTravel.js.
// What is written out below is the sequencing each face needs and nothing
// else.

// The acting character, from the session. `select` widens it for whichever
// action needs more; the default is what almost all of them need.
async function actor(select) {
  const session = await auth();
  if (!session?.discordUserId) return { error: "You are not signed in. ‡" };
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: select ?? {
      id: true,
      name: true,
      zoneId: true,
      locationId: true,
      factionId: true,
      discordUserId: true,
      // "Play from the web" — nothing here may touch Discord for them
      // (docs/systemdocs/CHAT.md §6).
      webOnly: true,
      // `role` and the tag slugs are what canToggleGate reads, and
      // affordancesFor asks it for every gate this character is standing at.
      role: { select: { slug: true } },
      tags: { select: { tag: { select: { slug: true } } } },
    },
  });
  if (!character) return { error: "You have no living character. ‡" };
  return { character, discordUserId: session.discordUserId };
}

// Standing in the room is the whole permission model for everything a Room
// button does — you cannot pull a bell rope from three zones away.
async function roomHere(character, roomId, slug, missing) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true },
  });
  if (!room || (slug && room.slug !== slug)) return { error: missing };
  if (character.locationId !== room.locationId) {
    return { error: `You're not standing in the ${room.name} any more. ‡` };
  }
  return { room };
}

// ---------------------------------------------------------------- the place

// The whole place panel, re-read. The page renders the first copy; this is
// what a dialog calls after it changed something a button's label depends on
// (a gate that is now shut, a door now being held).
export async function loadAffordances() {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  return { ok: true, affordances: await affordancesFor(prisma, me.character) };
}

export async function loadPeopleHere() {
  const me = await actor({ id: true, factionId: true, locationId: true });
  if (me.error) return { ok: false, error: me.error };
  const rows = await whosHere(prisma, me.character);
  return { ok: true, ...rows };
}

// Looking at somebody whose face you cannot see. The token is what
// db/lib/whosHere.js handed the page for a hood — an HMAC of the character id,
// so the browser is never told who is under it — and it is resolved here
// against the people actually standing at the looker's own Location. The
// readout itself is the sheet's own examineCharacter(), which re-resolves the
// looker from the session and re-checks co-presence a second time.
export async function examineHooded(token) {
  const me = await actor({ id: true, factionId: true, locationId: true });
  if (me.error) return { ok: false, error: me.error };
  const targetId = await resolveHoodToken(prisma, me.character, token);
  if (!targetId) return { ok: false, error: "They aren't here any more. ‡" };
  return examineCharacter(targetId);
}

// Photographing what somebody said — the web twin of the 📸 reaction
// (bot/src/events/messageReactionAdd.js#handleCameraReaction). The row is the
// only thing the browser sends; who spoke, whether they were hooded and
// whether this reader may see the place are all resolved here.
//
// The camera is NOT spent: holding one is the whole gate, and film is not a
// system anybody asked for. What bounds it instead is one shot per line per
// photographer — otherwise a reader could mint unbounded Tag rows off one
// message, and every one of those is a permanent catalog row. The bot keeps
// that bound in memory, which a restart empties and which the web process
// could never share, so this one is a row in AuditLog. It is the same shot
// either way, so the two faces refusing separately costs a player nothing.
//
// No `turnId`: that column is for the per-turn rations that count these rows
// (REQUESTS.md §1a), and this ration is per LINE rather than per turn.
const PHOTO_ACTION = "photo_taken";

export async function photographRow(seq) {
  const me = await actor({
    id: true,
    factionId: true,
    locationId: true,
    discordUserId: true,
    tags: { select: { quantity: true, tag: { select: { slug: true } } } },
  });
  if (me.error) return { ok: false, error: me.error };
  const character = me.character;

  const holds = (slug) => character.tags.some((ct) => ct.tag?.slug === slug && (ct.quantity ?? 0) > 0);

  // Framing a shot is something you do by eye. Gated exactly as 🔍 and 📸
  // are, and with the bot's own sentence.
  if (holds(BLIND_SLUG)) {
    return { ok: false, error: "You can't see." };
  }
  if (!holds(CAMERA_SLUG)) return { ok: false, error: "You have no camera." };

  let key;
  try {
    key = BigInt(seq);
  } catch {
    return { ok: false, error: "That line is gone." };
  }

  const row = await prisma.archiveEntry.findUnique({
    where: { seq: key },
    select: { seq: true, kind: true, placeKey: true, characterId: true, concealedAlias: true, deletedAt: true },
  });
  if (!row || row.kind !== "MESSAGE" || row.deletedAt || !row.characterId) {
    return { ok: false, error: "That line is gone." };
  }
  if (row.characterId === character.id) return { ok: false, error: "Point it at somebody else. ‡" };

  // The same gate the feed itself reads by (db/lib/feedAccess.js). A seq is a
  // guessable number, so this is what stops one being pointed at a room the
  // reader is standing outside of.
  const allowed =
    Boolean(row.placeKey) &&
    (await mayReadPlace(prisma, character, row.placeKey, { gm: false, discordUserId: me.discordUserId }));
  if (!allowed) return { ok: false, error: "That line is gone." };

  // One shot per line per photographer, read off the INDEXED columns.
  // AuditLog has (actorDiscordUserId, actionType, turnId) and (actionType);
  // it has no index over `details`, so a `path: ["seq"]` filter was a scan of
  // the whole table on a button anybody can press. The seq is checked in JS
  // over this photographer's own prints, which is a handful of rows.
  const mine = await prisma.auditLog.findMany({
    where: { actorDiscordUserId: me.discordUserId, actionType: PHOTO_ACTION },
    select: { details: true },
  });
  const wanted = String(row.seq);
  if (mine.some((entry) => String(entry.details?.seq ?? "") === wanted)) {
    return { ok: false, error: "You already have that shot. ‡" };
  }

  const subject = await prisma.character.findUnique({
    where: { id: row.characterId },
    select: EXAMINE_SUBJECT_SELECT,
  });
  if (!subject) return { ok: false, error: "That line is gone." };

  // The hood the ROOM SAW, which outlives the hood they are wearing now: a
  // print filed under a real name nobody present ever heard would be a
  // permanent unmasking of somebody who spoke masked.
  const hooded = row.concealedAlias != null;

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  // A Leader/Treasurer of the subject's own faction reads their ⬢, the same
  // seat the readout gives 🔍. Nothing else of the viewer's sight survives —
  // `viewerTags: []` and an empty `satisfied` are what "a lens has no medical
  // training" means, and without them a surgeon's photograph would launder
  // their diagnosis into whoever they handed the print to.
  const officer =
    !hooded && subject.factionId
      ? (await getMyFactionRole(prisma, me.discordUserId, subject.factionId)).isOfficer
      : false;

  const readout = examineReadout({
    subject: hooded ? { ...subject, concealed: true } : subject,
    viewerTags: [],
    satisfied: new Set(),
    openTurnNumber: openTurn?.number,
    lastDesire: null,
    viewerFactionId: character.factionId ?? null,
    viewerIsOfficer: officer,
    wasConcealedAs: hooded ? row.concealedAlias : null,
  });

  // No transaction: nothing is spent, so there is nothing that has to be
  // atomic with the print — and mintPhoto's collision retry cannot run inside
  // one (db/lib/photoMint.js#createWithRetry).
  const photo = await mintPhoto(prisma, character.id, {
    subject: readout.name,
    caption: photoCaption(readout),
    subjectCharacterId: subject.id,
  });

  // Written only once the print exists, so a failed mint leaves the shot
  // there to try again rather than burning it.
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: me.discordUserId,
      actionType: PHOTO_ACTION,
      targetCharacterId: row.characterId,
      details: { seq: String(row.seq), placeKey: row.placeKey, hooded, photoTagId: photo.id, photoName: photo.name },
    },
  });

  return {
    ok: true,
    readout,
    photoName: photo.name,
    line: `You take a photograph of ${readout.name}. ‡`,
  };
}

// ⭐ from the web. The twin of the reaction in Discord
// (bot/src/events/messageReactionAdd.js#handleStarReaction) and it writes the
// same `Note` row, so a line starred here and a line starred there land on the
// same /notes page in the same shape.
//
// A line with no Discord message behind it — a web-only player's, or one the
// outbox has not pushed yet — still needs a stable key for Note's
// (discordMessageId, discordUserId) unique, so it is filed under its seq
// instead. Using the real message id when there is one is what keeps a ⭐ in
// Discord and a ⭐ here from making two notes out of one message.
export async function starRow(seq) {
  // locationId is what db/lib/feedAccess.js#placesFor reads — without it the
  // place list comes back empty and every star is refused.
  const me = await actor({ id: true, name: true, discordUserId: true, zoneId: true, locationId: true });
  if (me.error) return { ok: false, error: me.error };
  const character = me.character;

  let key;
  try {
    key = BigInt(seq);
  } catch {
    return { ok: false, error: "That line is gone." };
  }

  const row = await prisma.archiveEntry.findUnique({
    where: { seq: key },
    select: {
      seq: true,
      kind: true,
      placeKey: true,
      content: true,
      sentAt: true,
      zoneId: true,
      characterId: true,
      characterName: true,
      concealedAlias: true,
      discordMessageId: true,
      discordChannelId: true,
      deletedAt: true,
    },
  });
  if (!row || row.deletedAt || !row.content) return { ok: false, error: "That line is gone." };

  // The same gate the feed itself reads by (db/lib/feedAccess.js). A seq is a
  // guessable number, so this is what stops one being starred out of a room
  // the reader is standing outside of.
  const allowed =
    Boolean(row.placeKey) &&
    (await mayReadPlace(prisma, character, row.placeKey, { gm: false, discordUserId: me.discordUserId }));
  if (!allowed) return { ok: false, error: "That line is gone." };

  await prisma.note.upsert({
    where: {
      discordMessageId_discordUserId: {
        discordMessageId: row.discordMessageId ?? `seq:${row.seq}`,
        discordUserId: me.discordUserId,
      },
    },
    create: {
      discordMessageId: row.discordMessageId ?? `seq:${row.seq}`,
      discordChannelId: row.discordChannelId ?? "",
      characterId: row.characterId,
      // Filed under the alias a concealed or forced line was said as, for the
      // reason handleStarReaction gives: the note is private, but writing the
      // real name into it hands the starrer what the hood was hiding.
      characterName: row.concealedAlias ?? row.characterName ?? "Bascinet",
      zoneId: row.zoneId ?? null,
      content: row.content,
      sentAt: row.sentAt,
      discordUserId: me.discordUserId,
    },
    update: {},
  });

  return { ok: true, line: "Saved to your Notes." };
}

// What is lying in a room's stash, as STRUCTURE rather than as a sentence.
//
// It used to answer with formatStashLine's Discord line — `-# 0 ⬢ | **Tags**:
// Paper ×23` — which the column then printed raw, subtext marker, asterisks
// and all. That helper stays exactly as it is for the bot, which is talking
// into a channel that renders those markers. The web draws its own chips off
// the rows, so nothing is being formatted twice.
// THE THINGS DRAWER (CHAT.md §7). What is in this character's pockets, in the
// two categories a player carries — read back after every Equip, Use, Give or
// Destroy, and on the column's own minute, so a thing handed over in Discord
// stops being listed here without a reload.
//
// Nothing is decided in the browser: the four verbs come off the catalog flags
// through ./thingRows.js, and each one re-checks itself when it is pressed.
export async function myThings() {
  const me = await actor({
    id: true,
    tags: {
      select: {
        id: true,
        tagId: true,
        quantity: true,
        equipped: true,
        tag: {
          select: {
            id: true,
            name: true,
            category: true,
            equippable: true,
            consumable: true,
            tradeable: true,
            removable: true,
          },
        },
      },
    },
  });
  if (me.error) return { ok: false, error: me.error };
  return { ok: true, groups: thingGroups(me.character.tags) };
}

export async function readStash(roomId) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const rooms = await prisma.room.findMany({
    where: { locationId: me.character.locationId ?? "" },
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
      accessTagSlugs: true,
      resources: true,
      tags: {
        where: { quantity: { gt: 0 } },
        orderBy: { tag: { name: "asc" } },
        select: { tagId: true, quantity: true, tag: { select: { name: true } } },
      },
    },
  });
  const keys = await roomAccessKeys(prisma, me.character.id);
  // A room you cannot get into is a locked door, not an empty one.
  const room = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds).find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "You can't get in there. ‡" };
  return {
    ok: true,
    name: room.name,
    resources: room.resources ?? 0,
    items: (room.tags ?? [])
      .filter((rt) => (rt.quantity ?? 0) > 0)
      .map((rt) => ({ tagId: rt.tagId, name: rt.tag.name, quantity: rt.quantity })),
  };
}

// ---------------------------------------------------------------- travelling

export async function loadTravel() {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const character = me.character;
  if (!character.locationId) return { ok: false, error: "You are nowhere yet." };

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  const heading = character.travelToLocationId
    ? await prisma.location.findUnique({ where: { id: character.travelToLocationId }, select: { name: true } })
    : null;

  const [options, party] = await Promise.all([
    travelOptions(prisma, character, character.locationId),
    partyOf(prisma, character.id),
  ]);

  return {
    ok: true,
    // Already walking? A paid crossing is a day on the road, and the only
    // thing on offer is turning round.
    heading: heading?.name ?? null,
    // Both count the party: over the mount's seats, the extra crossing it
    // buys is gone, and the number here has to already say so (MAP.md §3a).
    freeLeft: freeMovesLeft(character, config, openTurn, party.length),
    freeReason: freeZoneMovesReason(character, party.length),
    // Whether there's anything to dismount at all — the node list only
    // marks a specific way or a specific destination as a consequence when
    // this is true, since neither "on foot" nor "indoors" means anything to
    // somebody already walking.
    mounted: blocksOnFoot(equippedSlugs(character.tags ?? [])),
    options: options.map((row) => ({
      id: row.location.id,
      name: row.location.name,
      // Already loaded: locationGraph's LINK_INCLUDE pulls whole Location rows
      // on both ends of a link, so this costs no query. The node draws it so
      // the way out says what it leads to, not just where.
      description: row.location.description || null,
      zoneName: row.location.zone?.name ?? null,
      crossesZone: row.crossesZone,
      passable: row.passable,
      // A Location a mount gets parked at on arrival (db/lib/indoors.js).
      indoors: Boolean(row.location.indoors),
      // A way too narrow to ride or push through — crossing it dismounts
      // instead of refusing (db/lib/indoors.js#dismountForNarrowWay).
      dismounts: Boolean(row.dismounts),
      // crossingCheck's field is `refusal`, not `reason` — this was silently
      // dropping the actual message (e.g. the locked/shut wording) and
      // falling back to the node's generic "no way".
      reason: row.refusal ?? null,
    })),
    partySize: party.length,
  };
}

// ------------------------------------------------------------------ escort

// The party rack: who is standing here, who is already with you, and how many
// seats your mount has. One round trip, polled by the panel the way HereList
// polls its own list — somebody walking up to you has to appear.
export async function loadParty() {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const character = me.character;

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const [candidates, party, incoming] = await Promise.all([
    escortCandidates(prisma, character, openTurn?.number ?? null),
    partyOf(prisma, character.id),
    // Asks aimed at THIS character. The Discord buttons are unreachable for a
    // web-only player, so the rack answers them too.
    prisma.offer.findMany({
      where: { kind: "ESCORT", status: "PENDING", responderId: character.id },
      select: { id: true, initiator: { select: { name: true } } },
    }),
  ]);

  return {
    ok: true,
    seats: fastTravelCapacity(equippedSlugs(character.tags ?? [])),
    candidates,
    // The rack draws this, in the order they were picked up. Its verdict is
    // re-derived rather than read off `candidates`: a follower can be with you
    // and no longer be a candidate, which is exactly the state a stale
    // attachment leaves and exactly what the rack has to keep showing.
    party: party.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      reason: escortReason(row, escortAuthority(character, row, openTurn?.number ?? null)),
    })),
    incoming: incoming.map((offer) => ({ id: offer.id, from: offer.initiator?.name ?? "Somebody" })),
  };
}

// Pick somebody up. FORCED and CONSENTED attach at once; anyone else is asked
// and attaches only when they accept. The verdict is re-derived here — the
// panel's is a hint, and this is a public endpoint.
export async function bringAlong(targetId) {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const target = await prisma.character.findUnique({ where: { id: targetId ?? "" }, select: MOVER_SELECT });
  const verdict = escortAuthority(me.character, target, openTurn?.number ?? null);
  if (!verdict) return { ok: false, error: "You can't take them along. ‡" };

  if (verdict === "ASK") {
    if (!openTurn) return { ok: false, error: "No turn is open." };
    const offer = await createEscortOffer(prisma, { actor: me.character, target, turn: openTurn });
    if (!offer.ok) return { ok: false, error: offer.reason };
    await sendDm(offer.dm.discordUserId, offer.dm.content, { components: offer.dm.components }).catch(() => {});
    return { ok: true, line: `You asked ${target.name} to come with you. ‡` };
  }

  if (!(await attach(prisma, me.character.id, target.id))) {
    return { ok: false, error: "Somebody else has them. ‡" };
  }
  return { ok: true, line: `${target.name} is with you. ‡` };
}

// Put somebody down. Always allowed: letting go is never gated.
export async function putDown(targetId) {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const target = await prisma.character.findFirst({
    where: { id: targetId ?? "", escortedById: me.character.id },
    select: { id: true, name: true },
  });
  if (!target) return { ok: false, error: "They aren't with you. ‡" };
  await detach(prisma, target.id);
  return { ok: true, line: `You let ${target.name} go. ‡` };
}

// Answering an ask from the web, for a player who never opens Discord. The
// same two functions the bot's buttons call, so the two faces cannot drift.
export async function answerEscort({ offerId, accept } = {}) {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const offer = await prisma.offer.findFirst({
    where: { id: offerId ?? "", kind: "ESCORT", status: "PENDING", responderId: me.character.id },
  });
  if (!offer) return { ok: false, error: "That offer's gone. ‡" };

  const result = accept
    ? await acceptEscort(prisma, offer, me.character)
    : await declineOffer(prisma, offer, me.character);
  for (const dm of result.dms ?? []) {
    await sendDm(dm.discordUserId, dm.content).catch(() => {});
  }
  return result.ok ? { ok: true, line: result.line } : { ok: false, error: result.reason };
}

export async function travelTo({ locationId } = {}) {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };

  const target = await prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } });
  if (!target) return { ok: false, error: "That place no longer exists. ‡" };

  // Who comes along is read off Character.escortedById inside the move's own
  // transaction — nothing is posted from the browser, so there is nothing to
  // re-authorize here (MAP.md §3a).
  const result = await performLocationMove(prisma, me.character, target);
  if (!result.ok) return { ok: false, error: result.reason };

  // Followers the way would not take: already detached, still standing where
  // they were. The leader's line must not name the reason — a hidden crawl's
  // refusal would announce that the crawl is there (MAP.md §2a).
  const stranded = [];
  for (const entry of result.leftBehind ?? []) {
    stranded.push(entry.character.name);
    if (entry.character.status !== "ALIVE" || !entry.character.discordUserId) continue;
    await sendDm(entry.character.discordUserId, `*${me.character.name} went on without you.* ‡`).catch(() => {});
  }

  // A paid crossing is a day on the road: nobody has moved yet, so there are
  // no roles to swap — db/lib/travelArrivalPass.js does all of it at the next
  // turn advance (MAP.md §3). The one thing owed now is a word to the
  // passengers, who did not press anything.
  if (result.deferred) {
    for (const entry of result.travelers) {
      if (entry.character.id === me.character.id) continue;
      if (entry.character.status !== "ALIVE" || !entry.character.discordUserId) continue;
      await sendDm(
        entry.character.discordUserId,
        `*${me.character.name} is taking you to ${target.name}. You'll get there next turn.* ‡`,
      ).catch(() => {});
    }
    const setOut = [`You set out for ${target.name}. You arrive next turn, and your Move is spent.`];
    if (stranded.length > 0) setOut.push(`You can't move ${stranded.join(", ")} through here.`);
    // dismountedMessage already carries its own mark, so only one ‡ ends the
    // block either way.
    if (result.dismounted.length > 0) setOut.push(dismountedMessage(result.dismounted));
    return { ok: true, line: result.dismounted.length > 0 ? setOut.join(" ") : `${setOut.join(" ")} ‡` };
  }

  // Sequential on purpose: each entry is a handful of REST calls, and firing
  // a whole dragged party's worth at once is the shape that trips the
  // invalid-response breaker (db/lib/discordRest.js).
  for (const entry of result.moved) {
    await applyLocationMoveSideEffects(prisma, {
      characterId: entry.character.id,
      fromLocationId: entry.fromLocationId,
      toLocationId: entry.toLocationId,
      // Only ever computed for the mover themselves — performLocationMove
      // checks the mover's own equipped mount against the edge, never a
      // dragged passenger's.
      dismounted: entry.character.id === me.character.id ? result.dismounted : undefined,
    }).catch(() => {});
  }
  // The Caving Die's "on arrival" trigger (CAVING.md), and the word owed to
  // anybody who was carried off without pressing anything.
  for (const entry of result.moved) {
    if (entry.cavingDm) await sendDm(entry.cavingDm.discordUserId, entry.cavingDm.content).catch(() => {});
  }
  const brought = [];
  for (const entry of result.moved) {
    if (entry.character.id === me.character.id) continue;
    brought.push(entry.character.name);
    if (entry.character.status !== "ALIVE" || !entry.character.discordUserId) continue;
    await sendDm(
      entry.character.discordUserId,
      `*${me.character.name} brought you along to ${target.name}.* ‡`,
    ).catch(() => {});
  }

  const parts = [`Moved to ${target.name}.`];
  if (result.usedFreeMove) {
    parts.push(
      result.freeMovesLeft > 0
        ? `${result.freeMovesLeft} free ${result.freeMovesLeft === 1 ? "move" : "moves"} left this turn.`
        : "That was your last free move this turn.",
    );
  }
  if (brought.length > 0) parts.push(`Bringing ${brought.join(", ")}.`);
  if (stranded.length > 0) parts.push(`You can't move ${stranded.join(", ")} through here.`);
  return { ok: true, line: `${parts.join(" ")} ‡` };
}

// ------------------------------------------------------------------- gates

export async function flipGate(linkId) {
  const me = await actor(GATE_CHARACTER_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const result = await toggleGate(prisma, {
    character: me.character,
    linkId,
    actorDiscordUserId: me.discordUserId,
  });
  if (!result.ok) return { ok: false, error: result.error };
  // Redrawing the Discord anchor and the watchtower's starter is a
  // Discord-only follow-up and stays with the bot, which owns those messages
  // — the gate itself is already flipped either way, so nothing here waits
  // on it. The bot redraws on its own click and on the next channel doctor
  // pass.
  return { ok: true, line: result.line };
}

export async function holdKeyed(linkId) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const result = await holdKeyedOpen(prisma, { discordUserId: me.discordUserId, linkId, hold: true });
  return result.ok ? { ok: true, line: result.line, note: result.note } : { ok: false, error: result.error };
}

// ------------------------------------------------------------- noticeboard

// A paper's whole Tag row, because paperDescription and readBlock both need
// it — a `select` beside a nested `include` is not a shape Prisma accepts.
const BOARD_ACTOR_SELECT = {
  id: true,
  name: true,
  locationId: true,
  discordUserId: true,
  tags: { select: { tagId: true, equipped: true, tag: true } },
};

// The board where this character is standing. The LOAD is
// db/lib/noticeboard.js#boardFor, which is Location-keyed and knows nothing
// about who is asking; the actor gate — you have to be standing here — is
// this line, and it stays on this side.
async function boardHere(character) {
  return boardFor(prisma, character.locationId);
}

export async function readBoard() {
  const me = await actor(BOARD_ACTOR_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const ctx = await boardHere(me.character);
  if (ctx.error) return { ok: false, error: ctx.error };

  // Written or sealed, and never gated on whether they can read it: pinning
  // up a letter you cannot read yourself is a perfectly good thing to do.
  const holding = me.character.tags
    .filter((ct) => ct.tag.paperKind === "PAPER" || ct.tag.paperKind === "SEALED")
    .slice(0, BOARD_OPTION_LIMIT)
    .map((ct) => ({ tagId: ct.tagId, name: ct.tag.name, sealed: ct.tag.paperKind === "SEALED" }));

  return {
    ok: true,
    heading: boardText(ctx.location.name, ctx.posts, ctx.openTurn?.number ?? 0),
    notices: ctx.posts.map((p) => ({ id: p.id, name: p.tag.name })),
    holding,
  };
}

export async function readNotice(postId) {
  const me = await actor(BOARD_ACTOR_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const ctx = await boardHere(me.character);
  if (ctx.error) return { ok: false, error: ctx.error };
  const post = ctx.posts.find((p) => p.id === postId);
  if (!post) return { ok: false, error: "It's gone." };

  const where = { phase: ctx.openTurn?.phase ?? null, indoors: ctx.location.indoors ?? true };
  // The same predicate the tag chip uses, and the same sentence — a blind
  // reader and an illiterate one get identical refusals, so neither the
  // reader nor anyone watching learns which it was.
  const reader = { tags: me.character.tags, ...where };
  const text = paperDescription(post.tag, reader);
  const blocked = Boolean(readBlock(me.character.tags, where)) || post.tag.paperKind === "SEALED";
  // Nobody is told it was read. `paper` is what PaperSheet.js draws; `text`
  // and `plain` stay for anything still reading the flat shape.
  return { ok: true, name: post.tag.name, text, plain: blocked, paper: paperView(post.tag, reader) };
}

export async function tearNotice(postId) {
  const me = await actor(BOARD_ACTOR_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const ctx = await boardHere(me.character);
  if (ctx.error) return { ok: false, error: ctx.error };
  const post = ctx.posts.find((p) => p.id === postId);
  if (!post) return { ok: false, error: "It's gone." };

  // The delete IS the claim, so two people tearing at the same paper cannot
  // both walk away with it.
  const claimed = await prisma.noticePost.deleteMany({ where: { id: post.id } });
  if (claimed.count === 0) return { ok: false, error: "Somebody got there first." };
  await addToStack(prisma, me.character.id, post.tagId, 1, {});

  if (ctx.location.discordChannelId) {
    // Catch-logged: an unreachable channel must never undo a tear that has
    // already committed (ARCHITECTURE.md §5).
    await postMessage(ctx.location.discordChannelId, ambientLine(tornLine(post.tag.name))).catch(() => {});
  }
  // The same row the bot's board writes (db/lib/scene.js) — a tear on the web
  // and a tear on Discord are one event, and Chat shows both.
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: tornLine(post.tag.name) });
  return { ok: true, line: `You take ${post.tag.name} down.` };
}

export async function pinNotice(tagId) {
  const me = await actor(BOARD_ACTOR_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const ctx = await boardHere(me.character);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!ctx.openTurn) return { ok: false, error: "Nothing is happening yet." };

  const held = me.character.tags.find((ct) => ct.tagId === tagId);
  // "Has a paperKind" is not the check: a spent envelope and a bound book
  // both have one, and neither goes up on a wall.
  if (!held || (held.tag.paperKind !== "PAPER" && held.tag.paperKind !== "SEALED")) {
    return { ok: false, error: "You aren't holding that." };
  }

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { noticeExpiryTurns: true } });
  // N turns means N turns, counting the one it went up in.
  const expiresTurn = expiryFrom(ctx.openTurn.number, config?.noticeExpiryTurns ?? 10);

  try {
    await prisma.$transaction(async (tx) => {
      // NoticePost.tagId is @unique: a paper is on a board or in somebody's
      // hands, never both. Creating first means a paper already pinned
      // somewhere else fails here rather than being silently taken off a
      // sheet and lost.
      await tx.noticePost.create({
        data: {
          locationId: ctx.location.id,
          tagId: held.tagId,
          postedById: me.character.id,
          postedTurn: ctx.openTurn.number,
          expiresTurn,
        },
      });
      await dropCharacterTag(tx, me.character.id, held.tagId, 1);
    });
  } catch (err) {
    if (err?.code === "P2002") return { ok: false, error: "That one is already up somewhere. ‡" };
    return { ok: false, error: "That didn't go up." };
  }

  if (ctx.location.discordChannelId) {
    await postMessage(ctx.location.discordChannelId, ambientLine(pinnedLine(held.tag.name))).catch(() => {});
  }
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: pinnedLine(held.tag.name) });
  return { ok: true, line: `You nail ${held.tag.name} up. Anyone here can read it, or take it down. ‡` };
}

// ------------------------------------------------------------- conversation

export async function converseRooms() {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const [rooms, keys] = await Promise.all([
    prisma.room.findMany({
      where: { locationId: me.character.locationId ?? "", discordThreadId: { not: null } },
      select: { id: true, name: true, kind: true, accessTagSlugs: true },
      orderBy: { sortOrder: "asc" },
    }),
    roomAccessKeys(prisma, me.character.id),
  ]);
  const open = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds);
  return { ok: true, rooms: open.map((r) => ({ id: r.id, name: r.name, private: r.kind === "PRIVATE" })) };
}

export async function openConversation({ roomId, name, inviteIds = [] } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };

  const trimmed = String(name ?? "").trim().slice(0, 90);
  if (!trimmed) return { ok: false, error: "Give it a name." };

  const room = await prisma.room.findUnique({ where: { id: roomId }, include: { location: true } });
  if (!room) return { ok: false, error: "That room no longer exists. ‡" };
  if (me.character.locationId !== room.locationId) {
    return { ok: false, error: `You're not in ${room.location.name} any more. ‡` };
  }
  if (!room.location.discordChannelId) {
    return { ok: false, error: "That place has no channel yet — tell a GM. ‡" };
  }
  // The same locked-door rule the Discord picker applies.
  const keys = await roomAccessKeys(prisma, me.character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds).length === 0) {
    return { ok: false, error: "You can't get in there. ‡" };
  }

  // The thread hangs off the LOCATION channel, not the room thread: Discord
  // has no threads inside threads. The room is the link the whisper poll
  // reads, nothing more.
  let thread;
  try {
    thread = await startPrivateThread(room.location.discordChannelId, trimmed);
    // A "web only" creator stays out of their own thread's member list
    // (docs/systemdocs/CHAT.md §6); the membership row below is the truth.
    if (me.character.discordUserId && !me.character.webOnly) {
      await addThreadMember(thread.id, me.character.discordUserId);
    }
  } catch {
    return { ok: false, error: "Couldn't open that — try again, or tell a GM. ‡" };
  }

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  const conversation = await prisma.playerThread.create({
    data: {
      threadId: thread.id,
      name: trimmed,
      locationId: room.locationId,
      roomId: room.id,
      creatorCharacterId: me.character.id,
      creatorDiscordUserId: me.character.discordUserId,
      lastActivityTurn: openTurn?.number ?? null,
    },
  });
  // The creator is a member like anybody else — the thread add above is only
  // Discord's copy of that fact (db/lib/conversations.js).
  await addConversationMember(prisma, { playerThreadId: conversation.id, characterId: me.character.id });

  // Anybody the dialog was opened ON. Converse hangs off a person's row, so
  // the person whose row it was is ticked when it opens — and this is where
  // that tick becomes a membership row. The ids the browser sent are never
  // trusted: only somebody ALIVE and standing at this same Location is added,
  // which is the same co-presence rule every other people action here uses.
  const wanted = [...new Set((Array.isArray(inviteIds) ? inviteIds : []).map(String))].filter(
    (id) => id && id !== me.character.id,
  );
  if (wanted.length > 0) {
    const guests = await prisma.character.findMany({
      where: { id: { in: wanted }, status: "ALIVE", locationId: room.locationId },
      select: { id: true, discordUserId: true, webOnly: true },
    });
    for (const guest of guests) {
      // The ROW first, then the account: membership is a database fact and
      // Discord is its projection, so a failed thread add never decides
      // whether the conversation is in somebody's places.
      await addConversationMember(prisma, { playerThreadId: conversation.id, characterId: guest.id });
      if (guest.discordUserId && !guest.webOnly) {
        await addThreadMember(thread.id, guest.discordUserId).catch(() => {});
      }
    }
  }
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: me.discordUserId,
        actionType: "conversation_opened",
        targetCharacterId: me.character.id,
        details: { threadId: thread.id, name: trimmed, room: room.name, location: room.location.name },
      },
    })
    .catch(() => {});

  return { ok: true, line: "Opened. It is in your places now. ‡" };
}

// ------------------------------------------------------- bell, PA, the gun

export async function ringBell({ roomId, word } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, BELL_ROOM_SLUG, "There's no bell here.");
  if (found.error) return { ok: false, error: found.error };
  if (!bellWordMatches(word)) return { ok: false, error: `Type ${RING_WORD} to pull the rope. ‡` };

  // Read AFTER the word, so an abandoned dialog never reports a wait it was
  // not going to trigger anyway.
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { bellRungAt: true } });
  const { ok, secondsLeft } = bellCooldown(state?.bellRungAt);
  if (!ok) {
    // Minutes, not raw seconds: at a half-hour cooldown "1487s" is arithmetic
    // homework rather than an answer.
    const minutes = Math.max(1, Math.ceil(secondsLeft / 60));
    return {
      ok: false,
      error: `The bell is still humming from the last pull. About ${minutes} more minute${minutes === 1 ? "" : "s"}. ‡`,
    };
  }

  await prisma.gameState.update({ where: { id: 1 }, data: { bellRungAt: new Date() } });
  const { sent, failed } = await broadcastBell(prisma);
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: me.discordUserId,
        actionType: "bell_rung",
        targetCharacterId: me.character.id,
        details: { characterName: me.character.name, sent, failed },
      },
    })
    .catch(() => {});

  return {
    ok: true,
    line: failed.length
      ? `You haul on the rope. It carries to ${sent} place${sent === 1 ? "" : "s"}, and not to ${failed.join(", ")}. ‡`
      : "You haul on the rope, and the whole barony hears it. ‡",
  };
}

export async function turretState(roomId) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, null, "There's no button here.");
  if (found.error) return { ok: false, error: found.error };
  const armed = await gatehouseTurretArmed(prisma);
  return { ok: true, armed, word: armed ? DISARM_WORD : ARM_WORD };
}

export async function toggleTurret({ roomId, word } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, null, "There's no button here.");
  if (found.error) return { ok: false, error: found.error };

  // Re-read rather than trusting what the dialog was drawn against — two
  // people in the office can open it in the same moment, and the word they
  // were asked to type is what says which way they meant to throw it.
  const armed = await gatehouseTurretArmed(prisma);
  if (!turretWordMatches(word, armed)) {
    return { ok: false, error: `Type ${armed ? DISARM_WORD : ARM_WORD} to confirm.` };
  }

  const next = !armed;
  await prisma.gameState.update({ where: { id: 1 }, data: { gatehouseTurretArmed: next } });

  // The yard hears it, and that is the only warning anybody in it gets. Best
  // effort — the switch is thrown either way.
  const gatehouse = await prisma.location
    .findUnique({ where: { slug: GATEHOUSE_LOCATION_SLUG }, select: { discordChannelId: true } })
    .catch(() => null);
  if (gatehouse?.discordChannelId) {
    const line = next ? TURRET_ARMED_LINE : TURRET_DISARMED_LINE;
    await postMessage(gatehouse.discordChannelId, ambientLine(line.text, [], { signed: line.signed })).catch(() => {});
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: me.discordUserId,
        actionType: "gatehouse_turret_toggled",
        details: { armed: next, characterId: me.character.id, characterName: me.character.name },
      },
    })
    .catch(() => {});

  return {
    ok: true,
    line: next
      ? "The button clicks down. Somewhere below, the rotor comes alive. ‡"
      : "The button clicks up, and the yard goes quiet. ‡",
  };
}

export async function speakOnIntercom({ roomId, body } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, INTERCOM_ROOM_SLUG, "There's no intercom here.");
  if (found.error) return { ok: false, error: found.error };

  const text = String(body ?? "").trim();
  if (!text) return { ok: false, error: "Say something first." };

  const voice = await loadVoiceState(prisma, me.character.id);
  if (voice.block) return { ok: false, error: `You can't get the words out — you're ${voice.block.name}. ‡` };

  const { sent, failed } = await broadcastIntercom(prisma, text);

  // The transcript. One row for the broadcast, not one per zone — it was one
  // thing said, heard in several places. The speaker IS recorded even though
  // the channel line names nobody.
  await recordArchiveMessage(prisma, { character: me.character, content: text, channelKind: "intercom" }).catch(
    () => {},
  );
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: me.discordUserId,
        actionType: "intercom_broadcast",
        targetCharacterId: me.character.id,
        details: { body: text, zonesReached: sent, zonesFailed: failed },
      },
    })
    .catch(() => {});

  return {
    ok: true,
    line: "Your voice goes out across Ravenheart. ‡",
    note: failed.length > 0 ? `Nothing came through in ${failed.join(", ")}. ‡` : null,
  };
}

// --------------------------------------------------------------------- you

export async function submitMove({ moveKind, description } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const result = await fileMove(prisma, {
    character: me.character,
    actorDiscordUserId: me.discordUserId,
    moveKind,
    description,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // Filing is only half of it. The bot's modal
  // (bot/src/events/interactionCreate.js#handleMoveSubmit) confirms straight
  // after, and a Move that is never confirmed stays PENDING_TYPE: the staged
  // push (db/lib/stagedPush.js) skips it, the GM desk never lists it, and
  // re-filing is blocked — the player loses the turn and is told nothing.
  // Same call, same order, same arguments.
  const loaded = await prisma.action.findUnique({
    where: { id: result.action.id },
    include: { character: { include: { tags: { include: { tag: true } } } } },
  });
  const { roll } = await confirmMove(prisma, loaded, me.discordUserId, { laborRate: result.laborRate });

  // The bot answers in Discord markdown; this panel prints plain text, so the
  // same facts are said in words. The Gambit roll itself stays hidden until
  // the turn-end reveal, exactly as it does in Discord.
  const parts = ["Filed and locked in."];
  if (roll.gambit) parts.push("The die is cast — you'll see how it fell when the turn ends. ‡");
  if (roll.resourceValue != null) {
    parts.push(`Your day's work (${roll.expression}) came to ${roll.resourceValue > 0 ? "+" : ""}${roll.resourceValue} ⬢. ‡`);
    if (roll.bonusNote) parts.push(roll.bonusNote);
  }
  return { ok: true, line: parts.join(" ") };
}

// The turn card's own state, re-read: which turn is open, whether the Move
// window has shut, and the Move this character has already filed into it.
// Polled beside waitingOnYou, so a Move filed from Discord shows up here
// without a reload.
//
// `editable` is the same predicate db/lib/moves.js#editMove re-checks — a
// hint for whether to draw the button, never the lock.
export async function myMove() {
  const me = await actor({
    id: true,
    discordUserId: true,
    tags: { select: { tag: { select: { slug: true, name: true } } } },
  });
  if (me.error) return { ok: false, error: me.error };

  const openTurn = await prisma.turn.findFirst({
    where: { status: "OPEN" },
    select: { id: true, number: true, phase: true, startedAt: true },
  });
  if (!openTurn) return { ok: true, turn: null, move: null };

  const [frozen, action] = await Promise.all([
    clockFrozen(prisma),
    prisma.action.findFirst({
      where: { characterId: me.character.id, turnId: openTurn.id },
      select: {
        id: true,
        moveKind: true,
        description: true,
        status: true,
        moveReviewStatus: true,
        lockExpiresAt: true,
        appliedEffects: true,
        // The `auto:` marker that says a lesson, a confession, the auto-labor
        // pass or a travel stub wrote this row rather than the player
        // (db/lib/moves.js#filedByPlayer). Without it the Edit button is
        // offered on a Move nobody filed.
        gmNotes: true,
      },
    }),
  ]);
  const { cutoffAt, locked, hasLock } = moveWindow(openTurn, { clockFrozen: frozen });

  // The same gate editMove runs (db/lib/incapacitation.js): a Bound or Dying
  // character cannot change a Move any more than they could file one, so the
  // button is not drawn rather than drawn and refused.
  const stuck = blockerFor(me.character.tags ?? [], ACT);

  // Whether the one kind change a turn has already been spent. The dialog
  // disables the chips with it; db/lib/moves.js#editMove is the lock.
  const kindLocked = action && !stuck ? await kindChangeUsed(prisma, me.character.id, openTurn.id) : false;

  return {
    ok: true,
    turn: {
      number: openTurn.number,
      phase: openTurn.phase,
      // ISO, because a Date does not survive the trip to a client component
      // intact and the countdown ticks in the browser anyway. It is the
      // CUTOFF, not the turn's end — Moves stop three hours early
      // (db/lib/turnClock.js), and counting to the end named a time nothing
      // happens at.
      closesAt: hasLock && cutoffAt ? cutoffAt.toISOString() : null,
      locked,
      hasLock,
    },
    move: action
      ? {
          id: action.id,
          kind: action.moveKind,
          description: action.description,
          editable: !stuck && moveIsEditable(action, locked),
          // Said in the dialog and in place of the button, so a refusal is
          // never the first the player hears of it.
          blockedReason: stuck ? `You can't act right now — you're ${stuck.name}. ‡` : null,
          kindLocked,
        }
      : null,
  };
}

// Kept beside myMove rather than exported: the page's first paint runs the
// same test on the row it loaded itself (web/app/(app)/play/page.js).
function moveIsEditable(action, locked) {
  if (locked) return false;
  // A row the game wrote for them — a lesson, a confession, an auto-Labor, a
  // walk — is not theirs to change (db/lib/moves.js#filedByPlayer).
  if (!filedByPlayer(action)) return false;
  if (!["PENDING_TYPE", "CONFIRMED"].includes(action.status)) return false;
  if (!["OPEN", "PASSED"].includes(action.moveReviewStatus)) return false;
  if (action.lockExpiresAt && new Date(action.lockExpiresAt).getTime() > Date.now()) return false;
  return action.appliedEffects == null;
}

// Changing a Move already filed. The one-Move-a-turn row IS the turn, so
// there is nothing to cancel and re-file — db/lib/moves.js#editMove edits it
// in place, and re-rolls only when the KIND changed (never a second die for
// a Gambit that already has one).
export async function updateMove({ actionId, moveKind, description } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const result = await editMove(prisma, {
    character: me.character,
    actorDiscordUserId: me.discordUserId,
    actionId,
    moveKind,
    description,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const parts = ["Changed. The GMs have it. ‡"];
  const roll = result.roll;
  if (roll?.gambit) parts.push("The die is cast — you'll see how it fell when the turn ends. ‡");
  if (roll?.resourceValue != null) {
    parts.push(`Your day's work (${roll.expression}) came to ${roll.resourceValue > 0 ? "+" : ""}${roll.resourceValue} ⬢. ‡`);
    if (roll.bonusNote) parts.push(roll.bonusNote);
  }
  return { ok: true, line: parts.join(" ") };
}

// The Bascinet conversation (CHAT.md §2b): everything the game has said to
// this player by DM, and what they wrote back. The SAME rows the GM desk
// reads, through the SAME noise filter (web/lib/dmThread.js), from the other
// chair — so the two surfaces cannot disagree about what was said. The row
// shape strips the author: a player never learns which GM answered.
//
// Paged from the newest backwards by `beforeId`, with the desk's keyset
// (createdAt, id) — a turn push writes several rows into one millisecond, and
// a plain `createdAt <` would skip every row sharing the boundary's stamp.
//
// Gated on the ACCOUNT, not on a living character: the page itself is what
// requires one, and a player whose character died with the tab open should
// still be able to read what Bascinet said and write back — that is the
// moment they most want to.
const GM_THREAD_PAGE = 60;

async function account() {
  const session = await auth();
  if (!session?.discordUserId) return { error: "You are not signed in. ‡" };
  return { discordUserId: session.discordUserId };
}

export async function gmThread({ beforeId = null } = {}) {
  const me = await account();
  if (me.error) return { ok: false, error: me.error };

  let before = null;
  if (beforeId) {
    before = await prisma.directMessage.findFirst({
      where: { id: String(beforeId), discordUserId: me.discordUserId },
      select: { id: true, createdAt: true },
    });
  }

  const rows = await prisma.directMessage.findMany({
    where: withoutDmNoise(
      {
        discordUserId: me.discordUserId,
        ...(before
          ? { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] }
          : {}),
      },
      { perspective: "player" },
    ),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: GM_THREAD_PAGE + 1,
    select: PLAYER_DM_SELECT,
  });
  const hasMore = rows.length > GM_THREAD_PAGE;
  return {
    ok: true,
    hasMore,
    rows: rows.slice(0, GM_THREAD_PAGE).reverse().map(playerDmRow),
  };
}

// A line to Bascinet, from Chat. One INBOUND row, exactly as the bot logs
// a DM typed into Discord (bot/src/events/messageCreate.js) — and nothing
// sent to Discord, because there is nothing to send: the bot cannot speak as
// the player in their own DM, the desk picks the row up on its poll like any
// inbound, and the GM's answer goes out through sendDm to Discord and the
// table both, so it reaches the player on whichever face they are on.
// `meta.via` says where it was typed, for a GM reading the record later.
//
// Two refusals the Discord path has no equivalent of. The Play switch
// (GameConfig.playPanelEnabled) is re-read here because a tab open when a GM
// flips it keeps its stream; and a plain cap on how fast one account may
// write, because every scene composer in Chat is throttled and this one
// is a pipe straight into the GM desk's inbox.
const TO_GMS_WINDOW_MS = 60_000;
const TO_GMS_PER_WINDOW = 12;

export async function sendToGms(content) {
  const me = await account();
  if (me.error) return { ok: false, error: me.error };
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) return { ok: false, error: "Write something first. ‡" };
  if (text.length > PLAYER_DM_MAX_LENGTH) {
    return { ok: false, error: `That is too long — ${PLAYER_DM_MAX_LENGTH} characters at most. ‡` };
  }
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { playPanelEnabled: true } });
  if (config && !config.playPanelEnabled) return { ok: false, error: "The Play page is switched off. ‡" };
  const recent = await prisma.directMessage.count({
    where: {
      discordUserId: me.discordUserId,
      direction: "INBOUND",
      createdAt: { gte: new Date(Date.now() - TO_GMS_WINDOW_MS) },
    },
  });
  if (recent >= TO_GMS_PER_WINDOW) return { ok: false, error: "Slow down a moment. ‡" };

  const row = await prisma.directMessage.create({
    data: {
      discordUserId: me.discordUserId,
      direction: "INBOUND",
      content: text,
      source: "player",
      meta: { via: "play" },
    },
    select: PLAYER_DM_SELECT,
  });
  return { ok: true, row: playerDmRow(row) };
}

// The Desire picker's catalog, ~271 templates evaluated against this
// character's gates. Fetched the first time the picker opens rather than on
// every page load — the slot half the column draws costs one query and comes
// down with the page (web/lib/selfPools.js).
export async function desireCatalogView() {
  const me = await actor({
    id: true,
    tags: { select: { tagId: true, tag: true } },
    role: { select: { slug: true } },
  });
  if (me.error) return { ok: false, error: me.error };
  const [openTurn, gameConfig] = await Promise.all([
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
    prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: { desireSlots: true, desireSlotLockTurns: true },
    }),
  ]);
  return { ok: true, view: await loadDesireView(me.character, { openTurn, gameConfig }) };
}

// ------------------------------------------------------------ waiting on you

// Everything that is holding still until this player answers it: a lesson,
// a binding or a confession somebody offered; a threat seat; a letter the
// bird is still waiting on; a lobby assignment. Each row's Accept/Decline
// calls the SAME db/lib function the DM's buttons call, so an answer given
// here and an answer given in Discord are the same answer.
export async function waitingOnYou() {
  const me = await actor({ id: true, name: true, discordUserId: true, locationId: true });
  if (me.error) return { ok: false, error: me.error };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });

  const [offers, spawns, letters, lobbyEntry] = await Promise.all([
    openTurn
      ? prisma.offer.findMany({
          // Only what is MINE to answer. An offer I made is waiting on
          // somebody else, and listing it here would be a to-do I cannot do.
          where: { turnId: openTurn.id, status: "PENDING", responderId: me.character.id },
          orderBy: { createdAt: "asc" },
          select: { id: true, kind: true, initiatorId: true, tag: { select: { name: true } } },
        })
      : [],
    prisma.threatSpawn.findMany({
      where: { discordUserId: me.discordUserId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { id: true, threatSlug: true },
    }),
    prisma.birdMessage.findMany({
      where: { recipientId: me.character.id, delivered: true, repliedAt: null, replyDeadlineTurn: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { id: true, senderName: true, replyDeadlineTurn: true },
    }),
    prisma.lobbyEntry.findFirst({
      where: { discordUserId: me.discordUserId, status: "ASSIGNED" },
      select: { id: true, assignedRoleId: true },
    }),
  ]);

  const initiators = offers.length
    ? await prisma.character.findMany({
        where: { id: { in: offers.map((o) => o.initiatorId) } },
        select: { id: true, name: true },
      })
    : [];
  const nameOf = new Map(initiators.map((c) => [c.id, c.name]));

  const rows = [
    ...offers.map((o) => ({
      key: `offer:${o.id}`,
      id: o.id,
      kind: "offer",
      // A chaplain waiting on a confession is never told what it is about,
      // here or anywhere else.
      label:
        o.kind === "CONFESSION"
          ? `${nameOf.get(o.initiatorId) ?? "Somebody"} asks you to hear a confession. ‡`
          : o.kind === "BIND"
            ? `${nameOf.get(o.initiatorId) ?? "Somebody"} asks to bind you. ‡`
            : `${nameOf.get(o.initiatorId) ?? "Somebody"} offers ${o.tag?.name ?? "a lesson"}.`,
      decline: true,
    })),
    ...spawns.map((s) => ({
      key: `spawn:${s.id}`,
      id: s.id,
      kind: "spawn",
      label: "A seat is open to you. ‡",
      decline: true,
    })),
    ...letters.map((l) => ({
      key: `bird:${l.id}`,
      id: l.id,
      kind: "bird",
      // No Accept here: answering a letter means choosing which paper goes
      // back, which is the Bird dialog on the sheet. This row is the
      // reminder that the bird has not left yet.
      label: `The bird still waits on an answer to ${l.senderName}. ‡`,
      accept: false,
      decline: false,
      href: "/character",
    })),
    ...(lobbyEntry
      ? [
          {
            key: `lobby:${lobbyEntry.id}`,
            id: lobbyEntry.id,
            kind: "lobby",
            label: "You have a seat waiting to be taken up. ‡",
            accept: false,
            decline: true,
            href: "/character",
          },
        ]
      : []),
  ];

  return { ok: true, rows };
}

export async function answerWaiting({ kind, id, accept } = {}) {
  const me = await actor({ id: true, name: true, discordUserId: true, status: true });
  if (me.error) return { ok: false, error: me.error };

  if (kind === "offer") {
    const offer = await prisma.offer.findUnique({ where: { id } });
    if (!offer) return { ok: false, error: "That offer's gone." };
    // Matched to the OFFER's responder, never to a posted id.
    if (offer.responderId !== me.character.id) return { ok: false, error: "That's not yours to answer. ‡" };
    const responder = { id: me.character.id, name: me.character.name, discordUserId: me.discordUserId };

    const result = accept
      ? offer.kind === "BIND"
        ? await acceptBind(prisma, offer, responder)
        : offer.kind === "CONFESSION"
          ? await acceptConfession(prisma, offer, responder)
          : await acceptLesson(prisma, offer, responder)
      : await declineOffer(prisma, offer, responder);
    if (!result.ok) return { ok: false, error: result.reason };

    // The same post-commit sync the DM handler runs: a fresh Bound tag
    // changes what rooms the target may stand in, and what they can carry.
    if (result.boundId) {
      try {
        const drop = await settleCarry(prisma, result.boundId);
        const row = await prisma.character.findUnique({ where: { id: result.boundId } });
        if (row) await syncCharacterRoomAccess(prisma, row).catch(() => {});
        if (drop) await deliverCarryDrop(prisma, drop).catch(() => {});
      } catch {
        // The bind stands either way; a failed sync is the doctor's problem.
      }
    }
    for (const dm of result.dms ?? []) {
      await sendDm(dm.discordUserId, dm.content).catch(() => {});
    }
    return { ok: true, line: result.line };
  }

  if (kind === "spawn") {
    const result = accept
      ? await acceptThreatSpawn(prisma, id, me.discordUserId)
      : await declineThreatSpawn(prisma, id, me.discordUserId);
    if (!result.ok) return { ok: false, error: result.reason };
    if (accept) {
      await applySpawnSideEffects(prisma, result.sideEffects).catch(() => {});
    }
    return { ok: true, line: result.line };
  }

  if (kind === "lobby") {
    const result = await declineAssignment(prisma, id, me.discordUserId);
    return result.ok ? { ok: true, line: result.line } : { ok: false, error: result.reason };
  }

  return { ok: false, error: "There's nothing to answer there. ‡" };
}

// ------------------------------------------------------------ slash commands
//
// The web twins of the player slash commands (bot/src/lib/commands.js). Each
// one is the SAME rule the Discord handler runs, extracted into db/lib so the
// two faces cannot drift: db/lib/conceal.js, db/lib/shout.js, db/lib/roll.js.
// What is left here is the sequencing the web needs — resolve the actor from
// the session, re-check the place, write the scene row beside the Discord
// post — and nothing else.
//
// `/move`, `/travel`, `/converse` and `/look` need no new action: they are
// submitMove, travelTo, openConversation and the sheet's Examine dialog, all
// of which already exist above.

// /conceal. A standing state, not a per-message prefix — the alias is what
// the composer wears from here until it is turned off again.
export async function toggleConceal() {
  const me = await actor({
    id: true,
    name: true,
    concealed: true,
    age: true,
    gender: true,
    discordUserId: true,
  });
  if (me.error) return { ok: false, error: me.error };

  const result = await concealRule(prisma, { ...me.character, discordUserId: me.discordUserId });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, concealed: result.concealed, alias: result.alias, line: result.line };
}

// /shout. db/lib/shout.js answers who hears it and what they hear; this does
// both halves of the delivery, because a SYSTEM row is deliberately never
// echoed into a channel by the outbox (db/lib/scene.js) and a shout that only
// reached one face would be a shout half the game did not hear.
//
// Sequential, no Promise.all: this is up to a couple of dozen Locations, and
// a fan-out across all of them would burst Discord's rate-limit buckets. Same
// discipline as the bot's own loop. Every post is caught on its own, so one
// dead channel cannot swallow the rest of the shout.
export async function shoutHere(text, placeKey = null) {
  const me = await actor({ id: true, name: true, locationId: true, discordUserId: true });
  if (me.error) return { ok: false, error: me.error };

  const result = await shout(prisma, { ...me.character, discordUserId: me.discordUserId }, text);
  if (!result.ok) {
    return { ok: false, error: result.error, retryAfter: result.retryAfter ?? null };
  }

  // The room you are standing in hears you first. The loop below writes to
  // Location places only — a Room thread is behind a door, and a shout does
  // not go through every door in the street — but the one door you are inside
  // of would otherwise be the only place that did not hear you.
  const here = parsePlaceKey(placeKey);
  if (here && (here.kind === "room" || here.kind === "conv")) {
    const mine = await mayWritePlace(prisma, me.character, placeKey, {
      gm: false,
      discordUserId: me.discordUserId,
    });
    const near = result.heard.find((entry) => entry.distance === 0);
    if (mine && near) {
      await sceneLine(prisma, { placeKey, text: near.scene.text, lines: near.scene.lines });
      try {
        const target = await discordTargetForPlaceKey(prisma, placeKey);
        const channelId = target?.threadId ?? target?.channelId ?? null;
        if (channelId) await postMessage(channelId, near.line, undefined, { parse: [] });
      } catch {
        // The archive row stands. A thread that refused the post is one
        // audience short, not a failed shout.
      }
    }
  }

  for (const place of result.heard) {
    // The row first: it is what Chat shows and what /archive keeps, and
    // it is the only half a web-only player ever sees.
    await sceneLine(prisma, { placeKey: place.placeKey, text: place.scene.text, lines: place.scene.lines });
    if (!place.discordChannelId) continue;
    try {
      // parse: [] — no mentions at all. The text is player-typed and this is
      // the widest broadcast in the game; an "@everyone" in a shout would ping
      // twenty-nine channels at once. A shout is a noise, not an address.
      await postMessage(place.discordChannelId, place.line, undefined, { parse: [] });
    } catch (err) {
      console.error(`Shout into ${place.name} failed:`, err?.message ?? err);
    }
  }

  return { ok: true, line: result.line };
}

// /roll. One d6, in the place that is open — and the place is re-checked
// against the same gate the composer is, because a seq or a place key is a
// string the browser sent.
export async function rollHere(placeKey) {
  const me = await actor({
    id: true,
    name: true,
    age: true,
    gender: true,
    concealed: true,
    locationId: true,
    webOnly: true,
    discordUserId: true,
  });
  if (me.error) return { ok: false, error: me.error };

  const may = await mayWritePlace(prisma, me.character, placeKey, {
    gm: false,
    discordUserId: me.discordUserId,
  });
  if (!may) return { ok: false, error: "There's nobody here to see it. ‡" };

  return castDie(prisma, me.character, placeKey);
}

// /look. One entry point for both kinds of person the column knows about: a
// character id off a named row, or the opaque hood token db/lib/whosHere.js
// mints for a concealed one. A token is 32 hex characters and a cuid never
// is, so the two can be told apart without the browser saying which it sent.
const HOOD_TOKEN = /^[0-9a-f]{32}$/;

export async function lookAt(personRef) {
  const ref = String(personRef ?? "").trim();
  if (!ref) return { ok: false, error: "Look at who?" };
  if (HOOD_TOKEN.test(ref)) return examineHooded(ref);
  return examineCharacter(ref);
}

// ------------------------------------------------- who is in this room, and
// ------------------------------------------------- who may let somebody in
//
// The web twin of /add and /remove (bot/src/events/interactionCreate.js).
// They work on two things, and the place decides which:
//
//   - A Conversation. Membership is a PlayerThreadMember row, and it works on
//     any living character wherever they stand — the PlayerThreadInvite row
//     beside it replays the Discord half when they arrive.
//   - A private Room. Membership is a RoomGuest row, and the target has to be
//     STANDING here, because the grant is spent the moment they leave.
//
// A public Room takes neither: everyone standing in the Location can already
// read it, so `members` comes back null and the strip does not draw.

// The conversation behind a `conv:` key, plus whether this character is in
// it. Being a member IS the permission, the same gate the bot applies.
async function conversationHere(character, placeKey) {
  const parsed = parsePlaceKey(placeKey);
  if (!parsed || parsed.kind !== "conv") return { error: "That isn't a conversation." };
  const conversation = await prisma.playerThread.findUnique({
    where: { id: parsed.id },
    select: { id: true, threadId: true, name: true, locationId: true, location: { select: { name: true } } },
  });
  if (!conversation) return { error: "That conversation is gone." };
  const members = await conversationMembers(prisma, conversation.id);
  if (!members.some((entry) => entry.characterId === character.id)) {
    return { error: "You're not in this conversation. ‡" };
  }
  return { conversation, members };
}

// The private room behind a `room:` key. Two things, not one: your feet at its
// Location, AND a way in — a key or a guest row. The same pair
// db/lib/roomGuests.js#doorwayFor tests, and it has to be both. On Discord the
// second half was implicit, because /add was typed into the room's own thread
// and only an entitled character can see one; without it here, anybody
// standing in the street could hand out a door they cannot open themselves.
async function privateRoomHere(character, placeKey) {
  const parsed = parsePlaceKey(placeKey);
  if (!parsed || parsed.kind !== "room") return { error: "That isn't a room." };
  const room = await prisma.room.findUnique({
    where: { id: parsed.id },
    select: { id: true, name: true, kind: true, locationId: true, accessTagSlugs: true },
  });
  if (!room) return { error: "That room is gone." };
  if (room.kind !== "PRIVATE") return { error: "Anyone standing here can already walk in. ‡" };
  if (character.locationId !== room.locationId) return { error: "You're not in this room. ‡" };
  const keys = await roomAccessKeys(prisma, character.id);
  const inside =
    room.accessTagSlugs.some((slug) => keys.heldSlugs.has(slug)) || keys.guestRoomIds.has(room.id);
  if (!inside) return { error: "You are not inside that room. ‡" };
  return { room };
}

// Who is in the open place, and who standing here could be let in. One call,
// because the strip draws both and a second round trip for the picker would
// show a list that was already a beat stale.
export async function placeMembers(placeKey) {
  const me = await actor({ id: true, factionId: true, locationId: true });
  if (me.error) return { ok: false, error: me.error };
  const parsed = parsePlaceKey(placeKey);
  // Not an error: a Location, the zone summary and a public room simply have
  // no guest list, and the strip asks about every place it is shown.
  if (!parsed || (parsed.kind !== "conv" && parsed.kind !== "room")) {
    return { ok: true, members: null, candidates: [] };
  }

  let members;
  let room = null;
  if (parsed.kind === "conv") {
    const found = await conversationHere(me.character, placeKey);
    if (found.error) return { ok: false, error: found.error };
    members = found.members;
  } else {
    const found = await privateRoomHere(me.character, placeKey);
    // A public room is not a refusal, it is a place with no strip.
    if (found.error) {
      return found.error.startsWith("Anyone standing here")
        ? { ok: true, members: null, candidates: [] }
        : { ok: false, error: found.error };
    }
    room = found.room;
    members = await roomGuests(prisma, room.id);
  }

  // Everyone standing here who is not already in. Concealed people are
  // absent: a hood has no id to hand this, and letting somebody into a room
  // is not a thing you can do to a person you cannot name.
  const here = await whosHere(prisma, me.character);
  const inside = new Set(members.map((entry) => entry.characterId));
  let candidates = (here.named ?? [])
    .filter((person) => person.characterId !== me.character.id && !inside.has(person.characterId))
    .map((person) => ({
      characterId: person.characterId,
      name: person.name,
      avatarVersion: person.avatarVersion,
    }));

  // A key-holder is already in, by their key, and roomGuests() deliberately
  // does not list them (they hold no guest row). Left in the picker they read
  // as somebody outside, and letting one "in" writes a guest row that grants
  // nothing and that /remove then refuses to take back. One query for the
  // whole shortlist — whosHere() carries no tags.
  if (room && candidates.length > 0 && room.accessTagSlugs.length > 0) {
    const holders = await prisma.characterTag.findMany({
      where: {
        characterId: { in: candidates.map((person) => person.characterId) },
        tag: { slug: { in: room.accessTagSlugs } },
      },
      select: { characterId: true },
    });
    const keyed = new Set(holders.map((row) => row.characterId));
    candidates = candidates.filter((person) => !keyed.has(person.characterId));
  }

  return { ok: true, members, candidates };
}

export async function addMember(placeKey, characterId) {
  const me = await actor({ id: true, name: true, locationId: true, discordUserId: true });
  if (me.error) return { ok: false, error: me.error };
  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return { ok: false, error: "That place is gone." };

  if (parsed.kind === "conv") {
    const found = await conversationHere(me.character, placeKey);
    if (found.error) return { ok: false, error: found.error };
    const { conversation } = found;

    const target = await prisma.character.findFirst({
      where: { id: String(characterId ?? ""), status: "ALIVE" },
      select: { id: true, name: true, locationId: true, discordUserId: true, webOnly: true },
    });
    if (!target) return { ok: false, error: "That isn't a living character. ‡" };

    // The ROW first, wherever they are standing; the invite row beside it is
    // what replays the DISCORD add when they arrive
    // (db/lib/threadInvites.js). addConversationMember writes the presence
    // notify itself, and only when the row is genuinely new, so a second Add
    // on somebody already in does not wake all of their tabs.
    await addConversationMember(prisma, { playerThreadId: conversation.id, characterId: target.id });
    await prisma.playerThreadInvite
      .upsert({
        where: { threadId_characterId: { threadId: conversation.threadId, characterId: target.id } },
        update: {},
        create: { threadId: conversation.threadId, characterId: target.id },
      })
      .catch((err) => console.error("Failed to record thread invite:", err?.message ?? err));

    // A "web only" target is out of every channel on purpose (CHAT.md §6).
    if (target.locationId === conversation.locationId && !target.webOnly && target.discordUserId) {
      await addThreadMember(conversation.threadId, target.discordUserId).catch(() => {});
    }

    await sendDm(
      target.discordUserId,
      `*You were let into ${conversation.location?.name ?? "somewhere"} · ${conversation.name}.* ‡`,
    ).catch(() => {});

    return {
      ok: true,
      line:
        target.locationId === conversation.locationId
          ? `${target.name} was added.`
          : `${target.name} is invited — they'll see this when they reach ${conversation.location?.name ?? "this place"}. ‡`,
    };
  }

  const found = await privateRoomHere(me.character, placeKey);
  if (found.error) return { ok: false, error: found.error };

  const result = await addRoomGuest(prisma, {
    actor: me.character,
    roomId: found.room.id,
    characterId,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // db/lib/roomGuests.js writes no presence notify of its own — it is the
  // bot's code, and the bot has no places column to update. The added
  // character's Chat has to learn the door opened without a reload.
  await notifyPresence(prisma, result.target.id).catch(() => {});
  await sendDm(
    result.notify.discordUserId,
    `*You were let into ${result.notify.placeName ?? "somewhere"} · ${result.notify.threadName}.* ‡`,
  ).catch(() => {});

  return { ok: true, line: result.line };
}

export async function removeMember(placeKey, characterId) {
  const me = await actor({ id: true, name: true, locationId: true, discordUserId: true });
  if (me.error) return { ok: false, error: me.error };
  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return { ok: false, error: "That place is gone." };

  if (parsed.kind === "conv") {
    const found = await conversationHere(me.character, placeKey);
    if (found.error) return { ok: false, error: found.error };
    const { conversation } = found;

    // ALIVE, the same gate the bot's /remove applies and the same one
    // addMember above already applies: a dead character is off the roster on
    // both faces, and the turn's death pass is what clears their rows.
    const target = await prisma.character.findFirst({
      where: { id: String(characterId ?? ""), status: "ALIVE" },
      select: { id: true, name: true, discordUserId: true },
    });
    if (!target) return { ok: false, error: "That isn't a living character. ‡" };

    // The ROW is what membership is (db/lib/conversations.js); the thread
    // member list is its projection, and the invite row would replay the add
    // on their next arrival if it were left behind.
    await removeConversationMember(prisma, { playerThreadId: conversation.id, characterId: target.id });
    await prisma.playerThreadInvite
      .deleteMany({ where: { threadId: conversation.threadId, characterId: target.id } })
      .catch((err) => console.error("Failed to delete thread invite:", err?.message ?? err));
    if (target.discordUserId) {
      await removeThreadMember(conversation.threadId, target.discordUserId).catch((err) =>
        console.error(`Failed to remove ${target.discordUserId} from thread:`, err?.message ?? err),
      );
    }

    return { ok: true, line: `${target.name} was removed.` };
  }

  const found = await privateRoomHere(me.character, placeKey);
  if (found.error) return { ok: false, error: found.error };

  const result = await removeRoomGuest(prisma, {
    actor: me.character,
    roomId: found.room.id,
    characterId,
  });
  if (!result.ok) return { ok: false, error: result.error };

  await notifyPresence(prisma, result.target.id).catch(() => {});
  return { ok: true, line: result.line };
}
