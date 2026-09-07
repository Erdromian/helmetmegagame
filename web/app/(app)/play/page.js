import { redirect } from "next/navigation";
import { prisma, feedRowShape, FEED_ROW_SELECT } from "@lifeweb/db";
import { feedWipeFloor, seqFilterAbove } from "@lifeweb/db/lib/feedWipe";
import { loadForcedName, loadConcealment, presentedIdentity } from "@lifeweb/db/lib/presentedIdentity";
import EmptyState from "@/app/components/EmptyState";
import { affordancesFor } from "@lifeweb/db/lib/placeAffordances";
import { whosHere } from "@lifeweb/db/lib/whosHere";
import { linksFor } from "@lifeweb/db/lib/locationGraph";
import { carryStatus } from "@lifeweb/db/lib/carry";
import { loadFeedViewer, placesFor } from "@/lib/feedAccess";
import { loadPeoplePools } from "@/lib/peoplePools";
import RequestActionsProvider from "@/app/components/RequestActionsProvider";
import CharacterMentionsProvider from "@/app/components/CharacterMentionsProvider";
import Hall from "./Hall";
import { waitingOnYou } from "./actions";

// /play — the Hall. Three columns on a desktop, one on a phone: everywhere
// this character can hear on the left, the open scene in the middle, and (in
// phase 3) the people standing there on the right.
//
// The first place's rows are rendered on the server so the page has something
// to show before any JavaScript runs; every other place is fetched when the
// reader opens it, and everything after that arrives on the one SSE stream
// Hall.js holds.
export const dynamic = "force-dynamic";

const HISTORY_ROWS = 100;

