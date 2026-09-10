"use client";

import ChatMarkdown from "@/app/components/ChatMarkdown";
import FormError from "@/app/components/FormError";
import HereList from "@/app/components/HereList";
import PartyRack from "./PartyRack";
import PlaceCard from "./PlaceCard";
import RoomPanel from "./RoomPanel";
import TravelNodes from "./TravelNodes";
import YouPanel from "./YouPanel";
import { usePlaceActions } from "./PlacePanel";
import { useAsideTab } from "./asideTabStore";
import { useRequestActions } from "@/app/components/RequestActionsProvider";

// The right column, and — under 900px (useAsideFolded.js) — everything inside
// the ⋯ sheet. One component either way, because the folded version is the
// same sections in the same order; only the box around them changes. That is
// exactly true again as of the HERE change below: the sheet used to be handed
// an `inSheet` flag that held one section back, and it no longer is.
//
// WHY TABS. These were a stack down one scroller: where you are, who is here,
// the room you have open, the ways out, and you. Three of them are unbounded —
// the place card is as long as its prose, the travel grid is 6rem per exit,
// and YOU is four sub-blocks plus a waiting list — so the tallest thing on the
// page decided how far you scrolled to reach anything under it. Worse, two of
// them (the room, the party rack) render nothing at all when they have nothing
// to say, so the column's height moved every time you walked anywhere. One tab
// open at a time fixes both: the strip holds still and the panel under it
// scrolls on its own.
//
// WHY HERE IS NOT ONE OF THEM. It was, for an afternoon, and a playtester said
// what was wrong with that: pressing a tab to find out who you are standing
// with is tedious, because that is the question the page exists to answer and
// you want it answered the whole time, not on request. So the people are drawn
// at the top of PLACE — the tab this column opens on — and the four that are
// left are the things you go and look at.
//
// The honest cost: HERE is unbounded too, just in a different unit. It is one
// row per occupant, so a launch-day Town can push the place card below the
// fold of the DEFAULT tab. That is accepted rather than unnoticed. Capping it
// with a max-height and a scroller is the obvious fix and is the wrong one
// today: the person menu is a plain absolutely-positioned .chat-menu inside
// this list, so an overflow here would trap it in a scrollbox. A cap needs the
// menu moved onto .chat-menu-portal first (globals.css, the way placePanel()
// already does it) — that, then the cap.
//
// The affordance list and every dialog it opens are owned once, by
// usePlaceActions, so the sections share one answer about what can be worked
// here — that has not changed, and it is why the dialogs hang below the
// panel rather than inside whichever tab opened them.
// Exported because Chat.js keys the phone's avatar strip on it too. Same list,
// same identity: HereList seeds its rows into useState and so needs remounting
// when the server hands down a different set, and the strip used to have no key
// at all — it froze at whatever it mounted with while the column beside it
// refreshed, and the two could disagree about who was in the room.
export function hereKey(people) {
  const named = (people?.named ?? []).map((person) => person.characterId).join(",");
  return `here:${named}|${(people?.concealed ?? []).length}`;
}

