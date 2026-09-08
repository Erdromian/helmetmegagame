import { prisma } from "@lifeweb/db";
import { CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom, presentedIdentity } from "@lifeweb/db/lib/presentedIdentity";

// Who a {char:<id>} token is allowed to RESOLVE to, which is a different
// question from who the @ menu offers.
//
// The two used to be one list — the people standing where the reader stands
// (whosHere().named) — and that was wrong in the direction that shows. A ping
// only has to survive the trip from Discord, where anybody in the guild can
// mention anybody's name role (PROXYING.md §6); the token that arrives is
// perfectly well-formed and names a real character. But if that character was
// not in the reader's own room, the Map had no entry, the renderer fell back
// to the literal text, and the line read `{char:cmtt1148600jgql0pyydw04pn}`.
//
// Resolving a name is not a leak. The name is already a mentionable Discord
// role titled after it, it is printed over every line they speak, and the
// SPEAKER is the one who said it. What the narrow list bought was never
// privacy — it was a cuid on screen instead of a name.
//
// The @ menu stays narrow. You should only be offered people you can see;
// that is a different rule and it is unchanged.
//
// The one thing genuinely hidden is a face behind a mask, so anybody
// presenting as somebody else is left OUT of this directory and falls back to
// the neutral chip. Deciding that with presentedIdentity() rather than by
// reading the columns is deliberate: the forced/concealed rule has three
// cases and a precedence order, and a second copy of it here would drift.
export async function loadMentionDirectory() {
  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
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

  const directory = [];
  for (const character of characters) {
    const shown = presentedIdentity(character, {
      forcedName: forcedNameFrom(character.tags),
      concealment: concealmentFrom(character.tags),
    });
    if (shown.concealed || shown.forced) continue;
    directory.push({
      id: character.id,
      name: character.name,
      updatedAt: character.updatedAt.getTime(),
      avatarPath: null,
    });
  }
  return directory;
}
