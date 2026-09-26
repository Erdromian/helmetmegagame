// Room-anchor interaction handlers: the Intercom, Quest interact, the
// Watchtower turret, the Bell Tower, Prayer at the Shrine of an Old Man, the
// Den's slot machine and the telephones — each one's open (button/select) and
// submit (modal, or confirm button) pair.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const {
  syncCharacterRoomAccess,
  accessibleRooms,
  roomAccessKeys,
} = require("@lifeweb/db/lib/roomAccess");
const { resolveActingMember, isGmMember, findAliveCharacter } = require("../../lib/interactionGuild");
const { postAsCharacterTo, loadVoiceState } = require("../../lib/proxy");
const {
  ROOM_STORAGE_PREFIX,
  ROOM_INTERCOM_PREFIX,
  ROOM_TURRET_PREFIX,
  ROOM_BELL_PREFIX,
  ROOM_PRAY_PREFIX,
  CENSOR_OFFICE_ROOM_SLUG,
} = require("@lifeweb/db/lib/roomStarterRow");
const {
  CHARON_SLUG,
  PANIC_ROOM_SLUG,
  COCKPIT_SLUG,
  HABITATION_SLUG,
  enterCharon,
  leaveCharon,
  pressLaunch,
  sleepAboard,
} = require("@lifeweb/db/lib/charon");
const { hasAttribute } = require("@lifeweb/db/lib/locationAttributes");
const { INTERCOM_ROOM_SLUG, broadcastIntercom } = require("@lifeweb/db/lib/intercom");
const { INTERCOM_MODAL_PREFIX, buildIntercomModal } = require("../../lib/intercomModal");
const { buildQuestModal } = require("../../lib/questModal");
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
} = require("../../lib/turretModal");
const { BELL_ROOM_SLUG, bellCooldown, broadcastBell } = require("@lifeweb/db/lib/bell");
const { XOM_SHRINE_ROOM_SLUG, grantXom } = require("@lifeweb/db/lib/xom");
const { CASINO_ROOM_SLUG, playSlots } = require("@lifeweb/db/lib/slotMachine");
const { SLOT_PROMPT } = require("@lifeweb/db/lib/slotText");
const {
  phoneView,
  handsetView,
  answerPhone,
  dialNumber,
  hangUp,
  walkAway,
  insertObol,
} = require("@lifeweb/db/lib/phone");
const {
  PHONE_KEY_PREFIX,
  PHONE_CALL_PREFIX,
  PHONE_ANSWER_PREFIX,
  PHONE_HANGUP_PREFIX,
  PHONE_WALK_PREFIX,
  PHONE_COIN_PREFIX,
  parseKeyId,
  panelText,
  keypadRows,
} = require("@lifeweb/db/lib/phoneKeypad");
const { PHONE_TEXT } = require("@lifeweb/db/lib/phoneText");
const { SFX } = require("@lifeweb/db/lib/sfx");
const { sceneLineAt } = require("@lifeweb/db/lib/scene");
const {
  BELL_MODAL_PREFIX,
  BELL_WORD_FIELD,
  buildBellModal,
  bellWordMatches,
} = require("../../lib/bellModal");
const {
  RESIDENCES_LOCATION_SLUG,
  TURRET_ARMED_LINE,
  TURRET_DISARMED_LINE,
  gatehouseTurretArmed,
} = require("@lifeweb/db/lib/gatehouseTurret");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");
const { postMessage } = require("@lifeweb/db/lib/discordRest");
const { ack, respond, scheduleDismiss } = require("../../lib/respond");

// showModal IS the acknowledgement and must be first — every check waits for the submit, since an
// open-time check would have to be re-run there anyway.
async function handleIntercomOpen(interaction, roomId) {
  await interaction.showModal(buildIntercomModal(roomId));
}


// A quest's Interact button (QUESTS.md). Only reads the title for the modal heading; everything
// that decides whether the press is allowed waits for the submit.
async function handleQuestOpen(interaction, questId) {
  const quest = await prisma.quest.findUnique({
    where: { id: questId },
    select: { title: true, status: true },
  });
  if (!quest || quest.status !== "OPEN") {
    await respond(interaction, "That's over.");
    return;
  }
  await interaction.showModal(buildQuestModal(questId, quest.title));
}


