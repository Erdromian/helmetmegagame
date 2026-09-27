"use server";

import { after } from "next/server";
// The Purse on the You plate (./next/YouPlate.js) is a server prop, so a verb
// here that moves obols through the player's hand calls refresh() on success,
// and only when coin really moved: the page redraws in the same response.
// refresh() rather than revalidatePath because /chat is force-dynamic, so
// there is no cache to drop, only the page in front of the player. Every other
// verb here leaves the page alone.
import { refresh } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { affordancesFor, locationAffordances, roomAffordances } from "@lifeweb/db/lib/placeAffordances";
import { markNukeRoom, nukeView, nukeCheck, nukePress } from "@lifeweb/db/lib/nuke";
import {
  phoneView,
  answerPhone as answerPayphone,
  dialNumber,
  hangUp,
  walkAway,
  insertObol,
} from "@lifeweb/db/lib/phone";
import { questInteract } from "@lifeweb/db/lib/quests";
import { playSlots as playSlotsInDb, CASINO_ROOM_SLUG } from "@lifeweb/db/lib/slotMachine";
import {
  machineView,
  takeMachine,
  releaseMachine,
  insertCoins,
  withdrawCoins,
  buySlot,
  unlockMachine,
  lockMachine,
  collectTill,
  stockMachine,
  unstockMachine,
  setSlotPrice,
} from "@lifeweb/db/lib/vending";
import { VENDING_TEXT } from "@lifeweb/db/lib/vendingText";
import {
  blackMarketState as blackMarketStateInDb,
  insertObols as insertBlackMarketObols,
  blackMarketOrder as blackMarketOrderInDb,
} from "@lifeweb/db/lib/blackMarket";
import { BLACK_MARKET_ROOM_SLUG, BLACK_MARKET_TEXT } from "@lifeweb/db/lib/blackMarketText";
import {
  terminalState as merchantTerminalStateInDb,
  insertObols as insertTerminalObols,
  withdrawObols as withdrawTerminalObols,
  placeOrder as placeTerminalOrder,
  editOrder as editTerminalOrder,
  removeOrder as removeTerminalOrder,
} from "@lifeweb/db/lib/merchantTerminal";
import { isTradeable } from "@lifeweb/db/lib/tradeable";
import { OBOL_SLUG } from "@lifeweb/db/lib/depotState";
import { RESOURCES_SLUG } from "@lifeweb/db/lib/resourceStack";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { searchRoom as searchRoomInDb } from "@lifeweb/db/lib/roomSearch";
import { countHiddenStacks, hiddenCountLine } from "@lifeweb/db/lib/roomStash";
import { announceInRoom } from "@lifeweb/db/lib/roomAnnounce";
import { hasAttribute } from "@lifeweb/db/lib/locationAttributes";
import { toggleGate, holdKeyedOpen, GATE_CHARACTER_SELECT } from "@lifeweb/db/lib/gates";
import { fileMove, editMove, withdrawMove, moveIsEditable } from "@lifeweb/db/lib/moves";
import { confirmMove } from "@lifeweb/db/lib/moveConfirm";
import { moveWindow, isDaylight } from "@lifeweb/db/lib/turnClock";
import { clockStatus } from "@lifeweb/db/lib/gameState";
import { combatModeState } from "@lifeweb/db/lib/combatMode";
import { combatViewFor } from "@lifeweb/db/lib/combat";
import { setCombatMode as setCombatModeInDb } from "@lifeweb/db/lib/verbs/combatMode";
import { sessionGate } from "@lifeweb/db/lib/betweenSessions";
import { loadDesireView } from "@/lib/selfPools";
import { withoutDmNoise, PLAYER_DM_SELECT, playerDmRow } from "@/lib/dmThread";
import { resolveDmActions } from "@/lib/dmActions";
import { PLAYER_DM_MAX_LENGTH } from "@/lib/constants";
import { whosHere, whosHereGm, resolveHoodToken, resolveCrossRoomRef } from "@lifeweb/db/lib/whosHere";
import { lastSightings } from "@lifeweb/db/lib/sightings";
import { VIEWER_SELECT, examineRow } from "@lifeweb/db/lib/examineRow";
import { STAR_ROW_SELECT, saveStarredRow } from "@/lib/starNote";
import { ghostCharacterFor } from "@lifeweb/db/lib/ghost";
import { maybeSendGmAutoReply } from "@lifeweb/db/lib/gmAutoReply";
import { travelOptions, linksFor, endpoints, isHeldOpen, linkBetween, routesWithinZone, loadGraph } from "@lifeweb/db/lib/locationGraph";
import { knownLocations } from "@lifeweb/db/lib/locationVisits";
import { walkWithinZone } from "@lifeweb/db/lib/locationWalk";
import { examineLines } from "@lifeweb/db/lib/examineLocation";
import { structuresAt } from "@lifeweb/db/lib/structures";
import { visibleZoneIds } from "@lifeweb/db/lib/gmZoneView";
import { heldReasonFor, seenByMany, seenById, seenByIdMany, seenByPlace, IDENTITY_SELECT } from "@lifeweb/db/lib/intercept";
import { capitalizeFirst } from "@lifeweb/db/lib/concealedIdentity";
import { waitingLetter } from "@lifeweb/db/lib/bird";
import { blocksOnFoot, equippedSlugs, fastTravelCapacity } from "@lifeweb/db/lib/mounts";
import {
  performLocationMove,
  freeMovesLeft,
  freeMovesBreakdown,
  travelSentence,
  freeZoneMovesReason,
  exertRefusal,
  exertEdgeFor,
  exertEdgeSentence,
  exertResultLine,
} from "@lifeweb/db/lib/locationTravel";
import {
  ESCORT_SELECT as MOVER_SELECT,
  escortAuthority,
  escortRefusal,
  escortCandidates,
  partyOf,
  attach,
  detach,
  createEscortOffer,
  acceptEscort,
  escortReason,
  escortView,
  escortName,
  escortKey,
  escortHidden,
  byShownName,
} from "@lifeweb/db/lib/escort";
import { resolveTargetKey } from "@lifeweb/db/lib/targetKey";
import { forcedNameFrom } from "@lifeweb/db/lib/presentedIdentity";
import { syncPartyMembership } from "@lifeweb/db/lib/partyChat";
import { accessibleRooms, roomAccessKeys, syncCharacterRoomAccess } from "@lifeweb/db/lib/roomAccess";
import { loadRoomsAt, roomAt, WITH_SIDES } from "@lifeweb/db/lib/roomSides";
import { applyArrivalFacts, applyArrivalDiscord } from "@lifeweb/db/lib/locationMove";
import { dismountedMessage } from "@lifeweb/db/lib/indoors";
import {
  boardFor,
  boardText,
  destroyNotice,
  pinnedLine,
  tornLine,
  BOARD_OPTION_LIMIT,
} from "@lifeweb/db/lib/noticeboard";
import { paperDescription, paperView, paperViewGm, TITLE_MAX, WRITE_MAX } from "@lifeweb/db/lib/paper";
import { mintUnownedPaper } from "@lifeweb/db/lib/paperMint";
import { cleanCustomText } from "@lifeweb/db/lib/customText";
import { getGmSession } from "@/lib/discordGuild";
import { decreeZones } from "@lifeweb/db/lib/decree";
import { writeChatViewAs } from "@/lib/viewAs";
import { speakerDirectory } from "@/lib/gmSpeakers";
import { readBlock } from "@lifeweb/db/lib/reading";
import { addToStack, dropCharacterTag } from "@lifeweb/db/lib/tagWrites";
import { expiryFrom } from "@lifeweb/db/lib/turnFormat";
import { ambientLine } from "@lifeweb/db/lib/ambientLine";
import { sceneLineAt } from "@lifeweb/db/lib/scene";
import { postMessage, addThreadMember } from "@lifeweb/db/lib/discordRest";
import {
  addConversationMember,
  removeConversationMember,
  conversationMembers,
  conversationMemberIds,
} from "@lifeweb/db/lib/conversations";
import { toggleConceal as concealRule } from "@lifeweb/db/lib/conceal";
import { shout, deliverShout } from "@lifeweb/db/lib/shout";
import { ooc, deliverOoc } from "@lifeweb/db/lib/ooc";
import { XOM_SHRINE_ROOM_SLUG, grantXom } from "@lifeweb/db/lib/xom";
import {
  CHARON_SLUG,
  PANIC_ROOM_SLUG,
  COCKPIT_SLUG,
  HABITATION_SLUG,
  enterCharon,
  leaveCharon,
  pressLaunch,
  sleepAboard,
} from "@lifeweb/db/lib/charon";
import { SFX, groundSfx } from "@lifeweb/db/lib/sfx";
import { openConversationThread } from "@lifeweb/db/lib/conversationOpen";
import { castDie } from "@lifeweb/db/lib/roll";
import { addRoomGuest, removeRoomGuest, roomGuests } from "@lifeweb/db/lib/roomGuests";
import { presentedNameOf, resolveMemberToken } from "@lifeweb/db/lib/presentedMembers";
import { notifyPresence } from "@lifeweb/db/lib/presenceNotify";
import { sceneLine } from "@lifeweb/db/lib/scene";
import { playInstrument } from "@lifeweb/db/lib/instrumentPlay";
import { parsePlaceKey, isScenePlaceKey, isOocPlaceKey, discordTargetForPlaceKey } from "@lifeweb/db/lib/placeKey";
import { findPlace as findPlaceInFeed } from "@lifeweb/db/lib/feedAccess";
import { removeThreadMember } from "@lifeweb/db/lib/discordRest";
import { BELL_ROOM_SLUG, RING_WORD, bellWordMatches, bellCooldown, broadcastBell } from "@lifeweb/db/lib/bell";
import {
  ARM_WORD,
  DISARM_WORD,
  turretWordMatches,
  gatehouseTurretArmed,
  RESIDENCES_LOCATION_SLUG,
  TURRET_ARMED_LINE,
  TURRET_DISARMED_LINE,
} from "@lifeweb/db/lib/gatehouseTurret";
import { INTERCOM_ROOM_SLUG, broadcastIntercom } from "@lifeweb/db/lib/intercom";
import { loadVoiceState } from "@lifeweb/db/lib/say";
import { recordArchiveMessage } from "@lifeweb/db/lib/archive";
import { acceptOffer, declineOfferOfKind } from "@lifeweb/db/lib/dmAnswer";
import { settleCarry, deliverCarryDrop } from "@lifeweb/db/lib/carry";
import { acceptThreatSpawn, declineThreatSpawn, applySpawnSideEffects } from "@lifeweb/db/lib/threatSpawn";
import { declineAssignment } from "@lifeweb/db/lib/lobby";
import { mayReadPlace, mayWritePlace } from "@lifeweb/db/lib/feedAccess";
import { photoCaption } from "@lifeweb/db/lib/photo";
import { CAMERA_SLUG, mintPhoto } from "@lifeweb/db/lib/photoMint";
import { sendDm } from "@/lib/discordGuild";
import { DM_KIND } from "@lifeweb/db/lib/dmKinds";
import { resourcesOf, isResourcesRow, withoutResources } from "@lifeweb/db/lib/resourceStack";
import { formatTravel } from "@lifeweb/db/lib/crossingCost";
import {
  CHIP_ROW_SELECT,
  chipSelect,
  CHIP_VIEWER_SELECT,
  GM_CHIP_CTX,
  chipContextFor,
  composeChipTag,
  toChipRow,
} from "@/lib/tagChipRows";
import { thingGroups } from "./thingRows";

// Every button in Chat's right column, as a server action. THE CONTRACT: the
// acting character is resolved from the session, never posted; every gate is
// re-checked here; the answer is `{ ok: true, … }` or `{ ok: false, error }`,
// nothing throws to the client (web/app/components/useActionRunner.js). Game
// logic lives in db/lib, so the Discord button and web dialog run one implementation.

// `select` widens the acting-character query for whichever action needs more.
//
// `acting` is the session gate: between sittings the game is shut and a player may only talk (SESSIONS.md §5), so every
// action here that CHANGES something passes { acting: true }. Every reader, /ooc and toggleConceal pass neither and stay
// open. Ordinary speech has its own answer inside db/lib/say.js, the one both faces share.
//
// `speech: true` is for the three that ARE talking but never reach say.js — a shout across the Location graph, a die
// roll, a music cue. They follow "Allow roleplaying in between sessions" rather than the act gate.
//
// The gate cannot live unconditionally in here, precisely because the talking lives in this file too.
async function actor(select, { acting = false, speech = false } = {}) {
  const session = await auth();
  if (!session?.discordUserId) return { error: "You are not signed in." };
  if (acting || speech) {
    const gate = await sessionGate(prisma, { acting });
    if (!gate.ok) return { error: gate.message };
  }
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: select ?? {
      id: true,
      name: true,
      zoneId: true,
      locationId: true,
      discordUserId: true,
      // Not mirrored to Discord — nothing here may touch Discord for them (docs/systemdocs/CHAT.md §6).
      discordMirrored: true,
      // Tag slugs are what room `access:` lists read — which rooms, which gates.
      role: { select: { slug: true } },
      tags: { select: { tag: { select: { slug: true } } } },
    },
  });
  if (!character) return { error: "You have no living character." };
  return { character, discordUserId: session.discordUserId };
}

// Standing in the room is the whole permission model for a Room button — you cannot pull a bell rope from three zones away.
async function roomHere(character, roomId, slug, missing) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true },
  });
  if (!room || (slug && room.slug !== slug)) return { error: missing };
  if (character.locationId !== room.locationId) {
    return { error: `You're not standing in the ${room.name} any more.` };
  }
  return { room };
}

// ---------------------------------------------------------------- the place

// The whole place panel, re-read — what a dialog calls after changing something a button's label depends on.
export async function loadAffordances() {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  return { ok: true, affordances: await affordancesFor(prisma, me.character) };
}

// Looking at whoever said one line — the web twin of the 🔍 reaction. Only a
// SEQ is sent; who spoke and whether hooded is resolved server-side (db/lib/examineRow.js).
export async function lookAtRow(seq) {
  const session = await auth();
  if (!session?.discordUserId) return { ok: false, error: "You are not signed in." };

  // The eye in /chat is where a GHOST actually looks: they have no sheet, so the Examine dialog on
  // /character is not theirs, and this is the only eye their seat reaches. They look as their last
  // body — keeping its learned sight, losing its blindfolds (db/lib/examineRow.js).
  let viewer = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: VIEWER_SELECT,
  });
  let ghost = false;
  if (!viewer) {
    const dead = await ghostCharacterFor(prisma, session.discordUserId);
    if (dead) {
      viewer = await prisma.character.findUnique({ where: { id: dead.id }, select: VIEWER_SELECT });
      ghost = Boolean(viewer);
    }
  }
  if (!viewer) return { ok: false, error: "You have no living character." };

  const result = await examineRow(prisma, viewer, seq, { ghost });
  if (!result) return { ok: false, error: "You can't see them." };
  if (result.blocked) return { ok: false, error: result.blocked };
  return { ok: true, readout: result.readout };
}

// Photographing what somebody said — the web twin of the 📸 reaction, resolved the same way the eye is (db/lib/examineRow.js).
// The camera is NOT spent — holding one is the whole gate; one shot per line
// per photographer is tracked in AuditLog. No `turnId`: this ration is per LINE, not per turn (REQUESTS.md §1a).
const PHOTO_ACTION = "photo_taken";

