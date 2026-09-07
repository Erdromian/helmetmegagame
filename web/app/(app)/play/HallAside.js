"use client";

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
  selected,
  // The phone's ⋯ sheet, NOT the character sheet — `aside.sheet` is spread
  // in here too and a flag called `sheet` was silently always truthy, which
  // is what kept HERE off the desktop column.
  inSheet = false,
}) {
  const { affordances: live, openFixture, openConverse, say, notice, error, pending, dialogs } =
    usePlaceActions(affordances);

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
      {notice && <p className="hall-quiet-line">{notice}</p>}
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
          poll
        />
      )}

      <RoomPanel selected={selected} affordances={live} onFixture={openFixture} pending={pending} />
      <TravelNodes onDone={say} />
      <YouPanel initialWaiting={waiting} />

      {dialogs}
    </>
  );
}