// Every gate lives in db/lib/quests.js#questInteract, which both faces call.
async function handleQuestSubmit(interaction, questId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }

  const result = await questInteract(prisma, {
    questId,
    character,
    intention: interaction.fields.getTextInputValue(QUEST_INTENTION_FIELD),
    actorDiscordUserId: interaction.user.id,
  });
  if (!result.ok) {
    await respond(interaction, result.error);
    return;
  }
  await respond(interaction, "Your Gambit is filed. You'll hear how it went when the turn is pushed.");
}


// Opening the modal isn't the act — the typed word is — so this only checks which way the switch is thrown.
async function handleTurretOpen(interaction, roomId) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { slug: true } });
  if (room?.slug !== CENSOR_OFFICE_ROOM_SLUG) {
    await respond(interaction, "There's no button here.");
    return;
  }
  await interaction.showModal(buildTurretModal(roomId, await gatehouseTurretArmed(prisma)));
}


// The typed word is the act, not opening the modal, so only the room is checked here.
async function handleBellOpen(interaction, roomId) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { slug: true } });
  if (room?.slug !== BELL_ROOM_SLUG) {
    await respond(interaction, "There's no bell here.");
    return;
  }
  await interaction.showModal(buildBellModal(roomId));
}


// A confirm, not the bell's type-the-word modal: praying disturbs nobody, but hands a permanent
// tag that can kill you, so the friction is being told the bargain.
const PRAY_CONFIRM_PREFIX = "room:pray:go:";

// Alive, standing here, admitted through the door. Re-run at confirm too, since the ephemeral
// outlives somebody climbing back out of the Chasm.
async function prayGate(interaction, roomId) {
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) return { error: "You don't have a living character." };
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true, accessTagSlugs: true },
  });
  if (!room || room.slug !== XOM_SHRINE_ROOM_SLUG) return { error: "There's no shrine here." };
  if (character.locationId !== room.locationId) {
    return { error: `You're not standing in the ${room.name} any more.` };
  }
  const keys = await roomAccessKeys(prisma, character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    return { error: "You can't get in there." };
  }
  return { character, room };
}


async function handlePrayOpen(interaction, roomId) {
  await ack(interaction);
  const gate = await prayGate(interaction, roomId);
  if (gate.error) {
    await respond(interaction, gate.error);
    return;
  }
  await respond(interaction, {
    content:
      "The face is waiting. Praying here is permanent, it takes whatever you believed in now, " +
      "and what happens to you afterwards is not up to you.",
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PRAY_CONFIRM_PREFIX}${roomId}`)
          .setLabel("Pray")
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  });
}


async function handlePrayConfirm(interaction, roomId) {
  await ack(interaction);
  const gate = await prayGate(interaction, roomId);
  if (gate.error) {
    await respond(interaction, gate.error);
    return;
  }
  const { character, room } = gate;

  const result = await grantXom(prisma, { characterId: character.id });
  if (result.already) {
    await respond(interaction, "The face is already watching you.");
    return;
  }
  if (result.spoken) {
    await respond(interaction, "Something else has you already, and it does not share.");
    return;
  }
  if (!result.ok) {
    await respond(interaction, "Nothing answers. Tell a GM.");
    return;
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "xom_prayed",
        targetCharacterId: character.id,
        details: { characterName: character.name, room: room.name, replaced: result.replaced },
      },
    })
    .catch((err) => console.error("Pray audit log failed:", err));

  // Witnessed only within the shrine — the tag is `catalog: secret` and never announced elsewhere.
  const witnessed = `${character.name} kneels, and the face seems to lean down.`;
  // Same line, same noise as the web face's Pray button (web/app/(app)/chat/actions.js) —
  // a player praying from Discord should sound the same to whoever is reading the shrine.
  await sceneLineAt(prisma, { roomId: room.id, text: witnessed, sfx: SFX.CONVERT }).catch(() => {});
  const thread = await prisma.room
    .findUnique({ where: { id: room.id }, select: { discordThreadId: true } })
    .catch(() => null);
  if (thread?.discordThreadId) {
    await postMessage(thread.discordThreadId, ambientLine(witnessed)).catch(() => {});
  }

  await respond(
    interaction,
    result.replaced
      ? `It takes your ${result.replaced} off you and does not offer anything back.`
      : "Something old and amused turns its attention on you.",
  );
}


// The Den's slot machine. A confirm, like Pray, rather than a modal: there is
// nothing to type, and money leaving your hand deserves one press to say so.
// Every rule, every refusal and the line the room reads are in
// db/lib/slotMachine.js, so this face and Chat's cannot drift.
const SLOTS_CONFIRM_PREFIX = "room:slots:go:";

async function handleSlotsOpen(interaction, roomId) {
  await ack(interaction);
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { slug: true } });
  if (room?.slug !== CASINO_ROOM_SLUG) {
    await respond(interaction, "There's no slot machine here.");
    return;
  }
  await respond(interaction, {
    content: SLOT_PROMPT,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${SLOTS_CONFIRM_PREFIX}${roomId}`)
          .setLabel("Enter coins")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

async function handleSlotsConfirm(interaction) {
  await ack(interaction);
  // The open turn, for the ledger stamp and the ration-free audit row. Null is
  // fine — the machine runs between turns the same as during one.
  const turn = await prisma.turn
    .findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } })
    .catch(() => null);
  const result = await playSlots(prisma, interaction.user.id, { turn });
  await respond(interaction, result.ok ? result.line : result.error);
  if (result.ok) scheduleDismiss(interaction);
}

