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
    members.sort(byOldest);
    const oldest = members[0];
    const latest = members[members.length - 1];
    const count = members.length;
    // Combat mode at each 1 (COMBAT-MODE.md §6): one on guard is enough to let them write, and the desk says
    // how many were. The response lives on the oldest; a group from before the fold may have it on a later one.
    const alertCount = members.filter((m) => m.alert).length;
    const responder = oldest.response ? oldest : ([...members].reverse().find((m) => m.response) ?? null);
    const respondedAtMs = responder?.respondedAtMs ?? null;
    for (const m of members) groupOf.set(m.id, oldest.id);
    out.push({
      ...oldest,
      memberIds: members.map((m) => m.id),
      latestId: latest.id,
      count,
      stuck: count >= CAVING_TROUBLE_CAP,
      die: latest.die,
      // How they looked at the newest 1, the one whose snapshot the lens reads (CAVING.md §5).
      look: latest.look,
      locationName: latest.locationName,
      zoneId: latest.zoneId,
      zoneName: latest.zoneName,
      firstAtMs: oldest.createdAtMs,
      createdAtMs: latest.createdAtMs,
      ...resultStatus(members, [respondedAtMs]),
      alertCount,
      latestAlert: Boolean(latest.alert),
      response: responder?.response ?? "",
      respondedAtMs,
      respondedAtLabel: responder?.respondedAtLabel ?? null,
      // The Result box lives on the oldest roll. A group from before the fold may have notes on a
      // later one, so the newest non-empty note stands in for an empty first.
      gmNotes: oldest.gmNotes || [...members].reverse().find((m) => m.gmNotes)?.gmNotes || "",
    });
  }
  return { rows: out, groupOf };
}

// Oldest first, the id breaking a same-millisecond tie — the order the server picks a result's anchor in
// (db/lib/cavingStand.js#cavingResultMembers), so the desk and the server name the same roll.
function byOldest(a, b) {
  return (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0) || String(a.id).localeCompare(String(b.id));
}

// Where a result stands, off its 1s (oldest first) and the times each caver in it last wrote a response.
// Needs attention while ANY 1 in it is undecided — a fresh failure after a GM resolved it reopens it, and
// says how many are new. A response written or changed after a GM resolved it reopens it too, the way a
// fresh 1 does: the ruling was made without it. Not after the push — the turn is over.
function resultStatus(rolls, respondedTimes) {
  const resolved = rolls.filter((m) => m.resolvedAt);
  const open = rolls.length - resolved.length;
  // The newest resolved 1 says who resolved it and how (by hand, or the push).
  const lastResolved = resolved[resolved.length - 1] ?? null;
  const resolvedMs = Math.max(0, ...resolved.map((m) => (m.resolvedAt ? Date.parse(m.resolvedAt) : 0)));
  const respondedSinceResolved =
    open === 0 && !lastResolved?.autoResolved && resolvedMs > 0 && respondedTimes.some((t) => t != null && t > resolvedMs);
  const undecided = open > 0 || respondedSinceResolved;
  return {
    statusLabel: undecided ? "Needs attention" : "Resolved",
    resolvedAt: undecided ? null : (lastResolved?.resolvedAt ?? null),
    resolvedAtLabel: undecided ? null : (lastResolved?.resolvedAtLabel ?? null),
    resolvedByUsername: undecided ? null : (lastResolved?.resolvedByUsername ?? null),
    autoResolved: !undecided && Boolean(lastResolved?.autoResolved),
    newSinceResolved: resolved.length > 0 ? open : 0,
    respondedSinceResolved,
  };
}

