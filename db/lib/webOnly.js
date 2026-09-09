// "Play from the web" — the switch on the Bio card that takes a player's
// DISCORD ACCOUNT out of the game entirely while leaving the character exactly
// where they stand. See docs/systemdocs/CHAT.md §6.
//
// The problem it solves is in CHAT.md §1: a Discord channel lists every
// account that can see it, and a Location channel is opened with a per-member
// overwrite, so standing in the Keep tells everybody else in the Keep which
// Discord account you are. Nothing short of not being there fixes it.
//
// ON strips the Location overwrite, the zone role (and with it #turns, whose
// view grants ride the zone roles — db/lib/turnsChannelAccess.js), every
// narrowcast overwrite, every private-Room thread and every Conversation
// thread. OFF puts all of it back. What survives either way: DMs, the OOC
// report channel (role-based, not per-character), RoomGuest rows,
// PlayerThreadMember rows, and the fiction — they still stand there and still
// appear in Who's here?.
//
// THE TURN-PING ROLE GOES TOO, and used to be on that list. The argument for
// keeping it was that a turn ping is a DM rather than a channel, and that was
// simply wrong: the ping is a <@&role> inside the #turns console
// (db/turnCalendar.js), a channel this switch has just closed to them. So a
// web-only player was pinged twice a day about a message they could not open,
// and the console is deleted and reposted every turn, so by the time they
// looked there was nothing there at all. A player reported it as ghost pings.
//
// That role is NOT taken off here, and deliberately: this function's only
// caller already writes it on the very next line (web/app/(app)/character/
// actions.js), because it has to handle the case this function never sees —
// somebody already web-only who just ticks the turn-ping box. Doing it in both
// places was two identical REST calls per flip. The channel doctor's
// `turn-ping` reconcile is the backstop for everybody else.
//
// THE ORDER MATTERS. The database flip lands FIRST, inside the cooldown guard,
// and every Discord call after it is best-effort. A failed REST call must never
// un-flip the switch: the flag is what every re-materialiser reads, so a
// half-applied ON that stays ON is repaired by the channel doctor's next pass,
// while one that rolled back would leave the player believing they were hidden
// when they were not.
//
// Takes `prisma` as its first parameter (the db/lib/dm.js convention) and is
// deliberately NOT on the @lifeweb/db barrel; require it by path.

const { revokeAllCharacterAccess } = require("./accessSweep");
const { removeThreadMember, setGuildNickname } = require("./discordRest");
const { materializeDiscordPresence } = require("./locationMove");
const { conversationsFor } = require("./conversations");
const { notifyPresence } = require("./presenceNotify");

// How long a character waits between two flips of the "web only" switch.
// Each flip is a burst of Discord writes — every overwrite, every role, every
// thread — so the cooldown is hours, not seconds. Two of them. This used to be
// a GameConfig column nothing ever wrote; the constant IS the setting.
const WEB_ONLY_COOLDOWN_SECONDS = 7200;

// Every thread this account is in as a player: the private Rooms their keys
// opened (recorded in Character.roomThreadRoomIds) and the Conversations they
// are a member of. Discord's own list is not read — the columns and the rows
// ARE the record, which is the whole point of db/lib/conversations.js.
async function shedThreads(prisma, character) {
  const discordUserId = character.discordUserId;
  if (!discordUserId) return;

  const roomIds = character.roomThreadRoomIds ?? [];
  if (roomIds.length > 0) {
    const rooms = await prisma.room
      .findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true, discordThreadId: true } })
      .catch(() => []);
    for (const room of rooms) {
      if (!room.discordThreadId) continue;
      await removeThreadMember(room.discordThreadId, discordUserId).catch((err) =>
        console.error(`Web-only on: failed to drop ${character.id} from room "${room.name}":`, err.message ?? err),
      );
    }
    // Cleared whatever Discord answered. The column is what syncCharacterRoomAccess
    // diffs against, and with the flag on it computes an empty entitlement, so a
    // stale id here would make every one of those rooms un-removable later.
    await prisma.character
      .update({ where: { id: character.id }, data: { roomThreadRoomIds: [] } })
      .catch((err) => console.error(`Web-only on: room record clear failed for ${character.id}:`, err.message ?? err));
  }

  // Conversations everywhere, not just where they stand: the account is
  // leaving Discord altogether, so a thread hanging off a Location they walked
  // out of yesterday still has their name in its member list.
  const conversations = await conversationsFor(prisma, character.id).catch(() => []);
  for (const conversation of conversations) {
    await removeThreadMember(conversation.threadId, discordUserId).catch((err) =>
      console.error(
        `Web-only on: failed to drop ${character.id} from conversation ${conversation.threadId}:`,
        err.message ?? err,
      ),
    );
  }
}

