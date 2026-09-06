import "server-only";
import { prisma } from "@lifeweb/db";
import { allowedPlaceKeys, mayReadPlace, mayWritePlace } from "@lifeweb/db/lib/feedAccess";

// The web's half of the feed gate. The rules moved down to
// db/lib/feedAccess.js in phase 1, because db/lib/say.js has to ask the same
// question the SSE route asks and a gate living up here could only ever
// answer for one face. What is left is the character load, which is web-shaped
// (it is the row /play and the two routes render from).
//
// Neither route trusts a posted character id: the character is resolved from
// the session, the way every server action in this app resolves it.

export { allowedPlaceKeys, mayReadPlace, mayWritePlace };

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
      location: { select: { id: true, name: true, description: true } },
    },
  });
}