async function handleBellSubmit(interaction, roomId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true },
  });
  if (!room || room.slug !== BELL_ROOM_SLUG) {
    await respond(interaction, "There's no bell here.");
    return;
  }
  if (character.locationId !== room.locationId) { // decided at submit — reaching the rope is the only safeguard
    await respond(interaction, `You're not standing in the ${room.name} any more.`);
    return;
  }
  if (!bellWordMatches(interaction.fields.getTextInputValue(BELL_WORD_FIELD))) {
    await respond(interaction, "You leave the rope alone.");
    return;
  }

  // Cooldown read AFTER the word, so an abandoned modal never reports a wait it wasn't going to trigger.
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { bellRungAt: true } });
  const { ok, secondsLeft } = bellCooldown(state?.bellRungAt);
  if (!ok) {
    const minutes = Math.max(1, Math.ceil(secondsLeft / 60)); // minutes, not raw seconds
    await respond(
      interaction,
      `The bell is on cooldown. About ${minutes} more minute${minutes === 1 ? "" : "s"}.`,
    );
    return;
  }

  await prisma.gameState.update({ where: { id: 1 }, data: { bellRungAt: new Date() } });

  const { sent, failed } = await broadcastBell(prisma);

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "bell_rung",
        targetCharacterId: character.id,
        details: { characterName: character.name, sent, failed },
      },
    })
    .catch((err) => console.error("Bell audit log failed:", err));

  await respond(
    interaction,
    failed.length
      ? "The bell sounds."
      : "The bell sounds.",
  );
}


async function handleTurretSubmit(interaction, roomId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true },
  });
  if (!room || room.slug !== CENSOR_OFFICE_ROOM_SLUG) {
    await respond(interaction, "There's no button here.");
    return;
  }
  if (character.locationId !== room.locationId) { // decided at submit — reaching the switch is the only safeguard
    await respond(interaction, `You're not standing in the ${room.name} any more.`);
    return;
  }

  const armed = await gatehouseTurretArmed(prisma); // re-read, not trusted from the modal: two people could open it at once
  if (!turretWordMatches(interaction.fields.getTextInputValue(TURRET_WORD_FIELD), armed)) {
    await respond(interaction, "You leave the button alone.");
    return;
  }

  const next = !armed;
  await prisma.gameState.update({ where: { id: 1 }, data: { gatehouseTurretArmed: next } });

  const gatehouse = await prisma.location // the yard's only warning; best-effort, switch throws either way
    .findUnique({ where: { slug: RESIDENCES_LOCATION_SLUG }, select: { discordChannelId: true } })
    .catch(() => null);
  if (gatehouse?.discordChannelId) {
    const line = next ? TURRET_ARMED_LINE : TURRET_DISARMED_LINE;
    await postMessage(gatehouse.discordChannelId, ambientLine(line.text, [], { signed: line.signed })).catch(
      (err) => console.error("Gatehouse turret line failed:", err),
    );
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "gatehouse_turret_toggled",
        details: { armed: next, characterId: character.id, characterName: character.name },
      },
    })
    .catch((err) => console.error("Gatehouse turret audit log failed:", err));

  await respond(
    interaction,
    next
      ? "The button toggles on."
      : "The button toggles off.",
  );
}


