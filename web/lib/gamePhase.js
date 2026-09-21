import { cache } from "react";
import { prisma } from "@lifeweb/db";
// By path, not through the barrel: db/lib is CommonJS and this is the server half.
import { trainHere } from "@lifeweb/db/lib/train";

// The facts the soundtrack needs, and nothing else (docs/systemdocs/SOUND.md §3, §5).
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
// WHERE THEY ARE STANDING rides along, because the ambience bed is chosen from it
// (web/app/components/placeAmbience.js) and this is already the one query that runs on
// every page for exactly this purpose. A separate provider and a second poll would have
// been a second answer to a question already being asked once a minute.
//
// The character select widens by one join and no extra round trip. What crosses to the
// client is slugs and booleans — never the Location row, which carries descriptions and
// stash contents that the soundtrack has no business shipping to a browser.
//
// cache()d, so the root layout's call and anything else in the same request share it. Both
// reads are indexed singleton-shaped lookups /character already pays for.
export const getMusicPhase = cache(async (discordUserId) => {
  const [state, character, turn] = await Promise.all([
    prisma.gameState.findUnique({ where: { id: 1 }, select: { phase: true } }),
    discordUserId
      ? prisma.character.findFirst({
          where: { discordUserId, status: "ALIVE" },
          select: {
            id: true,
            location: {
              select: {
                slug: true,
                indoors: true,
                attributes: true,
                zone: { select: { slug: true, kind: true } },
              },
            },
          },
        })
      : null,
    prisma.turn.findFirst({
      where: { status: "OPEN" },
      select: { number: true, startedAt: true },
    }),
  ]);
  return {
    phase: state?.phase ?? "CLOSED",
    hasCharacter: Boolean(character),
    standing: standingFor(character, turn),
  };
});

// How long after a turn opens the train still counts as having just pulled in. It rolls
// in at the CLOSE of the turn before, so the platform noise belongs to the top of this
// one (db/lib/train.js, docs/systemdocs/DEPOT.md §0d) — and it has to stop, or "the train
// is in" stops meaning anything and becomes the Depot's permanent room tone.
const TRAIN_FRESH_MS = 60 * 60 * 1000;

function standingFor(character, turn) {
  const location = character?.location;
  if (!location) return null;
  const started = turn?.startedAt ? new Date(turn.startedAt).getTime() : null;
  return {
    locationSlug: location.slug,
    zoneSlug: location.zone?.slug ?? null,
    zoneKind: location.zone?.kind ?? null,
    indoors: Boolean(location.indoors),
    // Just the keys. The values in Location.attributes are all `true` where present
    // (db/lib/locationAttributes.js), and a bare list is what the ambience table matches
    // against.
    attributes: location.attributes ? Object.keys(location.attributes) : [],
    trainFresh:
      trainHere(turn?.number ?? 0) &&
      started !== null &&
      Date.now() - started < TRAIN_FRESH_MS,
  };
}
