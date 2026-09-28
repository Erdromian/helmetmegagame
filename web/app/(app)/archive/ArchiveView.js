"use client";

import { useCallback, useMemo, useState } from "react";
import useArchiveScroll from "@/app/components/useArchiveScroll";
import { useRouter } from "next/navigation";
import Modal from "@/app/components/Modal";
import Select from "@/app/components/Select";
import Switch from "@/app/components/Switch";
import CheckPicker from "@/app/components/CheckPicker";
import EmptyState from "@/app/components/EmptyState";
import useSessionState from "@/app/components/useSessionState";
import { gameTitle } from "@/lib/gameLabel";
import { activeArchiveFilters, archiveParamsToQuery } from "@/lib/archiveQuery";
import ArchiveTranscript from "./ArchiveTranscript";

// The transcript's controls and its scroll.
//
// FILTERS LIVE IN THE URL, not in this component's state. Narrowing pushes a
// new query and the server re-renders the first screen; the stream below is
// keyed on that query so it remounts with the new rows rather than trying to
// reconcile them (react-hooks/set-state-in-effect is an error here, so a
// "reset when the props change" effect is not available and would be the wrong
// shape anyway). The view stays shareable: what you are reading is in the link
// even though how far you have scrolled is not.
//
// The two VIEW toggles sit above that remount on purpose — narrowing to one
// speaker should not turn your portraits back off — and they live in
// sessionStorage so a reload keeps them. Actions is NOT one of them, though it
// sits beside them: it changes which rows the server pages, so it has to be in
// the query, and it is off unless the link says otherwise.

const VIEW_KEY = "archive:view";
const VIEW_DEFAULT = { groupScenes: true, portraits: false };

