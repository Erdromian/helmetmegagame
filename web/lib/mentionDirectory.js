import { prisma } from "@lifeweb/db";
import { UNBURIED_BODY_WHERE } from "@lifeweb/db/lib/presence";
import {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
  letterPlaqueFile,
} from "@lifeweb/db/lib/presentedIdentity";
import { knownSubjects } from "@lifeweb/db/lib/strangers";
import { disguiseNameFrom } from "@lifeweb/db/lib/disguises";

// Two lists off one query: who a `{char:<id>}` token may RESOLVE to (everybody, kept LIVE), and who the @ menu
// may OFFER (narrower, hides a hooded/disguised character). A token carries the name it was sent under
// (db/lib/say.js#stampMentionNames); messageTokens.js draws a face only while this list still calls that
// person by that same name AND says they are not hidden (PROXYING.md §5a). `includeUnburiedDead` is /notes'
// roster (CHARACTERS.md §5).
//
// `viewerId` is who will read the list. Somebody they have no Friends entry for
// keeps their name (a name is what a mention is) but not their portrait: it is
// swapped for the letter plaque of that same name. A stranger's face reaches
// the page elsewhere, by token or by line (docs/systemdocs/STRANGERS.md §2), and
// a portrait here beside the name would let the page match the two.
export async function loadMentionDirectory({ includeUnburiedDead = false, viewerId = null } = {}) {
  return loadMentions({ includeUnburiedDead, viewerId });
}

// presentedIdentity() decides the hide, so the forced/concealed precedence order has one copy.
export async function loadOfferableMentions({ includeUnburiedDead = false, viewerId = null } = {}) {
  const all = await loadMentions({ includeUnburiedDead, viewerId });
  return all.filter((c) => !c.hidden);
}

// The shared read. `name` is the REAL name on purpose — the frozen-name gate in messageTokens.js compares
// against it, and a token with no frozen half falls back to it. The FACE is the presented one, because
// /api/avatar is identity-blind and a chip must never be the one surface that forgets a hood.
async function loadMentions({ includeUnburiedDead, viewerId = null }) {
  const characters = await prisma.character.findMany({
    where: livingWhere(includeUnburiedDead),
    orderBy: NAME_ORDER,
    select: {
      id: true,
      name: true,
      // The plaque a stranger's entry wears is the one /api/avatar would draw: the first name's initial.
      firstName: true,
      updatedAt: true,
      concealed: true,
      // Only the tags the two resolvers read: a name-forcing one, and anything equipped that conceals.
      tags: {
        where: {
          OR: [{ tag: { forcedName: { not: null } } }, { equipped: true, tag: { concealsIdentity: true } }],
        },
        select: { equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
      },
    },
  });

  const known = await knownSubjects(prisma, viewerId, characters.map((c) => c.id));
  return characters.map((character) => {
    const shown = presentedIdentity(character, {
      forcedName: forcedNameFrom(character.tags),
      concealment: concealmentFrom(character.tags),
      disguised: Boolean(disguiseNameFrom(character.tags)),
    });
    const stranger = known !== null && !known.has(character.id) && !shown.concealed && !shown.forced;
    // A disguise's plaque beside the real name would pair the two (STRANGERS.md §10),
    // so its entry wears its own name's plaque, the way a stranger's does.
    const plaque = stranger || shown.disguised;
    return shape(character, plaque ? { ...shown, avatarPath: `/assets/letters/${letterPlaqueFile(character.firstName ?? character.name)}` } : shown);
  });
}

const NAME_ORDER = [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }];

function livingWhere(includeUnburiedDead) {
  return includeUnburiedDead
    ? { OR: [{ status: "ALIVE" }, UNBURIED_BODY_WHERE] }
    : { status: "ALIVE" };
}

function shape(character, shown) {
  return {
    id: character.id,
    name: character.name,
    updatedAt: character.updatedAt.getTime(),
    // The helm sprite for a hood, the letter plaque for a forced name, /api/avatar for a plain face.
    avatarPath: shown.avatarPath ?? null,
    hidden: Boolean(shown.concealed || shown.forced),
  };
}
