"use client";

import { memo } from "react";
import IconButton from "@/app/components/IconButton";
import { BellIcon, BellOffIcon } from "@/app/components/icons";
import { isUnread } from "./seenStore";

// The left column of the Hall: everywhere this character may read, grouped the
// way a person would think of them.
//
//   SUMMARY        the zone's own channel — the widest room, so it sits on top
//   HERE           the Location you are standing in — scenery, not speech
//   ROOMS          the public rooms off it, then the private ones you can open
//   CONVERSATIONS  the private threads you are in
//
// Under 720px the same list is a horizontal .tab-bar of .tab-item above the
// feed, which is the second half of this file. The sections are the only
// difference between the two: a tab strip has no room for headings, so the
// glyph carries the kind instead.

// A private Room wears a key, a Location wears the door it is. One character
// each, because the column is 15rem wide and a label is what people read.
function glyph(place) {
  if (place.kind === "loc") return "▸";
  if (place.kind === "conv") return "»";
  if (place.kind === "zone") return "▤";
  return place.roomKind === "PRIVATE" ? "▪" : "";
}

const PlaceRow = memo(function PlaceRow({ place, active, unread, onSelect }) {
  return (
    <button
      type="button"
      className="hall-place"
      data-active={active ? "true" : "false"}
      onClick={() => onSelect(place.placeKey)}
    >
      <span className="hall-glyph" aria-hidden="true">
        {glyph(place)}
      </span>
      <span className="hall-place-name">{place.name}</span>
      {unread && <span className="hall-dot" aria-label="Unread ‡" />}
    </button>
  );
});

function Section({ title, places, selected, seen, newest, onSelect }) {
  if (places.length === 0) return null;
  return (
    <div className="hall-section">
      <p className="hall-section-title">{title}</p>
      {places.map((place) => (
        <PlaceRow
          key={place.placeKey}
          place={place}
          active={place.placeKey === selected}
          unread={place.placeKey !== selected && isUnread(seen, place.placeKey, newest(place))}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export default function PlacesColumn({
  places,
  selected,
  seen,
  newest,
  onSelect,
  webOnly = false,
  chimeMuted = false,
  onToggleChime = null,
}) {
  const here = places.filter((p) => p.kind === "loc");
  const rooms = places.filter((p) => p.kind === "room");
  const conversations = places.filter((p) => p.kind === "conv");
  const summary = places.filter((p) => p.kind === "zone");

  return (
    <nav className="hall-places" aria-label="Places ‡">
      <Section title="Summary ‡" places={summary} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      <Section title="Here ‡" places={here} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      <Section title="Rooms ‡" places={rooms} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      <Section
        title="Conversations ‡"
        places={conversations}
        selected={selected}
        seen={seen}
        newest={newest}
        onSelect={onSelect}
      />
      {/* The foot: the one preference this column carries — whether being
          named in a scene makes a sound, per browser rather than per
          character (useHallChimeMuted.js) — and the quiet reminder that this
          character's Discord account is out of every channel, so this page is
          the whole of the game for them (HALL.md §6). An icon and a chip
          rather than two sentences: the column is 15rem wide and the places
          are what it is for. */}
      <div className="hall-places-foot">
        {onToggleChime && (
          <IconButton
            icon={chimeMuted ? BellOffIcon : BellIcon}
            label={chimeMuted ? "Mentions are silent ‡" : "Mentions chime ‡"}
            aria-pressed={!chimeMuted}
            onClick={() => onToggleChime(!chimeMuted)}
          />
        )}
        {webOnly && <span className="chip hall-webonly">Playing from the web ‡</span>}
      </div>
    </nav>
  );
}

// The phone's version of the same list. .tab-bar / .tab-item are the app's
// tab strip (DESIGN-SYSTEM.md §5) — a strip that navigates between panels,
// keyed on data-active, which is exactly what this is.
export function PlacesTabs({ places, selected, seen, newest, onSelect }) {
  return (
    <div className="tab-bar hall-tabs" role="tablist" aria-label="Places ‡">
      {places.map((place) => (
        <button
          key={place.placeKey}
          type="button"
          role="tab"
          className="tab-item"
          aria-selected={place.placeKey === selected}
          data-active={place.placeKey === selected ? "true" : "false"}
          onClick={() => onSelect(place.placeKey)}
        >
          {place.name}
          {place.placeKey !== selected && isUnread(seen, place.placeKey, newest(place)) && (
            <span className="hall-dot" aria-label="Unread ‡" />
          )}
        </button>
      ))}
    </div>
  );
}
