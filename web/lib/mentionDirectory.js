import { prisma } from "@lifeweb/db";
import { CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom, presentedIdentity } from "@lifeweb/db/lib/presentedIdentity";

// Two lists, and the whole file is about keeping them apart: who a
// `{char:<id>}` token may RESOLVE to, and who the @ menu may OFFER.
//
// They used to be one — the people standing where the reader stands
// (whosHere().named) — and that was wrong in the direction that shows. A ping
// only has to survive the trip from Discord, where anybody in the guild can
// mention anybody's name role (PROXYING.md §6); the token that arrives is
// perfectly well-formed and names a real character. But if that character was
// not in the reader's own room, the Map had no entry, the renderer fell back
// to the literal text, and the line read `{char:cmtt1148600jgql0pyydw04pn}`.

// ------------------------------------------------------------------ RESOLVE
//
// Everybody. Resolving a name is not a leak: the name is already a mentionable
// Discord role, it is printed over every line they speak, and the SPEAKER is
// the one who said it. What a narrow list bought was never privacy — it was a
// cuid on screen instead of a name.
//
// This list used to drop anybody currently presenting as somebody else, to
// keep a face out from behind a mask, and it could not do that job. The list
// is rebuilt on every render and a mention is drawn from it LIVE, so the little
// portrait beside an old `{char:…}` winked out the moment its subject pulled a
// hood on anywhere in the world and came back when it came off — a mask
// detector readable by anybody who could see any line that ever named them.
// The exact thing the exclusion was meant to prevent, wired backwards.
//
// The freeze does that hiding instead. A token carries the name it was sent
// under (db/lib/say.js#stampMentionNames), and
// web/app/components/messageTokens.js draws a face only when this list still
// calls that person by that same name. Nothing about a mention changes because
// of what its subject is wearing now (PROXYING.md §5a).
//
// `includeUnburiedDead` is /notes' roster: a journal is written about people
// you knew, and CHARACTERS.md §5's rule is that a dead-and-buried character is
// simply absent from every roster while an unburied one is not yet gone. /chat
// has no use for it — you cannot @ somebody who is not standing here.
export async function loadMentionDirectory({ includeUnburiedDead = false } = {}) {
  const characters = await prisma.character.findMany({
    where: livingWhere(includeUnburiedDead),
    orderBy: NAME_ORDER,
    select: { id: true, name: true, updatedAt: true },
  });
  return characters.map(shape);
}

// -------------------------------------------------------------------- OFFER
//
// Narrower, and this is where the concealment rule belongs. Being offered a
// name to type is a live act: a hooded or disguised character must not be in
// the menu, and must not draw their real portrait in an entry you are writing
// now. Unlike the resolve list above, nothing here is drawn against an old
// line, so there is no flicker for a mask to leak through.
//
// Deciding it with presentedIdentity() rather than by reading the columns is
// deliberate: the forced/concealed rule has three cases and a precedence
// order, and a second copy of it here would drift.
//
// /chat needs no version of this — its @ menu is the people standing in the
// room, which whosHere() already answers. /notes has no room to stand in.
export async function loadOfferableMentions({ includeUnburiedDead = false } = {}) {
  const characters = await prisma.character.findMany({
    where: livingWhere(includeUnburiedDead),
    orderBy: NAME_ORDER,
    select: {
      id: true,
      name: true,
      updatedAt: true,
      concealed: true,
      // Only the tags the two resolvers read — a name-forcing one, and
      // anything equipped that conceals.
      tags: {
        where: {
          OR: [{ tag: { forcedName: { not: null } } }, { equipped: true, tag: { concealsIdentity: true } }],
        },
        select: { equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
      },
    },
  });

  const out = [];
  for (const character of characters) {
    const shown = presentedIdentity(character, {
      forcedName: forcedNameFrom(character.tags),
      concealment: concealmentFrom(character.tags),
    });
    if (shown.concealed || shown.forced) continue;
    out.push(shape(character));
  }
  return out;
}

const NAME_ORDER = [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }];

function livingWhere(includeUnburiedDead) {
  return includeUnburiedDead
    ? { OR: [{ status: "ALIVE" }, { status: "DEAD", buriedAt: null }] }
    : { status: "ALIVE" };
}

function shape(character) {
  return {
    id: character.id,
    name: character.name,
    updatedAt: character.updatedAt.getTime(),
    avatarPath: null,
  };
}