export default function ArchiveView({ game, games, currentGameId, zones, rooms, characters, filters, total, first }) {
  const router = useRouter();
  const [view, setView] = useSessionState(VIEW_KEY, VIEW_DEFAULT);
  const [drawer, setDrawer] = useState(false);
  const query = archiveParamsToQuery(filters);
  const names = useMemo(() => new Map(characters.map((c) => [c.id, c.name])), [characters]);
  const active = activeArchiveFilters(filters, names);

  // One place that writes a link, so no control invents its own query string.
  const go = useCallback(
    (overrides) => {
      const next = archiveParamsToQuery(filters, overrides);
      router.push(next ? `/archive?${next}` : "/archive");
    },
    [filters, router],
  );

  // A name or a scene clicked in the transcript ADDS to what is picked rather
  // than replacing it, so two speakers can be followed by clicking both.
  const pick = useCallback(
    ({ zone, character }) => {
      if (zone && !filters.zones.includes(zone)) go({ zone: [...filters.zones, zone] });
      if (character && !filters.characters.includes(character)) go({ character: [...filters.characters, character] });
    },
    [filters, go],
  );

  return (
    <>
      <div className="archive-bar">
        <form
          className="archive-search"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: new FormData(e.currentTarget).get("q")?.toString().trim() ?? "" });
          }}
        >
          <input name="q" defaultValue={filters.q} placeholder="anything said…" aria-label="Search the transcript" />
        </form>

        {/* The one filter people reach for every visit, so it stays out of the
            drawer: a day is unreadable with the world's own lines folded in
            and unfinishable without them. */}
        <div className="segmented" role="group" aria-label="What to show">
          <button type="button" aria-pressed={filters.show === "speech"} onClick={() => go({ show: "speech" })}>
            Speech
          </button>
          <button type="button" aria-pressed={filters.show === "all"} onClick={() => go({ show: "all" })}>
            Everything
          </button>
        </div>

        <button type="button" className="btn" onClick={() => setDrawer(true)}>
          Filters{active.length ? ` · ${active.length}` : ""}
        </button>

        <div className="archive-bar-spacer" />

        {/* What characters did, beside what they said: every verb, every Move
            and what came of it. A layer to turn on, so off by default. */}
        <Switch checked={filters.actions} onChange={(e) => go({ actions: e.target.checked ? "1" : "" })}>
          Actions
        </Switch>
        <Switch checked={view.groupScenes} onChange={(e) => setView({ ...view, groupScenes: e.target.checked })}>
          Scenes
        </Switch>
        <Switch checked={view.portraits} onChange={(e) => setView({ ...view, portraits: e.target.checked })}>
          Faces
        </Switch>
      </div>

      {/* What is narrowed, always visible and always removable. A filter set in
          the drawer and forgotten about is the reason the drawer needs these. */}
      {active.length ? (
        <div className="archive-chips">
          {active.map((f) => (
            <button key={f.key} type="button" className="chip" onClick={() => go(f.clear)}>
              {f.label} <span aria-hidden="true">×</span>
              <span className="sr-only">Remove this filter</span>
            </button>
          ))}
          <button
            type="button"
            className="archive-chips-clear"
            onClick={() => go({ q: "", from: "", to: "", zone: [], room: [], character: [] })}
          >
            Clear all
          </button>
        </div>
      ) : null}

      <ArchiveStream key={query} query={query} first={first} view={view} total={total} onPick={pick} />

      <Modal open={drawer} onClose={() => setDrawer(false)} title="Filters">
        {/* Mounted only while open, so every opening starts from the link. */}
        {drawer ? (
          <ArchiveFilters
            game={game}
            games={games}
            currentGameId={currentGameId}
            zones={zones}
            rooms={rooms}
            characters={characters}
            filters={filters}
            onGame={(id) => {
              setDrawer(false);
              // A different game is a different transcript, so everything
              // narrowing THIS one is dropped rather than carried over to a
              // game whose zones and people are not the same.
              router.push(`/archive?game=${encodeURIComponent(id)}`);
            }}
            onApply={(overrides) => {
              setDrawer(false);
              go(overrides);
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}

// Everything that narrows, picked together and applied once. Ticking a box
// does not navigate: three rooms and two people would otherwise be five page
// loads, each showing a transcript you did not ask for.
function ArchiveFilters({ game, games, currentGameId, zones, rooms, characters, filters, onGame, onApply }) {
  const [zonePick, setZonePick] = useState(filters.zones);
  const [roomPick, setRoomPick] = useState(filters.rooms);
  const [peoplePick, setPeoplePick] = useState(filters.characters);
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");
  const [order, setOrder] = useState(filters.order);

  const zoneItems = useMemo(() => zones.map((z) => ({ id: z, label: z })), [zones]);
  const peopleItems = useMemo(() => characters.map((c) => ({ id: c.id, label: c.name })), [characters]);

  return (
    <form
      className="archive-drawer"
      onSubmit={(e) => {
        e.preventDefault();
        onApply({
          zone: zonePick,
          room: roomPick,
          character: peoplePick,
          from: String(from).trim(),
          to: String(to).trim(),
          order,
        });
      }}
    >
      <label className="field">
        <span className="field-label">Game</span>
        <Select value={filters.game || game.id} onChange={(e) => onGame(e.target.value)}>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {gameTitle(g)}
              {g.id === currentGameId ? " · current" : g.archivedAt ? " · archived" : ""}
            </option>
          ))}
        </Select>
      </label>

      <div className="archive-drawer-days">
        <label className="field">
          <span className="field-label">From day</span>
          <input type="number" min="1" placeholder="the start" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">To day</span>
          <input type="number" min="1" placeholder="the end" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <CheckPicker label="Zones" items={zoneItems} value={zonePick} onChange={setZonePick} maxHeight="10rem" />
      <CheckPicker
        label="Rooms"
        items={rooms}
        value={roomPick}
        onChange={setRoomPick}
        filterPlaceholder="Filter rooms…"
        emptyLabel="No room matches."
        maxHeight="12rem"
      />
      <CheckPicker
        label="People"
        items={peopleItems}
        value={peoplePick}
        onChange={setPeoplePick}
        filterPlaceholder="Filter people…"
        emptyLabel="Nobody matches."
        maxHeight="12rem"
      />

      <label className="field">
        <span className="field-label">Order</span>
        <Select value={order} onChange={(e) => setOrder(e.target.value)}>
          <option value="asc">Oldest first</option>
          <option value="desc">Newest first</option>
        </Select>
      </label>

      <div className="archive-drawer-foot">
        <button type="submit" className="btn">
          Apply
        </button>
      </div>
    </form>
  );
}

// The rows, and nothing else. Remounted whenever the filter changes, which is
// what keeps "what is on screen" and "what was asked for" from disagreeing.
function ArchiveStream({ query, first, view, total, onPick }) {
  // Rows, cursor and the sentinel come from the shared hook — the GM
  // inspector's Archive tab scrolls the same transcript through the same
  // endpoint, and two copies of this would eventually disagree.
  const { rows, done, failed, more, sentinel } = useArchiveScroll({ query, first });

  const cite = useCallback((row) => {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#e${row.id}`;
    navigator.clipboard?.writeText(url).catch(() => {});
  }, []);

  if (rows.length === 0) {
    return <EmptyState>No line in this game matches that.</EmptyState>;
  }

  return (
    <>
      <ArchiveTranscript
        rows={rows}
        groupScenes={view.groupScenes}
        portraits={view.portraits}
        onPick={onPick}
        onCite={cite}
      />
      <div className="archive-more" ref={done ? undefined : sentinel}>
        {failed ? (
          <button type="button" className="btn" onClick={more}>
            That didn&rsquo;t load. Try again
          </button>
        ) : done ? (
          <span className="text-muted">
            {rows.length} of {total} · that is all of it
          </span>
        ) : (
          <span className="text-muted">
            {rows.length} of {total}…
          </span>
        )}
      </div>
    </>
  );
}