export async function photographRow(seq) {
  const me = await actor({
    id: true,
    locationId: true,
    discordUserId: true,
    tags: { select: { quantity: true, tag: { select: { slug: true } } } },
  }, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const character = me.character;

  const holds = (slug) => character.tags.some((ct) => ct.tag?.slug === slug && (ct.quantity ?? 0) > 0);

  if (!holds(CAMERA_SLUG)) return { ok: false, error: "You have no camera." };

  let key;
  try {
    key = BigInt(seq);
  } catch {
    return { ok: false, error: "That line is gone." };
  }

  // Read off the INDEXED columns — AuditLog has no index over `details`, so a
  // `path: ["seq"]` filter would scan the whole table. Checked in JS instead, over a handful of rows.
  const mine = await prisma.auditLog.findMany({
    where: { actorDiscordUserId: me.discordUserId, actionType: PHOTO_ACTION },
    select: { details: true },
  });
  const wanted = String(key);
  if (mine.some((entry) => String(entry.details?.seq ?? "") === wanted)) {
    return { ok: false, error: "You already have that shot." };
  }

  // Only what the audit row files, plus the one refusal examineRow can't word
  // for itself: it returns null for your own line, and "point it at somebody else" beats "that line is gone".
  const row = await prisma.archiveEntry.findUnique({
    where: { seq: key },
    select: { placeKey: true, characterId: true },
  });
  if (!row?.characterId) return { ok: false, error: "That line is gone." };
  if (row.characterId === character.id) return { ok: false, error: "Point it at somebody else." };

  // The shot is the ordinary look (db/lib/examineRow.js). `bystander: true`
  // makes it a LENS not a person — no doctor's eye, no Seductive, no Thanati sight.
  const viewer = await prisma.character.findUnique({ where: { id: character.id }, select: VIEWER_SELECT });
  const result = await examineRow(prisma, viewer, key, { bystander: true });
  if (!result) return { ok: false, error: "That line is gone." };
  if (result.blocked) return { ok: false, error: result.blocked };
  const readout = result.readout;
  const hooded = readout.concealed;

  // No transaction: nothing is spent, and mintPhoto's collision retry cannot run inside one (db/lib/photoMint.js#createWithRetry).
  const photo = await mintPhoto(prisma, character.id, {
    subject: readout.name,
    caption: photoCaption(readout),
    subjectCharacterId: row.characterId,
  });

  // Written only once the print exists, so a failed mint can retry rather than burning the shot.
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: me.discordUserId,
      actionType: PHOTO_ACTION,
      targetCharacterId: row.characterId,
      details: { seq: wanted, placeKey: row.placeKey, hooded, photoTagId: photo.id, photoName: photo.name },
    },
  });

  return {
    ok: true,
    readout,
    photoName: photo.name,
    line: `You take a photograph of ${readout.name}.`,
    sfx: SFX.PHOTO,
  };
}

// ⭐ from the web — the twin of the Discord reaction, writing the same `Note`
// row. A line with no Discord message is filed under its seq instead.
export async function starRow(seq) {
  // locationId feeds feedAccess.js#placesFor.
  const me = await actor({ id: true, name: true, discordUserId: true, zoneId: true, locationId: true });
  if (me.error) return { ok: false, error: me.error };
  const character = me.character;

  let key;
  try {
    key = BigInt(seq);
  } catch {
    return { ok: false, error: "That line is gone." };
  }

  const row = await prisma.archiveEntry.findUnique({ where: { seq: key }, select: STAR_ROW_SELECT });
  if (!row || row.deletedAt || !row.content) return { ok: false, error: "That line is gone." };

  // The same gate the feed reads by — stops a starred seq from a room the reader isn't standing in.
  const allowed =
    Boolean(row.placeKey) &&
    (await mayReadPlace(prisma, character, row.placeKey, { gm: false, discordUserId: me.discordUserId }));
  if (!allowed) return { ok: false, error: "That line is gone." };

  // Filed under the name THIS reader saw on the line (web/lib/starNote.js).
  await saveStarredRow(row, me.discordUserId, character.id);

  return { ok: true, line: "Saved to your Highlights." };
}

// What is lying in a room's stash, as STRUCTURE, not a formatted Discord line.
// THE THINGS DRAWER (CHAT.md §7): pockets, read back after every Equip/Use/Give/Destroy. Each verb re-checks itself when pressed.
export async function myThings() {
  const me = await actor({
    id: true,
    ...CHIP_VIEWER_SELECT,
    tags: {
      select: {
        id: true,
        tagId: true,
        quantity: true,
        equipped: true,
        // thingGroups derives its own poisonMarker off this — never returned raw.
        poisonedCount: true,
        equippedQuantity: true,
        // The whole chip shape — slug, category, weightLbs for thingGroups, plus everything TagDetails draws.
        // instrument and poison are read by thingGroups for the item's own verbs (db/lib/itemVerbs.js).
        tag: { select: chipSelect({ instrument: true, poison: true }) },
      },
    },
  });
  if (me.error) return { ok: false, error: me.error };
  const ctx = await chipContextFor(me.character);
  return { ok: true, groups: thingGroups(me.character.tags, (tag) => composeChipTag(tag, ctx)) };
}

export async function readStash(roomId) {
  // Widened past actor()'s default: paper on the floor is composed for THIS reader's eyes (db/lib/reading.js).
  const me = await actor({
    id: true,
    locationId: true,
    ...CHIP_VIEWER_SELECT,
  });
  if (me.error) return { ok: false, error: me.error };
  const ctx = await chipContextFor(me.character);
  // Every room that opens onto here, gated from this side (db/lib/roomSides.js).
  const rooms = await loadRoomsAt(prisma, me.character.locationId, {
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
      accessTagSlugs: true,
      tags: {
        where: { quantity: { gt: 0 } },
        orderBy: { tag: { name: "asc" } },
        // Whole chip shape, so you can READ before picking up.
        select: { tagId: true, quantity: true, tag: { select: CHIP_ROW_SELECT } },
      },
    },
  });
  const keys = await roomAccessKeys(prisma, me.character.id);
  // A room you can't get into is a locked door, not an empty one.
  const room = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "You can't get in there." };
  // What is under the floor, counted in stacks and said before anybody searches (SEARCH.md §9c).
  const hidden = await countHiddenStacks(prisma, room.id);
  return {
    ok: true,
    name: room.name,
    hidden,
    hiddenLine: hiddenCountLine(hidden),
    resources: resourcesOf(room),
    // ⬢ is drawn as its own chip (RoomPanel.js), not as a pickable stack.
    items: (room.tags ?? [])
      .filter((rt) => (rt.quantity ?? 0) > 0 && !isResourcesRow(rt))
      .map((rt) => toChipRow(rt, ctx)),
  };
}

// Going through the open room for what is under the floor (SEARCH.md §9).
// Every rule is db/lib/roomSearch.js#searchRoom, shared with the Discord
// button; this is the session, the line back, and the room's ambient line.
// The stash the panel shows is re-read by the caller afterwards, since a find
// lands on the floor rather than in a pocket.
export async function searchRoom(roomId) {
  const me = await actor({
    id: true,
    status: true,
    locationId: true,
    discordUserId: true,
    tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { slug: true, name: true } } } },
  });
  if (me.error) return { ok: false, error: me.error };
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
  const out = await searchRoomInDb(prisma, { character: me.character, roomId, turn });
  if (!out.ok) return { ok: false, error: out.reason };
  // REST and best-effort, after the answer; the room hears that somebody went
  // through it and not what they found.
  after(() => announceInRoom(out.room, me.character, out.line).catch(() => {}));
  return { ok: true, line: out.readout, found: out.found.length, sfx: SFX.STASH };
}

// ---------------------------------------------------------------- travelling

export async function loadTravel() {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const character = me.character;
  if (!character.locationId) return { ok: false, error: "You are nowhere yet." };

  // Two waves, the shape /map's loadMap uses and for the same reason: these
  // four used to be four awaits in a row, and the two graph questions below
  // each read Location and LocationLink for themselves.
  const [graph, config, openTurn, { seen }] = await Promise.all([
    loadGraph(prisma),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
    knownLocations(prisma, character.id),
  ]);
  const [routes, options, party, currentZone, action] = await Promise.all([
    // Everywhere farther in their own zone they could walk to (MAP.md §3c). Kept
    // OUT of `options` on purpose: that grid means "doors out of this room", and
    // folding a three-hop walk into it would make the panel lie about what is
    // next door.
    routesWithinZone(prisma, character, { known: seen, graph }),
    travelOptions(prisma, character, character.locationId, { graph }),
    partyOf(prisma, character.id),
    character.zoneId ? prisma.zone.findUnique({ where: { id: character.zoneId }, select: { slug: true, name: true } }) : null,
    // Whether the Move is spent — a push on is only offered after it is
    // (MAP.md §3). The same read the sheet's hasMoved makes.
    prisma.action.findFirst({ where: { characterId: character.id, turn: { status: "OPEN" } }, select: { id: true } }),
  ]);
  const acted = Boolean(action);

  return {
    ok: true,
    // Somebody has hold of them (INTERCEPT.md) — the banner over the list, said once.
    held: heldReasonFor(character),
    // The AMBIENT count, before a destination is picked. Both count the
    // party, so a mount's extra crossing is already reflected (MAP.md §3a).
    freeLeft: freeMovesLeft(character, config, openTurn, party.length),
    freeReason: freeZoneMovesReason(character, party.length, { config, openTurn }),
    // The same count in two halves — "1 travel, plus 2 rides on your
    // Motorcycle" — for the header and the confirm (MAP.md §3a). The sentence
    // is built here because TravelNodes is a client component and
    // locationTravel.js is not for the browser bundle.
    breakdown: freeMovesBreakdown(character, config, openTurn, party.length),
    travelLine: travelSentence(freeMovesBreakdown(character, config, openTurn, party.length)),
    // Whether there's anything to dismount at all — the node list only
    // marks a specific way or a specific destination as a consequence when
    // this is true, since "on foot" means nothing to somebody already walking.
    mounted: blocksOnFoot(equippedSlugs(character.tags ?? [])),
    // The Move already spent this turn: Go leaves the strip and the push on
    // is the only way across a zone with no travel left (MAP.md §3).
    moved: acted,
    // The zone they are standing in, for the heading over the walks.
    zoneName: currentZone?.name ?? null,
    // More than one hop only — a neighbour is already a way out above, and
    // listing it twice would read as two different journeys to one place.
    walks: routes
      .filter((row) => row.hops > 1)
      .map((row) => ({
        id: row.location.id,
        name: row.location.name,
        description: row.location.description || null,
        hops: row.hops,
        through: row.path.slice(0, -1).map((l) => l.name),
        dismounts: row.dismounts,
        // A tight squeeze somewhere along the road (MAP.md §2a) — said to
        // everybody, so a leader knows their Giant cannot finish this walk.
        tightSqueeze: Boolean(row.tightSqueeze),
      })),
    options: options.map((row) => {
      // Which way the push on's die leans for this character, said before
      // they commit (MAP.md §3). Null when it doesn't.
      const exertNote = exertEdgeSentence(exertEdgeFor(character.tags ?? []));
      const exertOpts = { left: 0, acted };
      const freeLeft = freeMovesLeft(character, config, openTurn, party.length);
      // The server's own refusal of a push on here, asked ahead of time
      // (MAP.md §3); null is yes. Shown once the Move is spent and this is
      // the only way across, so a player knows why the way is shut till
      // next turn.
      const exertWhy = row.crossesZone
        ? exertRefusal(character, config, openTurn, { ...exertOpts, left: freeLeft, cost: row.cost })
        : null;
      return {
        id: row.location.id,
        name: row.location.name,
        // Already loaded: locationGraph's LINK_INCLUDE pulls whole Location rows
        // on both ends of a link, so this costs no query. The node draws it so
        // the way out says what it leads to, not just where.
        description: row.location.description || null,
        zoneName: row.location.zone?.name ?? null,
        zoneSlug: row.location.zone?.slug ?? null,
        // A CAVE_LEVEL destination, which is now exactly where the Caving Die
        // rolls — travelCost.js#crossingConfirm reads this to warn before a
        // zone crossing lands somebody underground (CAVING.md §2). There is no
        // exempt place left to subtract; the `safe` attribute is gone.
        caveLevel: row.location.zone?.kind === "CAVE_LEVEL",
        crossesZone: row.crossesZone,
        // What the crossing spends in travel — ½ between the town zones, 1
        // anywhere else (db/lib/crossingCost.js), 0 inside the zone.
        cost: row.cost ?? 0,
        passable: row.passable,
        freeLeft,
        // Whether the Push on button belongs on the strip for this crossing.
        canExert: row.crossesZone && exertWhy === null,
        exertWhy,
        exertNote,
        // A way too narrow to ride or push through — crossing it dismounts
        // instead of refusing (db/lib/indoors.js#dismountForNarrowWay).
        dismounts: Boolean(row.dismounts),
        // A hole no Giant fits through (MAP.md §2a). Drawn as a chip for
        // EVERYBODY, not only the Giant it refuses — so the rest of a party
        // can see where their Giant friend cannot follow.
        tightSqueeze: Boolean(row.tightSqueeze),
        // Which of this character's own tags opens the way, when one does — the
        // node draws it as that tag's chip, so a climb you paid Caving
        // for says so instead of looking like every other road. Only ever a tag
        // they hold (locationGraph.js#crossingCheck), so there is nothing here to
        // leak.
        openedBy: row.openedBy ?? null,
        // crossingCheck's field is `refusal`, not `reason` — this was silently
        // dropping the actual message (e.g. the locked/shut wording) and
        // falling back to the node's generic "no way".
        reason: row.refusal ?? null,
      };
    }),
    partySize: party.length,
  };
}

// ------------------------------------------------------------------ escort

// The party rack: who's here, who's with you, how many seats. Polled the way HereList polls its own list.
export async function loadParty() {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const character = me.character;

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });

  // A passenger cannot lead a party of their own (db/lib/escort.js
  // #escortAuthority), so the rack shows who THEY are being brought along
  // with instead of a picker to bring somebody of their own (MAP.md §3a).
  // One view of who is hidden from THIS character, shared by every list below —
  // built off presentRows, so it can never disagree with resolveHoodToken about
  // who a token names (db/lib/escort.js#escortView).
  const view = await escortView(prisma, character);
  let riding = null;
  if (character.escortedById) {
    const [leaderRow, companions] = await Promise.all([
      prisma.character.findUnique({ where: { id: character.escortedById }, select: { id: true, name: true } }),
      partyOf(prisma, character.escortedById),
    ]);
    // The LEADER may be the one in the mask — a masked faction Leader can attach
    // you FORCED — so their row goes through the same view, and their id does
    // not travel at all. `leaderId` used to ship raw, which /api/avatar answers
    // with a face.
    riding = {
      // No `leaderId`. It used to ship the real one, which /api/avatar answers
      // with a face, and the rack never read it — PartyRack.js draws the name
      // and nothing else.
      leaderName: leaderRow ? escortName(leaderRow, view) : "somebody",
      // escortName, never row.name: a party can carry somebody in a mask now,
      // and the rack is the one place that would publish the name they are
      // wearing it to hide (PROXYING.md §5). No id on a hood row either.
      // By the name shown, never partyOf's real-name order (escort.js#byShownName).
      companions: byShownName(
        companions
          .filter((row) => row.id !== character.id)
          .map((row) => ({ id: escortKey(row, view), name: escortName(row, view), status: row.status })),
      ),
    };
  }

  const [candidates, party, incoming] = await Promise.all([
    escortCandidates(prisma, character, openTurn?.number ?? null),
    partyOf(prisma, character.id),
    // Asks aimed at THIS character — the Discord buttons are unreachable for a web-only player.
    prisma.offer.findMany({
      where: { kind: "ESCORT", status: "PENDING", responderId: character.id },
      select: { id: true, initiatorId: true },
    }),
  ]);

  // Offer.initiatorId is a bare column, not a relation — resolve the name with its own lookup, like every other reader.
  // Through the view like everything else: the person asking to take you along
  // may be wearing a mask, and "Sir Alder wants to take you along" would be the
  // unmasking. escortName answers "somebody" for anyone the view hides.
  const askerNames = new Map();
  if (incoming.length) {
    const askers = await prisma.character.findMany({
      where: { id: { in: [...new Set(incoming.map((o) => o.initiatorId))] } },
      select: { id: true, name: true },
    });
    for (const asker of askers) askerNames.set(asker.id, escortName(asker, view));
  }

  return {
    ok: true,
    riding,
    seats: fastTravelCapacity(equippedSlugs(character.tags ?? [])),
    candidates,
    // Re-derived rather than read off `candidates`: a follower can be with you and no longer be a candidate.
    // By the name shown, never partyOf's real-name order (escort.js#byShownName).
    party: byShownName(party.map((row) => ({
      id: escortKey(row, view),
      name: escortName(row, view),
      status: row.status,
      // The avatar's own gate. A hood row is keyed by token, so /api/avatar
      // could not draw the face even if it tried — this is what makes it draw
      // the question-mark plate instead of nothing.
      hooded: escortHidden(row, view),
      reason: escortReason(row, escortAuthority(character, row, openTurn?.number ?? null)),
    }))),
    incoming: incoming.map((offer) => ({ id: offer.id, from: askerNames.get(offer.initiatorId) ?? "Somebody" })),
  };
}

