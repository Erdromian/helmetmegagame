import { prisma } from "@lifeweb/db";
import { feedRowShape } from "@lifeweb/db/lib/archive";
import { createLens, keptSpeaker } from "@lifeweb/db/lib/strangers";

// The columns a star copies off an ArchiveEntry. `turnNumber` is for the lens
// (a scene key), never stored.
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
  turnNumber: true,
};

// A starred line becomes one Highlight — the same `Note` row the ⭐ reaction
// in Discord writes, so a line starred from /chat, from the day's memories on
// /memories and from Discord is one note, not three. A line with no Discord
// message behind it is filed under `seq:<seq>` (PROXYING.md §7). The CALLER
// gates who may star which row; this only writes.
//
// `readerId` is the starrer's own character. The line is filed under the name
// THEY saw on it (db/lib/strangers.js#keptSpeaker): a hood's alias, a forced
// name, or — for a bare face they could not put a name to — "Young Man", never
// the real name the row holds (docs/systemdocs/STRANGERS.md §6). The ⭐ from
// Discord keeps the name the webhook posted under
// (bot/src/events/messageReactionAdd.js), which is all a Discord reader saw.
export async function saveStarredRow(row, discordUserId, readerId) {
  const [shown] = await createLens(prisma, { characterId: readerId ?? null }).all([feedRowShape(row)]);
  const speaker = keptSpeaker(row, shown);
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
      characterName: speaker.name ?? "Bascinet",
      // The face the room saw for a hood; none for a stranger. /memories draws
      // a known speaker's face from the id, and only when this name is theirs.
      presentedAvatarPath: speaker.avatarPath,
      zoneId: row.zoneId ?? null,
      content: row.content,
      sentAt: row.sentAt,
      discordUserId,
    },
    update: {},
  });
}
