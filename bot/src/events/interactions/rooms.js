// Room-anchor interaction handlers: the Intercom, Quest interact, the
// Watchtower turret, the Bell Tower, Prayer at the Shrine of an Old Man, the
// Den's slot machine and the telephones — each one's open (button/select) and
// submit (modal, or confirm button) pair.
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
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
const { phoneView, placeCall, answerCall, hangUp } = require("@lifeweb/db/lib/phone");
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
// Three custom ids for one button, because Discord needs a distinct id per
// control but the PLAYER only ever sees one Phone button. Which of the three
// they get is db/lib/phone.js#phoneView's answer, re-read on every press:
// dialling, answering, or putting the receiver down.
const PHONE_DIAL_PREFIX = "room:phone:dial:";
const PHONE_ANSWER_PREFIX = "room:phone:answer:";
const PHONE_HANGUP_PREFIX = "room:phone:hangup:";

// The open. ack() first, always — CLAUDE.md's "Acknowledge before you work":
// phoneView hits the database four or five times, and doing that ahead of the
// acknowledgement is how a player is shown "The application did not respond"
// for a call that has already started ringing.
async function handlePhoneOpen(interaction, roomId) {
  await ack(interaction);
  const view = await phoneView(prisma, interaction.user.id, roomId);
  if (!view.ok) {
    await respond(interaction, view.error);
    return;
  }

  if (view.mode === "held") {
    await respond(interaction, PHONE_TEXT.held);
    return;
  }

  if (view.mode === "hangup") {
    await respond(interaction, {
      content: PHONE_TEXT.dialling,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${PHONE_HANGUP_PREFIX}${roomId}`)
            .setLabel("Hang up")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    return;
  }

  if (view.mode === "answer") {
    await respond(interaction, {
      content: PHONE_TEXT.ringing,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${PHONE_ANSWER_PREFIX}${roomId}`)
            .setLabel("Answer")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    return;
  }

  if (view.phones.length === 0) {
    await respond(interaction, PHONE_TEXT.noneToCall);
    return;
  }

  // No tooltip and no description on any option: the list of phones IS the
  // explanation, and a line of help under each one would be thirteen lines of
  // it. Discord caps a select at 25 options and the exchange is nowhere near.
  //
  // The payphone's price is the ONE line of guidance here, and it goes in the
  // message above the control rather than on an option — `-#` subtext, the
  // Move declaration's shape (CLAUDE.md, "Bot message style").
  const prompt = view.room.payphone && !view.paid ? `${PHONE_TEXT.pick}\n-# ${PHONE_TEXT.insert}` : PHONE_TEXT.pick;
  await respond(interaction, {
    content: prompt,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PHONE_DIAL_PREFIX}${roomId}`)
          .setPlaceholder(PHONE_TEXT.pick)
          .addOptions(view.phones.slice(0, 25).map((p) => ({ label: p.phone, value: p.id }))),
      ),
    ],
  });
}

async function handlePhoneDial(interaction, roomId) {
  await ack(interaction);
  const toRoomId = interaction.values?.[0];
  if (!toRoomId) {
    await respond(interaction, "Pick a phone.");
    return;
  }
  // The open turn, for the ledger stamp and the audit row. Null is fine — a
  // phone works between turns the same as during one.
  const turn = await prisma.turn
    .findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } })
    .catch(() => null);
  const result = await placeCall(prisma, interaction.user.id, { fromRoomId: roomId, toRoomId, turn });
  await respond(interaction, result.ok ? PHONE_TEXT.dialling : result.error);
}

async function handlePhoneAnswer(interaction, roomId) {
  await ack(interaction);
  const result = await answerCall(prisma, interaction.user.id, roomId);
  await respond(interaction, result.ok ? PHONE_TEXT.pickedUp : result.error);
}

async function handlePhoneHangup(interaction, roomId) {
  await ack(interaction);
  const result = await hangUp(prisma, interaction.user.id, roomId);
  await respond(interaction, result.ok ? "You put the receiver down." : result.error);
}

// Custom IDs below: "loc:" is the travel flow, "conv:" the Conversation flow, "move:"/"say:" the Move/Speak modals.


module.exports = {
  PRAY_CONFIRM_PREFIX,
  SLOTS_CONFIRM_PREFIX,
  PHONE_DIAL_PREFIX,
  PHONE_ANSWER_PREFIX,
  PHONE_HANGUP_PREFIX,
  handlePhoneOpen,
  handlePhoneDial,
  handlePhoneAnswer,
  handlePhoneHangup,
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
};
