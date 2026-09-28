import { cache } from "react";
import { prisma } from "@lifeweb/db";
// By path, not through the barrel: db/lib is CommonJS and this is the server half.
import { trainHere } from "@lifeweb/db/lib/train";
import { bandOf } from "@lifeweb/db/lib/mood";
import { isPlayerGhost } from "@lifeweb/db/lib/ghost";
import { CHARON_SPACE_SLUG } from "@lifeweb/db/lib/charonPlaces";
import { getGmSession } from "@/lib/discordGuild";
import { DRUG_STATE_SLUGS, drugsHeld } from "@/lib/drugHighs";

// What "in pain shock or sedated" resolves to. `pain-shock` is the document's own words and
// a real tag; SEDATED IS NOT IN THE CATALOG AT ALL, and `unconscious` is the nearest thing
// to it, so this list is a reading rather than a translation. See SOUND.md §7.
const IMPAIRED_TAGS = ["pain-shock", "unconscious"];
// "Ambience while hallucinating" — a real tag, and the document's own word.
const HALLUCINATING_TAG = "hallucinating";
// "Ambience while wearing thanati robes". WEARING, so the robes count only while equipped.
const ROBES_TAG = "black-robes";
// Being on a drug: the state tags each one leaves behind (drugHighs.js).
const LISTENER_TAGS = [...IMPAIRED_TAGS, HALLUCINATING_TAG, ROBES_TAG, ...DRUG_STATE_SLUGS];

// How long after the Charon lifts its passengers still hear it lift. "Plays immediately
// after the charon has taken off" — the phase poll is a minute, so this only has to outlast
// one poll and a tab that was asleep for a few.
const CHARON_FRESH_MS = 10 * 60 * 1000;
// The same window for a dose: long enough that the sound of taking it still reaches a tab
// that polls a minute later, or a player who took it on Discord and opens the site after.
const DRUG_FRESH_MS = 10 * 60 * 1000;

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
              where: { tag: { slug: { in: LISTENER_TAGS } } },
              select: { equipped: true, acquiredAt: true, tag: { select: { slug: true } } },
            },
            location: {
              select: {
                slug: true,
                indoors: true,
                attributes: true,
                zone: { select: { slug: true, kind: true } },
                // Id to slug for the rooms here, so a `room:<id>` Chat has open can be
                // matched against placeAmbience.js#BY_ROOM. Ordered, so an unchanged
                // answer compares equal in PhaseProvider.js#sameAnswer.
                rooms: { select: { id: true, slug: true }, orderBy: { slug: "asc" } },
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
  const phase = state?.phase ?? "CLOSED";
  const standing = standingFor(character, turn);
  if (standing && character.location.slug === CHARON_SPACE_SLUG) {
    const launch = await prisma.charonLaunch.findFirst({
      where: { launchedAt: { not: null } },
      orderBy: { launchedAt: "desc" },
      select: { launchedAt: true },
    });
    const at = launch?.launchedAt ? new Date(launch.launchedAt).getTime() : null;
    // The stamp is the launch itself, so a listener can tell one lift-off from the next.
    standing.charonLaunchedAt = at !== null && Date.now() - at < CHARON_FRESH_MS ? at : null;
  }

  // WITH NO LIVING CHARACTER the soundtrack has two more questions, and only in a running
  // game (SOUND.md §4): is this a ghost, who hears the dead rather than the lobby, and is
  // this a GM, who hears whatever place they are looking at in Chat. Both are asked only
  // here, so a living player's poll never pays for them.
  let ghost = false;
  let gm = false;
  if (!character && discordUserId && phase === "RUNNING") {
    [ghost, gm] = await Promise.all([
      isPlayerGhost(prisma, discordUserId),
      getGmSession().then((s) => s.isGm),
    ]);
  }

  return { phase, hasCharacter: Boolean(character), standing, ghost, gm };
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
    // Only the rooms at THIS Location: a room anywhere else is not one you can be reading.
    rooms: Object.fromEntries((location.rooms ?? []).map((r) => [r.id, r.slug])),
    // The BAND's tone, not the number. db/lib/mood.js already sorts the ten bands into
    // bad / warn / muted / good, which is the axis "mood is low" is asking about, and the
    // raw dial is a number no player is ever shown (MOOD.md) — it has no business crossing
    // to a browser just so the soundtrack can compare it against a threshold of its own.
    moodTone: bandOf(character.mood)?.tone ?? null,
    impaired: character.tags.some((t) => IMPAIRED_TAGS.includes(t.tag.slug)),
    hallucinating: character.tags.some((t) => t.tag.slug === HALLUCINATING_TAG),
    robed: character.tags.some((t) => t.tag.slug === ROBES_TAG && t.equipped),
    // The drugs they are on, and — only for a dose inside the last few minutes — when it
    // was taken, which is what the sound of taking it waits for (MusicDirector.js). An old
    // dose crosses as null, so a stamp nobody can act on does not churn the poll.
    drugs: drugsHeld(character.tags.map((t) => ({ slug: t.tag.slug, acquiredAt: t.acquiredAt }))).map(
      ({ id, takenAt }) => ({ id, takenAt: Date.now() - takenAt < DRUG_FRESH_MS ? takenAt : null }),
    ),
    charonLaunchedAt: null,
    trainFresh:
      trainHere(turn?.number ?? 0) &&
      started !== null &&
      Date.now() - started < TRAIN_FRESH_MS,
  };
}
