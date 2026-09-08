"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import EmptyState from "@/app/components/EmptyState";
import Modal from "@/app/components/Modal";
import ChatAside from "./ChatAside";
import MapBoard from "../map/MapBoard";
import HereList from "./HereList";
import PlacesColumn, { PlacesTabs } from "./PlacesColumn";
import useAsideFolded from "./useAsideFolded";
import Feed from "./Feed";
import FactionPanel from "./FactionPanel";
import DmPane, { DM_PLACE_KEY } from "./DmPane";
import { useDmState, seedNewestOutbound, addDmRow, noteDmReconnect } from "./dmStore";
import NoticeCards from "./NoticeCards";
import { ConverseDialog } from "./PlacePanel";
import { addMember } from "./actions";
import { playChime, chimedRecently } from "@/app/components/chime";
import useChatChimeMuted, { chatChimeMuted } from "@/app/components/useChatChimeMuted";
import { useSeen, markSeen, seedSeenIfFresh } from "./seenStore";
import { noteTyping } from "./typingStore";
import { usePushState, initPush, togglePush } from "./pushStore";
import {
  usePlaces,
  setPlaces,
  seedRows,
  seedInitial,
  applyRow,
  removeRow,
  notableSeq,
  markHistoryLoaded,
  markHistoryLoading,
  historyLoaded,
  isOwnRow,
} from "./feedStore";

// Chat: everywhere this character can hear, and one of them open.
//
// ONE EventSource for the whole tab, not one per place. Phase 0 opened a
// stream per place, which was fine when there was one; a Chat has a Location,
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

// How many places a player's Chat warms in the background before it stops.
// See the prefetch effect for why there is a ceiling at all.
const PREFETCH_LIMIT = 12;

function decodeHash(hash) {
  if (!hash) return null;
  try {
    return decodeURIComponent(hash);
  } catch {
    return null;
  }
}

