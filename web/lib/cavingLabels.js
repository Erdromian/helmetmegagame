// Player-facing names for CavingRollKind (docs/systemdocs/CAVING.md), shared by QueueRail.js and
// CavingDesk.js so neither renders the raw enum as "undefined".
export const CAVING_KIND_LABELS = {
  TROUBLE: "Trouble",
  QUIET: "Quiet",
  FIND: "Find",
};

// How many 1s in one zone on one turn stop a caver moving at all (CAVING.md
// §2e). A COPY of db/lib/cavingPass.js#CAVING_TROUBLE_CAP, not an import: this
// module is reached from client components, and cavingPass.js requires the
// mood pass and the tag writers, which drag PrismaClient into the browser
// bundle. db/test/cavingTally.test.js fails the build if the two disagree.
export const CAVING_TROUBLE_CAP = 10;

export function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

// Which 1 of the turn each TROUBLE row is, for the Caving lens. Takes one
// turn's rows (cavingRollRow shape, web/lib/moveRows.js) and answers, per row
// id, { nth, total, stuck }: this is the character's nth 1 in this zone on
// this turn, out of `total`, and `stuck` once the total has reached the cap —
// the same count db/lib/cavingPass.js#cavingRestrictionsFor makes, recomputed
// from the rows the desk already holds so no server round trip is needed and
// the live stream keeps it current. Grouped by character AND zone, because
// that is the stop's own scope. Only TROUBLE rows are tallied; the rest get
// no entry.
export function troubleTallies(rows) {
  const groups = new Map();
  for (const row of rows ?? []) {
    if (row.kind !== "TROUBLE") continue;
    const key = `${row.characterId}|${row.zoneId ?? row.zoneName ?? ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const out = new Map();
  for (const group of groups.values()) {
    group.sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0) || String(a.id).localeCompare(String(b.id)));
    const total = group.length;
    group.forEach((row, i) => out.set(row.id, { nth: i + 1, total, stuck: total >= CAVING_TROUBLE_CAP }));
  }
  return out;
}

// The rail's second line for a tallied row: "3rd 1 this turn", or nothing
// for the first — one 1 is the ordinary case and needs no count.
export function tallyLabel(tally) {
  if (!tally || tally.total < 2) return null;
  return `${ordinal(tally.nth)} 1 this turn`;
}