// One caver's card inside a result: their own 1s folded (foldCavingRolls), or none at all for somebody who
// stood there at the lock without failing. `place` is the result's Location id, so a caver a GM has moved
// since says where they are now.
function caverCard(caver, standing, place) {
  const now = standing?.nowLocationId && standing.nowLocationId !== place ? standing.nowLocationName : null;
  if (!caver) {
    return {
      characterId: standing.characterId,
      characterName: standing.characterName,
      discordUsername: standing.discordUsername,
      avatarVersion: standing.avatarVersion,
      catatonic: standing.catatonic,
      roleTitle: standing.roleTitle,
      look: standing.look,
      failed: false,
      severity: 0,
      stuck: false,
      alertCount: standing.standAlert ? 1 : 0,
      response: "",
      respondedAtMs: null,
      respondedAtLabel: null,
      gmNotes: "",
      memberIds: [],
      firstId: null,
      latestId: null,
      firstAtMs: null,
      hasStandSnapshot: Boolean(standing.hasStandSnapshot),
      nowLocationName: now,
    };
  }
  return {
    characterId: caver.characterId,
    characterName: caver.characterName,
    discordUsername: caver.discordUsername,
    avatarVersion: caver.avatarVersion,
    catatonic: caver.catatonic,
    roleTitle: caver.roleTitle,
    look: caver.look,
    failed: true,
    severity: caver.count,
    stuck: caver.stuck,
    alertCount: caver.alertCount,
    response: caver.response,
    respondedAtMs: caver.respondedAtMs,
    respondedAtLabel: caver.respondedAtLabel,
    // Their own result's Result box, from before the lock merged it with the others.
    gmNotes: caver.gmNotes,
    memberIds: caver.memberIds,
    firstId: caver.id,
    latestId: caver.latestId,
    firstAtMs: caver.firstAtMs,
    hasStandSnapshot: Boolean(standing?.hasStandSnapshot),
    nowLocationName: now,
  };
}

// Failers first, the worst first; then the people who stood there without failing; then by name.
function byCard(a, b) {
  return (b.severity ?? 0) - (a.severity ?? 0) || String(a.characterName).localeCompare(String(b.characterName));
}

