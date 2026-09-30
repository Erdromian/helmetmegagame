// How many people are standing at each place a character is watching, for the
// small count /map draws beside a crosshair (MAP.md §6j). Deliberately NOT on
// the @lifeweb/db barrel; require it by path.
//
// WHICH PLACES is the chat column's own answer, narrowed: where you stand, plus
// every street you walked out of this turn that is still lit (./vantages.js),
// and of those only the ones in the zone you are standing in. Everywhere else
// gets no number at all, not a zero: the map remembers a place for ever, and a
// count on one is a live look at a street you are not watching.
//
// THE NUMBER is the one "Here · N" prints for somebody standing there: every
// ALIVE character at the Location, the looker included. Hoods and strangers
// count, since a hood hides WHO somebody is and never THAT they are there
// (PROXYING.md §5). It is a count and nothing else — no name, no face, no
// token ever leaves this module.
const { vantagesFor } = require("./vantages");

// The Location ids that get a number. `standing` is { id, zoneId } for the
// place the character is in; `vantages` are vantagesFor's rows. Here is always
// first, and a vantage across a zone boundary is dropped — it is in the chat
// column, but it is not "within the same zone".
function headcountLocationIds(standing, vantages = []) {
  if (!standing?.id) return [];
  const ids = [standing.id];
  for (const vantage of vantages) {
    const locationId = vantage?.locationId ?? null;
    if (!locationId || ids.includes(locationId)) continue;
    if (!standing.zoneId || vantage.location?.zoneId !== standing.zoneId) continue;
    ids.push(locationId);
  }
  return ids;
}

// Map<locationId, count> for one character. Every id the rule names is in the
// answer, so an empty watched street reads 0 rather than going missing.
//
// `standing` is handed in by a caller that already holds the Location row
// (loadMap has the whole graph); left out, it is one small read.
async function mapHeadcounts(prisma, character, standing = null) {
  if (!character?.id || !character.locationId) return new Map();
  const here =
    standing?.id === character.locationId
      ? standing
      : await prisma.location.findUnique({ where: { id: character.locationId }, select: { id: true, zoneId: true } });
  if (!here) return new Map();

  // A failed vantage read costs the watched streets their numbers, never the map.
  const vantages = await vantagesFor(prisma, { id: character.id, locationId: here.id }).catch((err) => {
    console.error(`Map headcounts: vantages failed for ${character.id}:`, err.message ?? err);
    return [];
  });
  const ids = headcountLocationIds(here, vantages);

  const rows = await prisma.character.groupBy({
    by: ["locationId"],
    where: { status: "ALIVE", locationId: { in: ids } },
    _count: { _all: true },
  });
  const counts = new Map(ids.map((id) => [id, 0]));
  for (const row of rows) counts.set(row.locationId, row._count._all);
  return counts;
}

module.exports = { headcountLocationIds, mapHeadcounts };