export default async function PlayPage() {
  const viewer = await loadFeedViewer();
  if (!viewer.discordUserId) redirect("/");

  if (!viewer.character && !viewer.gm) {
    return (
      <div className="hall-body hall-body--empty">
        <div className="panel">
          <EmptyState>You have no living character. ‡</EmptyState>
        </div>
      </div>
    );
  }

  const places = await placesFor(prisma, viewer.character, viewer.options);
  const first = places[0] ?? null;

  if (!first) {
    return (
      <div className="hall-body hall-body--empty">
        <div className="panel">
          <EmptyState>You are nowhere yet. ‡</EmptyState>
        </div>
      </div>
    );
  }

  // The cursor the stream opens with is the newest seq in the GAME at render
  // time, not the newest in this place. The catch-up then carries exactly what
  // happened while the page was loading, across every place at once — asking
  // from this place's own newest would have replayed every other place's whole
  // backlog down the stream.
  // The Dawn watermark, read before the rows so the first paint and the
  // stream's catch-up agree about where the day starts (db/lib/feedWipe.js).
  const floor = await feedWipeFloor(prisma);

  const [rows, watermark, forcedName, concealment] = await Promise.all([
    prisma.archiveEntry.findMany({
      where: { placeKey: first.placeKey, deletedAt: null, seq: seqFilterAbove(floor) },
      orderBy: { seq: "desc" },
      take: HISTORY_ROWS,
      select: FEED_ROW_SELECT,
    }),
    prisma.archiveEntry.aggregate({ _max: { seq: true } }),
    viewer.character ? loadForcedName(prisma, viewer.character.id) : null,
    viewer.character ? loadConcealment(prisma, viewer.character.id) : null,
  ]);

  // The name this character's own optimistic rows wear before the server
  // answers — forced beats concealed beats their own, the same resolution the
  // send route does, so an optimistic row never shows a name the confirmed
  // one will not.
  const identity = viewer.character
    ? presentedIdentity(viewer.character, { forcedName, concealment })
    : { name: null };

  // The right column. Everything in it is a fact about where this character
  // is standing, so it is loaded here and re-checked by every action the
  // panels call — a disabled button is a hint, never a lock.
  //
  // A GM watching a zone has no character, and therefore nothing to stand in,
  // nobody to act on and no Move to file. They get the feed and no column.
  const aside = viewer.character
    ? await (async () => {
        // The sheet FIRST. The viewer loader is shared with every feed route
        // and selects no tags, but the people pools, the affordances and the
        // carry line all read character.tags (and the role, for the gate) —
        // the page once handed them the bare viewer and fell over on the
        // first living character it met.
        const [sheet, gameConfig, openTurn] = await Promise.all([
          prisma.character.findUnique({
            where: { id: viewer.character.id },
            select: {
              resources: true,
              tags: { select: { tagId: true, quantity: true, equipped: true, tag: true } },
              role: { select: { slug: true } },
            },
          }),
          prisma.gameConfig.findUnique({ where: { id: 1 } }),
          prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, phase: true } }),
        ]);
        const character = { ...viewer.character, ...sheet };

        const [people, affordances, links, waiting, pools] = await Promise.all([
          whosHere(prisma, character),
          affordancesFor(prisma, character),
          character.locationId ? linksFor(prisma, character.locationId) : [],
          waitingOnYou(),
          // The people dialogs the sheet has, over the same pools the sheet
          // builds (web/lib/peoplePools.js) so the two cannot disagree about
          // who is standing near you.
          loadPeoplePools(character, { discordUserId: viewer.discordUserId, openTurn }),
        ]);
        const rooms = character.locationId
          ? await prisma.room.count({ where: { locationId: character.locationId } })
          : 0;
        return {
          people,
          affordances,
          rooms,
          exits: links.length,
          place: viewer.character.location ?? null,
          waiting: waiting.ok ? waiting.rows : [],
          selfId: character.id,
          pools,
          sheet,
          // What this character is carrying against their cap — the Transfer
          // dialog projects a hand-over off both.
          carry: carryStatus(character, gameConfig),
        };
      })()
    : null;

  // The @ list, and the lookup a {char:…} in a row resolves against — one
  // roster for both, so a mention can only ever name somebody the writer could
  // see and only ever render for a reader who could see them too. Concealed
  // people are deliberately absent: whosHere() puts them in `concealed`, which
  // carries an alias and no id.
  const mentionRoster = (aside?.people?.named ?? []).map((person) => ({
    id: person.characterId,
    name: person.name,
    updatedAt: person.avatarVersion,
  }));

  const hall = (
    <Hall
      initialPlaces={places}
      initialPlace={first.placeKey}
      initialRows={rows.reverse().map((row) => feedRowShape(row))}
      initialSeq={watermark._max.seq === null ? "0" : String(watermark._max.seq)}
      self={{
        characterId: viewer.character?.id ?? null,
        name: identity.name,
        avatarVersion: viewer.character?.updatedAt?.getTime?.() ?? null,
      }}
      aside={aside}
      webOnly={Boolean(viewer.character?.webOnly)}
      roster={mentionRoster}
    />
  );

  // Look at, Heal, Transfer, Loot, Bind, Free, Harm and Move Player are the
  // SHEET's dialogs, mounted here over the same pools rather than rebuilt.
  // Only the people half is handed down: the rest of the sheet's pools —
  // craft, paper, the bird, the Factory — belong to the sheet, and ActionGrid
  // is not mounted here at all.
  if (!aside) return hall;
  return (
    <CharacterMentionsProvider characters={mentionRoster}>
      <RequestActionsProvider
        selfId={viewer.character.id}
        selfName={viewer.character.name}
        characterTags={aside.sheet?.tags ?? []}
        resources={aside.sheet?.resources ?? 0}
        carry={aside.carry}
        examineBlocked={aside.pools.examineBlocked}
        canHeal={aside.pools.canHeal}
        healsLeft={aside.pools.healsLeft}
        healTargets={aside.pools.healTargets}
        healParties={{ characters: aside.pools.peopleParties, rooms: [] }}
        transferParties={{ characters: aside.pools.peopleParties, rooms: [] }}
        lootTargets={aside.pools.lootTargets}
        moveTargets={aside.pools.moveTargets}
        moveLocations={aside.pools.moveLocations}
        bindTargets={aside.pools.bindTargets}
        harmTargets={aside.pools.harmTargets}
        harmTags={aside.pools.harmTags}
      >
        {hall}
      </RequestActionsProvider>
    </CharacterMentionsProvider>
  );
}
