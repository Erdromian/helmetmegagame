import "server-only";
import { prisma, placeKeyForLocation } from "@lifeweb/db";

// The one gate on the live feed: which places a character may read and write.
//
// Both /api/feed and /api/feed/say call this, and neither trusts a posted
// character id — the character is resolved from the session, the way every
// server action in this app resolves it. For the spike that is only the
// Location the character is standing in; rooms, conversations and the zone
// summary come with phase 1.

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

export function allowedPlaceKeys(character) {
  const here = placeKeyForLocation(character?.locationId);
  return here ? [here] : [];
}

export function mayReadPlace(character, placeKey) {
  return Boolean(placeKey) && allowedPlaceKeys(character).includes(placeKey);
}
