const { sendDm } = require("../../dm");
const { DM_KIND } = require("../../dmKinds");
const { syncCharacterRoomAccess } = require("../../roomAccess");
const { notifyPresence } = require("../../presenceNotify");

// A GM's staged "let in" (ADJUDICATION.md §1). The push wrote the RoomGuest
// row; this is the half /add does straight after it. The thread add goes
// through the ordinary recompute rather than a bare addThreadMember, so the
// membership is recorded and the next move can take it away again.
async function applyRoomEntries({ prisma, p, list, step }) {
  const entries = [...list(p.roomEntries)];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    await step(`roomEntry:${i}`, async () => {
      const character = await prisma.character.findUnique({
        where: { id: entry.characterId },
        select: { id: true, status: true, locationId: true, discordUserId: true },
      });
      if (!character) return;
      await syncCharacterRoomAccess(prisma, character).catch((err) =>
        console.error(`Room entry sync failed for ${entry.characterId}:`, err),
      );
      // Their own Chat has to hear the door opened, Discord or not.
      await notifyPresence(prisma, character.id).catch(() => {});

      // The same letter /add sends: where, never who opened it.
      if (character.discordUserId) {
        const where = entry.locationName ? `${entry.locationName} · ${entry.roomName}` : entry.roomName;
        await sendDm(prisma, character.discordUserId, `*You were let into ${where}.*`, {
          kind: DM_KIND.QUIET,
        }).catch((err) => console.error(`Room entry DM to ${character.discordUserId} failed:`, err));
      }
    });
  }
}

module.exports = { applyRoomEntries };
