"use client";

import { memo, useEffect, useRef } from "react";
import IconButton from "@/app/components/IconButton";
import HoverCard from "@/app/components/HoverCard";
import { BellIcon, BellOffIcon, BellRingIcon, SendIcon } from "@/app/components/icons";
import { isUnread } from "./seenStore";
import { useFolded } from "./sectionFold";

// The left column of Chat: everywhere this character may read, grouped the
// way a person would think of them.
//
//   MESSAGES       Bascinet — the DM conversation, a pseudo-place (./DmPane.js)
//   SUMMARY        the zone's own channel — the widest room
//   RADIO          the frequencies you are carrying a radio for
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
  // A radio net: nowhere at all, carried in your pack (db/lib/specialChannels.js).
  if (place.kind === "net") return "∿";
  // The faction is a pseudo-place: a banner, not a door. It has no channel —
  // the panel it opens is a roster (./FactionPanel.js).
  if (place.kind === "faction") return "⚑";
  // Bascinet is a pseudo-place too: the DM conversation, drawn by ./DmPane.js.
  if (place.kind === "dm") return "✉";
  return place.roomKind === "PRIVATE" ? "▪" : "";
}

// A row with a description shows it on hover or focus. Through HoverCard
// because the column scrolls, and a tooltip drawn in-tree would be clipped by
// it; `pinnable={false}` because the row is a button already — one tab stop,
// Enter still selects the place, nothing sticks open. A row with nothing to
// say (a Conversation, Bascinet, the faction) is a bare button, so thirty
// rows do not each mount a portal. Phones get no hover and none of this: the
// column is not rendered under 720px, and the place you are standing in has
// its description at the top of the ⋯ sheet.
const PlaceRow = memo(function PlaceRow({ place, active, unread, onSelect }) {
  const button = (
    <button
      type="button"
      className="chat-place"
      data-active={active ? "true" : "false"}
      onClick={() => onSelect(place.placeKey)}
    >
      <span className="chat-glyph" aria-hidden="true">
        {glyph(place)}
      </span>
      <span className="chat-place-name">{place.name}</span>
      {unread && <span className="chat-dot" aria-label="Unread" />}
    </button>
  );
  const description = place.description?.trim();
  if (!description) return button;
  return (
    <HoverCard
      pinnable={false}
      className="chat-place-hover"
      panel={
        <>
          <span className="chat-tip-name">{place.name}</span>
          <span className="chat-tip-desc">{description}</span>
        </>
      }
    >
      {button}
    </HoverCard>
  );
});

// A section folds shut, and stays shut across visits (./sectionFold.js). A
// Keep with eight rooms used to push Conversations off the bottom of the
// column, and nothing else here can make the list shorter.
//
// A fold NEVER hides an unread place. Somebody who folded Rooms in a quiet
// hour would otherwise stop being told anything was said in one, and a column
// that silently withholds a waiting conversation is worse than a long column.
function Section({ title, places, selected, seen, newest, onSelect }) {
  const [folded, toggleFolded] = useFolded(title);
  // Hooks first: this return has to sit under them.
  if (places.length === 0) return null;
  const unreadOf = (place) =>
    place.placeKey !== selected && isUnread(seen, place.placeKey, newest(place));
  const shown = folded ? places.filter((place) => unreadOf(place)) : places;
  const hidden = places.length - shown.length;
  return (
    <div className="chat-section">
      <button
        type="button"
        className="chat-section-title chat-section-fold"
        aria-expanded={!folded}
        onClick={toggleFolded}
      >
        <span className="chat-fold-mark" aria-hidden="true">
          {folded ? "▸" : "▾"}
        </span>
        {title}
        {hidden > 0 && <span className="chat-fold-count mono">{hidden}</span>}
      </button>
      {shown.map((place) => (
        <PlaceRow
          key={place.placeKey}
          place={place}
          active={place.placeKey === selected}
          unread={unreadOf(place)}
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
  // The push toggle beside the bell. Null on a browser with no PushManager,
  // and on a deployment with no VAPID keys set (CHAT.md §5a).
  push = null,
}) {
  const here = places.filter((p) => p.kind === "loc");
  const rooms = places.filter((p) => p.kind === "room");
  const conversations = places.filter((p) => p.kind === "conv");
  const summary = places.filter((p) => p.kind === "zone");
  const nets = places.filter((p) => p.kind === "net");
  const faction = places.filter((p) => p.kind === "faction");
  const messages = places.filter((p) => p.kind === "dm");

  return (
    <nav className="chat-places" aria-label="Places">
      {/* First, above the street: what the game has said to YOU. It is about
          the player rather than the place, and it is where a turn result
          lands, so it sits where a glance finds it (CHAT.md §2b). */}
      <Section title="Messages" places={messages} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      <Section title="Summary" places={summary} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      {/* The frequencies, beside the other channel that is not a room you are
          standing in. A radio goes where you go, so it sits above the street
          rather than inside it. */}
      <Section title="Radio" places={nets} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      <Section title="Here" places={here} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      <Section title="Rooms" places={rooms} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      <Section
        title="Conversations"
        places={conversations}
        selected={selected}
        seen={seen}
        newest={newest}
        onSelect={onSelect}
      />
      {/* Last, under the places a voice can reach: the people you are in it
          with, wherever they are standing. One row, and it opens a panel
          rather than a feed. */}
      <Section title="Faction" places={faction} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      {/* The foot: the one preference this column carries — whether being
          named in a scene makes a sound, per browser rather than per
          character (useChatChimeMuted.js) — and the quiet reminder that this
          character's Discord account is out of every channel, so this page is
          the whole of the game for them (CHAT.md §6). An icon and a chip
          rather than two sentences: the column is 15rem wide and the places
          are what it is for. */}
      <div className="chat-places-foot">
        {onToggleChime && (
          <IconButton
            icon={chimeMuted ? BellOffIcon : BellIcon}
            label={chimeMuted ? "Mentions are silent" : "Mentions chime"}
            aria-pressed={!chimeMuted}
            onClick={() => onToggleChime(!chimeMuted)}
          />
        )}
        {push && (
          <IconButton
            icon={push.on ? BellRingIcon : SendIcon}
            label={push.on ? "Notifications on" : "Notify me"}
            aria-pressed={push.on}
            disabled={push.busy}
            onClick={push.onToggle}
          />
        )}
        {webOnly && <span className="chip chat-webonly">Playing from the web</span>}
      </div>
    </nav>
  );
}

// The phone's version of the same list. .tab-bar / .tab-item are the app's
// tab strip (DESIGN-SYSTEM.md §5) — a strip that navigates between panels,
// keyed on data-active, which is exactly what this is.
export function PlacesTabs({ places, selected, seen, newest, onSelect }) {
  const stripRef = useRef(null);
  // The open tab is brought into the strip's view whenever it changes — a
  // search hit, `/travel`, a link into a room can all open a place whose tab
  // is off the edge of the phone. By moving the strip's own scrollLeft, never
  // scrollIntoView: that walks every scrollable ancestor and would drag the
  // whole screen with it.
  useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector('[data-active="true"]');
    if (!strip || !tab) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  }, [selected]);
  return (
    <div ref={stripRef} className="tab-bar chat-tabs" role="tablist" aria-label="Places">
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
            <span className="chat-dot" aria-label="Unread" />
          )}
        </button>
      ))}
    </div>
  );
}
