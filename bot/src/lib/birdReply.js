const { prisma } = require("@lifeweb/db");
const { sendDm } = require("@lifeweb/db/lib/dm");
const { BIRD_REPLY_PICK_PREFIX } = require("@lifeweb/db/lib/bird");
const { birdReplyWindow, sendableLetters, sendBirdReply } = require("@lifeweb/db/lib/birdReply");
const { logAudit } = require("@lifeweb/db/lib/auditLog");
const { afterInventoryChangeDb } = require("@lifeweb/db/lib/inventoryTail");
const { ack, respond } = require("./respond");

// The Reply button on a Bird's letter, and the picker it opens — Discord's
// half only. Every rule lives in db/lib/birdReply.js, shared with the web's
// Reply dialog (BIRD.md). The button sits on the recipient's own DM, but
// `/paper reply` reaches the same picker from any channel, so the acting
// character is passed to the core the way the web passes it.

const OPTION_LIMIT = 25; // Discord's cap on a string select's options

// The living character behind this account — the one the letter must be for.
async function actingCharacterId(interaction) {
  const character = await prisma.character.findFirst({
    where: { discordUserId: interaction.user.id, status: "ALIVE" },
    select: { id: true },
  });
  // A made-up id rather than null: null would skip the core's recipient check.
  return character?.id ?? "none";
}

async function handleBirdReplyOpen(interaction, birdMessageId) {
  await ack(interaction, { ephemeral: true });

  const state = await birdReplyWindow(prisma, birdMessageId, { actingCharacterId: await actingCharacterId(interaction) });
  if (!state.ok) return respond(interaction, { content: state.reason });

  const letters = sendableLetters(state.replier, { limit: OPTION_LIMIT });
  if (letters.length === 0) {
    return respond(interaction, {
      content:
        "You have nothing written to send back. Write a letter on your sheet, then answer before the bird goes.",
    });
  }

  return respond(interaction, {
    content: `The bird waits for something to carry back to **${state.message.senderName}**. It will not wait past next turn.`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${BIRD_REPLY_PICK_PREFIX}${birdMessageId}`,
            placeholder: "Which letter?",
            options: letters.map((ct) => ({
              label: ct.tag.name.slice(0, 100),
              value: ct.tagId,
              description: ct.tag.paperKind === "SEALED" ? "Sealed" : undefined,
            })),
          },
        ],
      },
    ],
  });
}

async function handleBirdReplyPick(interaction, birdMessageId) {
  await ack(interaction, { ephemeral: true });

  const tagId = interaction.values?.[0];
  if (!tagId) return respond(interaction, { content: "Nothing picked." });

  const result = await sendBirdReply(prisma, birdMessageId, tagId, {
    actingCharacterId: await actingCharacterId(interaction),
  });
  if (!result.ok) return respond(interaction, { content: result.reason });

  // The same row the web's Reply writes (character/actions/misc.js#birdReplyRequestImpl).
  await logAudit(prisma, {
    actorDiscordUserId: interaction.user.id,
    actionType: "request_bird_reply",
    details: { birdMessageId: String(birdMessageId ?? "") },
  }).catch((err) => console.error("Bird reply audit failed:", err));

  if (result.dm) { // returned rather than sent, so the web can use its own transport (ARCHITECTURE.md §5)
    await sendDm(prisma, result.dm.discordUserId, result.dm.content, result.dm.opts).catch((err) =>
      console.error(`Bird reply DM to ${result.dm.discordUserId} failed:`, err),
    );
  }
  // Both sheets: the paper left the replier's hands and landed on the sender's.
  await afterInventoryChangeDb(prisma, result.characterIds);

  return respond(interaction, { content: result.line });
}

module.exports = { handleBirdReplyOpen, handleBirdReplyPick };