export default function Chat({
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
  // The composer's own two: the paperwork gates (web/lib/selfPools.js) and
  // whether there is anything over this character's face to put up or take
  // down. Both are hints — the four dialogs and toggleConceal re-check every
  // gate themselves.
  letters = null,
  conceal = null,
  // The faction this character is in, or null. A pseudo-place in the column
  // rather than a place: it has no channel, so what its row opens is a panel
  // (./FactionPanel.js), and the whole roster is decided on the server
  // (web/lib/selfPools.js#loadFactionView).
  faction = null,
  // The newest thing Bascinet said by DM, as epoch ms, for the Messages row's
  // dot before the pane has opened (./DmPane.js). The store takes over from
  // the first stream frame on.
  dmNewestMs = null,
}) {
  // The server's list is the first paint; the stream replaces it whole from
  // its first `places` event onward.
  const router = useRouter();
  const streamed = usePlaces();
  const places = streamed.length > 0 ? streamed : initialPlaces;
  const seen = useSeen();

  const hash = decodeHash(useSyncExternalStore(subscribeToHash, readHash, readServerHash));

  // The faction's row. `faction:<id>` is a place key the archive will never
  // hold, which is exactly what makes it safe as a pseudo-key: it round-trips
  // through the hash like any other, and nothing that reads a feed can ever
  // match it.
  const factionKey = faction ? `faction:${faction.id}` : null;
  // And Bascinet's: the DM conversation, the same kind of pseudo-key (CHAT.md
  // §2b). Its "newest seq" is epoch ms — seenStore compares BigInt strings,
  // and epoch ms is one — so the dot works without seenStore knowing.
  const dmState = useDmState();
  const dmKey = self?.characterId ? DM_PLACE_KEY : null;
  const dmNewest = dmState.newestOutboundMs === null ? null : String(dmState.newestOutboundMs);
  const navPlaces = useMemo(() => {
    const out = [];
    if (dmKey) out.push({ placeKey: dmKey, name: "Bascinet", kind: "dm", newestSeq: dmNewest, notableSeq: dmNewest });
    out.push(...places);
    if (factionKey) {
      out.push({ placeKey: factionKey, name: faction.name, kind: "faction", newestSeq: null, notableSeq: null });
    }
    return out;
  }, [places, factionKey, faction, dmKey, dmNewest]);
  const byKey = useMemo(() => new Map(navPlaces.map((place) => [place.placeKey, place])), [navPlaces]);
  // A hash naming somewhere you have left falls back to the first place, so a
  // stale bookmark opens the street rather than a blank column.
  const selectedKey = (hash && byKey.has(hash) ? hash : null) ?? initialPlace ?? places[0]?.placeKey ?? null;
  const selected = selectedKey ? (byKey.get(selectedKey) ?? null) : null;
  const factionOpen = Boolean(factionKey && selectedKey === factionKey);
  const dmOpen = Boolean(dmKey && selectedKey === dmKey);
  // The silo is a Room, so the button only draws when that room is in this
  // character's own place list — a shut door keeps it out of the list, and a
  // button selecting a place they cannot read would be a dead end.
  const siloOpen = Boolean(faction?.silo && byKey.has(faction.silo.placeKey));

  const onSelect = useCallback((placeKey) => {
    window.location.hash = encodeURIComponent(placeKey);
  }, []);


  // What the unread dot compares against: the newest thing said in a place
  // that was ABOUT this viewer, not merely the newest thing said. A place used
  // to light up for scenery — somebody lifting a stamp off a table — which is
  // how an unread mark stops meaning anything (feedStore.js#isNotableRow).
  //
  // The LARGER of two answers, never the first of them. The server's watermark
  // covers everything said before this tab connected; the live one covers
  // everything since. Taking the tab's answer when it has one would hide a
  // mention that landed while the page was closed.
  const selfCharacterId = self?.characterId ?? null;
  // Their own hood, so a line they said under it is not news to them.
  const selfSpeakerKey = self?.speakerKey ?? null;
  const newest = useCallback(
    (place) => {
      const live = notableSeq(place.placeKey, selfCharacterId, selfSpeakerKey);
      const seeded = place.notableSeq ?? null;
      if (live === null) return seeded;
      if (seeded === null) return live;
      return BigInt(live) > BigInt(seeded) ? live : seeded;
    },
    [selfCharacterId, selfSpeakerKey],
  );

  const onSeen = useCallback((placeKey, seq) => markSeen(placeKey, seq), []);

  // A browser opening Chat for the first time starts caught up rather
  // than with a dot beside everywhere it can hear. In a state INITIALIZER, so
  // it has run before the first client paint — from an effect it ran after
  // it, and every place flashed its unread dot for a frame on a first visit.
  // Not an effect and not a bare render-time write: the initializer is the
  // one place React runs a thing like this exactly once.
  useState(() => {
    if (typeof window === "undefined") return null;
    // The STORE first, and synchronously. Seeding it from an effect meant the
    // first client render drew an empty feed and the server's own rows landed
    // a frame later — "Nothing has been said here yet. ‡" flashing over a
    // scene that was already on the page. An initializer runs before that
    // first paint, and React runs it exactly once.
    // seedInitial rather than the three writes on their own: this runs during
    // a render, and that variant holds the store's notification for exactly
    // as long as it takes (feedStore.js#seedInitial).
    try {
      seedInitial({ places: initialPlaces, place: initialPlace, rows: initialRows });
    } catch {
      // The effect below repeats all three, so a store that refused here is
      // a frame of empty rather than an empty page.
    }
    try {
      seedNewestOutbound(dmNewestMs);
    } catch {
      // A missing seed costs a dot, nothing more.
    }
    try {
      seedSeenIfFresh([
        ...initialPlaces.map((entry) => ({ placeKey: entry.placeKey, seq: entry.newestSeq })),
        ...(dmNewestMs !== null && dmNewestMs !== undefined ? [{ placeKey: DM_PLACE_KEY, seq: String(dmNewestMs) }] : []),
      ]);
    } catch {
      // localStorage can be refused outright. A missing seed costs a dot,
      // nothing more.
    }
    return null;
  });

  // The phone's ⋯ sheet. The right column has no room to stand on a narrow
  // screen (under 900px, useAsideFolded.js), so it comes up over the scene instead — the same three panels,
  // rendered by the same component.
  const [chimeMuted, setChimeMuted] = useChatChimeMuted();

  const asideFolded = useAsideFolded();
  const [sheetOpen, setSheetOpen] = useState(false);
  // The noticeboard cards at the top of the Location's feed, and the counter
  // that makes them re-read. The Noticeboard dialog in the right column pins
  // to the SAME board, so the two have to share a signal or a pin leaves the
  // street showing the old papers.
  const [boardVersion, setBoardVersion] = useState(0);
  const bumpBoard = useCallback(() => setBoardVersion((n) => n + 1), []);
  // A search hit somebody clicked: which line, in which place, and when they
  // clicked it (so clicking the same hit twice scrolls twice).
  const [jump, setJump] = useState(null);

  // ---- What the composer's slash commands reach for ------------------------
  //
  // `/travel` and `/converse` cannot be server actions: one picks a node in
  // the Travel grid and one opens a dialog, and both of those live in the
  // right column, which on a phone is not even mounted. Chat.js owns both
  // sides, so the callbacks are handed down to Feed.js and the state is
  // handed up to ChatAside.
  //
  //   travelPick   { locationId, at } — `at` is a timestamp so picking the
  //                same node twice re-opens the confirm strip.
  //   converseOn   whether the Converse dialog is open.
  //   placesVersion  bumped on every `places` frame, which is what a key
  //                turning or somebody else's /add looks like from here. The
  //                members strip re-reads on it.
  // Which place is open, for the stream handlers below. A ref rather than a
  // dependency: the EventSource is opened once per mount, and putting
  // `selectedKey` in that effect's deps would tear the connection down and
  // build it again every time somebody clicked a room.
  const selectedRef = useRef(null);
  const [travelPick, setTravelPick] = useState(null);
  const [converseOn, setConverseOn] = useState(false);
  const [placesVersion, setPlacesVersion] = useState(0);
  const bumpPlaces = useCallback(() => setPlacesVersion((n) => n + 1), []);

  // Web Push, asked once per tab. The store is what holds the answer — this
  // effect sets no state of its own (./pushStore.js).
  const push = usePushState();
  useEffect(() => {
    initPush();
  }, []);

  // Written in an effect, not during a render: react-hooks/immutability is an
  // error here and a ref written mid-render is exactly what it catches.
  useEffect(() => {
    selectedRef.current = selectedKey;
  }, [selectedKey]);

  // A line found by search. The window around it is loaded FIRST — the store
  // usually holds the newest hundred, and a hit from three days ago is not in
  // it — and only then is the place opened and the seq handed to Feed.js to
  // scroll to. Rows merge by seq, so a window that overlaps what is already
  // held costs nothing.
  const onJump = useCallback(
    (placeKey, seq) => {
      if (!placeKey || !seq) return;
      const go = () => {
        setJump({ placeKey, seq: String(seq), at: Date.now() });
        window.location.hash = encodeURIComponent(placeKey);
      };
      fetch(`/api/feed/history?place=${encodeURIComponent(placeKey)}&around=${encodeURIComponent(seq)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.rows) seedRows(placeKey, data.rows);
          markHistoryLoaded(placeKey);
          go();
        })
        // The place still opens. A hit whose window would not load is better
        // answered by the newest hundred than by nothing happening at all.
        .catch(go);
    },
    [],
  );
  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  // The map, over the top of everything. Mounted HERE rather than in
  // ChatAside because ChatAside renders twice on a phone — the desktop column
  // and the "Here" sheet — and a Modal in there would be two of them.
  //
  // On a folded viewport it navigates to /map instead of opening. A full-bleed
  // board inside the sheet would be a dialog inside a dialog on the smallest
  // screen there is, and /map is a real route precisely so the phone has
  // somewhere to go.
  const [mapOpen, setMapOpen] = useState(false);
  const openMap = useCallback(() => {
    setSheetOpen(false);
    if (asideFolded) router.push("/map");
    else setMapOpen(true);
  }, [asideFolded, router]);

  const onTravelPick = useCallback((locationId) => {
    setTravelPick({ locationId, at: Date.now() });
    // On a phone the grid is inside the ⋯ sheet, so picking a node from the
    // composer has to bring the sheet up with it — otherwise the command
    // answers "confirm it in Travel" and Travel is nowhere on the screen.
    setSheetOpen(true);
  }, []);
  const onConverse = useCallback(() => setConverseOn(true), []);
  // "Add to …" on a person's row in HERE. The same server action the members
  // strip and the /add command use; the strip re-reads off placesVersion.
  const onAddMember = useCallback(
    (characterId) => {
      if (!selectedKey || !characterId) return;
      addMember(selectedKey, characterId)
        .then(bumpPlaces)
        .catch(() => {
          // The strip is the surface that reports this; a menu row that
          // failed is answered by the list not changing.
        });
    },
    [selectedKey, bumpPlaces],
  );

  // One stream for the tab. `since` is the seq the server render was taken at,
  // so the catch-up carries what happened while the page was loading and
  // nothing that was already in it.
  useEffect(() => {
    // All three already ran in the initializer above, before the first paint.
    // They are idempotent, and they stay here as the guard for the one case
    // the initializer cannot cover: a server render whose props changed under
    // a client-side navigation back onto this page.
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
        // Somebody spoke in the conversation or private room that is OPEN.
        // A `places` frame only ever fires for the VIEWER's own presence, so
        // nothing else here tells them that a third party was let in or shown
        // out; the next thing anybody says is the cheapest honest prompt to
        // re-read the strip. Only for the two kinds of place that have one.
        const key = row.placeKey;
        if (
          key &&
          key === selectedRef.current &&
          (key.startsWith("conv:") || key.startsWith("room:"))
        ) {
          setPlacesVersion((n) => n + 1);
        }
        // Somebody said your name. The token is what the row is made of on
        // both faces (CHAT.md §5), so this rings for a Discord-origin mention
        // exactly as it does for a web one — and never for your own words.
        if (
          self?.characterId &&
          !isOwnRow(row, self.characterId, self.speakerKey) &&
          typeof row.content === "string" &&
          row.content.includes(`{char:${self.characterId}}`) &&
          !chatChimeMuted() &&
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
        // The members strip re-reads on this: a key turning, or somebody
        // else's /add, is exactly what a places frame means.
        setPlacesVersion((n) => n + 1);
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
    // A DM for this account — Bascinet's turn result, a GM's reply, or the
    // line this tab just sent, coming back round (dmStore.js dedupes by id).
    // Rings the mention chime for something Bascinet said while the pane is
    // not the open place: a DM is always about you.
    source.addEventListener("dm", (event) => {
      try {
        const row = JSON.parse(event.data);
        // The hub's pg client came back from a drop (feedHub.js#resyncDm):
        // not a row, a prompt to fetch the page again.
        if (row?.resync) {
          noteDmReconnect();
          return;
        }
        addDmRow(row);
        // Quiet only while the pane is open AND somebody is looking at it.
        const reading = selectedRef.current === DM_PLACE_KEY && document.visibilityState === "visible";
        if (row?.direction === "OUTBOUND" && !reading && !chatChimeMuted() && !chimedRecently()) {
          playChime(0.35);
        }
      } catch {
        // Same.
      }
    });
    // The DM path has no seq to catch up from, so a reconnect tells the pane
    // to ask for its page again. The FIRST open is the page's own load.
    let opened = false;
    source.addEventListener("open", () => {
      if (opened) noteDmReconnect();
      opened = true;
    });
    // EventSource reconnects by itself; the server's catch-up is bounded by
    // `since`, so a reconnect repeats little and the store dedupes by seq.
    return () => source.close();
  }, [initialPlace, initialPlaces, initialRows, initialSeq, self?.characterId, router]);

  // What was said BEFORE the page opened, for a place the reader has just
  // chosen. The stream only ever carries what happens next, so without this a
  // room opened for the first time would look empty until somebody spoke.
  useEffect(() => {
    // The two pseudo-places have no feed to load (./FactionPanel.js,
    // ./DmPane.js — the pane fetches its own page).
    if (!selectedKey || selectedKey.startsWith("faction:") || selectedKey === DM_PLACE_KEY || historyLoaded(selectedKey)) {
      return undefined;
    }
    // "loading" first, so Feed.js draws the skeleton instead of the empty
    // state while this is out. markHistoryLoading is also what stops a second
    // fetch: historyLoaded() is true for both of the non-idle states.
    markHistoryLoading(selectedKey);
    fetch(`/api/feed/history?place=${encodeURIComponent(selectedKey)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        // NOT gated on `cancelled`. The rows are for a place, not for a
        // render, and the store is keyed by place — dropping them because the
        // reader had moved on left that place marked "loading" for the life of
        // the tab, so walking back into it drew the skeleton forever.
        if (data?.rows) seedRows(selectedKey, data.rows);
        markHistoryLoaded(selectedKey);
      })
      .catch(() => {
        // The stream still fills this place in as people speak. Marked loaded
        // either way, or the skeleton would sit there forever.
        markHistoryLoaded(selectedKey);
      });
    return undefined;
  }, [selectedKey]);

  // PREFETCH. After the first paint, every OTHER place's backlog is fetched
  // one at a time, so opening a room is instant rather than a skeleton and a
  // round trip. One at a time on purpose — a Chat has a Location, its rooms,
  // the conversations you are in and the summary, and firing six requests at
  // once would compete with the thing the reader is actually looking at.
  //
  // NOT FOR A GM. A player's list is a Location, its rooms, their
  // conversations and a summary — small enough to walk. A GM's list is every
  // zone, every Location and every Room they may watch, which is two hundred
  // and more, and each one of those is a `findMany` of a hundred rows plus an
  // avatar pass. Warming a Chat a GM will open one room of is a storm the
  // database pays for and nobody sees, so a GM fetches on selection like the
  // Chat always did. And even for a player it is CAPPED: a well-connected
  // character can sit in a lot of conversations, and past a dozen the warmth
  // is not worth the requests.
  useEffect(() => {
    if (gm) return undefined;
    let stopped = false;
    let timer = null;
    const queue = places
      .map((entry) => entry.placeKey)
      .filter(Boolean)
      .slice(0, PREFETCH_LIMIT);

    function step() {
      if (stopped) return;
      const next = queue.shift();
      if (!next) return;
      if (historyLoaded(next)) {
        timer = setTimeout(step, 0);
        return;
      }
      markHistoryLoading(next);
      fetch(`/api/feed/history?place=${encodeURIComponent(next)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          // Landed rows are stored whatever happened to the queue. `stopped`
          // only says "ask for no more" — reading it here left the place
          // stuck on "loading" and its feed showing the skeleton for good.
          if (data?.rows) seedRows(next, data.rows);
          markHistoryLoaded(next);
        })
        .catch(() => {
          markHistoryLoaded(next);
        })
        .finally(() => {
          if (!stopped) timer = setTimeout(step, 0);
        });
    }

    timer = setTimeout(step, 0);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [places, gm]);

  // Which of the open place's doors a person can be let through. Only a
  // conversation and a PRIVATE room have one; everywhere else there is nothing
  // to add anybody to, and the row stays off the menu.
  const addPlace =
    selected && (selected.kind === "conv" || (selected.kind === "room" && selected.roomKind === "PRIVATE"))
      ? { placeKey: selected.placeKey, name: selected.name }
      : null;

  if (places.length === 0) {
    return (
      <div className="chat-body chat-body--empty">
        <div className="panel">
          <EmptyState>You are nowhere yet.</EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-body">
      <PlacesColumn
        places={navPlaces}
        selected={selectedKey}
        seen={seen}
        newest={newest}
        onSelect={onSelect}
        webOnly={webOnly}
        chimeMuted={chimeMuted}
        onToggleChime={setChimeMuted}
        push={push.supported ? { on: push.on, busy: push.busy, onToggle: togglePush } : null}
      />
      <div className="chat-centre">
        <PlacesTabs places={navPlaces} selected={selectedKey} seen={seen} newest={newest} onSelect={onSelect} />
        {/* On a phone the people are an avatar strip under the place header,
            opening the same per-person menu the column's rows do. It draws
            nowhere else — CSS hides it above 720px. */}
        {aside && <HereList people={aside.people} selfId={aside.selfId} strip />}
        {factionOpen ? (
          <FactionPanel faction={faction} siloOpen={siloOpen} onSelect={onSelect} />
        ) : dmOpen ? (
          <DmPane self={self} />
        ) : (
        <Feed
          place={selected}
          self={self}
          autocorrect={autocorrect}
          onSeen={onSeen}
          onOpenSheet={aside ? openSheet : null}
          roster={roster}
          // whosHere() whole, hoods included — the slash commands' person
          // picker needs them, and `roster` above deliberately has none.
          people={aside?.people ?? null}
          onTravelPick={onTravelPick}
          onConverse={onConverse}
          placesVersion={placesVersion}
          gm={gm}
          hasCamera={hasCamera}
          letters={letters}
          canConceal={Boolean(conceal?.canConceal)}
          concealed={Boolean(conceal?.concealed)}
          alias={conceal?.alias ?? null}
          jump={jump}
          onJump={onJump}
          fallbackPlace={initialPlace}
          fallbackRows={initialRows}
          // Only in the STREET, and only where there is a board to read. A
          // room, a conversation and the zone summary have no noticeboard —
          // the board belongs to the Location (db/lib/noticeboard.js).
          notices={
            aside?.hasBoard && selected?.kind === "loc" ? (
              <NoticeCards version={boardVersion} onChanged={bumpBoard} />
            ) : null
          }
        />
        )}
      </div>
      {/* ONE of these ever mounts. The CSS hides the column under 720px, but
          hiding is not unmounting: both copies used to be live at once on a
          phone, which meant two travel loads, two stash reads and two
          separate answers about what can be worked here. */}
      {aside && !asideFolded && (
        <aside className="chat-aside">
          {/* The OPEN place, so the room panel knows which room's storage and
              fixtures to draw — the whole reason the Council Room's Intercom
              used to show up in the Kitchens. */}
          <ChatAside
            {...aside}
            selected={selected}
            onPlaceChanged={bumpBoard}
            travelPick={travelPick}
            addPlace={addPlace}
            onAddMember={onAddMember}
            onOpenMap={openMap}
          />
        </aside>
      )}
      {/* `/converse` from the composer. The SAME dialog the right column's
          Converse opens — and the reason it is mounted here rather than there
          is the phone, where the right column is not mounted at all. */}
      {aside && converseOn && (
        <ConverseDialog
          onClose={() => setConverseOn(false)}
          onDone={() => {
            setConverseOn(false);
            router.refresh();
          }}
        />
      )}
      {aside && asideFolded && sheetOpen && (
        <Modal open title="Here" onClose={closeSheet} panelClassName="modal-panel chat-sheet">
          <ChatAside
            {...aside}
            selected={selected}
            onPlaceChanged={bumpBoard}
            travelPick={travelPick}
            addPlace={addPlace}
            onAddMember={onAddMember}
            onOpenMap={openMap}
            inSheet
          />
        </Modal>
      )}
      {/* Escape and the backdrop both close it — Modal.js owns that, and its
          topmost-wins stack means Escape closes the map before the sheet
          underneath. "Return to game" inside the board is the same door,
          spelled out for anyone who does not reach for Escape. */}
      {mapOpen && (
        <Modal open title="Map" onClose={() => setMapOpen(false)} panelClassName="modal-panel map-panel">
          <MapBoard onClose={() => setMapOpen(false)} />
        </Modal>
      )}
    </div>
  );
}
