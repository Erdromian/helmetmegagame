"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import EmptyState from "@/app/components/EmptyState";
import Modal from "@/app/components/Modal";
import HallAside from "./HallAside";
import HereList from "./HereList";
import PlacesColumn, { PlacesTabs } from "./PlacesColumn";
import useNarrow from "./useNarrow";
import Feed from "./Feed";
import { playChime, chimedRecently } from "@/app/components/chime";
import useHallChimeMuted, { hallChimeMuted } from "@/app/components/useHallChimeMuted";
import { useSeen, markSeen, seedSeenIfFresh } from "./seenStore";
import { noteTyping } from "./typingStore";
import {
  usePlaces,
  setPlaces,
  seedRows,
  applyRow,
  removeRow,
  newestSeq,
  markHistoryLoaded,
  historyLoaded,
} from "./feedStore";

// The Hall: everywhere this character can hear, and one of them open.
//
// ONE EventSource for the whole tab, not one per place. Phase 0 opened a
// stream per place, which was fine when there was one; a Hall has a Location,
// its Rooms, the conversations you are in and the zone summary, and a browser
// allows six connections per origin. So `/api/feed?since=` carries every place
// the viewer may read and says which those are with its own `places` event —
// which is also how walking into somewhere new reaches an open page without a
// reload.

// Which place is open lives in the URL hash, so a reload keeps it and a
// browser Back leaves the room the way it came. Read through
// useSyncExternalStore rather than an effect: react-hooks/set-state-in-effect
// is an error here, and the hash is exactly the kind of external mutable
// value that store is for.
function subscribeToHash(callback) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function readHash() {
  return window.location.hash.slice(1);
}

function readServerHash() {
  return "";
}

function decodeHash(hash) {
  if (!hash) return null;
  try {
    return decodeURIComponent(hash);
  } catch {
    return null;
  }
}