// Pick somebody up. FORCED and CONSENTED attach at once; anyone else is asked. Re-derived — the panel's verdict is a hint.
export async function bringAlong(targetKey) {
  const me = await actor(MOVER_SELECT, { acting: true });
  if (me.error) return { ok: false, error: me.error };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  // A KEY now (db/lib/targetKey.js), because the picker offers hoods — their id
  // never travels. allowDead, since a body is the most FORCED follower there is.
  const targetId = await resolveTargetKey(prisma, me.character, targetKey, { allowDead: true });
  const target = targetId
    ? await prisma.character.findUnique({ where: { id: targetId }, select: MOVER_SELECT })
    : null;
  const verdict = escortAuthority(me.character, target, openTurn?.number ?? null);
  // Says WHICH rule refused, not just "you can't".
  if (!verdict) return { ok: false, error: escortRefusal(me.character, target) };

  if (verdict === "ASK") {
    if (!openTurn) return { ok: false, error: "No turn is open." };
    const offer = await createEscortOffer(prisma, { actor: me.character, target, turn: openTurn });
    if (!offer.ok) return { ok: false, error: offer.reason };
    await sendDm(offer.dm.discordUserId, offer.dm.content, { components: offer.dm.components, meta: offer.dm.meta }).catch(() => {});
    return { ok: true, line: `You asked ${escortName(target, await escortView(prisma, me.character))} to come with you.` };
  }

  // A FORCED target is taken, not agreed with — escortAuthority already decided above; attach must not re-decide it.
  if (!(await attach(prisma, me.character.id, target.id, { takeover: verdict === "FORCED" }))) {
    return { ok: false, error: "Somebody else has them." };
  }
  await syncPartyMembership(prisma, me.character.id).catch(() => {});
  return { ok: true, line: `${escortName(target, await escortView(prisma, me.character))} is with you.` };
}

// Put somebody down. Always allowed: letting go is never gated.
export async function putDown(targetKey) {
  const me = await actor(MOVER_SELECT, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  // A key, like the picker that offered it. allowDead: you can be carrying a
  // body, and putting one down is exactly as ungated as putting anyone down.
  const targetId = await resolveTargetKey(prisma, me.character, targetKey, { allowDead: true });
  const target = targetId
    ? await prisma.character.findFirst({
        where: { id: targetId, escortedById: me.character.id },
        select: MOVER_SELECT,
      })
    : null;
  if (!target) return { ok: false, error: "They aren't with you." };
  await detach(prisma, target.id);
  await syncPartyMembership(prisma, me.character.id).catch(() => {});
  return { ok: true, line: `You let ${escortName(target, await escortView(prisma, me.character))} go.` };
}

// Answering an ask from the web. Same two functions the bot's buttons call, so the two faces can't drift.
export async function answerEscort({ offerId, accept } = {}) {
  const me = await actor(MOVER_SELECT, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const offer = await prisma.offer.findFirst({
    where: { id: offerId ?? "", kind: "ESCORT", status: "PENDING", responderId: me.character.id },
  });
  if (!offer) return { ok: false, error: "That offer's gone." };

  const result = accept
    ? await acceptEscort(prisma, offer, me.character)
    : await declineOfferOfKind(prisma, offer, me.character);
  for (const dm of result.dms ?? []) {
    await sendDm(dm.discordUserId, dm.content).catch(() => {});
  }
  if (accept && result.ok) {
    await syncPartyMembership(prisma, offer.initiatorId).catch(() => {});
  }
  return result.ok ? { ok: true, line: result.line } : { ok: false, error: result.reason };
}

// `exert`: the Push on button — one more crossing on a die instead of the
// Move (MAP.md §3). performLocationMove refuses it wherever it doesn't apply.
export async function travelTo({ locationId, exert = false } = {}) {
  const me = await actor(MOVER_SELECT, { acting: true });
  if (me.error) return { ok: false, error: me.error };

  const target = await prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } });
  if (!target) return { ok: false, error: "That place no longer exists." };

  // The panel went stale and sent the ground they are already standing on —
  // they moved on the bot, an escort carried them, or a second tab took the hop
  // first. Answered here in its own words, because the two routes below would
  // both read it as a place with no road to it: linkBetween(x, x) finds no edge
  // (a Location is never linked to itself), so it falls to the walk finder,
  // whose refusal is the FOG line — "You don't know a way there" about the
  // street under your boots. `stale` tells the client to re-read the road
  // instead of leaving the player clicking a list that can only refuse.
  if (me.character.locationId === target.id) {
    return { ok: false, error: "You're already there.", stale: true };
  }

  // Adjacent, or a walk of several hops across this zone (MAP.md §3c)? The
  // ROUTE IS RESOLVED SERVER-SIDE from the posted id and is never accepted from
  // the browser — same reasoning that keeps the escort party out of the mover's
  // parameters. `exert` means nothing on a walk: it never crosses a zone.
  const adjacentLink = me.character.locationId
    ? await linkBetween(prisma, me.character.locationId, target.id)
    : null;
  const walking = Boolean(me.character.locationId) && !adjacentLink;

  // Who comes along is read off Character.escortedById inside the move's own
  // transaction — nothing is posted from the browser, so there is nothing to
  // re-authorize here (MAP.md §3a).
  const result = walking
    ? await walkWithinZone(prisma, me.character, target)
    : await performLocationMove(prisma, me.character, target, { exert: exert === true });
  if (!result.ok) return { ok: false, error: result.reason };

  // Followers the way would not take, already detached. The leader's line
  // must not name the reason — a hidden crawl's refusal would announce it (MAP.md §2a).
  const stranded = [];
  const heldBack = [];
  // Everything this move owes DISCORD, as thunks, run in after() at the bottom
  // of this function. The NAMES are gathered here and now, because the sentence
  // this action returns is built out of them — it is only the telling that
  // waits. See the block below for why any of it waits at all.
  const tell = [];
  // Leader and follower each name the other as they know them
  // (intercept.js#seenBy): the escort rack offered a hood or a stranger by
  // token, so neither line may hand back the name.
  const leftBehind = result.leftBehind ?? [];
  const leftNames = await seenByIdMany(prisma, me.character.id, leftBehind.map((entry) => entry.character.id));
  // "held" is the one reason the leader IS told — it's plain to see anyway.
  leftBehind.forEach((entry, i) => (entry.reason === "held" ? heldBack : stranded).push(leftNames[i]));
  for (const entry of leftBehind) {
    if (entry.character.status !== "ALIVE" || !entry.character.discordUserId) continue;
    const left = entry.character.discordUserId;
    const leader = capitalizeFirst(await seenById(prisma, entry.character.id, me.character.id));
    tell.push(() => sendDm(left, `*${leader} went on without you.*`));
  }

  // The arrival's GAME half, AWAITED: the fog, a narrow-way dismount, a hand on a
  // shoulder, a turret's kill. MAP.md §3 promises the character is standing at
  // the destination by the time this call returns, and the sentence built at
  // the bottom of this function reads the result of it.
  // SKIPPED for a walk: locationWalk.js already ran it per hop, and running it
  // again over the merged list would fire every turret twice and re-roll every
  // Caving Die (MAP.md §3c). It hands back its hops' Discord halves instead,
  // already in order, which is what `arrivalFacts` is.
  const arrivalFacts = [...(result.arrivalFacts ?? [])];
  if (!result.sideEffectsApplied) {
    for (const entry of result.moved) {
      const facts = await applyArrivalFacts(prisma, {
        characterId: entry.character.id,
        fromLocationId: entry.fromLocationId,
        toLocationId: entry.toLocationId,
        // Only ever the mover's own mount.
        dismounted: entry.character.id === me.character.id ? result.dismounted : undefined,
        walked: true, // on foot, so the street behind them stays lit (db/lib/vantages.js) — a dragged passenger walked too
      }).catch((err) => {
        console.error(`Travel: arrival facts failed for ${entry.character.id}:`, err.message ?? err);
        return null;
      });
      if (facts) arrivalFacts.push(facts);
    }
  }
  // The arrival's DISCORD half — the Location channel, the zone role, the room
  // threads, the gate line into #summary. THIS is what made a click take
  // minutes: ARCHITECTURE.md §4, "awaiting Discord inside a server action
  // freezes the web app", and a walk multiplied it by up to eight hops. One
  // rate-limited call in db/lib/discordRest/core.js can sit on a sleeping
  // connection for the better part of two minutes, and there are dozens of them
  // in a dressed arrival. So the player is told they moved and Discord catches
  // up behind them, which is the latency MAP.md §3 already tolerates.
  for (const facts of arrivalFacts) {
    tell.push(() => applyArrivalDiscord(prisma, facts));
  }
  // The Caving Die's "on arrival" trigger (CAVING.md). A walk collected one per
  // hop, so it hands them over already gathered.
  const cavingDms = result.cavingDms ?? result.moved.map((entry) => entry.cavingDm).filter(Boolean);
  for (const dm of cavingDms) {
    tell.push(() => sendDm(dm.discordUserId, dm.content));
  }
  // Anybody laying in wait here (INTERCEPT.md), built inside performLocationMove.
  for (const dm of result.interceptDms ?? []) {
    tell.push(() =>
      sendDm(dm.discordUserId, dm.content, {
        kind: dm.kind,
        authorDiscordUserId: dm.authorDiscordUserId ?? null,
        components: dm.components,
        meta: dm.meta,
        sfx: dm.sfx,
        // Belt to cleanMessage() already stripping broadcast pings.
        allowedMentions: { parse: [] },
      }),
    );
  }
  // Where they ACTUALLY got to, which on a walk is not always where they meant
  // to go — an ambush, a gate shut behind somebody, a gun at the Depot. The
  // ground they covered is real and they are standing on it, so every line
  // below names this rather than the destination they picked.
  const landed = result.arrivedAt ?? target;

  const passengers = result.moved.filter((entry) => entry.character.id !== me.character.id);
  const brought = await seenByIdMany(prisma, me.character.id, passengers.map((entry) => entry.character.id));
  for (const entry of passengers) {
    if (entry.character.status !== "ALIVE" || !entry.character.discordUserId) continue;
    const passenger = entry.character.discordUserId;
    const leader = capitalizeFirst(await seenById(prisma, entry.character.id, me.character.id));
    tell.push(() => sendDm(passenger, `*${leader} brought you along to ${landed.name}.*`));
  }

  // Everything owed to Discord, after the response has gone. SEQUENTIAL, never
  // Promise.all: Discord bans an IP for an hour after ten thousand invalid
  // responses (ARCHITECTURE.md §5), so deferring this changed when it runs and
  // nothing else. Each failure is LOGGED rather than swallowed — §5 again: a
  // best-effort side effect still has to leave a trace.
  after(async () => {
    for (const one of tell) {
      // try/catch rather than .catch(): a thunk that throws BEFORE returning its
      // promise would otherwise take the rest of the queue down with it, and
      // then a party's arrival would go untold because one DM had a bad id.
      try {
        await one();
      } catch (err) {
        console.error("Travel: telling Discord failed:", err.message ?? err);
      }
    }
  });

  const parts = [
    walking && result.complete === false
      ? `You got as far as ${landed.name}.`
      : `Moved to ${landed.name}.`,
  ];
  // Always the mover's own sentence, never one written here — that is what
  // keeps a hidden crawl's refusal identical to a nonexistent edge's (§2a).
  if (result.stoppedBy?.reason) parts.push(result.stoppedBy.reason);
  if (result.usedFreeMove) {
    parts.push(
      result.freeMovesLeft > 0
        ? `${result.travelLeft ? travelSentence(result.travelLeft) : `${formatTravel(result.freeMovesLeft)} travel`} left this turn.`
        : "That was the last of your travel this turn.",
    );
  }
  if (result.spentTurn) parts.push("That crossing spent your Move.");
  if (result.exert) parts.push(exertResultLine(result.exert));
  if (brought.length > 0) parts.push(`Bringing ${brought.join(", ")}.`);
  if (stranded.length > 0) parts.push(`You can't move ${stranded.join(", ")} through here.`);
  if (heldBack.length > 0) parts.push(`Somebody has hold of ${heldBack.join(", ")}.`);
  // Your own boots on whatever they landed on. The mover's tab alone — a zone full of
  // people crossing all day must not be a zone full of footsteps. `arrivedAt` comes back
  // from a walk without its zone, so the slug's own prefix is the fallback: a Location is
  // `<zone>-<code>` by docs/zones.yaml's convention.
  const ground = groundSfx(landed.zone?.slug ?? String(landed.slug ?? "").split("-")[0]);
  if (result.dismounted.length > 0) {
    return { ok: true, line: `${parts.join(" ")} ${dismountedMessage(result.dismounted)}`, sfx: ground };
  }
  return { ok: true, line: `${parts.join(" ")}`, sfx: ground };
}

// ------------------------------------------------------------------- gates

export async function flipGate(linkId) {
  const me = await actor(GATE_CHARACTER_SELECT, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const result = await toggleGate(prisma, {
    character: me.character,
    linkId,
    actorDiscordUserId: me.discordUserId,
  });
  if (!result.ok) return { ok: false, error: result.error };
  // Redrawing the Discord anchor stays with the bot, which owns those messages — the gate is already flipped either way.
  return { ok: true, line: result.line };
}

export async function holdKeyed(linkId) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const result = await holdKeyedOpen(prisma, { discordUserId: me.discordUserId, linkId, hold: true });
  return result.ok ? { ok: true, line: result.line, note: result.note } : { ok: false, error: result.error };
}

// ------------------------------------------------------------- noticeboard

// A paper's whole Tag row: paperDescription and readBlock both need it, and a `select` beside a nested `include` isn't valid Prisma.
const BOARD_ACTOR_SELECT = {
  id: true,
  name: true,
  locationId: true,
  discordUserId: true,
  tags: { select: { tagId: true, equipped: true, tag: true } },
};

// The board where this character is standing. The LOAD (db/lib/noticeboard.js#boardFor) is Location-keyed and knows nothing about who's asking.
async function boardHere(character) {
  return boardFor(prisma, character.locationId);
}

export async function readBoard() {
  const me = await actor(BOARD_ACTOR_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const ctx = await boardHere(me.character);
  if (ctx.error) return { ok: false, error: ctx.error };

  // Never gated on whether they can read it — pinning up a letter you can't read yourself is a fine thing to do.
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

  const where = { daylight: isDaylight(), indoors: ctx.location.indoors ?? true };
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
  const me = await actor(BOARD_ACTOR_SELECT, { acting: true });
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
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: tornLine(post.tag.name), sfx: SFX.TEAR });
  return { ok: true, line: `You take ${post.tag.name} down.` };
}

export async function pinNotice(tagId) {
  const me = await actor(BOARD_ACTOR_SELECT, { acting: true });
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
    if (err?.code === "P2002") return { ok: false, error: "That one is already up somewhere." };
    return { ok: false, error: "That didn't go up." };
  }

  if (ctx.location.discordChannelId) {
    await postMessage(ctx.location.discordChannelId, ambientLine(pinnedLine(held.tag.name))).catch(() => {});
  }
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: pinnedLine(held.tag.name), sfx: SFX.PIN });
  return { ok: true, line: `You nail ${held.tag.name} up. Anyone here can read it, or take it down.` };
}

