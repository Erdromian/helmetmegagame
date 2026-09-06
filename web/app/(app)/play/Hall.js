"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import EmptyState from "@/app/components/EmptyState";
import Modal from "@/app/components/Modal";
import HallAside from "./HallAside";
import HereList from "./HereList";
import PlacesColumn, { PlacesTabs } from "./PlacesColumn";
import Feed from "./Feed";
import { useSeen, markSeen } from "./seenStore";
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

export default function Hall({ initialPlaces, initialPlace, initialRows, initialSeq, self, aside }) {
  // The server's list is the first paint; the stream replaces it whole from
  // its first `places` event onward.
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

  // The phone's ⚡ sheet. The right column has no room to stand on a narrow
  // screen, so it comes up over the scene instead — the same three panels,
  // rendered by the same component.
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

    const source = new EventSource(`/api/feed?since=${encodeURIComponent(initialSeq ?? "0")}`);
    source.addEventListener("message", (event) => {
      try {
        const row = JSON.parse(event.data);
        applyRow(row.placeKey, row);
      } catch {
        // A malformed frame is not worth tearing the stream down over.
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
      } catch {
        // Same.
      }
    });
    // EventSource reconnects by itself; the server's catch-up is bounded by
    // `since`, so a reconnect repeats little and the store dedupes by seq.
    return () => source.close();
  }, [initialPlace, initialPlaces, initialRows, initialSeq]);

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
      <PlacesColumn places={places} selected={selectedKey} seen={seen} newest={newest} onSelect={onSelect} />
      <div className="hall-centre">
        <PlacesTabs places={places} selected={selectedKey} seen={seen} newest={newest} onSelect={onSelect} />
        {/* On a phone the people are an avatar strip under the place header,
            opening the same per-person menu the column's rows do. It draws
            nowhere else — CSS hides it above 720px. */}
        {aside && <HereList people={aside.people} selfId={aside.selfId} strip />}
        <Feed place={selected} self={self} onSeen={onSeen} onOpenSheet={aside ? openSheet : null} />
      </div>
      {aside && (
        <aside className="hall-aside">
          <HallAside {...aside} />
        </aside>
      )}
      {aside && sheetOpen && (
        <Modal open title="Here ‡" onClose={closeSheet} panelClassName="modal-panel hall-sheet">
          <HallAside {...aside} sheet />
        </Modal>
      )}
    </div>
  );
}
