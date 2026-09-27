const {
  MENU_OPTION_LIMIT,
  PICK_ID,
  BRING_ID,
  CONFIRM_PREFIX,
  EXERT_PREFIX,
  CANCEL_ID,
  loadMover,
  listNames,
  buildLocationSelectRow,
  buildBringRow,
  applyBring,
  freeZoneMovesReason,
  buildConfirmRow,
  freeMovesLeft,
  stowedMounts,
  performMove,
} = require("../lib/locationTravel");
const { heldReasonFor, INTERCEPT_RELEASE_PREFIX } = require("@lifeweb/db/lib/intercept");
const { ATTACK_CANCEL_PREFIX } = require("@lifeweb/db/lib/attack");
const { isCombatButton, isCombatModal, handleCombatButton, handleCombatDescribe } = require("../lib/combatButtons");
const { DM_ACTION, DM_CHOICE } = require("@lifeweb/db/lib/dmActions");
const {
  WHOS_HERE_PREFIX,
  SECRET_ROOMS_PREFIX,
  EXAMINE_PREFIX,
  CONVERSE_PREFIX,
  GATE_PREFIX,
  KEYED_PREFIX,
} = require("@lifeweb/db/lib/locationAnchorRow");
const {
  ROOM_STORAGE_PREFIX,
  ROOM_SEARCH_PREFIX,
  ROOM_ATM_PREFIX,
  ROOM_DEPOT_TURRET_PREFIX,
  ROOM_INTERCOM_PREFIX,
  ROOM_TURRET_PREFIX,
  ROOM_BELL_PREFIX,
  ROOM_PRAY_PREFIX,
  ROOM_CHARON_ENTER_PREFIX,
  ROOM_CHARON_LAUNCH_PREFIX,
  ROOM_CHARON_SLEEP_PREFIX,
  CHARON_LEAVE_PREFIX,
  ROOM_SLOTS_PREFIX,
  ROOM_PHONE_PREFIX,
  ROOM_VENDING_PREFIX,
  ROOM_NUKE_PREFIX,
  ROOM_BLACK_MARKET_PREFIX,
  CENSOR_OFFICE_ROOM_SLUG,
} = require("@lifeweb/db/lib/roomStarterRow");
const { INTERCOM_MODAL_PREFIX, buildIntercomModal } = require("../lib/intercomModal");
const {
  QUEST_INTERACT_PREFIX,
  QUEST_MODAL_PREFIX,
  QUEST_INTENTION_FIELD,
  questInteract,
} = require("@lifeweb/db/lib/quests");
const {
  TURRET_MODAL_PREFIX,
  TURRET_WORD_FIELD,
  buildTurretModal,
  turretWordMatches,
} = require("../lib/turretModal");
const {
  BELL_MODAL_PREFIX,
  BELL_WORD_FIELD,
  buildBellModal,
  bellWordMatches,
} = require("../lib/bellModal");
const { LOBBY_DECLINE_PREFIX } = require("@lifeweb/db/lib/lobby");
const { handleLobbyDecline } = require("../lib/lobby");
const {
  buildConverseModal,
  CONVERSE_MODAL_PREFIX,
  CONVERSE_NAME_FIELD,
} = require("../lib/converseModal");
const { ack, respond, scheduleDismiss } = require("../lib/respond");
const { prisma } = require("@lifeweb/db");
const { sessionGate } = require("@lifeweb/db/lib/betweenSessions");
const { isGmMember } = require("../lib/interactionGuild");
const { BIRD_REPLY_PREFIX, BIRD_REPLY_PICK_PREFIX } = require("@lifeweb/db/lib/bird");
const { handleBirdReplyOpen, handleBirdReplyPick } = require("../lib/birdReply");
const { CONVERSION_PICK_PREFIX } = require("@lifeweb/db/lib/conversionRite");
const { handleConversionPick } = require("../lib/conversionPick");
const { NOTICEBOARD_PREFIX } = require("@lifeweb/db/lib/locationAnchorRow");
const {
  READ_PREFIX: NOTICE_READ_PREFIX,
  TEAR_PREFIX: NOTICE_TEAR_PREFIX,
  PIN_PREFIX: NOTICE_PIN_PREFIX,
  POST_PREFIX: NOTICE_POST_PREFIX,
  POST_MODAL_PREFIX: NOTICE_POST_MODAL_PREFIX,
  handleNoticeboardOpen,
  handleNoticeRead,
  handleNoticeTear,
  handleNoticePin,
  handleNoticePost,
  handleNoticePostSubmit,
} = require("../lib/noticeboardPanel");
const {
  OFFER_ACCEPT_PREFIX,
  OFFER_DECLINE_PREFIX,
  SEARCH_HIDE_PREFIX,
  SEARCH_HIDE_PICK_PREFIX,
} = require("@lifeweb/db/lib/offerRow");
const {
  handleOfferAccept,
  handleOfferDecline,
  handleSearchHideOpen,
  handleSearchHidePick,
} = require("../lib/offers");
const {
  THREAT_SPAWN_ACCEPT_PREFIX,
  THREAT_SPAWN_DECLINE_PREFIX,
} = require("@lifeweb/db/lib/threats");
const { handleThreatSpawnAccept, handleThreatSpawnDecline } = require("../lib/threatSpawn");
const {
  OPEN_PREFIX: EDIT_OPEN_PREFIX,
  MODAL_PREFIX: EDIT_MODAL_PREFIX,
  handleEditOpen,
  handleEditSubmit,
} = require("../lib/editModal");
const { handleRoomStorage, handleStorageCommand } = require("../lib/roomStorage");
const { handleRoomSearch } = require("../lib/roomSearch");
const {
  ZONE_VIEW_ID,
  handleZoneCommand,
  handleZoneViewPick,
  handleGmCommand,
  handleGmDmCommand,
  handleThreadMemberCommand,
  handleRoomGuestCommand,
} = require("./interactions/admin");
const {
  PRAY_CONFIRM_PREFIX,
  SLOTS_CONFIRM_PREFIX,
  NUKE_KEY_PREFIX,
  NUKE_PRESS_PREFIX,
  handleNukeOpen,
  handleNukeKey,
  handleNukePress,
  PHONE_KEY_PREFIX,
  PHONE_CALL_PREFIX,
  PHONE_ANSWER_PREFIX,
  PHONE_HANGUP_PREFIX,
  PHONE_WALK_PREFIX,
  PHONE_COIN_PREFIX,
  handleIntercomOpen,
  handleQuestOpen,
  handleQuestSubmit,
  handleTurretOpen,
  handleBellOpen,
  handlePrayOpen,
  handleCharonEnter,
  handleCharonLeave,
  handleCharonLaunch,
  handleCharonSleep,
  handlePrayConfirm,
  handleSlotsOpen,
  handlePhoneOpen,
  handlePhoneKey,
  handlePhoneCall,
  handlePhoneAnswer,
  handlePhoneHangup,
  handlePhoneWalk,
  handlePhoneCoin,
  handleSlotsConfirm,
  handleBellSubmit,
  handleTurretSubmit,
  handleIntercomSubmit,
} = require("./interactions/rooms");
const {
  VENDING_BUY_PREFIX,
  VENDING_INSERT_PREFIX,
  VENDING_INSERT_MODAL,
  VENDING_WITHDRAW_PREFIX,
  VENDING_LEAVE_PREFIX,
  VENDING_UNLOCK_PREFIX,
  VENDING_LOCK_PREFIX,
  VENDING_COLLECT_PREFIX,
  VENDING_OUT_PREFIX,
  VENDING_IN_PREFIX,
  VENDING_IN_MODAL,
  VENDING_PRICE_PREFIX,
  VENDING_PRICE_MODAL,
  handleVendingOpen,
  handleVendingLeave,
  handleVendingInsert,
  handleVendingInsertSubmit,
  handleVendingWithdraw,
  handleVendingBuy,
  handleVendingUnlock,
  handleVendingLock,
  handleVendingCollect,
  handleVendingStockIn,
  handleVendingStockInPicked,
  handleVendingStockInSubmit,
  handleVendingStockOut,
  handleVendingStockOutPicked,
  handleVendingPrice,
  handleVendingPricePicked,
  handleVendingPriceSubmit,
} = require("./interactions/vending");
const {
  BM_INSERT_PREFIX,
  BM_INSERT_MODAL,
  BM_PICK_PREFIX,
  BM_QTY_MODAL,
  handleBlackMarketOpen,
  handleBlackMarketInsert,
  handleBlackMarketInsertSubmit,
  handleBlackMarketPick,
  handleBlackMarketQtySubmit,
} = require("./interactions/blackMarket");
const { MERCHANT_TERMINAL_PREFIX } = require("@lifeweb/db/lib/placeAffordances");
const {
  MT_UNLOCK,
  MT_INSERT,
  MT_WITHDRAW,
  MT_COIN_MODAL,
  MT_PICK_PREFIX,
  MT_QTY_MODAL,
  MT_REMOVE_PICK,
  handleMerchantTerminalOpen,
  handleMerchantTerminalUnlock,
  handleMerchantTerminalCoin,
  handleMerchantTerminalCoinSubmit,
  handleMerchantTerminalPick,
  handleMerchantTerminalQtySubmit,
  handleMerchantTerminalRemove,
} = require("./interactions/merchantTerminal");
const {
  ATM_OUT_PREFIX,
  ATM_IN_PREFIX,
  ATM_PIN_SUFFIX,
  ATM_MODAL_PREFIX,
  DEPOT_TURRET_MODAL_PREFIX,
  handleAtmOpen,
  handleAtmAmountOpen,
  handleAtmSubmit,
  handleDepotTurretOpen,
  handleDepotTurretSubmit,
} = require("./interactions/depotCounter");
const {
  handleTravelOpen,
  handleGateToggle,
  handleKeyedPrompt,
  handleHoldEnd,
  handleTravelPick,
  handleTravelBring,
  handleTravelConfirm,
  handleTravelCancel,
} = require("./interactions/travel");
const {
  CONVERSE_ROOM_PREFIX,
  handleWhosHere,
  handleExamine,
  handleSecretRooms,
  handleConverseOpen,
  handleConverseRoomPick,
  handleConverseCreate,
  handleConcealCommand,
} = require("./interactions/scene");
const {
  VERB_COMMANDS,
  MENU_PREFIX: ACT_MENU_PREFIX,
  START_PREFIX: ACT_START_PREFIX,
  VERB_PREFIX: ACT_VERB_PREFIX,
  MODAL_PREFIX: ACT_MODAL_PREFIX,
  OPEN_VERB_PREFIXES,
  isOpenCommand,
  startFromCommand,
  handleVerbComponent,
  handleVerbModal,
  handleActionsOpen,
  handleMenuPick,
  handleStartButton,
} = require("../lib/verbs");
const { META_PREFIX, META_COMMANDS, handleMetaCommand, handleMetaComponent } = require("../lib/verbs/meta");
const { ACTIONS_OPEN_ID } = require("@lifeweb/db/lib/turnsConsoleRow");
const {
  handleMoveOpen,
  handleMoveSubmit,
  handleSpeakOpen,
  handleSpeakSubmit,
  handleMessageCommand,
  handleHealCommand,
  handleHealPick,
  handleRollCommand,
  handlePlayCommand,
  handleShoutCommand,
  handleOocCommand,
} = require("./interactions/actions");