// ------------------------------------------------ the board, worked by a GM
// A GM has no body, so the player gates answer "no" for them. FOUR SEPARATE
// ACTIONS since three behave differently (no literacy gate, a destroying tear, a paper minted from nothing).
async function gmBoard(placeKey) {
  const { session, isGm } = await getGmSession();
  // Same sentence a characterless player gets.
  if (!session?.discordUserId || !isGm) return { error: "You have no living character." };
  const parsed = parsePlaceKey(placeKey);
  if (parsed?.kind !== "loc") return { error: "There's no board here." };
  const ctx = await boardFor(prisma, parsed.id);
  if (ctx.error) return ctx;
  return { ...ctx, discordUserId: session.discordUserId };
}

export async function gmReadBoard(placeKey) {
  const ctx = await gmBoard(placeKey);
  if (ctx.error) return { ok: false, error: ctx.error };
  // No `holding`: a GM has no paper to pin, so the dialog gives a writing form where a player gets a picker.
  return {
    ok: true,
    heading: boardText(ctx.location.name, ctx.posts, ctx.openTurn?.number ?? 0),
    notices: ctx.posts.map((p) => ({ id: p.id, name: p.tag.name })),
  };
}

export async function gmReadNotice(placeKey, postId) {
  const ctx = await gmBoard(placeKey);
  if (ctx.error) return { ok: false, error: ctx.error };
  const post = ctx.posts.find((p) => p.id === postId);
  if (!post) return { ok: false, error: "It's gone." };
  // A GM sees everything, wax seal included, out of the same function (db/lib/paper.js#paperViewGm). Reading is silent either way.
  const paper = paperViewGm(post.tag);
  return { ok: true, name: post.tag.name, text: paper.text, plain: paper.plain, paper };
}

export async function gmTearNotice(placeKey, postId) {
  const ctx = await gmBoard(placeKey);
  if (ctx.error) return { ok: false, error: ctx.error };
  const post = ctx.posts.find((p) => p.id === postId);
  if (!post) return { ok: false, error: "It's gone." };

  // The delete IS the claim, same as a player's tear — the paper goes with the post since a GM has nothing to hold it in.
  const claimed = await destroyNotice(prisma, post);
  if (claimed.count === 0) return { ok: false, error: "Somebody got there first." };

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: ctx.discordUserId,
        actionType: "gm_tear_notice",
        details: {
          locationId: ctx.location.id,
          locationName: ctx.location.name,
          tagName: post.tag.name,
          face: "web",
        },
      },
    })
    .catch((err) => console.error("Notice audit log failed:", err));

  if (ctx.location.discordChannelId) {
    await postMessage(ctx.location.discordChannelId, ambientLine(tornLine(post.tag.name))).catch(() => {});
  }
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: tornLine(post.tag.name), sfx: SFX.TEAR });
  return { ok: true, line: `You take ${post.tag.name} down.` };
}

export async function gmPostNotice(placeKey, { title: rawTitle = "", body: rawBody = "" } = {}) {
  const ctx = await gmBoard(placeKey);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!ctx.openTurn) return { ok: false, error: "Nothing is happening yet." };

  // The title is CLEANED and the body only trimmed — a paper's NAME is
  // interpolated raw into bot messages (an "@" is a mention waiting to
  // happen), while the body is only shown through PaperSheet or a code block.
  const title = cleanCustomText(rawTitle, TITLE_MAX) || null;
  const body = String(rawBody ?? "").trim().slice(0, WRITE_MAX);
  if (!body) return { ok: false, error: "Write something first." };

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { noticeExpiryTurns: true },
  });
  const expiresTurn = expiryFrom(ctx.openTurn.number, config?.noticeExpiryTurns ?? 10);

  // MINTED OUTSIDE A TRANSACTION: createWithRetry re-rolls the slug on a
  // unique collision, and Postgres aborts the whole transaction on the first
  // failed statement (25P02) — a retry inside one throws (db/lib/paperMint.js).
  // paperAuthor takes the GM's Discord id for the audit trail only — a notice is anonymous on the board.
  const paper = await mintUnownedPaper(
    prisma,
    `gm-notice-${ctx.location.id}`,
    ctx.discordUserId,
    body,
    title,
  );

  try {
    await prisma.noticePost.create({
      data: {
        locationId: ctx.location.id,
        tagId: paper.id,
        // Nobody pinned it — the same shape a Wanted poster lands in (db/lib/wantedPoster.js).
        postedById: null,
        postedTurn: ctx.openTurn.number,
        expiresTurn,
      },
    });
  } catch (err) {
    // The paper exists but the board refused it — an orphan nothing can reach. Take it back out.
    await prisma.tag.deleteMany({ where: { id: paper.id, ephemeral: true } }).catch(() => {});
    if (err?.code === "P2002") return { ok: false, error: "That one is already up somewhere." };
    return { ok: false, error: "That didn't go up." };
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: ctx.discordUserId,
        actionType: "gm_post_notice",
        details: {
          locationId: ctx.location.id,
          locationName: ctx.location.name,
          tagId: paper.id,
          tagName: paper.name,
          face: "web",
        },
      },
    })
    .catch((err) => console.error("Notice audit log failed:", err));

  // THE SAME LINE A PLAYER'S PIN RAISES — names the paper, never the person, so nobody can tell a GM's notice from anyone else's.
  if (ctx.location.discordChannelId) {
    await postMessage(ctx.location.discordChannelId, ambientLine(pinnedLine(paper.name))).catch(() => {});
  }
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: pinnedLine(paper.name), sfx: SFX.PIN });
  return { ok: true, line: `You nail ${paper.name} up. Anyone here can read it, or take it down.` };
}

// ------------------------------------------------- the place, read by a GM
// What GmAside.js draws: a GM changes place by clicking, so this is an action on the open place, not a server re-render (CHAT.md §1).
async function gmPlace(placeKey) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return { error: "You have no living character." };

  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return { error: "Nowhere to look." };

  // Every kind resolved down to its Location. A zone has none, and neither does a net.
  let locationId = null;
  let conversationId = null;
  let roomId = null;
  let zoneId = null;
  if (parsed.kind === "loc") {
    locationId = parsed.id;
  } else if (parsed.kind === "room") {
    const room = await prisma.room.findUnique({
      where: { id: parsed.id },
      select: { id: true, locationId: true },
    });
    if (!room) return { error: "That room is gone." };
    roomId = room.id;
    locationId = room.locationId;
  } else if (parsed.kind === "conv") {
    const conversation = await prisma.playerThread.findUnique({
      where: { id: parsed.id },
      select: { id: true, locationId: true },
    });
    if (!conversation) return { error: "That conversation is gone." };
    conversationId = conversation.id;
    locationId = conversation.locationId;
  } else if (parsed.kind === "zone") {
    zoneId = parsed.id;
  }

  const location = locationId
    ? await prisma.location.findUnique({
        where: { id: locationId },
        select: {
          id: true,
          name: true,
          description: true,
          attributes: true,
          discordChannelId: true,
          zone: { select: { id: true, name: true, description: true } },
        },
      })
    : null;
  if (locationId && !location) return { error: "That place is gone." };

  const scopeZoneId = location?.zone?.id ?? zoneId ?? null;
  const allowed = await visibleZoneIds(prisma, session.discordUserId);
  if (allowed && scopeZoneId && !allowed.has(scopeZoneId)) {
    return { error: "That is not one of the zones you are watching." };
  }

  return { session, location, locationId, roomId, conversationId, zoneId };
}

export async function gmPlaceView(placeKey) {
  const ctx = await gmPlace(placeKey);
  if (ctx.error) return { ok: false, error: ctx.error };
  const { location, locationId, roomId, conversationId, zoneId } = ctx;

  // A radio net belongs to no zone and no Location (CHAT.md §5d) — answered plainly, not with an empty column.
  if (!locationId && !zoneId) {
    return { ok: true, placeKey, kind: "net" };
  }

  // A zone summary is the zone and its Locations, nothing else — a GM reading #summary isn't standing in any of them.
  if (!locationId) {
    const zone = await prisma.zone.findUnique({
      where: { id: zoneId },
      select: {
        id: true,
        name: true,
        description: true,
        locations: { orderBy: { name: "asc" }, select: { id: true, name: true } },
      },
    });
    if (!zone) return { ok: false, error: "That zone is gone." };
    return {
      ok: true,
      placeKey,
      kind: "zone",
      zone: { name: zone.name, description: zone.description ?? "" },
      locations: zone.locations.map((l) => ({ id: l.id, name: l.name })),
    };
  }

  const [examined, people, rooms, links, structures, members] = await Promise.all([
    examineLines(prisma, locationId),
    whosHereGm(prisma, locationId),
    prisma.room.findMany({
      where: { locationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        kind: true,
        accessTagSlugs: true,
        // roomAffordances reads this to decide the Phone button is there at
        // all (docs/systemdocs/PHONES.md) — without it the GM aside draws
        // every fixture in the room except the phone.
        phone: true,
        // And this one for the vending machine, for the same reason
        // (docs/systemdocs/VENDING.md).
        vendingMachine: true,
        tags: {
          where: { quantity: { gt: 0 } },
          orderBy: { tag: { name: "asc" } },
          // The whole chip shape, not just a name.
          select: { tagId: true, quantity: true, tag: { select: CHIP_ROW_SELECT } },
        },
      },
    }),
    linksFor(prisma, locationId),
    structuresAt(prisma, locationId),
    conversationId ? conversationMembers(prisma, conversationId, null, { gm: true }) : Promise.resolve(null),
  ]);

  // The place-only half of the affordance catalog (db/lib/placeAffordances.js). Travel and Who's here? dropped, same reason ChatAside drops them.
  const fixtures = locationAffordances(location, { web: true })
    .filter((entry) => entry.id !== "travel" && entry.id !== "whosHere" && entry.id !== "examine")
    .map((entry) => ({ id: entry.id, label: entry.label, tone: entry.tone }));

  // Every modular way out, read through the graph rather than off a button — same reason examineLines reads it that way.
  const ways = (links ?? [])
    .map((link) => {
      const far = endpoints(link, locationId).far;
      return {
        linkId: link.id,
        farName: far?.name ?? "somewhere",
        modular: Boolean(link.modular),
        isOpen: Boolean(link.isOpen),
        keyed: Boolean(link.keyed),
        held: link.keyed ? isHeldOpen(link) : false,
      };
    })
    .sort((a, b) => a.farName.localeCompare(b.farName));

  const openRoom = roomId ? rooms.find((room) => room.id === roomId) ?? null : null;
  // Where the bomb is lives on GameState, not the room (docs/systemdocs/NUKE.md).
  const nukeRoomId = openRoom
    ? (await prisma.gameState.findUnique({ where: { id: 1 }, select: { nukeRoomId: true } }))?.nukeRoomId ?? null
    : null;

  return {
    ok: true,
    placeKey,
    kind: roomId ? "room" : conversationId ? "conv" : "loc",
    place: { id: location.id, name: location.name, description: location.description ?? "" },
    zone: { name: location.zone?.name ?? "", description: location.zone?.description ?? "" },
    // examineLines returns { ok, name, lines } or { ok: false, error }.
    lines: examined?.ok ? examined.lines : [],
    fixtures,
    people,
    ways,
    // typeName is a snapshot column, same reasoning as every other log column.
    structures: (structures ?? []).map((s) => ({
      id: s.id,
      name: s.typeName,
      status: s.status,
      turnsDone: s.turnsDone,
      turnsNeeded: s.turnsNeeded,
    })),
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      private: room.kind === "PRIVATE",
      keys: room.accessTagSlugs ?? [],
      resources: resourcesOf(room),
      // ⬢ is drawn as its own chip (GmAside.js's Things()), not among the things.
      things: withoutResources(room.tags).map((t) => toChipRow(t, GM_CHIP_CTX)),
    })),
    openRoom: openRoom
      ? {
          id: openRoom.id,
          name: openRoom.name,
          private: openRoom.kind === "PRIVATE",
          keys: openRoom.accessTagSlugs ?? [],
          resources: resourcesOf(openRoom),
          things: withoutResources(openRoom.tags).map((t) => toChipRow(t, GM_CHIP_CTX)),
          fixtures: roomAffordances(markNukeRoom([openRoom], nukeRoomId)[0], null, { web: true }).map((entry) => ({
            id: entry.id,
            label: entry.label,
            tone: entry.tone,
          })),
        }
      : null,
    members,
  };
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
  const open = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds);
  return { ok: true, rooms: open.map((r) => ({ id: r.id, name: r.name, private: r.kind === "PRIVATE" })) };
}

// How many people one Converse may seat besides the opener — a bound on a hand-posted list, since each hood token costs a presence query.
const INVITE_LIMIT = 10;

