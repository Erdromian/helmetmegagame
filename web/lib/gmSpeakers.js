import "server-only";
import { hoodToken } from "@lifeweb/db/lib/hoodToken";
import { roleGroupHue } from "@lifeweb/db/lib/roleGroups";

// The directory that lets a gamemaster read a hood: `speakerKey` -> real name.
//
// A hooded row reaches the browser with its `characterId` withheld and a
// `speakerKey` in its place (db/lib/archive.js#feedRowShape) — that withholding
// is per ROW rather than per reader, because web/lib/feedHub.js shapes one row
// and fans it to every watcher of a place, so a GM cannot be answered
// differently down there without answering everybody differently.
//
// So the GM is answered up here instead, with the key ring rather than a
// different scene: `speakerKey` is db/lib/hoodToken.js's HMAC of the character
// id, stable for as long as AUTH_SECRET is, so ONE map resolves every row the
// page will ever hold — the first paint, the live stream, the history fetch
// and search alike. Handed only to a GM, by a GM-gated caller.
//
// No AUTH_SECRET means no tokens at all (hoodToken answers null), and the map
// comes back empty rather than keyed on nothing.
//
// `names` is that map. `groups` beside it is speakerKey -> the estate the real
// speaker's name is painted in (db/lib/roleGroups.js), or nothing for one that
// wears none: what lets the GM seat's scene paint a hooded line the way it
// paints a named one. One query for both.
export async function speakerBook(prisma) {
  const people = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: { id: true, name: true, role: { select: { groupSlug: true } } },
  });
  const names = {};
  const groups = {};
  for (const person of people) {
    const key = hoodToken(person.id);
    if (!key) continue;
    names[key] = person.name;
    const group = roleGroupHue(person.role?.groupSlug);
    if (group) groups[key] = group;
  }
  return { names, groups };
}
