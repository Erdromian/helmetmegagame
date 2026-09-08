import { cache } from "react";
import "server-only";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";

// Who the header says you are, on the two pages whose title is a person
// rather than a page name — /character and /ledger.
//
// A separate loader from loadFeedViewer() because those two draw their header
// from a layout, and a layout cannot be handed anything by the page inside
// it. cache()d, so a route that also loads the character for its body pays
// for this once.
export const loadHeaderIdentity = cache(async () => {
  const session = await auth();
  if (!session?.discordUserId) return null;
  return prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      roleTitle: true,
      faction: { select: { id: true, name: true } },
    },
  });
});