// `inviteRefs` are character ids, or the bare hood token a concealed row carries instead — the same pair lookAt/addMember/removeMember take.
export async function openConversation({ roomId, name, inviteRefs = [] } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };

  const trimmed = String(name ?? "").trim().slice(0, 90);
  if (!trimmed) return { ok: false, error: "Give it a name." };

  const room = await prisma.room.findUnique({ where: { id: roomId }, include: { location: true } });
  if (!room) return { ok: false, error: "That room no longer exists." };
  if (me.character.locationId !== room.locationId) {
    return { ok: false, error: `You're not in ${room.location.name} any more.` };
  }
  if (!room.location.discordChannelId) {
    return { ok: false, error: "That place has no channel yet — tell a GM." };
  }
  // The same locked-door rule the Discord picker applies.
  const keys = await roomAccessKeys(prisma, me.character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    return { ok: false, error: "You can't get in there." };
  }

  // The one copy of the open sequence, shared with the bot's Converse modal
  // and with Xom's turn pass — see db/lib/conversationOpen.js.
  const opened = await openConversationThread(prisma, {
    locationId: room.locationId,
    roomId: room.id,
    name: trimmed,
    characterIds: [me.character.id],
    creatorCharacterId: me.character.id,
  });
  if (!opened.ok) return { ok: false, error: opened.error };
  const { conversation } = opened;
  const thread = { id: opened.threadId };

  // Anybody the dialog was opened ON. Converse hangs off a person's row, so
  // the person whose row it was is ticked when it opens — and this is where
  // that tick becomes a membership row. What the browser sent is never
  // trusted: a hood token resolves only against the people actually standing
  // with this character, and an id is then re-checked for ALIVE and the same
  // Location, which is the co-presence rule every other people action uses.
  // An unresolvable ref is dropped the way a bad id has always been.
  // Capped: each hood token costs a presence query, and the dialog sends at
  // most one. A longer list is somebody posting by hand.
  const refs = [...new Set((Array.isArray(inviteRefs) ? inviteRefs : []).map(String))]
    .filter(Boolean)
    .slice(0, INVITE_LIMIT);
  // A plain id goes through the shared resolver too, so it cannot pull
  // somebody standing here in a hood into the conversation — only their token
  // can (db/lib/targetKey.js). A hood that joined by id showed up on the strip
  // under its alias, which told the inviter who was under it.
  const sightings = refs.length > 0 ? await lastSightings(prisma, me.character) : null;
  const resolved = await Promise.all(
    refs.map((ref) => resolveTargetKey(prisma, me.character, HOOD_TOKEN.test(ref) ? `hood:${ref}` : ref, { sightings })),
  );
  const wanted = [...new Set(resolved.filter(Boolean))].filter((id) => id !== me.character.id);
  if (wanted.length > 0) {
    const guests = await prisma.character.findMany({
      where: { id: { in: wanted }, status: "ALIVE", locationId: room.locationId },
      select: { id: true, discordUserId: true, discordMirrored: true },
    });
    for (const guest of guests) {
      // The ROW first, then the account: membership is a database fact and
      // Discord is its projection, so a failed thread add never decides
      // whether the conversation is in somebody's places.
      await addConversationMember(prisma, { playerThreadId: conversation.id, characterId: guest.id });
      if (guest.discordUserId && guest.discordMirrored) {
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

  // Say so when the person you opened it FOR did not come. They walked off
  // between ticking the box and pressing the button, or they were never
  // reachable — either way the room is empty and the old line said "Opened"
  // and let you find that out by talking to nobody.
  const missed = refs.length > 0 && wanted.length === 0;
  return {
    ok: true,
    line: missed ? "Opened, but they aren't here any more — add them when they turn up." : "Opened. It is in your places now.",
  };
}

// ------------------------------------------------------- bell, PA, the gun

// Pray, at the Shrine of an Old Man. A confirm, not the bell's type-the-word
// dialog: this disturbs nobody, but hands you a permanent tag that can kill you.
export async function pray({ roomId } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, XOM_SHRINE_ROOM_SLUG, "There's no shrine here.");
  if (found.error) return { ok: false, error: found.error };

  // The same locked-door rule Discord applies. A server action is a public
  // endpoint, so the door is re-checked here and not trusted from the panel
  // that drew the button.
  const keys = await roomAccessKeys(prisma, me.character.id);
  if (accessibleRooms([found.room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    return { ok: false, error: "You can't get in there." };
  }

  const result = await grantXom(prisma, { characterId: me.character.id });
  if (result.already) return { ok: false, error: "The face is already watching you." };
  if (result.spoken) {
    return { ok: false, error: "Something else has you already, and it does not share." };
  }
  if (!result.ok) return { ok: false, error: "Nothing answers. Tell a GM." };

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: me.discordUserId,
        actionType: "xom_prayed",
        targetCharacterId: me.character.id,
        details: { characterName: me.character.name, room: found.room.name, replaced: result.replaced },
      },
    })
    .catch(() => {});

  // Anybody else standing in the shrine sees it. Nothing leaves the room —
  // the tag is `catalog: secret`, and this is the only place it is ever
  // announced at all. The shrine sees the face, not the name behind a hood.
  const witnessed = `${capitalizeFirst(await seenByPlace(prisma, me.character.id))} kneels, and the face seems to lean down.`;
  // The statue's noise rides the line that was already being written — everyone reading the
  // shrine hears it, and nobody outside it does (db/lib/sfx.js).
  await sceneLineAt(prisma, { roomId: found.room.id, text: witnessed, sfx: SFX.CONVERT }).catch(() => {});
  const thread = await prisma.room
    .findUnique({ where: { id: found.room.id }, select: { discordThreadId: true } })
    .catch(() => null);
  if (thread?.discordThreadId) {
    await postMessage(thread.discordThreadId, ambientLine(witnessed)).catch(() => {});
  }

  return {
    ok: true,
    line: result.replaced
      ? `It takes your ${result.replaced} off you and does not offer anything back.`
      : "Something old and amused turns its attention on you.",
  };
}

export async function ringBell({ roomId, word } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, BELL_ROOM_SLUG, "There's no bell here.");
  if (found.error) return { ok: false, error: found.error };
  if (!bellWordMatches(word)) return { ok: false, error: `Type ${RING_WORD} to pull the rope.` };

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
      error: `The bell is still humming from the last pull. About ${minutes} more minute${minutes === 1 ? "" : "s"}.`,
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
    // Bascinet's wording, and the same on both faces — the bot's twin in
    // bot/src/events/interactionCreate.js says exactly this. Which places
    // Discord refused is a fact about Discord, not about the barony, so the
    // names stay in soundBroadcast.js's console.error and the audit row above
    // and the ringer hears none of it.
    line: "The bell sounds.",
  };
}

export async function turretState(roomId) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, null, "There isn't a button here.");
  if (found.error) return { ok: false, error: found.error };
  const armed = await gatehouseTurretArmed(prisma);
  return { ok: true, armed, word: armed ? DISARM_WORD : ARM_WORD };
}

export async function toggleTurret({ roomId, word } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, null, "There isn't a button here.");
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
    .findUnique({ where: { slug: RESIDENCES_LOCATION_SLUG }, select: { discordChannelId: true } })
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
      ? "The button toggles on."
      : "The button toggles off.",
  };
}

// The Den's slot machine (db/lib/slotMachine.js). Everything that decides
// anything is in there, so this face and Discord's button cannot drift: the
// rules, the money and the line the room reads are one implementation. All
// this does is find the acting session and the open turn.
export async function playSlots({ roomId } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  // A server action is a public endpoint, so the room the dialog was drawn
  // against is checked here too rather than trusted. The machine re-checks the
  // door and the standing as well — this only refuses a wrong room early.
  const found = await roomHere(me.character, roomId, CASINO_ROOM_SLUG, "There's no slot machine here.");
  if (found.error) return { ok: false, error: found.error };

  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const result = await playSlotsInDb(prisma, me.discordUserId, { turn });
  if (!result.ok) return { ok: false, error: result.error, sfx: SFX.REFUSE_MONEY };
  // The stake always leaves the purse, win or lose.
  refresh();
  return { ok: true, line: result.line, sfx: result.sfx };
}

// --------------------------------------------------- the Merchant's machine
//
// Eleven actions for one button, the telephone's shape and for its reason: what
// the Machine button does depends on what the machine is doing right now and on
// who is pressing it, and that is decided server-side on every open
// (docs/systemdocs/VENDING.md).
//
// Everything that decides anything lives in db/lib/vending.js, so this face and
// Discord's buttons cannot drift. Each action here finds the acting session and
// the open turn, re-checks the room, and hands over. A server action is a public
// endpoint: the dialog's own state is a hint, never a lock.

// Every verb here ends the same way, so the shape is written once.
async function vendingVerb(roomId, fn, args = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, null, VENDING_TEXT.noMachine);
  if (found.error) return { ok: false, error: found.error };

  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const result = await fn(prisma, me.discordUserId, { roomId, turn, ...args });
  if (!result.ok) return { ok: false, error: result.error, sfx: SFX.REFUSE_MONEY };
  // Anything that moved a tag has to settle the carry (docs/systemdocs/CARRY.md)
  // — the same bargain every other inventory writer strikes.
  if (result.moved !== false) await afterInventoryChange([me.character.id]).catch(() => {});
  // `amount` is the coin that crossed the presser's hand: Insert, Withdraw,
  // Empty the till, and Step away with change in the slot. A purchase moves
  // coin from the slot to the till, not out of a purse, so it sets none.
  if (result.amount > 0) refresh();
  return { ok: true, line: result.line, sfx: result.sfx };
}

// The read. Takes the hold as a side effect, which is the design: the VIEW is
// what is exclusive, so a second person cannot so much as read the float.
export async function openMachine({ roomId } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, null, VENDING_TEXT.noMachine);
  if (found.error) return { ok: false, error: found.error };

  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const took = await takeMachine(prisma, me.discordUserId, { roomId, turn });
  // A refusal is not fatal here: somebody else holding it is a state the dialog
  // draws rather than an error it shows, so the view is read either way.
  const view = await machineView(prisma, me.discordUserId, roomId);
  if (!view.ok) return { ok: false, error: view.error, sfx: SFX.REFUSE };
  return { ...view, justTook: took.ok, sfx: took.ok ? took.sfx : null };
}

// A plain re-read, for the poll behind the countdown. Takes nothing.
export async function readMachine({ roomId } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  return machineView(prisma, me.discordUserId, roomId);
}

export async function leaveMachine({ roomId } = {}) {
  return vendingVerb(roomId, releaseMachine);
}

export async function vendInsert({ roomId, amount } = {}) {
  return vendingVerb(roomId, insertCoins, { amount });
}

export async function vendWithdraw({ roomId } = {}) {
  return vendingVerb(roomId, withdrawCoins);
}

export async function vendBuy({ roomId, tagId } = {}) {
  return vendingVerb(roomId, buySlot, { tagId });
}

export async function vendUnlock({ roomId } = {}) {
  return vendingVerb(roomId, unlockMachine);
}

export async function vendLock({ roomId } = {}) {
  return vendingVerb(roomId, lockMachine);
}

export async function vendCollect({ roomId } = {}) {
  return vendingVerb(roomId, collectTill);
}

export async function vendStockIn({ roomId, tagId, quantity, priceObols } = {}) {
  return vendingVerb(roomId, stockMachine, { tagId, quantity, priceObols });
}

export async function vendStockOut({ roomId, tagId, quantity } = {}) {
  return vendingVerb(roomId, unstockMachine, { tagId, quantity });
}

export async function vendSetPrice({ roomId, tagId, priceObols } = {}) {
  return vendingVerb(roomId, setSlotPrice, { tagId, priceObols });
}

// ------------------------------------------------- the Black Market terminal
//
// The Exactor's Office terminal (docs/systemdocs/DEPOT.md §0n). Every rule —
// the ring, the credit, the shelf, handing the goods over — is in
// db/lib/blackMarket.js, so this face and Discord's cannot drift. Each action
// finds the session, re-checks the room, and hands over.

// The read: the credit, the coin in hand, the shelf. Open between sittings,
// like every other reader here.
export async function blackMarketView({ roomId } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, BLACK_MARKET_ROOM_SLUG, BLACK_MARKET_TEXT.noTerminal);
  if (found.error) return { ok: false, error: found.error };
  return blackMarketStateInDb(prisma, me.discordUserId);
}

// The two writes, shut between sittings. Both end the same way.
async function blackMarketVerb(roomId, fn, args) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, BLACK_MARKET_ROOM_SLUG, BLACK_MARKET_TEXT.noTerminal);
  if (found.error) return { ok: false, error: found.error };

  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const result = await fn(prisma, me.discordUserId, { turn, ...args });
  if (!result.ok) return { ok: false, error: result.error, sfx: SFX.REFUSE_MONEY };
  // Coin left a purse, or goods landed in one: settle the carry
  // (docs/systemdocs/CARRY.md) and redraw the purse.
  await afterInventoryChange([me.character.id]).catch(() => {});
  refresh();
  return { ok: true, line: result.line, sfx: result.sfx };
}

export async function blackMarketInsert({ roomId, amount } = {}) {
  return blackMarketVerb(roomId, insertBlackMarketObols, { amount });
}

// `items` is [{ tagId, quantity }]; the terminal re-prices every line.
export async function blackMarketBuy({ roomId, items } = {}) {
  return blackMarketVerb(roomId, blackMarketOrderInDb, { items });
}

// ------------------------------------------------- the Merchant's Terminal
//
// At the Depot (Depot Overhaul.docx, docs/systemdocs/DEPOT.md §0c). A Location
// fixture rather than a room's, so there is no room to re-check: every rule —
// standing at the Depot, the License or the Merchant's ring, the terminal's
// coin, the pending list — is in db/lib/merchantTerminal.js, and Discord's
// panel calls the same functions.

// The read. `unlock` is the Unlock button: without it the screen is locked
// for everybody, which is the doc's "reveals a UI requesting it be unlocked".
export async function merchantTerminalView({ unlock = false } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  return merchantTerminalStateInDb(prisma, me.discordUserId, { unlock: Boolean(unlock) });
}

// Every write, shut between sittings.
async function merchantTerminalVerb(fn, args) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const result = await fn(prisma, me.discordUserId, { turn, ...args });
  if (!result.ok) return { ok: false, error: result.error, sfx: SFX.REFUSE_MONEY };
  // Coin left a purse or came into one: settle the carry and redraw the purse.
  await afterInventoryChange([me.character.id]).catch(() => {});
  refresh();
  return { ok: true, line: result.line, sfx: result.sfx };
}

export async function merchantTerminalInsert({ amount } = {}) {
  return merchantTerminalVerb(insertTerminalObols, { amount });
}

export async function merchantTerminalWithdraw({ amount } = {}) {
  return merchantTerminalVerb(withdrawTerminalObols, { amount });
}

// `items` is [{ tagId, quantity }]; the terminal re-prices every line.
export async function merchantTerminalOrder({ items } = {}) {
  return merchantTerminalVerb(placeTerminalOrder, { items });
}

// The whole new cart for one pending order; a line at 0 comes out.
export async function merchantTerminalEditOrder({ orderId, items } = {}) {
  return merchantTerminalVerb(editTerminalOrder, { orderId, items });
}

export async function merchantTerminalRemoveOrder({ orderId } = {}) {
  return merchantTerminalVerb(removeTerminalOrder, { orderId });
}

// What the merchant may put in: whatever they are carrying that is cargo and
// isn't money. Read here rather than in the engine because it is a question
// about the PRESSER's pockets, not about the machine.
export async function vendStockables({ roomId } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const view = await machineView(prisma, me.discordUserId, roomId);
  if (!view.ok) return view;
  if (!view.unlocked) return { ok: false, error: VENDING_TEXT.lockedFirst };

  const held = await prisma.characterTag.findMany({
    where: { characterId: me.character.id, quantity: { gt: 0 } },
    select: { quantity: true, tag: { select: { id: true, name: true, slug: true, tradeable: true } } },
    orderBy: { tag: { name: "asc" } },
  });
  return {
    ok: true,
    rows: held
      .filter((ct) => isTradeable(ct.tag) && ct.tag.slug !== OBOL_SLUG && ct.tag.slug !== RESOURCES_SLUG)
      .map((ct) => ({ tagId: ct.tag.id, name: ct.tag.name, held: ct.quantity })),
  };
}


// ------------------------------------------------------------- the telephone
//
// One button, and a dialog that follows whatever the phone is doing
// (docs/systemdocs/PHONES.md §3). Opening it picks the receiver up — and
// answers a named phone that is ringing — so every action below re-resolves
// the acting character from the session and re-checks the room: a server
// action is a public endpoint, and the dialog's own state is a hint.
//
// Only what the dialog draws crosses back. The call row never does: it carries
// both characters' ids, and the far end of a call is exactly the thing a phone
// is not supposed to tell you.
function phoneAnswer(view) {
  return {
    ok: true,
    mode: view.mode,
    phone: view.room?.phone ?? null,
    payphone: Boolean(view.room?.payphone),
    price: view.price ?? null,
    handset: view.handset ?? null,
    outcome: view.outcome ?? null,
    line: view.line ?? null,
    sfx: view.sfx ?? null,
  };
}

const openTurn = () => prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });

export async function openPhone({ roomId } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const view = await phoneView(prisma, me.discordUserId, roomId, { via: "web" });
  if (!view.ok) return { ok: false, error: view.error, sfx: SFX.REFUSE };
  return phoneAnswer(view);
}

// `charged` is set only when a payphone took an obol (PHONES.md §3): a named
// phone is free, and so is anything inside the 10 minutes a coin already paid for.
export async function answerPhone({ roomId } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const view = await answerPayphone(prisma, me.discordUserId, roomId, { via: "web", turn: await openTurn() });
  if (!view.ok) return { ok: false, error: view.error, sfx: view.sfx ?? SFX.REFUSE };
  if (view.charged) refresh();
  return phoneAnswer(view);
}

// Holds for a few seconds on a number that goes nowhere — the exchange ringing
// it out (db/lib/phone.js#dialNumber). The dialog plays the long tone meanwhile.
export async function dialPhone({ roomId, digits } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const view = await dialNumber(prisma, me.discordUserId, roomId, digits, { turn: await openTurn() });
  if (!view.ok) return { ok: false, error: view.error, sfx: view.sfx ?? SFX.REFUSE };
  if (view.charged) refresh();
  return phoneAnswer(view);
}

export async function insertPhoneObol({ roomId } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const view = await insertObol(prisma, me.discordUserId, roomId, { turn: await openTurn() });
  if (!view.ok) return { ok: false, error: view.error, sfx: view.sfx ?? SFX.REFUSE };
  if (view.charged) refresh();
  return phoneAnswer(view);
}

