import { cache } from "react";
import "server-only";
import { prisma } from "@lifeweb/db";
import { placesFor as placesForCharacter, findPlace, mayReadPlace, mayWritePlace } from "@lifeweb/db/lib/feedAccess";
import { feedWipeFloors, placeSeqWhere } from "@lifeweb/db/lib/feedWipe";
import { getGmSession } from "@/lib/discordGuild";

// The web's half of the feed gate. The rules live in db/lib/feedAccess.js,
// because db/lib/say.js has to ask the same question the SSE route asks and a
// gate up here could only ever answer for one face. What is left is the
// viewer load, which is web-shaped: the session says who is asking, and
// nothing here ever trusts a posted character id.

export { findPlace, mayReadPlace, mayWritePlace };

// placesFor plus the two numbers the page needs and the access rules have no
// business knowing. Both come back as STRINGS, because seq is a bigint column
// and JSON has no such thing.
//
//   newestSeq   the newest thing said in each place, whatever it was
//   notableSeq  the newest thing said there that is ABOUT this viewer
//
// The dot draws off `notableSeq`, not `newestSeq`. Any-row-is-unread meant a
// place lit up for scenery — somebody picking a stamp up off a table — so the
// dot stopped meaning anything and got ignored, which is the whole failure of
// an unread mark. Notable is the same rule the chime already used (CHAT.md
// §5): a row carrying this character's {char:…} token, or any row at all in a
// conversation, and in both cases not one they wrote themselves.
//
// `newestSeq` is still sent: Chat.js seeds the read marks from it, so a
// browser opening Chat for the first time starts level rather than
// claiming every place is unread.
export async function placesFor(client, character, options) {
  const places = await placesForCharacter(client, character, options);
  if (places.length === 0) return places;

  const newest = new Map();
  try {
    // Above each place's own watermark (db/lib/feedWipe.js). That is what
    // makes the unread dots reset with the wipe on their own: after it there is
    // no newest seq in a place until somebody speaks there again, so nothing is
    // left for the browser's `hall:seen:<placeKey>` to be behind. The list
    // mixes zone summaries with Locations and Rooms, and those two clear on
    // different days now, so the floors have to be applied per place.
    const floors = await feedWipeFloors(client);
    const grouped = await client.archiveEntry.groupBy({
      by: ["placeKey"],
      where: {
        ...placeSeqWhere(floors, places.map((entry) => entry.placeKey)),
        deletedAt: null,
      },
      _max: { seq: true },
    });
    for (const row of grouped) {
      if (row.placeKey && row._max?.seq !== null && row._max?.seq !== undefined) {
        newest.set(row.placeKey, String(row._max.seq));
      }
    }
  } catch (err) {
    // A missing dot is a cosmetic loss; a place list that failed to load is
    // not. Never let the count take the column down with it.
    console.error("Feed place watermarks failed:", err);
  }

  const notable = await notableWatermarks(client, places, character);

  return places.map((entry) => ({
    ...entry,
    newestSeq: newest.get(entry.placeKey) ?? null,
    notableSeq: notable.get(entry.placeKey) ?? null,
  }));
}

// The newest row in each place where SOMEBODY SPOKE — the seed for the unread
// mark in the places column.
//
// One query, and two conditions in it: the row is not the viewer's own, and
// its source is not SYSTEM.
//
// This used to be two queries for a much narrower question — rows in a
// conversation, and rows carrying the viewer's {char:…} token — with the note
// that a GM has neither and so gets no marks, "which is right, they are
// watching, not being spoken to". In practice that left the one person
// reading every channel with nothing to read them by, and had them opening a
// hundred places in turn to find out where a scene was. Speech subsumes both
// old arms: a conversation row is a person speaking, and so is a mention.
//
// Works with no character, which is the whole point — a GM in Chat is in GM
// mode BECAUSE they have none (web/lib/feedAccess.js#loadFeedViewer).
async function notableWatermarks(client, places, character) {
  const out = new Map();
  const allKeys = places.map((entry) => entry.placeKey);
  if (allKeys.length === 0) return out;

  try {
    // The same per-place floors placesFor uses above: summaries and turn
    // channels wipe on different days, so one global floor would either hide
    // live rows in one of them or resurrect wiped ones in the other.
    // placeSeqWhere scopes placeKey itself, so it replaces the `in` clause
    // rather than sitting beside one.
    const floors = await feedWipeFloors(client);

    // Your own words are not news. Spelled with the null arm rather than as a
    // bare `NOT`, because a comparison never matches a NULL column — and a
    // proxied row that never resolved to a character carries no characterId,
    // so `NOT: { characterId: me }` would silently drop exactly the rows a
    // watcher most wants to see.
    const notMine = character?.id
      ? { OR: [{ characterId: null }, { characterId: { not: character.id } }] }
      : {};

    const rows = await client.archiveEntry.groupBy({
      by: ["placeKey"],
      where: {
        deletedAt: null,
        // SYSTEM is the game talking to itself — a gate crossing, a smell, a
        // turn banner. Lighting a channel for those is what made the old mark
        // stop meaning anything, and it is the one thing held back now that
        // the rule is otherwise "somebody spoke".
        source: { not: "SYSTEM" },
        ...notMine,
        ...placeSeqWhere(floors, allKeys),
      },
      _max: { seq: true },
    });

    for (const row of rows) {
      const seq = row._max?.seq;
      if (!row.placeKey || seq === null || seq === undefined) continue;
      out.set(row.placeKey, String(seq));
    }
  } catch (err) {
    // Same posture as the watermarks above: a missing dot is cosmetic, a
    // column that failed to load is not.
    console.error("Feed notable watermarks failed:", err);
  }

  return out;
}

export async function loadFeedCharacter(discordUserId) {
  if (!discordUserId) return null;
  return prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      concealed: true,
      age: true,
      gender: true,
      updatedAt: true,
      locationId: true,
      // The chip in the places column (docs/systemdocs/CHAT.md §6).
      webOnly: true,
      location: {
        select: { id: true, name: true, description: true, indoors: true, zone: { select: { id: true, name: true, description: true } } },
      },
    },
  });
}

// Who is looking, and on what terms. A GM with no living character still gets
// a Chat — a read-only one over the zones their GmZoneView allows — and a GM
// who DOES have a living character plays it as that character, because the
// alternative is a GM who cannot use their own sheet.
//
// `options` is what every db/lib/feedAccess.js call needs: `{ gm, discordUserId }`.
// cache()d because every page's header asks for it now (AppHeader -> TurnMeta)
// and /chat asks again for its own load. One small indexed lookup either way,
// but there is no reason for a page to run it twice in a request.
export const loadFeedViewer = cache(async () => {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) return { discordUserId: null, character: null, gm: false, options: null };

  const character = await loadFeedCharacter(session.discordUserId);
  const gm = Boolean(isGm) && !character;
  return {
    discordUserId: session.discordUserId,
    character,
    gm,
    options: { gm, discordUserId: session.discordUserId },
  };
});
