// The Oracle desk. See docs/systemdocs/ORACLE.md.
//
// The (desk) layout has already checked isGm (web/app/(desk)/layout.js), so
// there is no gate here — same as turns, players and audit. The one server
// action this desk has re-checks for itself regardless, because a layout gate
// is presentation.

import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { getVisibleZones, listSelectableZones } from "@/lib/gmZoneView";
import { GmZoneViewProvider } from "@/app/components/GmZoneViewProvider";
import OracleDesk from "./OracleDesk";

const FRONT_PAGE = "__front__";

export default async function OraclePage({ searchParams }) {
  const params = await searchParams;

  // The playtest switch, ENFORCED here and not merely hidden from the rail.
  // Dropping the nav item is presentation; this is the lock, the same posture
  // /chat takes with playPanelEnabled. Superadmin rather than GM because the
  // point of the switch is to review the Oracle before the other gamemasters
  // meet it.
  const config = await prisma.gameConfig.findFirst({ select: { oraclePlaytest: true } });
  if (config?.oraclePlaytest) {
    const session = await auth();
    if (!isSuperadmin(session?.discordUserId)) redirect("/gm/players");
  }

  // Newest first, and the OPEN turn is offered like any other. It used to be
  // excluded, on the argument that its moves were still being filed and there
  // was nothing complete to have written about — true while the Oracle ran at
  // turn close, and backwards now that it runs at the Move cutoff. The open
  // turn's page is the whole point: it is what a gamemaster reads while they
  // adjudicate, in the three hours before the push.
  const turns = await prisma.turn.findMany({
    orderBy: { number: "desc" },
    take: 60,
    select: {
      id: true,
      number: true,
      phase: true,
      _count: { select: { oraclePages: true } },
    },
  });

  if (turns.length === 0) {
    return (
      <>
        <header className="desk-header">
          <h1 className="section-title">Oracle</h1>
        </header>
        <div className="desk-empty">
          <p>No turn has begun yet.</p>
        </div>
      </>
    );
  }

  // Default to the newest turn that has actually been written, not simply the
  // newest turn. Between midnight and the cutoff the open turn has no page, and
  // landing a GM on an empty one would hide yesterday's chronicle behind a
  // "nothing written" panel for twenty-one hours of every day.
  const wanted = Number.parseInt(params?.turn, 10);
  const turn =
    turns.find((t) => t.number === wanted) ?? turns.find((t) => t._count.oraclePages > 0) ?? turns[0];

  const [rows, zones, characters, visibleZones, selectableZones] = await Promise.all([
    prisma.oracleSynopsis.findMany({
      where: { turnId: turn.id },
      select: {
        id: true,
        body: true,
        threads: true,
        editedAt: true,
        model: true,
        zone: { select: { id: true, slug: true, name: true } },
      },
    }),
    prisma.zone.findMany({
      where: { gmRoleId: { not: null } },
      orderBy: { name: "asc" },
      select: { id: true, slug: true, name: true },
    }),
    // The inspector resolves a clicked {char:<id>} against this, and it is also
    // what the rail counts. ALIVE only: a name in an old record whose character
    // has since died renders as plain text rather than a control, which is the
    // same fail-closed shape as an unresolvable name.
    prisma.character.findMany({
      where: { status: "ALIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        discordUserId: true,
        zoneId: true,
        role: { select: { name: true } },
        faction: { select: { name: true } },
        zone: { select: { name: true } },
      },
    }),
    getVisibleZones(),
    listSelectableZones(),
  ]);

  const front = rows.find((row) => !row.zone) ?? null;

  const pages = rows.map((row) => ({
    key: row.zone?.slug ?? FRONT_PAGE,
    id: row.id,
    title: row.zone?.name ?? `Turn ${turn.number}`,
    body: row.body,
    model: row.model,
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
  }));

  // Threads live on the front page only. A malformed or absent array reads as
  // no threads rather than as a crash — the rail is the cheapest thing on this
  // page to lose.
  const threads = Array.isArray(front?.threads)
    ? front.threads.filter((t) => t && typeof t.name === "string" && typeof t.state === "string").slice(0, 5)
    : [];

  const counts = {};
  for (const zone of zones) counts[zone.id] = { present: 0 };
  for (const character of characters) {
    if (counts[character.zoneId]) counts[character.zoneId].present += 1;
  }

  const requested = typeof params?.page === "string" ? params.page : null;
  const selectedKey = pages.some((p) => p.key === requested) ? requested : (front ? FRONT_PAGE : (pages[0]?.key ?? FRONT_PAGE));

  const roster = characters.map((character) => ({
    id: character.id,
    name: character.name,
    discordUserId: character.discordUserId,
    roleTitle: character.role?.name ?? null,
    factionName: character.faction?.name ?? null,
    zoneName: character.zone?.name ?? null,
  }));

  return (
    <GmZoneViewProvider initialZoneNames={visibleZones?.map((zone) => zone.name) ?? null}>
      <OracleDesk
        turn={{ number: turn.number, phase: turn.phase }}
        turns={turns.map((t) => ({ number: t.number, phase: t.phase }))}
        pages={pages}
        threads={threads}
        zones={zones}
        counts={counts}
        roster={roster}
        selectableZones={selectableZones}
        visibleZoneIds={visibleZones?.map((zone) => zone.id) ?? null}
        visibleZoneNames={visibleZones?.map((zone) => zone.name) ?? null}
        selectedKey={selectedKey}
      />
    </GmZoneViewProvider>
  );
}