// Hanging up and walking away are never session-gated: putting a receiver
// down is not an action anybody should be kept from.
export async function hangUpPhone({ roomId } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const view = await hangUp(prisma, me.discordUserId, roomId);
  if (!view.ok) return { ok: false, error: view.error, sfx: SFX.REFUSE };
  return phoneAnswer(view);
}

export async function walkAwayPhone({ roomId } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const view = await walkAway(prisma, me.discordUserId, roomId);
  if (!view.ok) return { ok: false, error: view.error, sfx: SFX.REFUSE };
  return phoneAnswer(view);
}

// ------------------------------------------------------------- the bomb
//
// A keypad and one button (docs/systemdocs/NUKE.md). The digits live in the
// dialog until the eighth goes in; then nukeCheckCode says whether they are
// the sequence — counting a wrong one against this character, three in a row
// and they are locked out — and nukePressButton arms or disarms, checking the
// sequence again. The code itself never crosses back.
function nukeAnswer(view) {
  return {
    ok: true,
    armed: Boolean(view.armed),
    firesOn: view.firesOn ?? null,
    gone: Boolean(view.gone),
    lockedOut: Boolean(view.lockedOut),
    triesLeft: view.triesLeft ?? null,
    correct: Boolean(view.correct),
    line: view.line ?? null,
    sfx: view.sfx ?? null,
  };
}

function nukeRefusal(view) {
  return {
    ok: false,
    error: view.error,
    lockedOut: Boolean(view.lockedOut),
    triesLeft: view.triesLeft ?? null,
    sfx: view.sfx ?? SFX.REFUSE,
  };
}

export async function nukeState({ roomId } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const view = await nukeView(prisma, me.discordUserId, roomId);
  return view.ok ? nukeAnswer(view) : nukeRefusal(view);
}

export async function nukeCheckCode({ roomId, digits } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const view = await nukeCheck(prisma, me.discordUserId, roomId, digits);
  return view.ok ? nukeAnswer(view) : nukeRefusal(view);
}

export async function nukePressButton({ roomId, digits } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const view = await nukePress(prisma, me.discordUserId, roomId, digits, { turn: await openTurn() });
  return view.ok ? nukeAnswer(view) : nukeRefusal(view);
}

export async function speakOnIntercom({ roomId, body } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, INTERCOM_ROOM_SLUG, "There's no intercom here.");
  if (found.error) return { ok: false, error: found.error };

  const text = String(body ?? "").trim();
  if (!text) return { ok: false, error: "Say something first." };

  const voice = await loadVoiceState(prisma, me.character.id);
  if (voice.block) return { ok: false, error: `You can't get the words out — you're ${voice.block.name}.` };

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
    line: "Your voice goes out across Ravenheart.",
    note: failed.length > 0 ? `Nothing came through in ${failed.join(", ")}.` : null,
  };
}

// ------------------------------------------------------------------ quests

// A quest's Interact button, the web half of the pair (QUESTS.md). Both faces call the same questInteract, so they can't drift.
export async function interactWithQuest({ questId, intention } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };

  const result = await questInteract(prisma, {
    questId: String(questId ?? ""),
    // actor() already filtered to ALIVE; questInteract asks for the column.
    character: { ...me.character, status: "ALIVE" },
    intention,
    actorDiscordUserId: me.discordUserId,
  });
  if (!result.ok) return result;

  return {
    ok: true,
    line: "Your Gambit is filed. You'll hear how it went when the turn is pushed.",
  };
}

// --------------------------------------------------------------------- you

export async function submitMove({ moveKind, description } = {}) {
  const me = await actor(undefined, { acting: true });
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
  const { roll } = await confirmMove(prisma, loaded, me.discordUserId);

  // The bot answers in Discord markdown; this panel prints plain text, so the
  // same facts are said in words. The Gambit roll itself stays hidden until
  // the turn-end reveal, exactly as it does in Discord.
  const parts = [roll.gambit ? "Your move was declared." : "Done."];
  if (roll.applied) parts.push(`Also: ${roll.applied}.`);
  return { ok: true, line: parts.join(" ") };
}

// The turn card's own state, re-read: open turn, Move window, filed Move.
// Polled beside waitingOnYou, so a Discord-filed Move shows up without a reload.
// `move.editable` is the whole Change/Take it back affordance: a Gambit the player
// wrote is theirs until the cutoff, everything else is a receipt (db/lib/moves.js).
// Polled rather than computed once, so the buttons go away on their own at lock-in.
// It carries the combat mode button's state too (COMBAT-MODE.md §2), so the push turning it
// off reaches both surfaces on the same poll.
export async function myMove() {
  const me = await actor({
    id: true,
    combatModeSinceTurn: true,
    tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { slug: true } } } },
  });
  if (me.error) return { ok: false, error: me.error };

  const openTurn = await prisma.turn.findFirst({
    where: { status: "OPEN" },
    select: { id: true, number: true, dayNumber: true, turnLengthHours: true, endsAt: true, startedAt: true },
  });
  if (!openTurn) return { ok: true, turn: null, move: null, combatMode: null, fight: null, characterId: me.character.id };

  const [clock, action, fight] = await Promise.all([
    clockStatus(prisma),
    prisma.action.findFirst({
      where: { characterId: me.character.id, turnId: openTurn.id },
      select: {
        id: true,
        moveKind: true,
        description: true,
        playerFiled: true,
        moveReviewStatus: true,
        lockExpiresAt: true,
        // moveIsEditable's backstop guard for a turn with no cutoff to read. Omit it and
        // `undefined != null` is false, so a settled Gambit would quietly read as still editable.
        // NOT `diceRoll` — this payload is fetched by the player's own action, and while nothing
        // here ever returned the number, a die sitting in it is a loaded gun. The die is the
        // player's at turn close and not a minute before (db/lib/stagedPush.js).
        diceModifier: true,
      },
    }),
    // The fight they are in, for the line under the card (docs/systemdocs/ATTACK.md §4). Never a roll.
    combatViewFor(prisma, me.character.id, openTurn),
  ]);
  const { cutoffAt, locked, hasLock } = moveWindow(openTurn, { clockFrozen: clock.frozen });
  const { editable } = moveIsEditable(action, openTurn, { clockFrozen: clock.frozen, inSession: clock.inSession });

  return {
    ok: true,
    turn: {
      number: openTurn.number,
      dayNumber: openTurn.dayNumber,
      // ISO — a Date doesn't survive to a client component. It's the CUTOFF,
      // not the turn's end: Moves stop an adjudication window early (db/lib/turnClock.js).
      closesAt: hasLock && cutoffAt ? cutoffAt.toISOString() : null,
      // `locked` is the cutoff. `shut` is the game being closed for any reason, which `locked` cannot say: a frozen clock
      // reports locked: false, because freezing removes the deadline rather than shutting the game (db/lib/turnGate.js).
      locked,
      hasLock,
      shut: !clock.inSession,
      shutReason: clock.inSession ? null : "The game isn't in session.",
    },
    move: action
      ? { id: action.id, kind: action.moveKind, description: action.description, editable }
      : null,
    combatMode: combatModeState(me.character, openTurn, me.character.tags),
    fight: fight
      ? {
          locationName: fight.locationName,
          status: fight.status,
          inviter: fight.inviter,
          needsWriting: fight.canDescribe && !fight.description,
        }
      : null,
    // The dialog keys its unfiled draft on it, so two characters don't inherit each other's day.
    characterId: me.character.id,
  };
}

// Rewrite a Gambit that hasn't locked yet. Every gate is re-run in db/lib/moves.js —
// the Change button is a hint, not the lock (CLAUDE.md, "a server action is a public endpoint").
export async function editMyMove({ actionId, description } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };

  const result = await editMove(prisma, {
    character: me.character,
    actorDiscordUserId: me.discordUserId,
    actionId,
    description,
  });
  if (!result.ok) return { ok: false, error: result.error };

  return { ok: true, line: result.unchanged ? "No change." : "Your move was edited." };
}

// Take a Gambit back and get the day returned. Deleting the row IS the refund.
export async function withdrawMyMove({ actionId } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };

  const result = await withdrawMove(prisma, {
    character: me.character,
    actorDiscordUserId: me.discordUserId,
    actionId,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // A lesson Offer that died with the Move leaves somebody waiting on an answer that
  // is never coming — told now, not at the push, for the same reason a rejected Move is.
  for (const dm of result.dms ?? []) {
    await sendDm(dm.discordUserId, dm.content).catch(() => {});
  }

  return { ok: true, line: "Your move was canceled." };
}

// The Bascinet conversation (CHAT.md §2b): the SAME rows the GM desk reads,
// through the SAME noise filter (web/lib/dmThread.js). Row shape strips the
// author — a player never learns which GM answered. Paged by `beforeId` with
// the desk's keyset (createdAt, id) — a turn push writes several rows into
// one millisecond. Gated on the ACCOUNT, not a living character: a player
// whose character just died should still read and reply.
const GM_THREAD_PAGE = 60;

async function account() {
  const session = await auth();
  if (!session?.discordUserId) return { error: "You are not signed in." };
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
  // Which DM buttons are still worth drawing — "is this offer still open?" is a database question (web/lib/dmActions.js).
  const character = await prisma.character.findFirst({
    where: { discordUserId: me.discordUserId, status: "ALIVE" },
    select: { id: true },
  });
  return {
    ok: true,
    hasMore,
    rows: await resolveDmActions(
      rows.slice(0, GM_THREAD_PAGE).reverse().map(playerDmRow),
      { discordUserId: me.discordUserId, characterId: character?.id ?? null },
    ),
  };
}

// A line to Bascinet, from Chat. One INBOUND row, as the bot logs a DM typed
// into Discord — nothing sent to Discord, since the bot can't speak as the
// player. `meta.via` says where it was typed. Two refusals the Discord path
// has none of: the Play switch re-read here (a tab open when a GM flips it
// keeps its stream), and a rate cap since this is a pipe into the GM inbox.
const TO_GMS_WINDOW_MS = 60_000;
const TO_GMS_PER_WINDOW = 12;

export async function sendToGms(content, clientNonce) {
  const me = await account();
  if (me.error) return { ok: false, error: me.error };
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) return { ok: false, error: "Write something first." };
  if (text.length > PLAYER_DM_MAX_LENGTH) {
    return { ok: false, error: `That is too long — ${PLAYER_DM_MAX_LENGTH} characters at most.` };
  }
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { playPanelEnabled: true } });
  if (config && !config.playPanelEnabled) return { ok: false, error: "The Chat page is switched off." };
  const recent = await prisma.directMessage.count({
    where: {
      discordUserId: me.discordUserId,
      direction: "INBOUND",
      createdAt: { gte: new Date(Date.now() - TO_GMS_WINDOW_MS) },
    },
  });
  if (recent >= TO_GMS_PER_WINDOW) return { ok: false, error: "Slow down a moment." };

  // The composer's own id for this line. It is what retires the pending row
  // in DmPane, and a re-send under the same nonce can only find the row that
  // is already here — the same treatment the GM's side of the conversation
  // gets (PLAYER-DESK.md §5).
  const nonce = clientNonce ? String(clientNonce).trim().slice(0, 64) : null;
  if (nonce) {
    const already = await prisma.directMessage.findFirst({
      // A nonce is a posted value, not proof of who posted it — scope the
      // lookup to this player's own inbound row so a guessed/replayed nonce
      // can never hand back somebody else's DirectMessage (CLAUDE.md: never
      // trust a posted id).
      where: { clientNonce: nonce, discordUserId: me.discordUserId, direction: "INBOUND" },
      select: PLAYER_DM_SELECT,
    });
    if (already) return { ok: true, row: playerDmRow(already) };
  }

  const row = await prisma.directMessage.create({
    data: {
      discordUserId: me.discordUserId,
      direction: "INBOUND",
      content: text,
      source: "player",
      // A player's own words, the same as the bot's inbound log. Without
      // this the row takes the NOTICE default and never lights the desk
      // (db/lib/dmKinds.js).
      kind: DM_KIND.CONVERSATION,
      clientNonce: nonce,
      meta: { via: "play" },
    },
    select: PLAYER_DM_SELECT,
  });
  // The same quiet line a DM typed on Discord gets (db/lib/gmAutoReply.js), on the same 10-minute
  // clock — the window is the log row, so writing here and then DMing the bot is still one reply.
  // It goes to Discord rather than into this pane: QUIET is drawn on neither face.
  maybeSendGmAutoReply(prisma, me.discordUserId);
  return { ok: true, row: playerDmRow(row) };
}

// The Desire picker's catalog, ~271 templates evaluated against this character's gates. Fetched the first time the picker opens.
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

// Same words the offer's own DM uses. Every kind is named: an unlisted one
// used to fall through to "offers a lesson", which is how a ride read as one.
// One row per kind, and LESSON is a row rather than the default: anything
// unlisted used to read as "offers a lesson", which is how a collar read here.
function waitingOfferLabel(o, who) {
  switch (o.kind) {
    case "LESSON":
      return `${who} offers ${o.tag?.name ?? "a lesson"}.`;
    case "CONFESSION":
      return `${who} asks you to hear their confession.`;
    case "BIND":
      return `${who} asks to bind you.`;
    case "ESCORT":
      return `${who} wants to take you along.`;
    case "KISS":
      return `${who} would like to kiss you.`;
    case "SEARCH":
      // Says where to go, because this row deliberately offers no Accept.
      return `${who} wants to search you. Say yes in your DMs.`;
    case "COLLAR":
      return `${who} wants to put a collar on you.`;
    // Names nobody, same as the sheet (SheetTurn.js): a conversion names
    // nobody on any surface (THANATI.md). Answered in the DMs, where the
    // vision itself is; this row carries no buttons for it.
    case "CONVERSION":
      return "Something is waiting for an answer in your DMs.";
    default:
      return `${who} is waiting on your answer.`;
  }
}