// Flip the switch. Returns { ok: true } or { ok: false, error, readyAt } —
// `readyAt` is a Date, so the caller words the refusal in the reader's own
// clock rather than this one's.
async function setWebOnly(prisma, character, on) {
  if (!character?.id) return { ok: false, error: "No character.", readyAt: null };
  const want = Boolean(on);

  const cooldownMs = WEB_ONLY_COOLDOWN_SECONDS * 1000;

  const now = new Date();
  const cutoff = new Date(now.getTime() - cooldownMs);

  // The DB half first, and as ONE conditional update — the same shape the
  // Location-move cooldown uses (db/lib/locationTravel.js), so two clicks in
  // one tick cannot both pass. `webOnly: !want` in the WHERE makes a repeat of
  // the state you are already in a no-op rather than a wasted cooldown.
  const claimed = await prisma.character.updateMany({
    where: {
      id: character.id,
      webOnly: !want,
      OR: [{ webOnlyChangedAt: null }, { webOnlyChangedAt: { lte: cutoff } }],
    },
    data: { webOnly: want, webOnlyChangedAt: now },
  });

  if (claimed.count === 0) {
    const row = await prisma.character.findUnique({
      where: { id: character.id },
      select: { webOnly: true, webOnlyChangedAt: true },
    });
    // Already there: nothing to do and nothing to refuse.
    if (Boolean(row?.webOnly) === want) return { ok: true };
    const readyAt = new Date((row?.webOnlyChangedAt?.getTime() ?? now.getTime()) + cooldownMs);
    const minutes = Math.max(1, Math.round((now.getTime() - (row?.webOnlyChangedAt?.getTime() ?? 0)) / 60000));
    // The sentence is built here so a caller with no clock of its own has one;
    // the web re-words it through its own time helper so the hour lands in the
    // reader's locale rather than the server's.
    const clock = readyAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return {
      ok: false,
      error: `You switched ${minutes} minutes ago. You can switch again at ${clock}. ‡`,
      minutes,
      readyAt,
    };
  }

  // Everything below is Discord, and every call is wrapped. A failure here
  // leaves the flag as the player set it and the doctor repairs the rest.
  const row = await prisma.character
    .findUnique({
      where: { id: character.id },
      select: {
        id: true,
        name: true,
        status: true,
        discordUserId: true,
        discordRoleId: true,
        locationId: true,
        zoneId: true,
        webOnly: true,
        roomThreadRoomIds: true,
      },
    })
    .catch(() => null);

  if (row?.discordUserId && process.env.DISCORD_TOKEN) {
    try {
      if (want) {
        // keepGuests: a RoomGuest row is game state, not Discord state.
        // Somebody let them into that room and they are still standing in it;
        // the row is what the web feed reads to show it to them.
        await revokeAllCharacterAccess(prisma, row, { keepGuests: true });
        // The nickname is the loudest leak of all — `player | Cersei` on the
        // member list of the OOC report channel, which they are still in. Cleared,
        // not merely no longer synced (bot/src/lib/nickname.js skips them from now
        // on, so nothing puts it back).
        await setGuildNickname(row.discordUserId, null).catch((err) =>
          console.error(`web only: couldn't clear the nickname for ${row.discordUserId}:`, err.message ?? err),
        );
        await shedThreads(prisma, row);
      } else {
        await materializeDiscordPresence(prisma, row);
      }
    } catch (err) {
      console.error(`Web-only ${want ? "on" : "off"} for ${row.name ?? row.id} left work undone:`, err.message ?? err);
    }
  }

  // The set of places is unchanged either way — the flag is about Discord, not
  // about what /chat may read — but the chip in the places column is not, and
  // an open tab should not have to be reloaded to lose it.
  await notifyPresence(prisma, character.id).catch(() => {});

  return { ok: true };
}

module.exports = { setWebOnly };
