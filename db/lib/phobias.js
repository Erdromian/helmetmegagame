// Phobias (docs/systemdocs/TAGS.md): a phobia doesn't act on its own, it
// sustains a mood tag — afraid or panic — for as long as the character
// stands somewhere that triggers it. Settled on every Move
// (db/lib/locationMove.js) and swept turn-to-turn by phobiaPass.js as the
// safety net for anyone who didn't just move (a phobia granted mid-turn by a
// GM, a zone that changed under them some other way).
//
// One row per rule: (phobia slug) -> which mood it wants, and under what
// condition. Adding a phobia later is one more row here, nothing else.
//
// settlePhobias opens its own $transaction, so it must be called with the
// singleton prisma client, not a `tx` already inside one.
const { dropCharacterTag } = require("./tagWrites");
const {
  AFRAID_SLUG,
  PANIC_SLUG,
  CLAUSTROPHOBIA_SLUG,
  ACROPHOBIA_SLUG,
} = require("./constants");

const HILLS_ZONE_SLUG = "hills";
const MOUNTAIN_LOCATION_SLUG = "hills-mountain";

// Each rule reads only { location, zone } (zone = location.zone) and returns
// the mood slug it wants right now, or null if it doesn't apply.
const PHOBIA_RULES = [
  {
    phobiaSlug: CLAUSTROPHOBIA_SLUG,
    wants: ({ zone }) => (zone?.kind === "CAVE_LEVEL" ? AFRAID_SLUG : null),
  },
  {
    phobiaSlug: ACROPHOBIA_SLUG,
    wants: ({ location, zone }) => {
      if (location?.slug === MOUNTAIN_LOCATION_SLUG) return PANIC_SLUG;
      if (zone?.slug === HILLS_ZONE_SLUG) return AFRAID_SLUG;
      return null;
    },
  },
];

const MOOD_SLUGS = [AFRAID_SLUG, PANIC_SLUG];

let warnedMissingTag = false;

// Settles one character's phobia-driven moods against where they stand right
// now. Returns { characterId, granted, removed } or null if nothing changed.
// A character that isn't ALIVE wants nothing, so this still runs to clean up
// any CONDITION row left on a corpse — a dead character isn't afraid of the
// dark — it just never grants a new one.
async function settlePhobias(prisma, characterId) {
  return prisma.$transaction(async (tx) => {
    const character = await tx.character.findUnique({
      where: { id: characterId },
      select: {
        id: true,
        status: true,
        locationId: true,
        location: {
          select: {
            slug: true,
            zone: { select: { slug: true, kind: true } },
          },
        },
        tags: {
          where: {
            tag: {
              slug: {
                in: [
                  CLAUSTROPHOBIA_SLUG,
                  ACROPHOBIA_SLUG,
                  AFRAID_SLUG,
                  PANIC_SLUG,
                ],
              },
            },
          },
          select: {
            tagId: true,
            source: true,
            expiresTurn: true,
            tag: { select: { slug: true } },
          },
        },
      },
    });
    if (!character) return null;

    const held = new Set(character.tags.map((ct) => ct.tag.slug));
    const ctx = { location: character.location, zone: character.location?.zone };

    // A corpse or a Catatonic character stands nowhere a phobia can trigger,
    // so `wanted` comes back empty for them and every CONDITION row below
    // gets swept — the settle's cleanup half still has to run.
    const wanted =
      character.status === "ALIVE"
        ? new Set(
            PHOBIA_RULES.filter((rule) => held.has(rule.phobiaSlug))
              .map((rule) => rule.wants(ctx))
              .filter(Boolean),
          )
        : new Set();

    // A "condition" mood row is one this settle owns: an afraid/panic
    // CharacterTag with source === "CONDITION". Every other row on these
    // slugs — a GM grant (timed or "never"), a consume — is a person's grant
    // and this settle never touches it: when it expires the sweep removes
    // it, and this settle (which runs on every Move, and again in the pass
    // after the sweep at turn close) puts the phobia's own row back in.
    const conditionBySlug = new Map(
      character.tags
        .filter((ct) => MOOD_SLUGS.includes(ct.tag.slug) && ct.source === "CONDITION")
        .map((ct) => [ct.tag.slug, ct]),
    );
    const grantedBySlug = new Map(
      character.tags
        .filter((ct) => MOOD_SLUGS.includes(ct.tag.slug) && ct.source !== "CONDITION")
        .map((ct) => [ct.tag.slug, ct]),
    );

    const granted = [];
    const removed = [];

    for (const slug of wanted) {
      if (conditionBySlug.has(slug)) continue;
      // A person's grant on this slug is already covering the mood — leave
      // it entirely alone rather than rewriting its expiry.
      if (grantedBySlug.has(slug)) continue;
      const tag = await tx.tag.findUnique({ where: { slug }, select: { id: true } });
      if (!tag) {
        if (!warnedMissingTag) {
          warnedMissingTag = true;
          console.error(`settlePhobias: no "${slug}" tag — run npm run db:sync-tags. Phobias won't bite.`);
        }
        continue;
      }
      await tx.characterTag.create({
        data: { characterId, tagId: tag.id, source: "CONDITION", quantity: 1, expiresTurn: null },
      });
      granted.push(slug);
    }

    for (const [slug, ct] of conditionBySlug) {
      if (!wanted.has(slug)) {
        await dropCharacterTag(tx, characterId, ct.tagId);
        removed.push(slug);
      }
    }

    if (!granted.length && !removed.length) return null;
    return { characterId, granted, removed };
  });
}

module.exports = { settlePhobias };
