// The composer's @ list for one place. No imports on purpose: it runs in the browser, and
// web/lib/__tests__ loads this file by path with no Prisma and no "@/" alias behind it.
//
// `roster` is the people standing where you stand (chat/page.js, whosHere().named). Inside a
// room that opens onto more than one Location — the Gate, a window, a counter
// (docs/systemdocs/MAP.md §2d) — the people on its other sides are in it too and hear every
// line said there, so the @ list there names them as well (Multi-locational rooms.docx:
// "characters can communicate"). They come from whosHere()'s `rooms` groups, which the page
// already loads for Who's here, and only for the room being typed in: in the street they
// can't hear you, and the relay would drop the ping as out of earshot anyway.
//
// `named` rows only, the same as your own side: a hood or a stranger is never in it, so a
// mention token can't unmask anybody.
export function mentionRosterFor(roster, people, placeKey) {
  const base = roster ?? [];
  const groups = (people?.rooms ?? []).filter((group) => group?.roomId && `room:${group.roomId}` === placeKey);
  if (groups.length === 0) return base;

  const seen = new Set(base.map((person) => person.id));
  const across = [];
  for (const group of groups) {
    for (const person of group.named ?? []) {
      if (!person?.characterId || person.self || seen.has(person.characterId)) continue;
      seen.add(person.characterId);
      across.push({
        id: person.characterId,
        name: person.name,
        updatedAt: person.avatarVersion ?? null,
        avatarPath: person.avatarPath ?? null,
      });
    }
  }
  return across.length === 0 ? base : [...base, ...across];
}
