"use client";

import ChatMarkdown from "@/app/components/ChatMarkdown";
import FormError from "@/app/components/FormError";
import HereList from "./HereList";
import PlaceCard from "./PlaceCard";
import RoomPanel from "./RoomPanel";
import TravelNodes from "./TravelNodes";
import YouPanel from "./YouPanel";
import { usePlaceActions } from "./PlacePanel";

// The right column, and — under 720px — everything inside the ⋯ sheet. One
// component either way, because the phone's version is the same sections in
// the same order; only the box around them changes.
//
// Top to bottom: where you are, who is here, the room you have open, the ways
// out, and you. The affordance list and every dialog it opens are owned once,
// by usePlaceActions, so the sections share one answer about what can be
// worked here.
function hereKey(people) {
  const named = (people?.named ?? []).map((person) => person.characterId).join(",");
  return `here:${named}|${(people?.concealed ?? []).length}`;
}

export default function HallAside({
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
  selected,
  // `/travel <somewhere>` reaching in from the composer. It selects the node
  // and opens its confirm strip; the Go button is still what moves anybody.
  travelPick = null,
  // The open place, so HereList's person menu can offer "Add to …" for a
  // conversation or a private room.
  addPlace = null,
  onAddMember = null,
  // Something in this column changed the place — a paper pinned, a gate
  // flipped. Hall.js re-reads what it draws off the same board.
  onPlaceChanged = null,
  // The phone's ⋯ sheet, NOT the character sheet — `aside.sheet` is spread
  // in here too and a flag called `sheet` was silently always truthy, which
  // is what kept HERE off the desktop column.
  inSheet = false,
}) {
  const { affordances: live, openFixture, openConverse, say, notice, error, pending, dialogs } =
    usePlaceActions(affordances, onPlaceChanged);

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

  return (
    <>
      <PlaceCard
        place={place}
        zone={zone}
        lines={placeLines}
        fixtures={fixtures}
        onFixture={openFixture}
        onConverse={openConverse}
        pending={pending}
      />
      {/* What the action said back. A server string a player reads, so it is
          rendered rather than printed — several of them carry a `-#` or a
          `**` because the same sentence goes out to Discord. */}
      {notice && (
        <div className="hall-quiet-line">
          <ChatMarkdown content={notice} />
        </div>
      )}
      <FormError>{error}</FormError>

      {/* On a phone the people are a strip under the place header instead —
          Hall.js draws that one, so the sheet does not draw them twice. */}
      {/* Keyed on the SERVER's own list so a move — which re-renders this
          page and hands down a new one — remounts the list rather than
          leaving the poll's answer for the street you have left. It polls
          from here and only from here: the phone's strip is the same rows
          drawn by Hall.js, and two pollers on one screen is one too many. */}
      {!inSheet && (
        <HereList
          key={hereKey(people)}
          people={people}
          selfId={selfId}
          onConverse={openConverse}
          addPlace={addPlace}
          onAddMember={onAddMember}
          poll
        />
      )}

      <RoomPanel selected={selected} affordances={live} onFixture={openFixture} pending={pending} />
      <TravelNodes onDone={say} pick={travelPick} />
      <YouPanel
        initialWaiting={waiting}
        turn={turn}
        move={move}
        status={{ resources: sheet?.resources ?? 0, carry, tags: sheet?.tags ?? [] }}
        desires={desires}
      />

      {dialogs}
    </>
  );
}