export default function ChatAside({
  people,
  affordances,
  place,
  zone,
  placeLines,
  waiting,
  selfId,
  // The YOU column's own three: the open turn and this character's Move, the
  // sheet facts the status strip draws, and the Desire slots.
  turn,
  moveCharacterId,
  move,
  sheet,
  carry,
  desires,
  things,
  // Standing at the Depot with a licence or a keycard, and standing on
  // godflesh. Both decided on the server in page.js; the link's page and the
  // dialog's action each re-check their own gate.
  depotHref = null,
  canSeeExtract = false,
  selected,
  // `/travel <somewhere>` reaching in from the composer. It selects the node
  // and opens its confirm strip; the Go button is still what moves anybody.
  travelPick = null,
  // The open place, so HereList's person menu can offer "Add to …" for a
  // conversation or a private room.
  addPlace = null,
  onAddMember = null,
  // Something in this column changed the place — a paper pinned, a gate
  // flipped. Chat.js re-reads what it draws off the same board.
  onPlaceChanged = null,
  // Chat.js owns the map overlay, not this component: it writes ChatAside
  // twice (the desktop column and the ⋯ sheet), so a Modal mounted here would
  // be two declarations of the same overlay.
  onOpenMap = null,
}) {
  const { affordances: live, openFixture, openConverse, say, notice, error, pending, dialogs } =
    usePlaceActions(affordances, onPlaceChanged);
  // Extract is the SHEET's dialog, mounted on this page (play/page.js) over
  // the same two facts the sheet resolves — there is no second copy of it.
  const requestActions = useRequestActions();
  const openAction = requestActions?.open ?? null;
  // Research (CRAFTING.md §2b): the same canResearch/researchHint pool the
  // sheet's Research row reads (TagRail.js), computed once by the provider
  // off the atCathedral/holdsResearch/researchOptions props play/page.js
  // hands it — nothing extra to thread through this column.
  const canResearch = requestActions?.pools?.canResearch ?? false;
  const researchHint = requestActions?.pools?.researchHint ?? null;

  // The Location's own fixtures. Travel, Who's here?, Secret rooms? and
  // Examine are filtered out: the first is the node grid below, and the other
  // three only ever answered a question this column now answers by being on
  // the page. They stay in db/lib/placeAffordances.js for the Discord anchor,
  // which has no column beside it.
  const fixtures = live.filter(
    (entry) =>
      (entry.kind === "place" && entry.id === "noticeboard") ||
      entry.kind === "gate" ||
      entry.kind === "keyed",
  );

  // The tabs this place actually has. ROOM appears only when a room is open,
  // which is a thing you did rather than an accident of layout. The sheet and
  // the column now offer the same four — the people are in PLACE, and the one
  // thing the sheet does differently is not drawing them (see below).
  const tabs = [
    { id: "place", label: "Place" },
    selected?.kind === "room" && { id: "room", label: "Room" },
    { id: "travel", label: "Travel" },
    { id: "you", label: "You" },
  ].filter(Boolean);
  const [openTab, setOpenTab] = useAsideTab(
    tabs.map((tab) => tab.id),
    "place",
  );

  return (
    <div className="chat-aside-tabs">
      <div className="chat-tabstrip" role="tablist" aria-label="This place">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`chat-tab-${tab.id}`}
            aria-selected={openTab === tab.id}
            aria-controls={`chat-panel-${tab.id}`}
            className="chat-tab"
            data-open={openTab === tab.id ? "true" : undefined}
            onClick={() => setOpenTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* One scroller for whichever panel is open, so the column's height is
          the column's height whatever is in it. */}
      <div
        className="chat-aside-panel"
        role="tabpanel"
        id={`chat-panel-${openTab}`}
        aria-labelledby={`chat-tab-${openTab}`}
      >
        {openTab === "place" && (
          <>
            {/* The people first, above the Location's own words: this is what
                the reader came to the column for, and the prose under it can
                be a paragraph long. Keyed on the SERVER's own list so a move —
                which re-renders this page and hands down a new one — remounts
                the list rather than leaving the poll's answer for the street
                you have left.

                In the ⋯ sheet too, which it was not before. The old gate said
                two pollers on one screen, and that was never true: the phone's
                avatar strip (Chat.js) passes no `poll` and HereList defaults it
                off, so the strip has never polled anything. What the gate
                actually cost was the 720-900px band, where the sheet is mounted
                but the strip is still CSS-hidden — who is standing here was
                drawn NOWHERE in it — and a sheet titled "Here" with no people
                in it under 720 as well. */}
            <HereList
              key={hereKey(people)}
              people={people}
              selfId={selfId}
              onConverse={openConverse}
              addPlace={addPlace}
              onAddMember={onAddMember}
              poll
            />
            <PlaceCard
              place={place}
              zone={zone}
              lines={placeLines}
              fixtures={fixtures}
              onFixture={openFixture}
              onConverse={openConverse}
              depotHref={depotHref}
              onFactory={canSeeExtract && openAction ? () => openAction("extract") : null}
              onResearch={canResearch && openAction ? () => openAction("research") : null}
              researchHint={researchHint}
              onOpenMap={onOpenMap}
              pending={pending}
            />
            {/* What the action said back. A server string a player reads, so
                it is rendered rather than printed — several of them carry a
                `-#` or a `**` because the same sentence goes out to Discord. */}
            {notice && (
              <div className="chat-quiet-line">
                <ChatMarkdown content={notice} />
              </div>
            )}
            <FormError>{error}</FormError>
            {/* BELOW the place card, not above it. You pick somebody off the
                people list at the top and they follow you down the Travel tab
                (docs/systemdocs/MAP.md §3a), so it wants to be near them — but
                it fetches its party on mount and draws nothing until that lands,
                and above the card that meant the Location's prose jumping down
                a card-height on every visit to the default tab. Anything that
                appears late goes under the things that do not.

                It used to live inside the desktop-only HERE tab, which meant a
                phone could not reach the party at all. */}
            <PartyRack />
          </>
        )}

        {openTab === "room" && (
          <RoomPanel
            selected={selected}
            affordances={live}
            onFixture={openFixture}
            pending={pending}
          />
        )}

        {openTab === "travel" && <TravelNodes onDone={say} pick={travelPick} />}

        {openTab === "you" && (
          <YouPanel
            initialWaiting={waiting}
            turn={turn}
            move={move}
            moveCharacterId={moveCharacterId}
            status={{ resources: sheet?.resources ?? 0, carry, tags: sheet?.tags ?? [] }}
            desires={desires}
            things={things}
          />
        )}
      </div>

      {/* Outside the panel on purpose: a dialog opened from one tab must not
          unmount because the reader pressed another. */}
      {dialogs}
    </div>
  );
}