// --- The session gate ------------------------------------------------------
//
// Between sittings the game is shut and a player may TALK and nothing else (SESSIONS.md §5). Every command, button,
// select and modal on Discord comes through the one execute() below, so the gate sits there once rather than in fifty
// handlers — and it is an ALLOWLIST, so a button somebody adds next year is shut by default. That is the safe
// direction, but it does mean a NEW READ-ONLY OR SPEECH SURFACE MUST BE ADDED HERE or it will refuse out of session.
//
// Speech itself is not decided here: db/lib/say.js#prepareSpeech is the one answer both faces share, and it is what
// honours "Allow roleplaying in between sessions". The modal still has to OPEN, which is why say:open is on the list.
const OPEN_COMMANDS = new Set([
  // GM work, whenever they like. Each of these handlers gates on isGmMember itself.
  "gm", "zone", "dm", "heal", "add", "remove",
  // Out of character, or about how a player is PRESENTED rather than what they do. None of it is the game.
  "ooc", "message", "conceal",
  // Looking, not acting — the same as Who's here? and Examine below.
  "storage",
  // The Actions menu is a list; each verb picked from it meets the gate on its own step. Feedback and the lobby belong
  // to the player, not the game (bot/src/lib/verbs/meta.js).
  "actions", "feedback", "lobby",
]);

