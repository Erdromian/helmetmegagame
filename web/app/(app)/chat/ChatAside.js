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

// The right column, and — under 720px — everything inside the ⋯ sheet. One
// component either way, because the phone's version is the same sections in
// the same order; only the box around them changes.
//
// WHY TABS. These five were a stack down one scroller: where you are, who is
// here, the room you have open, the ways out, and you. Three of them are
// unbounded — the place card is as long as its prose, the travel grid is
// 6rem per exit, and YOU is four sub-blocks plus a waiting list — so the
// tallest thing on the page decided how far you scrolled to reach anything
// under it. Worse, two of them (the room, the party rack) render nothing at
// all when they have nothing to say, so the column's height moved every time
// you walked anywhere. One tab open at a time fixes both: the strip holds
// still and the panel under it scrolls on its own.
//
// The affordance list and every dialog it opens are owned once, by
// usePlaceActions, so the sections share one answer about what can be worked
// here — that has not changed, and it is why the dialogs hang below the
// panel rather than inside whichever tab opened them.
function hereKey(people) {
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
  // The phone's ⋯ sheet, NOT the character sheet — `aside.sheet` is spread
  // in here too and a flag called `sheet` was silently always truthy, which
  // is what kept HERE off the desktop column.
  inSheet = false,
  // Chat.js owns the map overlay, not this component: ChatAside renders twice
  // on a phone (the desktop column and the "Here" sheet), and a Modal mounted
  // here would be two of them.
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

  // The tabs this place actually has. HERE is the desktop column's alone —
  // on a phone those rows are the strip Chat.js draws under the header, and
  // two pollers on one screen is one too many. ROOM appears only when a room
  // is open, which is a thing you did rather than an accident of layout.
  const tabs = [
    { id: "place", label: "Place" },
    !inSheet && { id: "here", label: "Here" },
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
          </>
        )}

        {openTab === "here" && (
          <>
            {/* Keyed on the SERVER's own list so a move — which re-renders
                this page and hands down a new one — remounts the list rather
                than leaving the poll's answer for the street you have left. */}
            <HereList
              key={hereKey(people)}
              people={people}
              selfId={selfId}
              onConverse={openConverse}
              addPlace={addPlace}
              onAddMember={onAddMember}
              poll
            />
            {/* With the people rather than between two lists now: you pick
                somebody off the list above and they follow you down the
                Travel tab (docs/systemdocs/MAP.md §3a). */}
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
