// Player-facing names for CavingRollKind (docs/systemdocs/CAVING.md), shared by QueueRail.js and
// CavingDesk.js so neither renders the raw enum as "undefined".
export const CAVING_KIND_LABELS = {
  TROUBLE: "Trouble",
  QUIET: "Quiet",
  FIND: "Find",
};

// The severity at which a caver stops moving at all (CAVING.md §2e). A COPY of
// db/lib/cavingPass.js#CAVING_TROUBLE_CAP, not an import: this
// module is reached from client components, and cavingPass.js requires the
// mood pass and the tag writers, which drag PrismaClient into the browser
// bundle. db/test/cavingTally.test.js fails the build if the two disagree.
export const CAVING_TROUBLE_CAP = 10;

// The Caving lens folds a caver's failed rolls into ONE result (Caving.docx; CAVING.md §5): every
// TROUBLE row one character rolled on one turn — in the Caves, the Depths or both — is one row on
// the rail, one desk, one Save and one Mark resolved, and its severity is how many there were. Takes
// one turn's rows (cavingRollRow shape, web/lib/moveRows.js) and answers { rows, groupOf }:
//
//   rows     QUIET and FIND unchanged, and one row per group. A group row is keyed by its OLDEST
//            roll, so the id never changes while a caver keeps failing — the GM's selection and
//            keyboard cursor hold, and every staged message or effect attaches to that one id. The
//            die, place, zone and time are the NEWEST roll's, which is also the snapshot the desk
//            reads.
//   groupOf  any roll id -> the id of the row it is shown under, so an old link to one 1 still
//            opens its group.
//
// Recomputed from the rows the desk already holds, so the live stream keeps it current.
export function foldCavingRolls(rows) {
  const groups = new Map();
  const out = [];
  for (const row of rows ?? []) {
    if (row.kind !== "TROUBLE") {
      out.push(row);
      continue;
    }
    if (!groups.has(row.characterId)) groups.set(row.characterId, []);
    groups.get(row.characterId).push(row);
  }
  const groupOf = new Map();
  for (const members of groups.values()) {
    members.sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0) || String(a.id).localeCompare(String(b.id)));
    const oldest = members[0];
    const latest = members[members.length - 1];
    const resolved = members.filter((m) => m.resolvedAt);
    const open = members.length - resolved.length;
    // The newest resolved member says who resolved it and how (by hand, or the push).
    const lastResolved = resolved[resolved.length - 1] ?? null;
    const count = members.length;
    for (const m of members) groupOf.set(m.id, oldest.id);
    out.push({
      ...oldest,
      memberIds: members.map((m) => m.id),
      latestId: latest.id,
      count,
      stuck: count >= CAVING_TROUBLE_CAP,
      die: latest.die,
      locationName: latest.locationName,
      zoneId: latest.zoneId,
      zoneName: latest.zoneName,
      createdAtMs: latest.createdAtMs,
      // Needs attention while ANY 1 in it is undecided — a fresh failure after a GM resolved the
      // group reopens it, and says how many are new.
      statusLabel: open > 0 ? "Needs attention" : "Resolved",
      resolvedAt: open > 0 ? null : (lastResolved?.resolvedAt ?? null),
      resolvedAtLabel: open > 0 ? null : (lastResolved?.resolvedAtLabel ?? null),
      resolvedByUsername: open > 0 ? null : (lastResolved?.resolvedByUsername ?? null),
      autoResolved: open === 0 && Boolean(lastResolved?.autoResolved),
      newSinceResolved: resolved.length > 0 ? open : 0,
      // The Result box lives on the oldest roll. A group from before the fold may have notes on a
      // later one, so the newest non-empty note stands in for an empty first.
      gmNotes: oldest.gmNotes || [...members].reverse().find((m) => m.gmNotes)?.gmNotes || "",
    });
  }
  return { rows: out, groupOf };
}

// The rail's and the desk's severity for a failed result (Caving.docx: each failed roll adds 1): "Severity 3",
// and "Severity 1" for a lone 1. Nothing for a roll that did not fail.
export function severityLabel(row) {
  if (row?.kind !== "TROUBLE") return null;
  return `Severity ${row.count ?? 1}`;
}

// Whether a row stays on the Caving lens with the "Show other rolls" box unticked: only failures do
// (Caving.docx — results which were not failures are hidden by default).
export function isCavingFailure(row) {
  return row?.kind === "TROUBLE";
}