// Roleplay that does NOT go through db/lib/say.js — a shout carries across the Location graph, a die roll and a music
// cue land in the room as scenery. They are talking, so they follow the roleplay knob rather than the act gate, and
// they need saying here because prepareSpeech never sees them.
const SPEECH_COMMANDS = new Set(["shout", "roll", "play"]);

// Prefixes that stay clickable: reading, looking, and opening the Speak modal.
const OPEN_PREFIXES = [
  "say:open", "say:send:",
  WHOS_HERE_PREFIX, EXAMINE_PREFIX, SECRET_ROOMS_PREFIX, NOTICE_READ_PREFIX, ROOM_STORAGE_PREFIX,
  // Arrive in a DM to somebody with no character yet — a seat offer and a lobby assignment sit outside the game the
  // way character creation does, so a session boundary is not theirs to answer to.
  THREAT_SPAWN_ACCEPT_PREFIX, THREAT_SPAWN_DECLINE_PREFIX, LOBBY_DECLINE_PREFIX,
  // The Actions menu, and the verbs that only read (/warrant list, /paper read, /mymove…) — db/lib/actionCatalog.js
  // marks them `open`. Feedback and Ready / Not ready, which sit outside the game.
  ...OPEN_VERB_PREFIXES, META_PREFIX,
];

// Speech, act, or never gated at all.
function gateKindFor(interaction) {
  if (interaction.isChatInputCommand()) {
    if (OPEN_COMMANDS.has(interaction.commandName)) return null;
    // A verb's typed twin is open when the catalog says it only reads (SESSIONS.md §5).
    if (VERB_COMMANDS.has(interaction.commandName)) {
      return isOpenCommand(interaction.commandName, interaction.options.getSubcommand(false)) ? null : "act";
    }
    return SPEECH_COMMANDS.has(interaction.commandName) ? "speech" : "act";
  }
  return "act";
}

function alwaysOpen(interaction) {
  if (interaction.isChatInputCommand()) return gateKindFor(interaction) === null;
  // Anything execute() does not itself route — an autocomplete, say — is not ours to refuse.
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return true;
  const id = interaction.customId ?? "";
  return OPEN_PREFIXES.some((prefix) => id.startsWith(prefix));
}

