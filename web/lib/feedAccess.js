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

// The newest row in each place that is ABOUT this viewer. Two queries, because
// the two halves have nothing in common but the answer:
//
//   1. Every row in a conversation. Somebody opening a private thread with you
//      IS the message — there is no scenery in one.
//   2. Every row anywhere carrying this character's {char:<id>} token. That is
//      what a mention is made of on both faces (CHAT.md §5), so a ping typed
//      into Discord counts exactly as a web one does.
//
// Rows the viewer wrote are excluded from both: your own words are not news.
// A GM (no character) has neither half and gets no dots, which is right — they
// are watching, not being spoken to.
async function notableWatermarks(client, places, character) {
  const out = new Map();
  if (!character?.id) return out;

  const convKeys = places.filter((entry) => entry.kind === "conv").map((entry) => entry.placeKey);
  const allKeys = places.map((entry) => entry.placeKey);

  try {
    // The same per-place floors placesFor uses above: summaries and turn
    // channels wipe on different days, so one global floor would either hide
    // live rows in one of them or resurrect wiped ones in the other.
    // placeSeqWhere scopes placeKey itself, so it replaces the `in` clause
    // rather than sitting beside one.
    const floors = await feedWipeFloors(client);
    const base = { deletedAt: null, NOT: { characterId: character.id } };

    const [convRows, mentionRows] = await Promise.all([
      convKeys.length
        ? client.archiveEntry.groupBy({
            by: ["placeKey"],
            where: { ...base, ...placeSeqWhere(floors, convKeys) },
            _max: { seq: true },
          })
        : [],
      client.archiveEntry.groupBy({
        by: ["placeKey"],
        where: {
          ...base,
          ...placeSeqWhere(floors, allKeys),
          // Both spellings of a mention. The token carries the name it was
          // sent under now (db/lib/characterMentions.js), so the bare form
          // only ever matches a row written before that — and a bare
          // `{char:<id>` prefix would be wrong in the other direction, since
          // nothing makes one cuid a non-prefix of another.
          //
          // Under AND, not a bare OR: placeSeqWhere returns its OWN `OR` when
          // the set spans both zone summaries and turn places, and a sibling
          // `OR` key would overwrite it — dropping the place scoping entirely
          // and marking this reader notable for mentions in rooms they cannot
          // read.
          AND: [
            {
              OR: [
                { content: { contains: `{char:${character.id}}` } },
                { content: { contains: `{char:${character.id}|` } },
              ],
            },
          ],
        },
        _max: { seq: true },
      }),
    ]);

    // Largest wins where a place answers both — a mention inside a
    // conversation is one row, not two.
    for (const row of [...convRows, ...mentionRows]) {
      const seq = row._max?.seq;
      if (!row.placeKey || seq === null || seq === undefined) continue;
      const prev = out.get(row.placeKey);
      if (prev === undefined || BigInt(String(seq)) > BigInt(prev)) out.set(row.placeKey, String(seq));
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
// and /play asks again for its own load. One small indexed lookup either way,
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
