import "server-only";
import { prisma } from "@lifeweb/db";
import { placesFor as placesForCharacter, findPlace, mayReadPlace, mayWritePlace } from "@lifeweb/db/lib/feedAccess";
import { getGmSession } from "@/lib/discordGuild";

// The web's half of the feed gate. The rules live in db/lib/feedAccess.js,
// because db/lib/say.js has to ask the same question the SSE route asks and a
// gate up here could only ever answer for one face. What is left is the
// viewer load, which is web-shaped: the session says who is asking, and
// nothing here ever trusts a posted character id.

export { findPlace, mayReadPlace, mayWritePlace };

// placesFor plus the one number the page needs and the access rules have no
// business knowing: the newest seq said in each place. That is what draws an
// unread dot — the browser compares it against the last seq it saw there,
// kept in localStorage — and it comes back as a STRING, because the column is
// a bigint and JSON has no such thing.
export async function placesFor(client, character, options) {
  const places = await placesForCharacter(client, character, options);
  if (places.length === 0) return places;

  const newest = new Map();
  try {
    const grouped = await client.archiveEntry.groupBy({
      by: ["placeKey"],
      where: { placeKey: { in: places.map((entry) => entry.placeKey) }, deletedAt: null },
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

  return places.map((entry) => ({ ...entry, newestSeq: newest.get(entry.placeKey) ?? null }));
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
      // The chip in the places column (docs/systemdocs/HALL.md §6).
      webOnly: true,
      location: {
        select: { id: true, name: true, description: true, zone: { select: { id: true, name: true } } },
      },
    },
  });
}

// Who is looking, and on what terms. A GM with no living character still gets
// a Hall — a read-only one over the zones their GmZoneView allows — and a GM
// who DOES have a living character plays it as that character, because the
// alternative is a GM who cannot use their own sheet.
//
// `options` is what every db/lib/feedAccess.js call needs: `{ gm, discordUserId }`.
export async function loadFeedViewer() {
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
}