// The refusal sentence, or false to carry on. A GM is never refused — they run the sitting.
//
// Raced at 800ms and failing OPEN, the same bargain handleMoveOpen already strikes (interactions/actions.js): this read
// happens before the three-second acknowledgement on EVERY interaction, including the ones that open a modal and so
// cannot be deferred first. A slow pool must cost a refusal, never the click. What slips through still meets the gate
// again deeper down — db/lib/locationTravel.js, web/lib/moveSpend.js and db/lib/say.js all ask it themselves, so
// failing open here loses nothing but the tidy sentence.
async function shutOut(interaction) {
  if (alwaysOpen(interaction) || isGmMember(interaction)) return false;
  const acting = gateKindFor(interaction) !== "speech";
  const gate = await Promise.race([
    sessionGate(prisma, { acting }).catch((err) => {
      console.error("Session gate check failed:", err);
      return { ok: true };
    }),
    new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 800)),
  ]);
  return gate.ok ? false : gate.message;
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      const shut = await shutOut(interaction);
      if (shut) {
        // A modal-opening interaction is acknowledged by showModal(), which we are not calling — so this one reply
        // is both the refusal and the ack, and respond() writes the "» *…*" an ephemeral reply wears.
        return void (await respond(interaction, shut));
      }
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "gm") return void (await handleGmCommand(interaction));
        if (interaction.commandName === "zone") return void (await handleZoneCommand(interaction));
        if (interaction.commandName === "dm") return void (await handleGmDmCommand(interaction));
        if (interaction.commandName === "heal") return void (await handleHealCommand(interaction));
        if (interaction.commandName === "add" || interaction.commandName === "remove") {
          return void (await handleThreadMemberCommand(interaction, interaction.commandName));
        }
        if (interaction.commandName === "move") return void (await handleMoveOpen(interaction));
        if (interaction.commandName === "location" || interaction.commandName === "travel")
          return void (await handleTravelOpen(interaction));
        if (interaction.commandName === "conceal") return void (await handleConcealCommand(interaction));
        if (interaction.commandName === "storage") return void (await handleStorageCommand(interaction));
        if (interaction.commandName === "message") return void (await handleMessageCommand(interaction));
        if (interaction.commandName === "roll") return void (await handleRollCommand(interaction));
        if (interaction.commandName === "play") return void (await handlePlayCommand(interaction));
        if (interaction.commandName === "shout") return void (await handleShoutCommand(interaction));
        if (interaction.commandName === "ooc") return void (await handleOocCommand(interaction));
        // Every player verb's typed twin, the Actions menu, and the player's own two (bot/src/lib/verbs/).
        if (interaction.commandName === "actions") return void (await handleActionsOpen(interaction));
        if (VERB_COMMANDS.has(interaction.commandName)) return void (await startFromCommand(interaction));
        if (META_COMMANDS.has(interaction.commandName)) return void (await handleMetaCommand(interaction));
      } else if (interaction.isButton()) {
        if (interaction.customId === "loc:open") return void (await handleTravelOpen(interaction));
        // The Actions button — every Location anchor, and the #turns console.
        if (interaction.customId === ACTIONS_OPEN_ID) return void (await handleActionsOpen(interaction));
        // A room's own button for one verb (the Depot's Send money, the Meister's Sell tax), and every verb's own
        // buttons. Some open a modal, so none is acked here — each step acks for itself.
        if (interaction.customId.startsWith(ACT_START_PREFIX)) return void (await handleStartButton(interaction));
        if (interaction.customId.startsWith(ACT_VERB_PREFIX)) return void (await handleVerbComponent(interaction));
        if (interaction.customId.startsWith(META_PREFIX)) return void (await handleMetaComponent(interaction));
        if (interaction.customId === CANCEL_ID) return void (await handleTravelCancel(interaction));
        if (interaction.customId.startsWith(CONFIRM_PREFIX)) {
          return void (await handleTravelConfirm(interaction, interaction.customId.slice(CONFIRM_PREFIX.length)));
        }
        if (interaction.customId.startsWith(EXERT_PREFIX)) {
          return void (await handleTravelConfirm(interaction, interaction.customId.slice(EXERT_PREFIX.length), { exert: true }));
        }
        if (interaction.customId.startsWith(WHOS_HERE_PREFIX)) {
          return void (await handleWhosHere(interaction, interaction.customId.slice(WHOS_HERE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(ROOM_STORAGE_PREFIX)) {
          return void (await handleRoomStorage(interaction, interaction.customId.slice(ROOM_STORAGE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(ROOM_SEARCH_PREFIX)) {
          return void (await handleRoomSearch(interaction, interaction.customId.slice(ROOM_SEARCH_PREFIX.length)));
        }
        // The Depot's counter (docs/systemdocs/DEPOT.md). The ATM's own button
        // acks and answers with a balance; its two amount buttons open modals,
        // so those must NOT be acked first.
        if (interaction.customId.startsWith(ROOM_ATM_PREFIX)) {
          return void (await handleAtmOpen(interaction));
        }
        if (interaction.customId === ATM_OUT_PREFIX || interaction.customId === ATM_OUT_PREFIX + ATM_PIN_SUFFIX) {
          return void (await handleAtmAmountOpen(interaction, true, interaction.customId.endsWith(ATM_PIN_SUFFIX)));
        }
        if (interaction.customId === ATM_IN_PREFIX || interaction.customId === ATM_IN_PREFIX + ATM_PIN_SUFFIX) {
          return void (await handleAtmAmountOpen(interaction, false, interaction.customId.endsWith(ATM_PIN_SUFFIX)));
        }
        // The Merchant's Terminal (db/lib/merchantTerminal.js), on the Depot's
        // anchor. Insert and Withdraw open a modal, so they must NOT be acked first.
        if (interaction.customId.startsWith(MERCHANT_TERMINAL_PREFIX)) {
          return void (await handleMerchantTerminalOpen(interaction));
        }
        if (interaction.customId === MT_UNLOCK) {
          return void (await handleMerchantTerminalUnlock(interaction));
        }
        if (interaction.customId === MT_INSERT || interaction.customId === MT_WITHDRAW) {
          return void (await handleMerchantTerminalCoin(interaction, interaction.customId === MT_WITHDRAW));
        }
        // Opens a modal, so it must NOT be ack()'d first — see handleQuestOpen.
        if (interaction.customId.startsWith(ROOM_DEPOT_TURRET_PREFIX)) {
          return void (await handleDepotTurretOpen(interaction));
        }
        // Opens a modal, so it must NOT be ack()'d first — see handleQuestOpen.
        if (interaction.customId.startsWith(QUEST_INTERACT_PREFIX)) {
          return void (await handleQuestOpen(interaction, interaction.customId.slice(QUEST_INTERACT_PREFIX.length)));
        }
        // Opens a modal, so it must NOT be ack()'d first — see handleIntercomOpen.
        if (interaction.customId.startsWith(ROOM_INTERCOM_PREFIX)) {
          return void (await handleIntercomOpen(interaction, interaction.customId.slice(ROOM_INTERCOM_PREFIX.length)));
        }
        if (interaction.customId.startsWith(ROOM_TURRET_PREFIX)) {
          return void (await handleTurretOpen(interaction, interaction.customId.slice(ROOM_TURRET_PREFIX.length)));
        }
        // The confirm first: "room:pray:go:<id>" also starts with the open
        // prefix, so testing the other way round would route every confirm
        // back into the dialog it came from.
        if (interaction.customId.startsWith(PRAY_CONFIRM_PREFIX)) {
          return void (await handlePrayConfirm(
            interaction,
            interaction.customId.slice(PRAY_CONFIRM_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(ROOM_PRAY_PREFIX)) {
          return void (await handlePrayOpen(interaction, interaction.customId.slice(ROOM_PRAY_PREFIX.length)));
        }
        // The keypad and the handset's buttons before the open, for the
        // reason Pray's pair gives just below: "room:phone:key:<id>:<digits>"
        // and the rest all start with the open prefix "room:phone:"
        // (db/lib/phoneKeypad.js).
        if (interaction.customId.startsWith(PHONE_KEY_PREFIX)) {
          return void (await handlePhoneKey(interaction));
        }
        if (interaction.customId.startsWith(PHONE_CALL_PREFIX)) {
          return void (await handlePhoneCall(interaction));
        }
        if (interaction.customId.startsWith(PHONE_ANSWER_PREFIX)) {
          return void (await handlePhoneAnswer(interaction, interaction.customId.slice(PHONE_ANSWER_PREFIX.length)));
        }
        if (interaction.customId.startsWith(PHONE_HANGUP_PREFIX)) {
          return void (await handlePhoneHangup(interaction));
        }
        if (interaction.customId.startsWith(PHONE_WALK_PREFIX)) {
          return void (await handlePhoneWalk(interaction));
        }
        if (interaction.customId.startsWith(PHONE_COIN_PREFIX)) {
          return void (await handlePhoneCoin(interaction));
        }
        // The bomb's keypad (docs/systemdocs/NUKE.md): its key and press ids
        // start with the open prefix "room:nuke:", so they go first.
        if (interaction.customId.startsWith(NUKE_KEY_PREFIX)) {
          return void (await handleNukeKey(interaction));
        }
        if (interaction.customId.startsWith(NUKE_PRESS_PREFIX)) {
          return void (await handleNukePress(interaction));
        }
        if (interaction.customId.startsWith(ROOM_NUKE_PREFIX)) {
          return void (await handleNukeOpen(interaction, interaction.customId.slice(ROOM_NUKE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(ROOM_PHONE_PREFIX)) {
          return void (await handlePhoneOpen(interaction, interaction.customId.slice(ROOM_PHONE_PREFIX.length)));
        }
        // The Charon (docs/systemdocs/CHARON.md). Four buttons, each carrying
        // the id of the thing it acts on — the room for three of them, nothing
        // for Leave, which reads the presser's own locationId.
        if (interaction.customId.startsWith(ROOM_CHARON_ENTER_PREFIX)) {
          return void (await handleCharonEnter(
            interaction,
            interaction.customId.slice(ROOM_CHARON_ENTER_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(ROOM_CHARON_LAUNCH_PREFIX)) {
          return void (await handleCharonLaunch(
            interaction,
            interaction.customId.slice(ROOM_CHARON_LAUNCH_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(ROOM_CHARON_SLEEP_PREFIX)) {
          return void (await handleCharonSleep(
            interaction,
            interaction.customId.slice(ROOM_CHARON_SLEEP_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(CHARON_LEAVE_PREFIX)) {
          return void (await handleCharonLeave(interaction));
        }
        // The confirm before the open, for the reason Pray's pair gives just
        // above: "room:slots:go:<id>" also starts with the open prefix.
        if (interaction.customId.startsWith(SLOTS_CONFIRM_PREFIX)) {
          return void (await handleSlotsConfirm(interaction));
        }
        if (interaction.customId.startsWith(ROOM_SLOTS_PREFIX)) {
          return void (await handleSlotsOpen(interaction, interaction.customId.slice(ROOM_SLOTS_PREFIX.length)));
        }
        // The Merchant's vending machine. EVERY sub-prefix goes before the open
        // prefix, for the reason Pray's and Slots' pairs give above:
        // "room:vending:insert:<id>" also starts with "room:vending:".
        if (interaction.customId.startsWith(VENDING_INSERT_PREFIX)) {
          return void (await handleVendingInsert(interaction, interaction.customId.slice(VENDING_INSERT_PREFIX.length)));
        }
        if (interaction.customId.startsWith(VENDING_WITHDRAW_PREFIX)) {
          return void (await handleVendingWithdraw(
            interaction,
            interaction.customId.slice(VENDING_WITHDRAW_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(VENDING_LEAVE_PREFIX)) {
          return void (await handleVendingLeave(interaction, interaction.customId.slice(VENDING_LEAVE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(VENDING_UNLOCK_PREFIX)) {
          return void (await handleVendingUnlock(interaction, interaction.customId.slice(VENDING_UNLOCK_PREFIX.length)));
        }
        if (interaction.customId.startsWith(VENDING_LOCK_PREFIX)) {
          return void (await handleVendingLock(interaction, interaction.customId.slice(VENDING_LOCK_PREFIX.length)));
        }
        if (interaction.customId.startsWith(VENDING_COLLECT_PREFIX)) {
          return void (await handleVendingCollect(
            interaction,
            interaction.customId.slice(VENDING_COLLECT_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(VENDING_IN_PREFIX)) {
          return void (await handleVendingStockIn(interaction, interaction.customId.slice(VENDING_IN_PREFIX.length)));
        }
        if (interaction.customId.startsWith(VENDING_OUT_PREFIX)) {
          return void (await handleVendingStockOut(interaction, interaction.customId.slice(VENDING_OUT_PREFIX.length)));
        }
        if (interaction.customId.startsWith(VENDING_PRICE_PREFIX)) {
          return void (await handleVendingPrice(interaction, interaction.customId.slice(VENDING_PRICE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(ROOM_VENDING_PREFIX)) {
          return void (await handleVendingOpen(interaction, interaction.customId.slice(ROOM_VENDING_PREFIX.length)));
        }
        // The Black Market terminal (db/lib/blackMarket.js). Insert opens a
        // modal, so it must NOT be acked first.
        if (interaction.customId === BM_INSERT_PREFIX) {
          return void (await handleBlackMarketInsert(interaction));
        }
        if (interaction.customId.startsWith(ROOM_BLACK_MARKET_PREFIX)) {
          return void (await handleBlackMarketOpen(interaction));
        }
        if (interaction.customId.startsWith(ROOM_BELL_PREFIX)) {
          return void (await handleBellOpen(interaction, interaction.customId.slice(ROOM_BELL_PREFIX.length)));
        }
        if (interaction.customId.startsWith(SECRET_ROOMS_PREFIX)) {
          return void (await handleSecretRooms(interaction, interaction.customId.slice(SECRET_ROOMS_PREFIX.length)));
        }
        if (interaction.customId.startsWith(EXAMINE_PREFIX)) {
          return void (await handleExamine(interaction, interaction.customId.slice(EXAMINE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(CONVERSE_PREFIX)) {
          return void (await handleConverseOpen(interaction, interaction.customId.slice(CONVERSE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(GATE_PREFIX)) {
          return void (await handleGateToggle(interaction, interaction.customId.slice(GATE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(KEYED_PREFIX)) {
          return void (await handleKeyedPrompt(interaction, interaction.customId.slice(KEYED_PREFIX.length)));
        }
        if (interaction.customId.startsWith(INTERCEPT_RELEASE_PREFIX)) {
          return void (await handleHoldEnd(
            interaction,
            DM_ACTION.INTERCEPT_HOLD,
            interaction.customId.slice(INTERCEPT_RELEASE_PREFIX.length),
          ));
        }
        // Legacy: a Cancel attack button from before the Combat Overhaul (db/lib/attack.js).
        if (interaction.customId.startsWith(ATTACK_CANCEL_PREFIX)) {
          return void (await handleHoldEnd(
            interaction,
            DM_ACTION.ATTACK_HOLD,
            interaction.customId.slice(ATTACK_CANCEL_PREFIX.length),
          ));
        }
        // A fight's DM buttons (docs/systemdocs/ATTACK.md): Join, Decline, Write your attack, Call off. Write opens a
        // modal, which is its own acknowledgement, so the handler acks the others itself.
        if (isCombatButton(interaction.customId)) return void (await handleCombatButton(interaction));
        if (interaction.customId === "move:open") return void (await handleMoveOpen(interaction));
        if (interaction.customId === "say:open") return void (await handleSpeakOpen(interaction));
        // Arrive in a DM on a consent offer (docs/systemdocs/LESSONS.md), so
        // guild/member are null. Not acked: interaction.update() is the ack.
        if (interaction.customId.startsWith(OFFER_ACCEPT_PREFIX)) {
          return void (await handleOfferAccept(interaction, interaction.customId.slice(OFFER_ACCEPT_PREFIX.length)));
        }
        if (interaction.customId.startsWith(OFFER_DECLINE_PREFIX)) {
          return void (await handleOfferDecline(interaction, interaction.customId.slice(OFFER_DECLINE_PREFIX.length)));
        }
        // Search's third button (docs/systemdocs/SEARCH.md §2). Arrives in the
        // same DM as the two above, and unlike them it is NOT an answer — it
        // opens an ephemeral picker and deliberately leaves Yes/No on the
        // message, so this one IS acked (it does not call interaction.update).
        if (interaction.customId.startsWith(SEARCH_HIDE_PREFIX)) {
          return void (await handleSearchHideOpen(interaction, interaction.customId.slice(SEARCH_HIDE_PREFIX.length)));
        }
        // Arrives in a DM on a threat spawn offer (docs/systemdocs/THREATS.md),
        // so guild/member are null — and the clicker has no character yet,
        // which is the whole point. Not acked: interaction.update() is the ack.
        if (interaction.customId.startsWith(THREAT_SPAWN_ACCEPT_PREFIX)) {
          return void (await handleThreatSpawnAccept(
            interaction,
            interaction.customId.slice(THREAT_SPAWN_ACCEPT_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(THREAT_SPAWN_DECLINE_PREFIX)) {
          return void (await handleThreatSpawnDecline(
            interaction,
            interaction.customId.slice(THREAT_SPAWN_DECLINE_PREFIX.length),
          ));
        }
        // Arrives in a DM on an assignment (docs/systemdocs/LOBBY.md §4), so
        // guild/member are null and the clicker has no character yet.
        if (interaction.customId.startsWith(LOBBY_DECLINE_PREFIX)) {
          return void (await handleLobbyDecline(
            interaction,
            interaction.customId.slice(LOBBY_DECLINE_PREFIX.length),
          ));
        }
        // Arrives in a DM on a Bird's letter, so guild/member are null.
        if (interaction.customId.startsWith(BIRD_REPLY_PREFIX)) {
          return void (await handleBirdReplyOpen(interaction, interaction.customId.slice(BIRD_REPLY_PREFIX.length)));
        }
        // The board on a Location's anchor. Shown only where docs/zones.yaml
        // declared one (db/lib/noticeboard.js).
        if (interaction.customId.startsWith(NOTICEBOARD_PREFIX)) {
          return void (await handleNoticeboardOpen(interaction, interaction.customId.slice(NOTICEBOARD_PREFIX.length)));
        }
        // The GM's third row: a button where a player gets the Pin select,
        // because a GM holds no paper and writes the notice on the spot. It
        // opens a modal, so the handler must NOT be acked first.
        if (interaction.customId.startsWith(NOTICE_POST_PREFIX)) {
          return void (await handleNoticePost(interaction, interaction.customId.slice(NOTICE_POST_PREFIX.length)));
        }
        // Arrives in a DM; must NOT be acked first since it opens a modal.
        if (interaction.customId.startsWith(EDIT_OPEN_PREFIX)) return void (await handleEditOpen(interaction));
      } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === ZONE_VIEW_ID) return void (await handleZoneViewPick(interaction));
        // A pick from the Actions menu starts the verb; every verb's own selects are its steps.
        if (interaction.customId.startsWith(ACT_MENU_PREFIX)) return void (await handleMenuPick(interaction));
        if (interaction.customId.startsWith(ACT_VERB_PREFIX)) return void (await handleVerbComponent(interaction));
        if (interaction.customId === PICK_ID) return void (await handleTravelPick(interaction));
        if (interaction.customId === BRING_ID) {
          return void (await handleTravelBring(interaction));
        }
        // Must NOT be acked first: it opens a modal.
        if (interaction.customId.startsWith(CONVERSE_ROOM_PREFIX)) {
          return void (await handleConverseRoomPick(interaction));
        }
        // A terminal ware picked: opens the quantity modal, so no ack.
        if (interaction.customId.startsWith(MT_PICK_PREFIX)) {
          return void (await handleMerchantTerminalPick(interaction));
        }
        if (interaction.customId === MT_REMOVE_PICK) {
          return void (await handleMerchantTerminalRemove(interaction));
        }
        // The vending machine's three selects. The two "pick:" ones are checked
        // first because they share their parent's prefix, and the two that open
        // a modal must NOT be acked first.
        if (interaction.customId.startsWith(`${VENDING_OUT_PREFIX}pick:`)) {
          return void (await handleVendingStockOutPicked(
            interaction,
            interaction.customId.slice(`${VENDING_OUT_PREFIX}pick:`.length),
          ));
        }
        if (interaction.customId.startsWith(`${VENDING_PRICE_PREFIX}pick:`)) {
          return void (await handleVendingPricePicked(
            interaction,
            interaction.customId.slice(`${VENDING_PRICE_PREFIX}pick:`.length),
          ));
        }
        if (interaction.customId.startsWith(VENDING_BUY_PREFIX)) {
          return void (await handleVendingBuy(interaction, interaction.customId.slice(VENDING_BUY_PREFIX.length)));
        }
        // A Black Market ware picked: opens the quantity modal, so no ack.
        if (interaction.customId.startsWith(BM_PICK_PREFIX)) {
          return void (await handleBlackMarketPick(interaction));
        }
        // Opens a modal, so it must NOT be acked first.
        if (interaction.customId.startsWith(VENDING_IN_MODAL)) {
          return void (await handleVendingStockInPicked(
            interaction,
            interaction.customId.slice(VENDING_IN_MODAL.length),
          ));
        }
        if (interaction.customId.startsWith("heal:pick:")) {
          return void (await handleHealPick(interaction, interaction.customId.slice("heal:pick:".length)));
        }
        // The select inside the Hide-items ephemeral above. It updates that
        // ephemeral, never the consent DM.
        if (interaction.customId.startsWith(SEARCH_HIDE_PICK_PREFIX)) {
          return void (await handleSearchHidePick(
            interaction,
            interaction.customId.slice(SEARCH_HIDE_PICK_PREFIX.length),
          ));
        }
        // Answering a bird: which letter in your hands goes back.
        if (interaction.customId.startsWith(BIRD_REPLY_PICK_PREFIX)) {
          return void (await handleBirdReplyPick(interaction, interaction.customId.slice(BIRD_REPLY_PICK_PREFIX.length)));
        }
        // The Rite of Conversion's picker (docs/systemdocs/THANATI.md §4a).
        // Arrives in a DM to every chanter, so guild/member are null; the
        // first of them to answer claims the rite.
        if (interaction.customId.startsWith(CONVERSION_PICK_PREFIX)) {
          return void (await handleConversionPick(
            interaction,
            interaction.customId.slice(CONVERSION_PICK_PREFIX.length),
          ));
        }
        // The three verbs on a noticeboard. Read is free to anyone standing
        // here; whether they can make anything of it is a separate question
        // the handler asks (db/lib/reading.js).
        if (interaction.customId.startsWith(NOTICE_READ_PREFIX)) {
          return void (await handleNoticeRead(interaction, interaction.customId.slice(NOTICE_READ_PREFIX.length)));
        }
        if (interaction.customId.startsWith(NOTICE_TEAR_PREFIX)) {
          return void (await handleNoticeTear(interaction, interaction.customId.slice(NOTICE_TEAR_PREFIX.length)));
        }
        if (interaction.customId.startsWith(NOTICE_PIN_PREFIX)) {
          return void (await handleNoticePin(interaction, interaction.customId.slice(NOTICE_PIN_PREFIX.length)));
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === "move:new") return void (await handleMoveSubmit(interaction));
        if (isCombatModal(interaction.customId)) return void (await handleCombatDescribe(interaction));
        if (interaction.customId.startsWith(ACT_MODAL_PREFIX)) return void (await handleVerbModal(interaction));
        if (interaction.customId.startsWith(META_PREFIX)) return void (await handleMetaComponent(interaction));
        if (interaction.customId.startsWith(CONVERSE_MODAL_PREFIX)) {
          return void (await handleConverseCreate(interaction, interaction.customId.slice(CONVERSE_MODAL_PREFIX.length)));
        }
        if (interaction.customId.startsWith(NOTICE_POST_MODAL_PREFIX)) {
          return void (await handleNoticePostSubmit(
            interaction,
            interaction.customId.slice(NOTICE_POST_MODAL_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(QUEST_MODAL_PREFIX)) {
          return void (await handleQuestSubmit(interaction, interaction.customId.slice(QUEST_MODAL_PREFIX.length)));
        }
        if (interaction.customId.startsWith(INTERCOM_MODAL_PREFIX)) {
          return void (await handleIntercomSubmit(
            interaction,
            interaction.customId.slice(INTERCOM_MODAL_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(TURRET_MODAL_PREFIX)) {
          return void (await handleTurretSubmit(
            interaction,
            interaction.customId.slice(TURRET_MODAL_PREFIX.length),
          ));
        }
        // The vending machine's three modals. The put-in and price ones carry
        // "<roomId>:<tagId>" rather than a bare room id, since the select that
        // opened them is gone by the time the modal comes back.
        if (interaction.customId === BM_INSERT_MODAL) {
          return void (await handleBlackMarketInsertSubmit(interaction));
        }
        if (interaction.customId.startsWith(BM_QTY_MODAL)) {
          return void (await handleBlackMarketQtySubmit(interaction, interaction.customId.slice(BM_QTY_MODAL.length)));
        }
        if (interaction.customId.startsWith(VENDING_INSERT_MODAL)) {
          return void (await handleVendingInsertSubmit(
            interaction,
            interaction.customId.slice(VENDING_INSERT_MODAL.length),
          ));
        }
        if (interaction.customId.startsWith(VENDING_IN_MODAL)) {
          return void (await handleVendingStockInSubmit(
            interaction,
            interaction.customId.slice(VENDING_IN_MODAL.length),
          ));
        }
        if (interaction.customId.startsWith(VENDING_PRICE_MODAL)) {
          return void (await handleVendingPriceSubmit(
            interaction,
            interaction.customId.slice(VENDING_PRICE_MODAL.length),
          ));
        }
        if (interaction.customId.startsWith(ATM_MODAL_PREFIX)) {
          return void (await handleAtmSubmit(interaction, interaction.customId.slice(ATM_MODAL_PREFIX.length)));
        }
        if (interaction.customId.startsWith(MT_COIN_MODAL)) {
          return void (await handleMerchantTerminalCoinSubmit(interaction, interaction.customId.slice(MT_COIN_MODAL.length)));
        }
        if (interaction.customId.startsWith(MT_QTY_MODAL)) {
          return void (await handleMerchantTerminalQtySubmit(interaction, interaction.customId.slice(MT_QTY_MODAL.length)));
        }
        if (interaction.customId.startsWith(DEPOT_TURRET_MODAL_PREFIX)) {
          return void (await handleDepotTurretSubmit(interaction));
        }
        if (interaction.customId.startsWith(BELL_MODAL_PREFIX)) {
          return void (await handleBellSubmit(interaction, interaction.customId.slice(BELL_MODAL_PREFIX.length)));
        }
        if (interaction.customId.startsWith("say:send:")) {
          return void (await handleSpeakSubmit(interaction, interaction.customId.slice("say:send:".length)));
        }
        if (interaction.customId.startsWith(EDIT_MODAL_PREFIX)) return void (await handleEditSubmit(interaction));
      }
    } catch (err) {
      console.error("interactionCreate handler failed:", err);
      await respondToFailure(interaction);
    }
  },
};

async function respondToFailure(interaction) {
  if (!interaction.isRepliable?.()) return;
  await respond(interaction, { content: "Something went wrong — that didn't go through.", components: [] });
}
