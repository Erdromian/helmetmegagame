import { cache } from "react";
import { prisma } from "@lifeweb/db";

// The two facts the soundtrack needs, and nothing else (docs/systemdocs/SOUND.md §3).
//
// It is not `GameState.phase` alone because there is no CHARACTER_CREATION phase —
// creation is what /character renders when the phase is not LOBBY and you have no living
// character (LOBBY.md §1), so the music has to ask the same pair of questions the page
// does.
//
// Deliberately NOT folded into /api/character-version: that route answers 403 "No living
// character" before it reaches its own gameState read, and every state this cares about is
// a state where it 403s.
//
// cache()d, so the root layout's call and anything else in the same request share it. Both
// reads are indexed singleton-shaped lookups /character already pays for.
export const getMusicPhase = cache(async (discordUserId) => {
  const [state, character] = await Promise.all([
    prisma.gameState.findUnique({ where: { id: 1 }, select: { phase: true } }),
    discordUserId
      ? prisma.character.findFirst({
          where: { discordUserId, status: "ALIVE" },
          select: { id: true },
        })
      : null,
  ]);
  return { phase: state?.phase ?? "CLOSED", hasCharacter: Boolean(character) };
});
