"use client";

import HereList from "./HereList";
import PlacePanel from "./PlacePanel";
import YouPanel from "./YouPanel";

// The right column, and — under 720px — everything inside the ⚡ sheet. One
// component either way, because the phone's version is the same three panels
// in the same order; only the box around them changes.
export default function HallAside({ people, affordances, place, rooms, exits, waiting, selfId, sheet = false }) {
  return (
    <>
      {/* On a phone the people are a strip under the place header instead —
          Hall.js draws that one, so the sheet does not draw them twice. */}
      {!sheet && <HereList people={people} selfId={selfId} />}
      <PlacePanel initialAffordances={affordances} place={place} rooms={rooms} exits={exits} />
      <YouPanel initialWaiting={waiting} />
    </>
  );
}