export default function Hall({
  initialPlaces,
  initialPlace,
  initialRows,
  initialSeq,
  self,
  aside,
  autocorrect = false,
  webOnly = false,
  // The people standing here, for the composer's @ list. The page hands the
  // same list to CharacterMentionsProvider, so what can be typed and what can
  // be rendered are one roster.
  roster = [],
  // A GM watching with no living character, and whether this character is
  // carrying an instant camera. Both only decide which controls a feed row
  // draws; the server re-decides every one of them when it is pressed.
  gm = false,
  hasCamera = false,
}) {
  // The server's list is the first paint; the stream replaces it whole from
  // its first `places` event onward.
  const router = useRouter();
  const streamed = usePlaces();
  const places = streamed.length > 0 ? streamed : initialPlaces;
  const seen = useSeen();

  const hash = decodeHash(useSyncExternalStore(subscribeToHash, readHash, readServerHash));
  const byKey = useMemo(() => new Map(places.map((place) => [place.placeKey, place])), [places]);
  // A hash naming somewhere you have left falls back to the first place, so a
  // stale bookmark opens the street rather than a blank column.
  const selectedKey = (hash && byKey.has(hash) ? hash : null) ?? initialPlace ?? places[0]?.placeKey ?? null;
  const selected = selectedKey ? (byKey.get(selectedKey) ?? null) : null;

  const onSelect = useCallback((placeKey) => {
    window.location.hash = encodeURIComponent(placeKey);
  }, []);

  // The newest thing said in a place: whatever this tab has heard live, or —
  // before any of it is loaded — the watermark the server sent with the list.
  const newest = useCallback((place) => newestSeq(place.placeKey) ?? place.newestSeq ?? null, []);

  const onSeen = useCallback((placeKey, seq) => markSeen(placeKey, seq), []);

  // A browser opening the Hall for the first time starts caught up rather
  // than with a dot beside everywhere it can hear. In a state INITIALIZER, so
  // it has run before the first client paint — from an effect it ran after
  // it, and every place flashed its unread dot for a frame on a first visit.
  // Not an effect and not a bare render-time write: the initializer is the
  // one place React runs a thing like this exactly once.
  useState(() => {
    if (typeof window === "undefined") return null;
    try {
      seedSeenIfFresh(initialPlaces.map((entry) => ({ placeKey: entry.placeKey, seq: entry.newestSeq })));
    } catch {
      // localStorage can be refused outright. A missing seed costs a dot,
      // nothing more.
    }
    return null;
  });

  // The phone's ⋯ sheet. The right column has no room to stand on a narrow
  // screen, so it comes up over the scene instead — the same three panels,
  // rendered by the same component.
  const [chimeMuted, setChimeMuted] = useHallChimeMuted();

  const narrow = useNarrow();
  const [sheetOpen, setSheetOpen] = useState(false);
  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  // One stream for the tab. `since` is the seq the server render was taken at,
  // so the catch-up carries what happened while the page was loading and
  // nothing that was already in it.
  useEffect(() => {
    seedRows(initialPlace, initialRows);
    setPlaces(initialPlaces);
    if (initialPlace) markHistoryLoaded(initialPlace);

    // The stream announces the place list once as it opens, which for a page
    // that was server-rendered a moment ago says nothing new — so the FIRST
    // one refreshes nothing and every one after it does. An EventSource that
    // reconnects on its own keeps these handlers, so this is per mount rather
    // than per connection.
    let sawPlaces = false;

    const source = new EventSource(`/api/feed?since=${encodeURIComponent(initialSeq ?? "0")}`);
    source.addEventListener("message", (event) => {
      try {
        const row = JSON.parse(event.data);
        applyRow(row.placeKey, row);
        // Somebody said your name. The token is what the row is made of on
        // both faces (HALL.md §5), so this rings for a Discord-origin mention
        // exactly as it does for a web one — and never for your own words.
        if (
          self?.characterId &&
          row.characterId !== self.characterId &&
          typeof row.content === "string" &&
          row.content.includes(`{char:${self.characterId}}`) &&
          !hallChimeMuted() &&
          !chimedRecently()
        ) {
          playChime(0.35);
        }
      } catch {
        // A malformed frame is not worth tearing the stream down over.
      }
    });
    // Somebody is writing something, here or on Discord. Held for six seconds
    // by typingStore.js and never sent for the viewer's own character.
    source.addEventListener("typing", (event) => {
      try {
        noteTyping(JSON.parse(event.data));
      } catch {
        // Same.
      }
    });
    // A delete carries only a seq and its place: the words somebody took back
    // never come back down the wire.
    source.addEventListener("delete", (event) => {
      try {
        const data = JSON.parse(event.data);
        removeRow(data?.placeKey, data?.seq);
      } catch {
        // Same.
      }
    });
    // Their feet moved, a key turned, or somebody let them into a
    // conversation. The server has already resubscribed; this is the column
    // catching up with it.
    source.addEventListener("places", (event) => {
      try {
        setPlaces(JSON.parse(event.data)?.places ?? []);
        // This event only ever fires because the VIEWER's own presence
        // changed — their feet moved, a key turned, somebody let them into a
        // conversation — and the right column is server props off page.js
        // (where you are, who is here, the Examine lines, the rooms a
        // Transfer can reach). Nothing else refreshes them, so without this
        // a walk across town left the column describing the old street. The
        // feed store is client state and survives the refresh.
        if (sawPlaces) router.refresh();
        sawPlaces = true;
      } catch {
        // Same.
      }
    });
    // EventSource reconnects by itself; the server's catch-up is bounded by
    // `since`, so a reconnect repeats little and the store dedupes by seq.
    return () => source.close();
  }, [initialPlace, initialPlaces, initialRows, initialSeq, self?.characterId, router]);

  // What was said BEFORE the page opened, for a place the reader has just
  // chosen. The stream only ever carries what happens next, so without this a
  // room opened for the first time would look empty until somebody spoke.
  useEffect(() => {
    if (!selectedKey || historyLoaded(selectedKey)) return;
    markHistoryLoaded(selectedKey);
    let cancelled = false;
    fetch(`/api/feed/history?place=${encodeURIComponent(selectedKey)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.rows) return;
        seedRows(selectedKey, data.rows);
      })
      .catch(() => {
        // The stream still fills this place in as people speak. Nothing to
        // say to the reader that an empty scene does not already say.
      });
    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  if (places.length === 0) {
    return (
      <div className="hall-body hall-body--empty">
        <div className="panel">
          <EmptyState>You are nowhere yet. ‡</EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="hall-body">
      <PlacesColumn
        places={places}
        selected={selectedKey}
        seen={seen}
        newest={newest}
        onSelect={onSelect}
        webOnly={webOnly}
        chimeMuted={chimeMuted}
        onToggleChime={setChimeMuted}
      />
      <div className="hall-centre">
        <PlacesTabs places={places} selected={selectedKey} seen={seen} newest={newest} onSelect={onSelect} />
        {/* On a phone the people are an avatar strip under the place header,
            opening the same per-person menu the column's rows do. It draws
            nowhere else — CSS hides it above 720px. */}
        {aside && <HereList people={aside.people} selfId={aside.selfId} strip />}
        <Feed
          place={selected}
          self={self}
          autocorrect={autocorrect}
          onSeen={onSeen}
          onOpenSheet={aside ? openSheet : null}
          roster={roster}
          gm={gm}
          hasCamera={hasCamera}
        />
      </div>
      {/* ONE of these ever mounts. The CSS hides the column under 720px, but
          hiding is not unmounting: both copies used to be live at once on a
          phone, which meant two travel loads, two stash reads and two
          separate answers about what can be worked here. */}
      {aside && !narrow && (
        <aside className="hall-aside">
          {/* The OPEN place, so the room panel knows which room's storage and
              fixtures to draw — the whole reason the Council Room's Intercom
              used to show up in the Kitchens. */}
          <HallAside {...aside} selected={selected} />
        </aside>
      )}
      {aside && narrow && sheetOpen && (
        <Modal open title="Here ‡" onClose={closeSheet} panelClassName="modal-panel hall-sheet">
          <HallAside {...aside} selected={selected} inSheet />
        </Modal>
      )}
    </div>
  );
}
