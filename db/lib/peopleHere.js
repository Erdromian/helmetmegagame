// The ONE roster behind every people-picker, on both faces — the sheet and
// /chat on the web (web/lib/peopleHere.js delegates here), and every "pick
// someone here" select on Discord (bot/src/lib/verbs/pickers.js). Two halves:
// the people whose faces you can see, and the people in masks. A hood hides
// WHO somebody is, never THAT they are standing there, so both halves feed
// every picker that acts on a body (PROXYING.md §5).
//
// ONE PREDICATE DECIDES THE SPLIT, and it is not this file's. `presentRows` in
// db/lib/whosHere.js is where "is this person hidden from this viewer" is
// answered, and `resolveHoodToken` reads the same answer — so a row offered
// under a token always resolves back to somebody. web/lib/peopleHere.js's
// header tells the story of what went wrong when two predicates split it.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel; require
// it by path.
const { whosHere } = require("./whosHere");

const NAME_ORDER = [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }];

// What a picker calls somebody, and what it posts back for them. Both halves
// already carry the presented name — the one the VIEWER holds, forced names and
// aliases resolved — so neither of these re-derives anything.
function pickerName(row) {
  return row?.name ?? "somebody";
}
function pickerKey(row) {
  return row?.hooded ? row.id : `character:${row.id}`;
}

// Both halves, from one room read and one row read.
//
//   named   real ids, and the name the viewer HOLDS for them.
//   hooded  "hood:<token>" for an id, the alias for a name, `hooded: true`.
//           The real id and real name are stripped on the way out rather than
//           never selected, so a caller cannot leak one by writing its `select`
//           carelessly — shipping an id IS the unmasking.
//
// `room` lets a caller that has already asked whosHere hand the answer in
// rather than paying for it twice.
async function rosterHere(prisma, character, { includeDead = false, select, room = null } = {}) {
  if (!character?.locationId) return { named: [], hooded: [], room: null };
  const answer =
    room ??
    (await whosHere(prisma, character, {
      includeSelf: false,
      includeDead,
      withSightings: true,
      withHoodIds: true,
    }));

  const hoodIds = answer.hoodIds ?? new Map();
  const tokenById = new Map([...hoodIds].map(([token, id]) => [id, token]));
  const aliasByToken = new Map(answer.concealed.filter((c) => c.token).map((c) => [c.token, c.alias]));
  // The name the viewer holds, not Character.name: presentRows has already
  // resolved a forced name and any sighting.
  const heldName = new Map(answer.named.map((c) => [c.characterId, c.name]));

  const ids = [...heldName.keys(), ...hoodIds.values()];
  if (ids.length === 0) return { named: [], hooded: [], room: answer };
  const rows = await prisma.character.findMany({ where: { id: { in: ids } }, orderBy: NAME_ORDER, select });

  const named = [];
  const hooded = [];
  for (const row of rows) {
    const token = tokenById.get(row.id);
    if (!token) {
      named.push({ ...row, name: heldName.get(row.id) ?? row.name });
      continue;
    }
    const { id: _id, name: _name, ...rest } = row;
    hooded.push({
      ...rest,
      // `token` alongside the key because the two consumers want different
      // shapes: a dialog posts `id` straight back, while PartySelect builds its
      // own value as `${kind}:${id}` and needs the bare token plus kind "hood".
      id: `hood:${token}`,
      token,
      name: aliasByToken.get(token) ?? "somebody",
      hooded: true,
    });
  }
  // By alias, then token — never the NAME_ORDER the rows came back in, which is
  // the real name's, and would put two identical aliases in their real names'
  // order in every picker (db/lib/whosHere.js#hoodOrder says the same).
  hooded.sort((a, b) => a.name.localeCompare(b.name) || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0));
  return { named, hooded, room: answer };
}

// Discord's picker rows: `{ key, label }`, the key being exactly what the web
// posts (a `character:<id>` or `hood:<token>` target key, resolved on the way
// back by db/lib/targetKey.js#resolveTargetKey), so a select value is never a
// bare id. Named first, then the masks, the order the web's pickers draw them.
async function pickerRows(prisma, character, { includeDead = false, room = null } = {}) {
  const { named, hooded } = await rosterHere(prisma, character, {
    includeDead,
    room,
    select: { id: true, name: true },
  });
  return [...named, ...hooded].map((row) => ({ key: pickerKey(row), label: pickerName(row), hooded: Boolean(row.hooded) }));
}

module.exports = { rosterHere, pickerRows, pickerName, pickerKey };
