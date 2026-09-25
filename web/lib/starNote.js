import { prisma } from "@lifeweb/db";

// The columns a star copies off an ArchiveEntry.
export const STAR_ROW_SELECT = {
  seq: true,
  kind: true,
  placeKey: true,
  content: true,
  sentAt: true,
  zoneId: true,
  characterId: true,
  characterName: true,
  concealedAlias: true,
  presentedAvatarPath: true,
  discordMessageId: true,
  discordChannelId: true,
  deletedAt: true,
};

// A starred line becomes one Highlight — the same `Note` row the ⭐ reaction
// in Discord writes, so a line starred from /chat, from the day's memories on
// /memories and from Discord is one note, not three. A line with no Discord
// message behind it is filed under `seq:<seq>` (PROXYING.md §7). The CALLER
// gates who may star which row; this only writes.
export async function saveStarredRow(row, discordUserId) {
  await prisma.note.upsert({
    where: {
      discordMessageId_discordUserId: {
        discordMessageId: row.discordMessageId ?? `seq:${row.seq}`,
        discordUserId,
      },
    },
    create: {
      discordMessageId: row.discordMessageId ?? `seq:${row.seq}`,
      discordChannelId: row.discordChannelId ?? "",
      characterId: row.characterId,
      // Filed under the alias a concealed line was said as — a note revealing the real name would hand back what the hood hid.
      characterName: row.concealedAlias ?? row.characterName ?? "Bascinet",
      // Same gate, for the face.
      presentedAvatarPath: row.concealedAlias ? (row.presentedAvatarPath ?? null) : null,
      zoneId: row.zoneId ?? null,
      content: row.content,
      sentAt: row.sentAt,
      discordUserId,
    },
    update: {},
  });
}
