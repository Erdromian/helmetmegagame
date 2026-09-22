import { cache } from "react";
import { prisma } from "@lifeweb/db";
// By path, not through the barrel: db/lib is CommonJS and this is the server half.
import { trainHere } from "@lifeweb/db/lib/train";
import { bandOf } from "@lifeweb/db/lib/mood";

// What "in pain shock or sedated" resolves to. `pain-shock` is the document's own words and
// a real tag; SEDATED IS NOT IN THE CATALOG AT ALL, and `unconscious` is the nearest thing
// to it, so this list is a reading rather than a translation. See SOUND.md §7.
const IMPAIRED_TAGS = ["pain-shock", "unconscious"];

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
            // Some ambience is about the LISTENER rather than the room — "Ambience in town
            // when character mood is low", "Ambience while in pain shock or sedated". Mood
            // is a scalar on the row already being read, so it is free; the tags cost one
            // narrow join, filtered in the query rather than fetched and scanned.
            mood: true,
            tags: {
              where: { tag: { slug: { in: IMPAIRED_TAGS } } },
              select: { tagId: true },
              take: 1,
            },
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
    // The BAND's tone, not the number. db/lib/mood.js already sorts the ten bands into
    // bad / warn / muted / good, which is the axis "mood is low" is asking about, and the
    // raw dial is a number no player is ever shown (MOOD.md) — it has no business crossing
    // to a browser just so the soundtrack can compare it against a threshold of its own.
    moodTone: bandOf(character.mood)?.tone ?? null,
    impaired: character.tags.length > 0,
    trainFresh:
      trainHere(turn?.number ?? 0) &&
      started !== null &&
      Date.now() - started < TRAIN_FRESH_MS,
  };
}
