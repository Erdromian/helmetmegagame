"use client";

import ChatMarkdown from "@/app/components/ChatMarkdown";
import FormError from "@/app/components/FormError";
import { TONE_CLASS } from "../PlacePanel";
import { fixturesFor } from "../fixtures";

// WHAT IS ON THE WALLS, over the scene — for as long as the right column is
// folded into its drawer (under 900px, ../useAsideFolded.js).
//
// A phone reached the Phone, the Infoterminal and every other fixture only by
// opening the 👥 drawer, which is labelled "Who is here". Players looking for a
// telephone had no reason to look behind a people icon, and reported that they
// could not find one at all. The phone in their hand was worse: its handset bar
// lived in the same drawer, so a receiver ringing in their hand showed nothing
// with the drawer shut.
//
// So under the travel strip, the open place's fixtures (../fixtures.js — the
// same filter the column draws from, so the two can never disagree), the
// handset bar while a phone is held, and the line the last fixture answered
// with. Drawn off the ONE usePlaceActions bag ChatNext owns, which is also what
// the drawer draws from: a gate flipped here relabels itself there.
//
// Nothing at all when there is nothing to say, which is most rooms: a strip
// over the scene is height taken from the one thing a phone is for.
export default function FixtureStrip({ selected, placeActions }) {
  const { affordances, openFixture, notice, error, pending, phoneBar } = placeActions;
  const fixtures = fixturesFor(affordances, selected);

  // `phoneBar` is always an element; the handset bar inside it draws nothing
  // until a phone is in this character's hand, so it is placed unconditionally
  // and the strip's own frame hides itself around it when empty (chat-next.css).
  return (
    <div className="chat-fixture-strip">
      {phoneBar}
      {fixtures.length > 0 && (
        <div className="chat-fixture-row" data-swipe-ignore role="group" aria-label={selected?.name ?? "Here"}>
          {fixtures.map((entry) => (
            <button
              key={`${entry.id}:${entry.roomId ?? entry.linkId ?? ""}`}
              type="button"
              className={TONE_CLASS[entry.tone] ?? "btn-secondary"}
              disabled={pending}
              onClick={() => openFixture(entry)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
      {notice && (
        <div className="chat-quiet-line">
          <ChatMarkdown content={notice} />
        </div>
      )}
      <FormError>{error}</FormError>
    </div>
  );
}