// Everything holding still until this player answers it: a lesson, binding,
// confession, threat seat, letter, lobby assignment. Each row's Accept/Decline calls the SAME db/lib function the DM's buttons call.
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
      where: {
        recipientId: me.character.id,
        delivered: true,
        repliedAt: null,
        // The window, not merely "it has one" — the turn it arrived in and the
        // one after (db/lib/birdReply.js#birdReplyWindow). Without the
        // comparison a letter nobody can answer any more sat on this list for
        // the rest of the game as a to-do that could never be done. Between
        // turns the bird is waiting rather than gone, so nothing is dropped.
        ...(openTurn
          ? { replyDeadlineTurn: { gte: openTurn.number } }
          : { replyDeadlineTurn: { not: null } }),
      },
      orderBy: { createdAt: "asc" },
      // Never senderName: a bird letter is unsigned (BIRD.md §8).
      select: { id: true, tagName: true, replyDeadlineTurn: true },
    }),
    prisma.lobbyEntry.findFirst({
      where: { discordUserId: me.discordUserId, status: "ASSIGNED" },
      select: { id: true, assignedRoleId: true },
    }),
  ]);

  // IDENTITY_SELECT, not a bare name. Search is the first offer kind whose
  // INITIATOR may be wearing a hood — every other one refuses a covered face at
  // the gate, so its initiator is always somebody you have seen. Reading the row
  // name here would put "Lord Greeblus wants to search you" in the victim's own
  // to-do list, which is exactly the unmasking INTERCEPT.md §2 exists to stop.
  const initiators = offers.length
    ? await prisma.character.findMany({
        where: { id: { in: offers.map((o) => o.initiatorId) } },
        select: IDENTITY_SELECT,
      })
    : [];
  // As this character would name them: a stranger is "a young man" (STRANGERS.md).
  const initiatorNames = await seenByMany(prisma, me.character.id, initiators);
  const nameOf = new Map(initiators.map((c, i) => [c.id, capitalizeFirst(initiatorNames[i])]));

  const rows = [
    ...offers.map((o) => ({
      key: `offer:${o.id}`,
      id: o.id,
      kind: "offer",
      // A chaplain waiting on a confession is never told what it is about,
      // here or anywhere else.
      label: waitingOfferLabel(o, nameOf.get(o.initiatorId) ?? "Somebody"),
      // A search is the one kind this shortcut must NOT be able to accept.
      // Saying yes to one is a two-step act — you get to hide things first
      // (docs/systemdocs/SEARCH.md §2) — and this row has no Hide items
      // control, so an Accept here would silently answer with nothing hidden
      // for somebody who never learned they could. Saying NO loses nothing, so
      // Decline stays. Yes lives on the DM card, which has all three buttons.
      // A CONVERSION gets neither: its refusal costs something, and a row that
      // says nothing about who or what is no place to pay it.
      accept: o.kind !== "SEARCH" && o.kind !== "CONVERSION",
      decline: o.kind !== "CONVERSION",
    })),
    ...spawns.map((s) => ({
      key: `spawn:${s.id}`,
      id: s.id,
      kind: "spawn",
      label: "A seat is open to you.",
      decline: true,
    })),
    ...letters.map((l) => ({
      key: `bird:${l.id}`,
      id: l.id,
      kind: "bird",
      // No Accept here: answering a letter means choosing which paper goes
      // back, which is a picker, not a yes. `mode` opens that dialog where it
      // is standing (the sheet's dialogs are mounted on Chat too) — it used to
      // be a bare link to /character, which landed the player on the sheet
      // with the Send Bird dialog and no reply in sight.
      label: `The bird that brought ${waitingLetter(l).letterName} still waits on an answer.`,
      accept: false,
      decline: false,
      mode: "birdReply",
    })),
    ...(lobbyEntry
      ? [
          {
            key: `lobby:${lobbyEntry.id}`,
            id: lobbyEntry.id,
            kind: "lobby",
            label: "You have a seat waiting to be taken up.",
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
  const me = await actor({ id: true, name: true, discordUserId: true, status: true }, { acting: true });
  if (me.error) return { ok: false, error: me.error };

  if (kind === "offer") {
    const offer = await prisma.offer.findUnique({ where: { id } });
    if (!offer) return { ok: false, error: "That offer's gone." };
    // Matched to the OFFER's responder, never to a posted id.
    if (offer.responderId !== me.character.id) return { ok: false, error: "That's not yours to answer." };
    const responder = { id: me.character.id, name: me.character.name, discordUserId: me.discordUserId };

    // declineOfferOfKind, never declineOffer: a CONVERSION refused from this
    // list has to cost what the DM's Refuse button costs (THANATI.md).
    const result = accept
      ? await acceptOffer(prisma, offer, responder)
      : await declineOfferOfKind(prisma, offer, responder);
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

  return { ok: false, error: "There's nothing to answer there." };
}

// ------------------------------------------------------------ slash commands
//
// The web twins of the player slash commands (bot/src/lib/commands.js). Each
// is the SAME rule the Discord handler runs, extracted into db/lib
// (conceal.js, shout.js, roll.js) — what's left is web sequencing only.
// `/move`, `/travel`, `/converse`, `/look` need no new action: already above.

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

// Combat mode (COMBAT-MODE.md), the button on the Turn block and the sheet. `on` is the state the
// player wants, never a flip — db/lib/verbs/combatMode.js says why. The rule re-checks everything.
export async function setCombatMode({ on } = {}) {
  const me = await actor({ id: true }, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const result = await setCombatModeInDb(prisma, { character: me.character, discordUserId: me.discordUserId, on: on === true });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, on: result.on, line: result.line };
}

// /shout. db/lib/shout.js answers who hears it and what they hear; this does
// both halves of delivery, since a SYSTEM row is never echoed by the outbox.
// Sequential, no Promise.all — up to a couple dozen Locations would burst
// Discord's rate limit. Every post is caught on its own, so one dead channel can't swallow the rest.
export async function shoutHere(text, placeKey = null) {
  const me = await actor({ id: true, name: true, locationId: true, discordUserId: true }, { speech: true });
  if (me.error) return { ok: false, error: me.error };

  // WHERE, then WHETHER, and both before shout() — which claims the five-minute
  // cooldown, so asking afterwards meant a place the player may not shout from
  // cost them five minutes of throat for zero posts.
  //
  // Where: a Room or a Conversation and nowhere else, the same gate Discord
  // uses (db/lib/placeKey.js#isScenePlaceKey). The street takes no voice at all
  // and the zone summary is a broadcast rather than a place anybody stands in;
  // `/shout` is offered in neither (commands.js), but a server action is a
  // public endpoint and the UI is a hint rather than a lock. This used to
  // refuse the street alone, so a summary place key fell through and shouted
  // from wherever the character actually stood.
  //
  // Whether: from inside a soundproof room the thread is the ONLY audience, so
  // a write the player does not have would burn the cooldown on a shout
  // literally nobody heard.
  if (!isScenePlaceKey(placeKey)) {
    return { ok: false, error: "You can only shout in a room or in a conversation." };
  }

  const mine = await mayWritePlace(prisma, me.character, placeKey, {
    gm: false,
    discordUserId: me.discordUserId,
  });
  if (!mine) return { ok: false, error: "You can't speak in here." };

  const result = await shout(prisma, { ...me.character, discordUserId: me.discordUserId }, text, { placeKey });
  if (!result.ok) {
    return { ok: false, error: result.error, retryAfter: result.retryAfter ?? null };
  }

  // Everything from here down is DELIVERY, and db/lib/shout.js#deliverShout
  // is all of it — the room you stand in first, then the street and its
  // neighbours. Three callers used to carry this loop character-for-character
  // (here, the bot, and the turn engine's Xom scream) and the one that went
  // stale is why a Discord shout reached nobody on the web.
  //
  // It never throws. The shout has already happened — shout() claimed the
  // cooldown and settled who heard it — so a failed row or a dead channel is
  // one audience short, not a failed shout. That used to leak: only the
  // postMessage calls were guarded, so a sceneLine that failed on the ninth of
  // twenty-nine places turned an already-committed shout into a rejected
  // promise, which the composer read as "it didn't send" and left the words
  // sitting in the box.
  await deliverShout(prisma, { placeKey, here: result.here, heard: result.heard });

  return { ok: true, line: result.line };
}

// /ooc. The player talking, not the character — so none of shout's reach and
// none of speech's voice tags apply. db/lib/ooc.js does the deciding and both
// halves of delivery; this is the web sequencing around it.
export async function oocHere(text, placeKey = null) {
  const me = await actor({ id: true, name: true, locationId: true, discordUserId: true });
  if (me.error) return { ok: false, error: me.error };

  // WHERE, then WHETHER, both before ooc() — which claims the rate-limit row,
  // so asking afterwards would spend a send on a place the player can't post
  // in. Same order and the same two gates as shoutHere above, and for the same
  // reason: a server action is a public endpoint and the selector is a hint,
  // not a lock.
  // isOocPlaceKey, wider than the scene gate the three above take: a summary
  // and a radio net are places a player can be read in, and an OOC line is the
  // player (db/lib/placeKey.js#isOocPlaceKey).
  if (!isOocPlaceKey(placeKey)) {
    return { ok: false, error: "You can't say that here." };
  }

  const mine = await mayWritePlace(prisma, me.character, placeKey, {
    gm: false,
    discordUserId: me.discordUserId,
  });
  if (!mine) return { ok: false, error: "You can't speak in here." };

  const result = await ooc(
    prisma,
    { ...me.character, discordUserId: me.discordUserId },
    text,
    { placeKey, source: "WEB" },
  );
  if (!result.ok) {
    return { ok: false, error: result.error, retryAfter: result.retryAfter ?? null };
  }

  // Never throws — the send is already claimed, so a dead channel is one
  // audience short rather than a failed send (db/lib/ooc.js).
  await deliverOoc(prisma, {
    placeKey,
    text: result.text,
    rowContent: result.rowContent,
    name: result.name,
    auditId: result.auditId,
  });

  return { ok: true };
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
    discordMirrored: true,
    discordUserId: true,
  }, { speech: true });
  if (me.error) return { ok: false, error: me.error };

  // A Room or a Conversation, the same gate /shout takes above: a die is cast
  // in front of the people you are standing with. mayWritePlace alone was not
  // that gate — db/lib/feedAccess.js gives the zone summary `canSpeak: true`,
  // so a summary place key passed it and rolled into the broadcast.
  if (!isScenePlaceKey(placeKey)) {
    return { ok: false, error: "There's nobody here to see it." };
  }

  const may = await mayWritePlace(prisma, me.character, placeKey, {
    gm: false,
    discordUserId: me.discordUserId,
  });
  if (!may) return { ok: false, error: "There's nobody here to see it." };

  return castDie(prisma, me.character, placeKey);
}

// /play. db/lib/instrumentPlay.js is the shared implementation the bot's own
// /play now calls too, so a lute plays the same way on both faces — the same
// AuditLog-backed cooldown, the same once-a-turn mood soothe for a Musician.
export async function playHere(placeKey) {
  const me = await actor({
    id: true,
    locationId: true,
    discordUserId: true,
    tags: {
      select: {
        tag: { select: { slug: true, instrument: true } },
        quantity: true,
        equipped: true,
        equippedQuantity: true,
      },
    },
  }, { speech: true });
  if (me.error) return { ok: false, error: me.error };

  // A Room or a Conversation, the same gate /shout and /roll take above: a
  // performance happens in front of the people you are standing with.
  if (!isScenePlaceKey(placeKey)) {
    return { ok: false, error: "There's nobody here to hear it." };
  }

  const may = await mayWritePlace(prisma, me.character, placeKey, {
    gm: false,
    discordUserId: me.discordUserId,
  });
  if (!may) return { ok: false, error: "There's nobody here to hear it." };

  return playInstrument(prisma, { ...me.character, discordUserId: me.discordUserId }, placeKey);
}

// /look, and the eye in the HERE column. One entry point for a character id
// or the opaque hood token db/lib/whosHere.js mints — a token is 32 hex, a
// cuid never is, so they're told apart without the browser saying which.
// Lands on the LINE you last heard them say, frozen (db/lib/sightings.js).
const HOOD_TOKEN = /^[0-9a-f]{32}$/;

export async function lookAt(personRef) {
  const ref = String(personRef ?? "").trim();
  if (!ref) return { ok: false, error: "Look at who?" };

  const me = await actor({ id: true, locationId: true, discordUserId: true });
  if (me.error) return { ok: false, error: me.error };

  // One sightings Map for both halves: resolveHoodToken decides who counts as hooded from the same answer the readout uses.
  const seen = await lastSightings(prisma, me.character);
  // A hood on the far side of a counter (db/lib/roomSides.js) is named by a look-only
  // ref: the same shape, resolved second, and never by anything a verb reads.
  const targetId = HOOD_TOKEN.test(ref)
    ? ((await resolveHoodToken(prisma, me.character, ref, { sightings: seen })) ??
      (await resolveCrossRoomRef(prisma, me.character, ref, { sightings: seen }))?.id ??
      null)
    : ref;
  if (!targetId) return { ok: false, error: "They aren't here any more." };

  const sighting = seen.get(targetId);
  if (!sighting) return { ok: false, error: "You haven't heard them say anything." };
  // A plain id whose last line was said in a hood is refused like no line at
  // all. Every surface offers that person under a token (presentRows reads the
  // same sighting), so only a hand-posted id lands here — and answering it with
  // the hooded line told the asker who was under the mask. A forced name worn
  // NOW is the one exception, because presentRows lists that person by name.
  if (!HOOD_TOKEN.test(ref) && sighting.concealed) {
    const row = await prisma.character.findUnique({
      where: { id: targetId },
      select: { tags: { where: { tag: { forcedName: { not: null } } }, select: { tag: { select: { forcedName: true } } } } },
    });
    if (!forcedNameFrom(row?.tags)) return { ok: false, error: "You haven't heard them say anything." };
  }

  return lookAtRow(sighting.seq);
}

// ------------------------------------------------- who is in this room, and
// ------------------------------------------------- who may let somebody in
//
// The web twin of /add and /remove. A Conversation's membership is a
// PlayerThreadMember row, working on any living character. A private Room's
// is a RoomGuest row, and the target has to be STANDING here. A public Room
// takes neither: `members` comes back null and the strip doesn't draw.

// The conversation behind a `conv:` key, plus whether this character is in
// it. Being a member IS the permission, the same gate the bot applies.
async function conversationHere(character, placeKey, { sightings = null } = {}) {
  const parsed = parsePlaceKey(placeKey);
  if (!parsed || parsed.kind !== "conv") return { error: "That isn't a conversation." };
  const conversation = await prisma.playerThread.findUnique({
    where: { id: parsed.id },
    select: { id: true, threadId: true, name: true, locationId: true, location: { select: { name: true } } },
  });
  if (!conversation) return { error: "That conversation is gone." };

  // The raw ids stay HERE, on the server — db/lib/conversations.js is where
  // both faces read them, so the bot and this cannot disagree about who is in
  // a conversation. `members` below is the presented list and carries no id
  // for anybody in a hood (db/lib/presentedMembers.js), which is why the gate
  // is answered off `memberIds` rather than off those rows: your own row is a
  // hood like any other when you are wearing one, and matching on a withheld
  // id would lock you out of your own conversation.
  const memberIds = await conversationMemberIds(prisma, conversation.id);
  if (!memberIds.includes(character.id)) {
    return { error: "You're not in this conversation." };
  }
  const members = await conversationMembers(prisma, conversation.id, character, { sightings });
  return { conversation, members, memberIds };
}

// The private room behind a `room:` key: your feet at its Location AND a way
// in (a key or a guest row) — the same pair db/lib/roomGuests.js#doorwayFor tests.
async function privateRoomHere(character, placeKey) {
  const parsed = parsePlaceKey(placeKey);
  if (!parsed || parsed.kind !== "room") return { error: "That isn't a room." };
  const row = await prisma.room.findUnique({
    where: { id: parsed.id },
    select: { id: true, name: true, kind: true, locationId: true, accessTagSlugs: true, sortOrder: true, ...WITH_SIDES },
  });
  if (!row) return { error: "That room is gone." };
  // The room as seen from where you stand: a counter between two Locations
  // has a door on each side, gated on its own (db/lib/roomSides.js).
  const room = roomAt(row, character.locationId);
  if (!room) return { error: "You're not in this room." };
  if (room.kind !== "PRIVATE") return { error: "Anyone standing here can already walk in." };
  const keys = await roomAccessKeys(prisma, character.id);
  const inside =
    room.accessTagSlugs.some((slug) => keys.heldSlugs.has(slug)) || keys.guestRoomIds.has(room.id);
  if (!inside) return { error: "You are not inside that room." };
  return { room };
}

// Who is in the open place, and who standing here could be let in — one call, so the picker never shows a stale list.
export async function placeMembers(placeKey) {
  const me = await actor({ id: true, locationId: true });
  if (me.error) return { ok: false, error: me.error };
  const parsed = parsePlaceKey(placeKey);
  // Not an error: a Location, the zone summary and a public room simply have
  // no guest list, and the strip asks about every place it is shown.
  if (!parsed || (parsed.kind !== "conv" && parsed.kind !== "room")) {
    return { ok: true, members: null, candidates: [] };
  }

  // One sightings Map for the whole answer. It is what decides whether a mask
  // is DRAWN on a member row (PROXYING.md §5a) — standing somewhere is public,
  // what is over your face is not — and the strip and the HERE column above it
  // must agree about it, so they read the same one rather than each asking.
  const sightings = await lastSightings(prisma, me.character);

  let members;
  let memberIds = [];
  let room = null;
  if (parsed.kind === "conv") {
    const found = await conversationHere(me.character, placeKey, { sightings });
    if (found.error) return { ok: false, error: found.error };
    members = found.members;
    memberIds = found.memberIds;
  } else {
    const found = await privateRoomHere(me.character, placeKey);
    // A public room is not a refusal, it is a place with no strip.
    if (found.error) {
      return found.error.startsWith("Anyone standing here")
        ? { ok: true, members: null, candidates: [] }
        : { ok: false, error: found.error };
    }
    room = found.room;
    // This side's guests: a pass is good on the side it was given at.
    memberIds = (
      await prisma.roomGuest.findMany({
        where: { roomId: room.id, locationId: room.locationId },
        orderBy: { createdAt: "asc" },
        select: { characterId: true },
      })
    ).map((row) => row.characterId);
    members = await roomGuests(prisma, room.id, me.character, { sightings, atLocationId: room.locationId });
  }

  // Everyone standing here who is not already in — HOODS INCLUDED, because
  // letting somebody through a door does not need their name (PROXYING.md
  // §5). `withHoodIds` is the server-only map this needs to filter them by
  // id; the id is dropped again on the way out.
  const here = await whosHere(prisma, me.character, { sightings, withHoodIds: true });

  // One list, two kinds of row. `id` is private to this function — it is what
  // the two filters below judge on, and what a hood must never be shipped
  // under, since /api/avatar/<id> answers with a face.
  //
  // An untokened hood (no AUTH_SECRET, so hoodToken mints nothing) is absent
  // rather than offered, the same rule Transfer's recipient list applies.
  const inside = new Set(memberIds);
  let candidates = [
    ...(here.named ?? []).map((person) => ({
      id: person.characterId,
      characterId: person.characterId,
      name: person.name,
      avatarVersion: person.avatarVersion,
      avatarPath: person.avatarPath ?? null,
      unknownFace: false,
    })),
    ...(here.concealed ?? [])
      .filter((person) => person.token && here.hoodIds.has(person.token))
      .map((person) => ({
        id: here.hoodIds.get(person.token),
        characterId: null,
        token: person.token,
        name: person.alias,
        avatarVersion: null,
        // The mask if this reader has earned it, the question-mark plate if
        // not — whichever the HERE column decided (PROXYING.md §5a). Not
        // hard-coded to the plate: the picker sits directly under that column,
        // and one hood drawn two ways in one viewport reads as two people.
        avatarPath: person.avatarPath ?? null,
        unknownFace: Boolean(person.unknownFace),
      })),
  ].filter((person) => person.id !== me.character.id && !inside.has(person.id));

  // A key-holder is already in, by their key, and roomGuests() deliberately
  // does not list them (they hold no guest row). Left in the picker they read
  // as somebody outside, and letting one "in" writes a guest row that grants
  // nothing and that /remove then refuses to take back. One query for the
  // whole shortlist — whosHere() carries no tags.
  //
  // NAMED ROWS ONLY, and a hood is deliberately left in the picker even when
  // they hold a key. Dropping them would be a fact about the person the row
  // names — the one thing the metagaming rule forbids a control from leaking
  // (web/app/components/actionRegistry.js) — and here it is the worst
  // possible one: a hood you can see standing there, absent from both the
  // members strip and the picker, is a hood with a key to this room, which is
  // exactly what a hideout's masks are for. The cost of offering them is a
  // guest row that grants what they already had.
  if (room && room.accessTagSlugs.length > 0) {
    const named = candidates.filter((person) => person.characterId);
    if (named.length > 0) {
      const holders = await prisma.characterTag.findMany({
        where: {
          characterId: { in: named.map((person) => person.id) },
          tag: { slug: { in: room.accessTagSlugs } },
        },
        select: { characterId: true },
      });
      const keyed = new Set(holders.map((row) => row.characterId));
      candidates = candidates.filter((person) => !person.characterId || !keyed.has(person.id));
    }
  }

  return { ok: true, members, candidates: candidates.map(({ id: _id, ...person }) => person) };
}

export async function addMember(placeKey, ref) {
  const me = await actor({ id: true, name: true, locationId: true, discordUserId: true }, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return { ok: false, error: "That place is gone." };

  const raw = String(ref ?? "").trim();
  const characterId = HOOD_TOKEN.test(raw) ? await resolveHoodToken(prisma, me.character, raw) : raw;
  if (!characterId) return { ok: false, error: "They aren't here any more." };

  if (parsed.kind === "conv") {
    const found = await conversationHere(me.character, placeKey);
    if (found.error) return { ok: false, error: found.error };
    const { conversation } = found;

    const target = await prisma.character.findFirst({
      where: { id: String(characterId ?? ""), status: "ALIVE" },
      select: { id: true, name: true, locationId: true, discordUserId: true, discordMirrored: true },
    });
    if (!target) return { ok: false, error: "That isn't a living character." };

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

    // A target not mirrored to Discord is out of every channel on purpose (CHAT.md §6).
    if (target.locationId === conversation.locationId && target.discordMirrored && target.discordUserId) {
      await addThreadMember(conversation.threadId, target.discordUserId).catch(() => {});
    }

    // system_notice, like the bot's twin in interactionCreate.js#notifyLetIn:
    // this is door plumbing, not somebody talking, and without the tag it read
    // as a genuine message on the GM desk.
    await sendDm(
      target.discordUserId,
      `*You were let into ${conversation.location?.name ?? "somewhere"} · ${conversation.name}.*`,
      { kind: DM_KIND.QUIET },
    ).catch(() => {});

    // The presented name in the sentence, not the real one. Adding somebody is
    // the moment the strip redraws, so this was the line that announced who
    // was under the hood you had just invited.
    const shown = await presentedNameOf(prisma, target.id, me.character);
    return {
      ok: true,
      line:
        target.locationId === conversation.locationId
          ? `${shown} was added.`
          : `${shown} is invited — they'll see this when they reach ${conversation.location?.name ?? "this place"}.`,
    };
  }

  const found = await privateRoomHere(me.character, placeKey);
  if (found.error) return { ok: false, error: found.error };

  const result = await addRoomGuest(prisma, {
    actor: me.character,
    roomId: found.room.id,
    characterId,
    // Only a token may let a hood in; a plain id for one is refused as absent.
    byToken: HOOD_TOKEN.test(raw),
  });
  if (!result.ok) return { ok: false, error: result.error };

  // db/lib/roomGuests.js writes no presence notify of its own — it is the
  // bot's code, and the bot has no places column to update. The added
  // character's Chat has to learn the door opened without a reload.
  await notifyPresence(prisma, result.target.id).catch(() => {});
  await sendDm(
    result.notify.discordUserId,
    `*You were let into ${result.notify.placeName ?? "somewhere"} · ${result.notify.threadName}.*`,
    { kind: DM_KIND.QUIET },
  ).catch(() => {});

  return { ok: true, line: result.line };
}

// A character id or a hood token, resolved against the roster of the place the caller has already gated on.
async function resolveMemberRef(ref, memberIds) {
  const raw = String(ref ?? "").trim();
  if (!HOOD_TOKEN.test(raw)) return raw;
  return resolveMemberToken(prisma, memberIds, raw);
}

// `ref` is a character id, or the opaque hood token a concealed member's row
// carries (db/lib/presentedMembers.js). The token resolves only inside the
// roster of the place it was minted from — safe to hand out.
export async function removeMember(placeKey, ref) {
  const me = await actor({ id: true, name: true, locationId: true, discordUserId: true }, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return { ok: false, error: "That place is gone." };

  if (parsed.kind === "conv") {
    const found = await conversationHere(me.character, placeKey);
    if (found.error) return { ok: false, error: found.error };
    const { conversation, memberIds } = found;
    const characterId = await resolveMemberRef(ref, memberIds);

    // ALIVE, the same gate the bot's /remove applies and the same one
    // addMember above already applies: a dead character is off the roster on
    // both faces, and the turn's death pass is what clears their rows.
    const target = await prisma.character.findFirst({
      where: { id: String(characterId ?? ""), status: "ALIVE" },
      select: { id: true, name: true, discordUserId: true },
    });
    if (!target) return { ok: false, error: "That isn't a living character." };

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

    // The presented name. Showing somebody out is not the moment to announce
    // who was under the hood.
    const shown = await presentedNameOf(prisma, target.id, me.character);
    return { ok: true, line: `${shown} was removed.` };
  }

  const found = await privateRoomHere(me.character, placeKey);
  if (found.error) return { ok: false, error: found.error };

  const guestIds = (
    await prisma.roomGuest.findMany({ where: { roomId: found.room.id }, select: { characterId: true } })
  ).map((row) => row.characterId);
  const result = await removeRoomGuest(prisma, {
    actor: me.character,
    roomId: found.room.id,
    characterId: await resolveMemberRef(ref, guestIds),
    // Only a token may show a hood out; a plain id for one is refused as absent.
    byToken: HOOD_TOKEN.test(String(ref ?? "").trim()),
  });
  if (!result.ok) return { ok: false, error: result.error };

  await notifyPresence(prisma, result.target.id).catch(() => {});
  return { ok: true, line: result.line };
}

// ------------------------------------------------------- the GM's two seats

// Which seat this gamemaster reads /chat from — their own character's scene,
// or the watcher's view of every zone they hold. The switch at the foot of the
// places column (./PlacesColumn.js) calls this and then reloads the page.
//
// Takes no target: a server action is a public endpoint, and the only person
// anyone may re-seat is themselves. The gate is `isGm` and nothing else —
// there is no seat here for a player to reach, and the places a GM seat lists
// are still GmZoneView's (db/lib/feedAccess.js#gmPlacesFor), so this hands
// nobody anything they did not already hold.
export async function setChatViewAs(mode) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return { ok: false, error: "Not authorized." };

  await writeChatViewAs(mode === "gm" ? "gm" : null);
  return { ok: true, mode: mode === "gm" ? "gm" : "player" };
}

// speakerKey -> real name, for a GM reading a scene. A hooded row carries no
// characterId — db/lib/archive.js#feedRowShape withholds it per ROW, because
// web/lib/feedHub.js shapes one row and fans it to every watcher of a place,
// so there is no per-reader decision to be made down there. What a hooded row
// DOES carry is `speakerKey`, the stable HMAC db/lib/hoodToken.js mints, so
// one small directory resolves every row source at once — first paint, the
// live stream, the history page and search — and it only ever reaches a GM.
//
// Refreshed by ./Feed.js when it meets a key it does not know: somebody born
// since the page loaded.
export async function gmSpeakerNames() {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return { ok: false, error: "Not authorized." };
  return { ok: true, speakers: await speakerDirectory(prisma) };
}

// A GM in GM view posting a system line into any place they can see — the web
// twin of /gm on Discord. Writes an archive row (source: SYSTEM, drawn as
// `.chat-subtext`) and posts to the corresponding Discord target if the place
// has one. `sceneLine` is what /ambient and /intercom already use, and
// feedOutbox skips SYSTEM rows so this can't be mirrored back to Discord —
// the Discord post here is deliberate, alongside the archive write, matching
// intercom.js's shape.
const GM_SYSTEM_POST_MAX = 1800;

export async function gmSystemPost({ placeKey, content } = {}) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return { ok: false, error: "Not authorized." };

  const text = String(content ?? "").trim();
  if (!text) return { ok: false, error: "Say something." };
  if (text.length > GM_SYSTEM_POST_MAX) return { ok: false, error: "That's too long." };
  const key = String(placeKey ?? "").trim();
  if (!key) return { ok: false, error: "No place to post into." };

  // Same visibility rule the reader already uses — a GM can only post into a
  // place gmPlacesFor currently returns for them (GmZoneView applied).
  const place = await findPlaceInFeed(prisma, null, key, {
    gm: true,
    ghost: false,
    discordUserId: session.discordUserId,
  });
  if (!place) return { ok: false, error: "You can't reach that place." };

  // sceneLine swallows its own DB errors and returns null rather than
  // throwing (db/lib/scene.js), so this always used to fall through and
  // answer { ok: true } even when nothing was written — the composer
  // cleared with no line ever landing. Check it.
  const line = await sceneLine(prisma, { placeKey: key, text });
  if (!line) return { ok: false, error: "Couldn't post that." };

  // Best-effort: a dead channel is one audience short rather than a refusal.
  const target = await discordTargetForPlaceKey(prisma, key).catch(() => null);
  if (target?.channelId) {
    const channelId = target.threadId ?? target.channelId;
    await postMessage(channelId, text).catch((err) =>
      console.error("gmSystemPost: Discord post failed:", err.message ?? err),
    );
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "gm_channel_message",
        details: { placeKey: key, message: text, via: "chat_web" },
      },
    })
    .catch((err) => console.error("gmSystemPost: audit log failed:", err.message ?? err));

  return { ok: true };
}