// The Caving lens' results (Caving.docx; CAVING.md §5a, §5c). Takes one turn's rolls (cavingRollRow shape)
// and its standings (web/lib/moveRows.js#cavingStandingRow), and answers { rows, groupOf } in the shape
// foldCavingRolls does — QUIET and FIND rows unchanged, one row per result:
//
//   before the lock   each caver's 1s are one result, named by where they stand NOW (the standing), so a
//                     3 rolled after a 1 moves the result with them. History, which has no "now", falls
//                     back to the newest 1's place.
//   at the lock       everybody stamped at one Location (db/lib/cavingStand.js) is ONE result: every caver
//                     there with 1s, each with their own severity, and everybody standing there without a
//                     failed roll (`bystanders`). A Location with nobody failing makes no result at all.
//
// Every result carries `members` (the cavers with 1s, worst first) and `bystanders`, one of each for a
// lone caver, so the rail and the desk draw one shape. It is keyed by its OLDEST 1 — the Result box and
// everything staged on the desk hang off that id, and the server works the same anchor out from any roll
// in it (cavingStand.js#cavingResultMembers). Before the lock that is each caver's own oldest 1; at the
// lock the oldest of them all, so the merged result keeps the earliest caver's notes in its Result box
// and shows the others' on their cards. `groupOf` maps every 1 to the result it is shown under.
export function foldCavingResults(rows, standings) {
  const { rows: folded } = foldCavingRolls(rows);
  const standingOf = new Map((standings ?? []).map((s) => [s.characterId, s]));
  const rollById = new Map((rows ?? []).map((r) => [r.id, r]));
  const out = [];
  const groupOf = new Map();
  // Location id -> the cavers with 1s stamped there.
  const places = new Map();

  for (const row of folded) {
    if (row.kind !== "TROUBLE") {
      out.push(row);
      continue;
    }
    const standing = standingOf.get(row.characterId);
    if (standing?.frozen && standing.standLocationId) {
      if (!places.has(standing.standLocationId)) places.set(standing.standLocationId, []);
      places.get(standing.standLocationId).push(row);
      continue;
    }
    // Their own result, where they stand now — or, with no "now" (a past turn), where the newest 1 was.
    const place = standing?.frozen ? null : (standing?.nowLocationId ?? null);
    for (const id of row.memberIds) groupOf.set(id, row.id);
    out.push({
      ...row,
      merged: false,
      locationName: standing?.frozen ? (standing.standLocationName ?? row.locationName) : (standing?.nowLocationName ?? row.locationName),
      zoneName: standing?.frozen ? (standing.standZoneName ?? row.zoneName) : (standing?.nowZoneName ?? row.zoneName),
      members: [caverCard(row, standing, place)],
      bystanders: [],
      searchNames: row.characterName,
    });
  }

  // Who stood at each place without failing.
  const bystandersAt = new Map();
  const failed = new Set(folded.filter((r) => r.kind === "TROUBLE").map((r) => r.characterId));
  for (const s of standingOf.values()) {
    if (!s.frozen || !s.standLocationId || failed.has(s.characterId) || !places.has(s.standLocationId)) continue;
    if (!bystandersAt.has(s.standLocationId)) bystandersAt.set(s.standLocationId, []);
    bystandersAt.get(s.standLocationId).push(s);
  }

  for (const [placeId, cavers] of places) {
    cavers.sort((a, b) => (a.firstAtMs ?? 0) - (b.firstAtMs ?? 0) || String(a.id).localeCompare(String(b.id)));
    const anchor = cavers[0];
    const allRolls = cavers.flatMap((c) => c.memberIds.map((id) => rollById.get(id)).filter(Boolean)).sort(byOldest);
    const latest = allRolls[allRolls.length - 1] ?? anchor;
    const first = standingOf.get(anchor.characterId);
    const members = cavers.map((c) => caverCard(c, standingOf.get(c.characterId), placeId)).sort(byCard);
    const bystanders = (bystandersAt.get(placeId) ?? []).map((s) => caverCard(null, s, placeId)).sort(byCard);
    for (const r of allRolls) groupOf.set(r.id, anchor.id);
    out.push({
      ...anchor,
      merged: cavers.length > 1 || bystanders.length > 0,
      memberIds: allRolls.map((r) => r.id),
      latestId: latest.id,
      die: latest.die,
      count: allRolls.length,
      stuck: members.some((m) => m.stuck),
      locationName: first?.standLocationName ?? anchor.locationName,
      zoneId: first?.standZoneId ?? anchor.zoneId,
      zoneName: first?.standZoneName ?? anchor.zoneName,
      createdAtMs: latest.createdAtMs,
      ...resultStatus(allRolls, cavers.map((c) => c.respondedAtMs)),
      alertCount: cavers.reduce((n, c) => n + (c.alertCount ?? 0), 0),
      // The Result box is the anchor caver's; every other caver's earlier notes stay on their card.
      gmNotes: anchor.gmNotes,
      members,
      bystanders,
      searchNames: [...members, ...bystanders].map((m) => m.characterName).join(" "),
    });
  }
  return { rows: out, groupOf };
}

// The rail's and the desk's severity for a failed result (Caving.docx: each failed roll adds 1): "Severity 3",
// and "Severity 1" for a lone 1. Nothing for a roll that did not fail.
export function severityLabel(row) {
  if (row?.kind !== "TROUBLE") return null;
  // A result with several cavers in it (foldCavingResults) says each one's own: severity is personal, and
  // so is the stop at 10.
  if ((row.members?.length ?? 0) > 1) return row.members.map((m) => `${m.characterName} · Severity ${m.severity}`).join(", ");
  return `Severity ${row.count ?? 1}`;
}

// Whether a row stays on the Caving lens with the "Show other rolls" box unticked: only failures do
// (Caving.docx — results which were not failures are hidden by default).
export function isCavingFailure(row) {
  return row?.kind === "TROUBLE";
}