async function handleIntercomSubmit(interaction, roomId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true },
  });
  if (!room || room.slug !== INTERCOM_ROOM_SLUG) {
    await respond(interaction, "There's no intercom here.");
    return;
  }
  if (character.locationId !== room.locationId) {
    await respond(interaction, `You're not standing in the ${room.name} any more.`);
    return;
  }

  const body = interaction.fields.getTextInputValue("intercom:body").trim();
  if (!body) {
    await respond(interaction, "Say something first.");
    return;
  }

  const voice = await loadVoiceState(character.id);
  if (voice.block) {
    await respond(interaction, `You can't get the words out — you're ${voice.block.name}.`);
    return;
  }
  const { sent, failed } = await broadcastIntercom(prisma, body); // writes its own SYSTEM row per zone (/chat + /archive)

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "intercom_broadcast",
        targetCharacterId: character.id,
        details: { body, zonesReached: sent, zonesFailed: failed },
      },
    })
    .catch((err) => console.error("Intercom audit failed:", err.message ?? err));

  const note = failed.length > 0 ? `\n-# Nothing came through in ${failed.join(", ")}.` : ""; // a partial reach isn't a failure, but say which zones missed it
  await respond(interaction, `» *Your voice goes out across Ravenheart.*${note}`, { fleeting: true });
}


// --- The telephone (docs/systemdocs/PHONES.md) ---------------------------
//
// A keypad in an ephemeral message. Pressing the room's Phone button picks the
// receiver up (and answers a named phone that is ringing) and draws the pad;
// every key press after that redraws it IN PLACE — ack({ update: true }) and
// an edit, never a second message — with the digits so far carried in each
// button's custom id (db/lib/phoneKeypad.js). The panel is not fleeting: it is
// the phone in your hand, and a keypad that deleted itself after a minute
// would drop the receiver out of sight mid-call.
//
// Picking the phone up HERE marks it held on Discord, which is what sends the
// far end's words for the holder alone to this player as a DM (db/lib/phoneVoice.js).

const BUTTON_STYLE = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary };

function keypadComponents(roomId, handset, digits) {
  return keypadRows(roomId, handset, digits).map((row) =>
    new ActionRowBuilder().addComponents(
      row.map((b) =>
        new ButtonBuilder()
          .setCustomId(b.id)
          .setLabel(b.label)
          .setStyle(BUTTON_STYLE[b.style] ?? ButtonStyle.Secondary)
          .setDisabled(Boolean(b.disabled)),
      ),
    ),
  );
}