// The zones DecreeDialog.js offers, for the composer's own `/decree`
// (commands.js). GM-gated the same way gmPlace() above gates every other
// GM-only action here — the desk's own zone picker (DecreeComposer.js's
// server-rendered `zones` prop, before it moved here) never needed a fetch
// like this one because its page is GM-only from the route down
// (web/app/(desk)/gm/turns), and /chat is not. sendDecree
// (web/app/(desk)/gm/turns/actions.js) re-checks GM again at the actual send,
// same as every server action here.
export async function getDecreeZones() {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return { ok: false, error: "Not authorized." };
  const zones = await decreeZones(prisma);
  return { ok: true, zones };
}

// ---------------------------------------------------------------- the Charon

// The ship above the Keep (docs/systemdocs/CHARON.md). Four buttons, one
// mechanism, and none of them trusts what the panel sent: the Panic Room's door
// re-checks the key, the ship's own two re-check that you are actually standing
// in it, and every refusal is worded by db/lib/charon.js so Discord and the web
// say the same sentence.

/** The Panic Room's way in. Refuses when the ship is full, or has already gone. */
export async function enterTheCharon({ roomId } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, PANIC_ROOM_SLUG, "There's no way through here.");
  if (found.error) return { ok: false, error: found.error };

  // The same locked-door rule Discord applies — a server action is a public
  // endpoint, so the key is re-checked here rather than trusted off the panel.
  const keys = await roomAccessKeys(prisma, me.character.id);
  if (accessibleRooms([found.room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    return { ok: false, error: "You can't get in there." };
  }

  const refusal = await enterCharon(prisma, me.character);
  if (refusal) return { ok: false, error: refusal };
  return { ok: true };
}

/** The ship's own way out, on the ground. */
export async function leaveTheCharon() {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };

  const here = await prisma.location.findUnique({
    where: { id: me.character.locationId ?? "" },
    select: { slug: true },
  });
  if (here?.slug !== CHARON_SLUG) return { ok: false, error: "You aren't aboard." };

  const refusal = await leaveCharon(prisma, me.character);
  if (refusal) return { ok: false, error: refusal };
  return { ok: true };
}

/**
 * The Cockpit's terminal. One button doing three things — start, cancel, or
 * refuse — because which of them it is depends on state the player can already
 * see in the feed, and a second button would be a second thing to get wrong.
 */
export async function launchTheCharon({ roomId } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, COCKPIT_SLUG, "There's no terminal here.");
  if (found.error) return { ok: false, error: found.error };

  const answer = await pressLaunch(prisma, me.character);
  // A refusal the terminal makes to one person, with the console's own noise on
  // it. Everything else was said out loud into the ship's feed instead, where
  // the people it concerns are standing.
  if (answer) return { ok: false, error: answer.text, sfx: answer.sfx };
  return { ok: true };
}

/** The Habitation's last button, in orbit only. */
export async function sleepInTheCharon({ roomId } = {}) {
  const me = await actor(undefined, { acting: true });
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, HABITATION_SLUG, "There's nowhere to lie down here.");
  if (found.error) return { ok: false, error: found.error };

  // On the ground the bunk is just a bunk. Off the Location's own attribute
  // rather than its slug, so the rule is the same one the button is drawn from.
  const here = await prisma.location.findUnique({
    where: { id: me.character.locationId ?? "" },
    select: { attributes: true },
  });
  if (!hasAttribute(here, "offMap")) return { ok: false, error: "You aren't in space." };

  const slept = await sleepAboard(prisma, me.character);
  if (!slept) return { ok: false, error: "You can't do that right now." };
  return { ok: true };
}
