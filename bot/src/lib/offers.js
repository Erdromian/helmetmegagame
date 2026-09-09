// The Accept / Decline click on a consent DM (docs/systemdocs/LESSONS.md).
//
// The DM arrives in the responder's DMs, so guild/member are null; the
// clicker is matched to the Offer's responder by Discord user id. The
// acknowledgement is interaction.update(): the buttons come off the message
// and the outcome is written under it, so a dead button can't be clicked
// twice and the DM reads as a record afterwards.
//
// The load, the ownership check and the order of the tail now live in
// db/lib/dmAnswer.js, because the WEB answers these buttons too
// (db/lib/dmActions.js). This file keeps only what a gateway client can do
// and a REST one cannot: editing the interaction's own message, fetching a
// User to DM, and the room/carry syncs the web runs its own twin of.
const { prisma } = require("@lifeweb/db");
const { answerDmAction } = require("@lifeweb/db/lib/dmAnswer");
const { DM_ACTION, DM_CHOICE } = require("@lifeweb/db/lib/dmActions");
const { deliverCarryDrop } = require("@lifeweb/db/lib/carry");
const { syncCharacterRoomAccess } = require("@lifeweb/db/lib/roomAccess");
const { sendDm } = require("./dm");

// Strips the buttons and writes the outcome under the original text. The
// original content already carries sendDm's `»`; the outcome gets its own.
async function settle(interaction, line) {
  const original = interaction.message?.content ?? "";
  await interaction
    .update({
      content: `${original}\n» ${line}`.slice(0, 2000),
      components: [],
    })
    .catch((err) => console.error("Offer button update failed:", err));
}

async function fanOut(interaction, dms) {
  for (const dm of dms ?? []) {
    const user = await interaction.client.users
      .fetch(dm.discordUserId)
      .catch(() => null);
    if (!user) continue;
    await sendDm(user, `» ${dm.content}`).catch((err) =>
      console.error(`Offer DM to ${dm.discordUserId} failed:`, err),
    );
  }
}

// The Discord half of what the router handed back. Everything here is
// best-effort: a fresh Bound tag changes what rooms the target may stand in,
// and a failure there is the channel doctor's problem, not a reason to tell
// somebody the bind they accepted failed.
async function applySideEffects(interaction, sideEffects) {
  for (const characterId of sideEffects.roomSyncCharacterIds ?? []) {
    try {
      const row = await prisma.character.findUnique({ where: { id: characterId } });
      if (row) await syncCharacterRoomAccess(prisma, row);
    } catch (err) {
      console.error(`Post-bind room sync for ${characterId} failed:`, err);
    }
  }
  if (sideEffects.carryDrop) {
    await deliverCarryDrop(prisma, sideEffects.carryDrop).catch((err) =>
      console.error("Post-bind carry drop failed:", err),
    );
  }
  if (sideEffects.boundNotification) {
    await fanOut(interaction, [sideEffects.boundNotification]);
  }
}

async function handleOffer(interaction, offerId, choice) {
  const result = await answerDmAction(prisma, {
    action: { kind: DM_ACTION.OFFER, id: offerId },
    choice,
    discordUserId: interaction.user.id,
  });
  await settle(interaction, result.line);
  await fanOut(interaction, result.dms);
  await applySideEffects(interaction, result.sideEffects);
}

async function handleOfferAccept(interaction, offerId) {
  await handleOffer(interaction, offerId, DM_CHOICE.ACCEPT);
}

async function handleOfferDecline(interaction, offerId) {
  await handleOffer(interaction, offerId, DM_CHOICE.DECLINE);
}

module.exports = { handleOfferAccept, handleOfferDecline };