// The whole panel for a holding view, or a plain line for anything else.
async function drawPhone(interaction, view, roomId, digits = "", line = null) {
  if (!view.ok) {
    await respond(interaction, { content: view.error, components: [] }, { fleeting: false });
    return;
  }
  if (view.mode === "held") {
    await respond(interaction, { content: PHONE_TEXT.held, components: [] });
    return;
  }
  if (view.mode === "gone") {
    await respond(interaction, { content: view.line ?? PHONE_TEXT.walkedAway, components: [] });
    return;
  }
  if (view.mode === "answer") {
    // A ringing payphone: answering takes a coin, said before it is taken.
    await respond(
      interaction,
      {
        content: `${PHONE_TEXT.stateRinging}\n-# ${PHONE_TEXT.insert}`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${PHONE_ANSWER_PREFIX}${roomId}`)
              .setLabel(PHONE_TEXT.insertCoin)
              .setStyle(ButtonStyle.Primary),
          ),
        ],
      },
      { fleeting: false },
    );
    return;
  }
  await respond(
    interaction,
    {
      content: panelText(view.handset, digits, line ?? view.line ?? null),
      components: keypadComponents(roomId, view.handset, digits),
    },
    { fleeting: false },
  );
}

// The open turn, for the ledger stamp and the audit row. Null is fine — a
// phone works between turns the same as during one.
function openTurn() {
  return prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } }).catch(() => null);
}

// The open. ack() first, always — CLAUDE.md's "Acknowledge before you work":
// picking a phone up is several queries and a write.
async function handlePhoneOpen(interaction, roomId) {
  await ack(interaction);
  const view = await phoneView(prisma, interaction.user.id, roomId, { via: "discord" });
  await drawPhone(interaction, view, roomId);
}

// A digit or ⌫: nothing is written, the pad just redraws with the new digits.
async function handlePhoneKey(interaction) {
  await ack(interaction, { update: true });
  const parsed = parseKeyId(interaction.customId, PHONE_KEY_PREFIX);
  if (!parsed) return;
  const view = await handsetView(prisma, interaction.user.id, parsed.roomId);
  await drawPhone(interaction, view, parsed.roomId, parsed.digits);
}

// Dial. A number that goes nowhere holds for a few seconds on the server while
// it rings out — safe after the ack, which is exactly why the ack comes first.
async function handlePhoneCall(interaction) {
  await ack(interaction, { update: true });
  const parsed = parseKeyId(interaction.customId, PHONE_CALL_PREFIX);
  if (!parsed) return;
  const view = await dialNumber(prisma, interaction.user.id, parsed.roomId, parsed.digits, { turn: await openTurn() });
  if (!view.ok) {
    const again = await handsetView(prisma, interaction.user.id, parsed.roomId);
    await drawPhone(interaction, again, parsed.roomId, parsed.digits, view.error);
    return;
  }
  await drawPhone(interaction, view, parsed.roomId);
}

async function handlePhoneAnswer(interaction, roomId) {
  await ack(interaction, { update: true });
  const view = await answerPhone(prisma, interaction.user.id, roomId, { via: "discord", turn: await openTurn() });
  await drawPhone(interaction, view, roomId);
}

// Hang up, walk away, another coin: one shape — do it, then redraw the pad
// (or, having walked away, say so and take the pad down).
function handsetButton(prefix, act) {
  return async (interaction) => {
    await ack(interaction, { update: true });
    const parsed = parseKeyId(interaction.customId, prefix);
    if (!parsed) return;
    const view = await act(parsed.roomId);
    if (!view.ok) {
      const again = await handsetView(prisma, interaction.user.id, parsed.roomId);
      await drawPhone(interaction, again, parsed.roomId, "", view.error);
      return;
    }
    await drawPhone(interaction, view, parsed.roomId);
  };
}

async function handlePhoneHangup(interaction) {
  return handsetButton(PHONE_HANGUP_PREFIX, (roomId) => hangUp(prisma, interaction.user.id, roomId))(interaction);
}

async function handlePhoneWalk(interaction) {
  return handsetButton(PHONE_WALK_PREFIX, (roomId) => walkAway(prisma, interaction.user.id, roomId))(interaction);
}

async function handlePhoneCoin(interaction) {
  return handsetButton(PHONE_COIN_PREFIX, async (roomId) =>
    insertObol(prisma, interaction.user.id, roomId, { turn: await openTurn() }),
  )(interaction);
}

// Custom IDs below: "loc:" is the travel flow, "conv:" the Conversation flow, "move:"/"say:" the Move/Speak modals.



// ---------------------------------------------------------------- the Charon

// The web twins of these four are in web/app/(app)/chat/actions.js, and both
// sides call the same db/lib/charon.js — so a refusal reads the same wherever
// you pressed it (docs/systemdocs/CHARON.md).
//
// Every one acks first, like every other handler that touches the database:
// doing the work first shows "The application did not respond" for something
// that already committed.

// The shared gate: a living character, standing in the Location this room hangs
// off, holding whatever key the room's own `access:` list wants. The same three
// checks prayGate makes, and for the same reason — a button is a hint, not a
// lock, and a custom_id can be replayed from anywhere.
async function charonRoomGate(interaction, roomId, slug, missing) {
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) return { error: "You don't have a living character." };
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true, accessTagSlugs: true },
  });
  if (!room || room.slug !== slug) return { error: missing };
  if (character.locationId !== room.locationId) {
    return { error: `You're not standing in the ${room.name} any more.` };
  }
  const keys = await roomAccessKeys(prisma, character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    return { error: "You can't get in there." };
  }
  return { character, room };
}

async function handleCharonEnter(interaction, roomId) {
  await ack(interaction);
  const gate = await charonRoomGate(interaction, roomId, PANIC_ROOM_SLUG, "There's no way through here.");
  if (gate.error) {
    await respond(interaction, gate.error);
    return;
  }
  const refusal = await enterCharon(prisma, gate.character);
  await respond(interaction, refusal ?? "You step aboard.");
}

async function handleCharonLeave(interaction) {
  await ack(interaction);
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }
  const here = await prisma.location.findUnique({
    where: { id: character.locationId ?? "" },
    select: { slug: true },
  });
  if (here?.slug !== CHARON_SLUG) {
    await respond(interaction, "You can't do that right now.");
    return;
  }
  const refusal = await leaveCharon(prisma, character);
  await respond(interaction, refusal ?? "You step back off.");
}

// One button, three answers — start, cancel, or refuse. The first two say what
// they did out loud into the ship's feed instead of back at the presser, which
// is why the ephemeral line here is so thin: the sentence that matters is
// already in the room, where everybody else aboard can read it too.
async function handleCharonLaunch(interaction, roomId) {
  await ack(interaction);
  const gate = await charonRoomGate(interaction, roomId, COCKPIT_SLUG, "There's no terminal here.");
  if (gate.error) {
    await respond(interaction, gate.error);
    return;
  }
  const answer = await pressLaunch(prisma, gate.character);
  await respond(interaction, answer ? answer.text : "The terminal answers.");
}

async function handleCharonSleep(interaction, roomId) {
  await ack(interaction);
  const gate = await charonRoomGate(interaction, roomId, HABITATION_SLUG, "There's nowhere to lie down here.");
  if (gate.error) {
    await respond(interaction, gate.error);
    return;
  }
  // Off the Location's own attribute rather than its slug, so the rule is the
  // same one the button was drawn from. On the ground the bunk is just a bunk.
  const here = await prisma.location.findUnique({
    where: { id: gate.character.locationId ?? "" },
    select: { attributes: true },
  });
  if (!hasAttribute(here, "offMap")) {
    await respond(interaction, "You can't do that right now.");
    return;
  }
  const slept = await sleepAboard(prisma, gate.character);
  await respond(interaction, slept ? "You lie down." : "You can't do that right now.");
}


module.exports = {
  PRAY_CONFIRM_PREFIX,
  SLOTS_CONFIRM_PREFIX,
  PHONE_KEY_PREFIX,
  PHONE_CALL_PREFIX,
  PHONE_ANSWER_PREFIX,
  PHONE_HANGUP_PREFIX,
  PHONE_WALK_PREFIX,
  PHONE_COIN_PREFIX,
  handlePhoneOpen,
  handlePhoneKey,
  handlePhoneCall,
  handlePhoneAnswer,
  handlePhoneHangup,
  handlePhoneWalk,
  handlePhoneCoin,
  handleSlotsOpen,
  handleSlotsConfirm,
  handleIntercomOpen,
  handleQuestOpen,
  handleQuestSubmit,
  handleTurretOpen,
  handleBellOpen,
  handlePrayOpen,
  handlePrayConfirm,
  handleBellSubmit,
  handleTurretSubmit,
  handleIntercomSubmit,
  handleCharonEnter,
  handleCharonLeave,
  handleCharonLaunch,
  handleCharonSleep,
};
