"use client";

import { memo, useMemo } from "react";
import HoverCard from "@/app/components/HoverCard";
import { ChevronDownIcon, MailIcon } from "@/app/components/icons";
import { isUnread } from "../seenStore";
import { useFolds } from "./foldStore";

// THE LEFT COLUMN: everywhere this character may read.
//
// The top belongs to no zone — MAIL (the Bascinet conversation, then Deadchat)
// and RADIO (the frequencies carried). Neither is a room on the map, so neither
// sits under a zone's divider. Everything below is grouped BY ZONE, the way
// Discord groups channels by category: SUMMARY the zone's own channel · HERE
// the Location stood in · ROOMS · CONVERSATIONS · ELSEWHERE the streets walked
// out of earlier this turn, watched and read-only (db/lib/vantages.js).
//
// Rebuilt from ../PlacesColumn.js. The behaviour is the same to the row; what
// changed is that the old one threaded `selected`, `seen`, `notified`, `newest`
// and `onSelect` through every <Section> and every row — five props restated at
// nine call sites, so adding a sixth meant editing all nine. The grouping does
// the reading once here and hands each section rows that already know what they
// are.
//
// A SHUT SECTION STILL SHOWS WHAT IS NEW. Folding Here, Rooms or any other
// section hides its rows, except any row that is unread and the row you are
// reading now. The open row has to stay: it stops
// counting as unread the moment it is selected, so without it the row would
// vanish from under the click. Leave it once it is read and it goes back into
// the fold. Nothing here writes to the fold store; the fold stays shut.
//
// A SHUT ZONE HIDES EVERYTHING, unread rows included (Chat Overhaul.docx), so
// a GM can put a whole zone away and sort the rest. Its divider says what is
// waiting inside instead: it brightens, and carries the count of lines
// addressed to you, or a dot when there are none.
//
// A GM STARTS WITH LOCATIONS, ROOMS AND CONVERSATIONS SHUT. A GM hears every
// place in the game, so with everything open the column is a wall of rows and
// the zone dividers are lost in it. Zones stay open: the GM sees every zone and
// opens the sections they want. The fold store holds whatever differs from the
// default, so for these three sections the GM's stored key is the one they
// OPENED (`…:open`), never the one they shut. A player's column is unchanged.

// The sections a GM's column starts with shut.
const GM_SHUT_BY_DEFAULT = new Set(["here", "rooms", "conversations"]);

function Row({ place, onSelect }) {
  const button = (
    <button
      type="button"
      className="row-line"
      data-active={place.active ? "true" : undefined}
      data-unread={place.unread ? "true" : undefined}
      data-vantage={place.vantage ? "true" : undefined}
      onClick={() => onSelect(place.placeKey)}
    >
      {place.kind === "dm" && (
        <span className="row-glyph" aria-hidden="true">
          <MailIcon width="14" height="14" />
        </span>
      )}
      <span className="nm">{place.name}</span>
      {/* Discord's two levels. UNREAD is the name brightening and nothing else
          — it carried a dot once, which is a second mark saying what the weight
          already says. A NUMBER only where something was addressed to YOU. */}
      {place.count > 0 && (
        <span className="badge mono" aria-label={`${place.count} for you`}>
          {place.count}
        </span>
      )}
    </button>
  );
  const description = place.description?.trim();
  if (!description) return button;
  // The column scrolls, so an in-tree tooltip would clip — HoverCard portals.
  // `pinnable={false}`: the row underneath is already a button.
  return (
    <HoverCard
      pinnable={false}
      className="row-hover"
      panel={
        <>
          <span className="tip-name">{place.name}</span>
          <span className="tip-desc">{description}</span>
        </>
      }
    >
      {button}
    </HoverCard>
  );
}

// What a shut section still shows (see the header): anything unread, anything
// with a line addressed to you, and the place you are reading.
const peeks = (place) => place.unread || place.count > 0 || place.active;

const Section = memo(function Section({ title, places, foldKey, shut, onToggle, onSelect, heading = "sect" }) {
  if (places.length === 0) return null;
  const open = !shut;
  const rows = open ? places : places.filter(peeks);
  return (
    <div className="chat-section">
      <button type="button" className={`${heading} fold`} aria-expanded={open} onClick={() => onToggle(foldKey)}>
        <ChevronDownIcon data-open={open ? "true" : undefined} />
        {title}
      </button>
      {rows.map((place) => <Row key={place.placeKey} place={place} onSelect={onSelect} />)}
    </div>
  );
});

export default function PlacesColumn({
  places,
  selected,
  seen,
  // placeKey -> how many things here were addressed to YOU (../notifiedStore.js).
  notified = null,
  newest,
  onSelect,
  // True in the GM seat, where Locations, Rooms and Conversations start shut.
  gm = false,
  // A GM who also plays somebody: `{ mode, onChange }`. Null for everybody
  // else — a plain player has no second seat.
  viewAs = null,
  // The You plate (./YouPlate.js), pinned in the foot. Null for a GM or a
  // ghost with no body of their own.
  you = null,
  // The phone drawer's nav links, or a GM's zone picker. Null on desktop.
  foot = null,
  // The phone drawer's nav links, drawn ABOVE the places instead of under
  // them. A spectator's only way to /actions from a phone, and under a list
  // as long as theirs the foot is screens down. Null on desktop.
  head = null,
}) {
  const [collapsed, toggle] = useFolds();

  // Read every row's state ONCE, here, rather than per section per render.
  const decorate = (place) => ({
    ...place,
    active: place.placeKey === selected,
    // The place you are reading is never unread.
    unread: place.placeKey !== selected && isUnread(seen, place.placeKey, newest(place)),
    count: notified?.get(place.placeKey) ?? 0,
  });

  const { pinned, radio, other, groups, liveKeys } = useMemo(() => {
    const rows = places.map(decorate);
    const of = (kind) => rows.filter((p) => p.kind === kind);

    // THE TWO STANDALONE ROWS, and they are deliberately not a section. Bascinet
    // is the conversation with the people running the game; Game is what the
    // game itself says (db/lib/gameChannel.js). Neither is mail, neither is a
    // place on the map, and heading two unlike rows "Mail" said they were one
    // thing. They draw bare, under the bar, in this order.
    const pinnedRows = [...of("dm"), ...of("game")];
    // Deadchat has a section of its own, "Other": it is neither mail nor a
    // place on the map, and for a ghost it is the one row they can answer.
    const otherRows = of("dead");
    // The party chat is nowhere for the same reason a net is: it travels with
    // the leader, not with a Location.
    const radioRows = [...of("net"), ...of("party")];

    // Server order IS zone order (db/lib/feedAccess.js reads Zone.sortOrder),
    // so this buckets and never sorts. A place with no zone that is none of the
    // four above falls into a trailing group, so a kind added later can never
    // go undrawn.
    const out = [];
    const byZone = new Map();
    const loose = [];
    for (const place of rows) {
      if (["dm", "game", "dead", "net", "party"].includes(place.kind)) continue;
      if (!place.zoneId) {
        loose.push(place);
        continue;
      }
      let group = byZone.get(place.zoneId);
      if (!group) {
        group = { zoneId: place.zoneId, zoneName: place.zoneName ?? "", places: [] };
        byZone.set(place.zoneId, group);
        out.push(group);
      }
      group.places.push(place);
    }
    if (loose.length > 0) out.push({ zoneId: null, zoneName: null, places: loose });

    // Every fold key this column can draw right now. foldStore prunes anything
    // stored that is not in here — a conversation that closed, a street walked
    // out of — so the remembered set cannot grow forever.
    // No "mail" key any more: the two rows above it draw with no fold to remember.
    const keys = new Set(["radio", "other"]);
    for (const group of out) {
      const k = group.zoneId ?? "loose-zone";
      keys.add(k);
      for (const s of ["summary", "here", "rooms", "conversations", "elsewhere"]) keys.add(`${k}:${s}`);
      // Both seats' keys, so a GM who flips to Player and back keeps what they
      // opened as a GM in the zones both seats share.
      for (const s of GM_SHUT_BY_DEFAULT) keys.add(`${k}:${s}:open`);
    }

    return { pinned: pinnedRows, radio: radioRows, other: otherRows, groups: out, liveKeys: keys };
    // `decorate` closes over selected/seen/notified/newest, all of which are in
    // the dep list; it is deliberately not a useCallback, since it is cheap and
    // hoisting it would only move the same dependencies somewhere less obvious.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, selected, seen, notified, newest]);

  // One zone means no divider: there is nothing to divide it from, and a
  // living player's column stays exactly as tall as it was.
  const divided = groups.length > 1;
  const onToggle = (key) => toggle(key, liveKeys);
  const shut = (key) => collapsed.has(key);
  // A section's fold key, and whether it is shut. In the GM seat, the three
  // shut-by-default sections store the opposite: the key means "opened".
  const sectionFold = (zoneKey, slug) =>
    gm && GM_SHUT_BY_DEFAULT.has(slug)
      ? { foldKey: `${zoneKey}:${slug}:open`, shut: !collapsed.has(`${zoneKey}:${slug}:open`) }
      : { foldKey: `${zoneKey}:${slug}`, shut: collapsed.has(`${zoneKey}:${slug}`) };

  return (
    <nav className="chat-places" aria-label="Places">
      {head && <div className="chat-places-head">{head}</div>}
      <p className="bar">Places</p>

      {/* Bare rows, no heading and no fold — see `pinnedRows` above. They keep a
          wrapper so the CSS can give them the indent a section heading would
          otherwise have set, and a rule under them so the first real heading
          does not read as theirs. */}
      {pinned.length > 0 && (
        <div className="chat-section chat-section--pinned">
          {pinned.map((place) => (
            <Row key={place.placeKey} place={place} onSelect={onSelect} />
          ))}
        </div>
      )}
      <Section title="Radio" places={radio} foldKey="radio" shut={shut("radio")} onToggle={onToggle} onSelect={onSelect} />
      <Section title="Other" places={other} foldKey="other" shut={shut("other")} onToggle={onToggle} onSelect={onSelect} />

      {groups.map((group) => {
        const key = group.zoneId ?? "loose-zone";
        // Elsewhere is cut FIRST and the other sections exclude it, so a fogged
        // street and its rooms draw once, together, under their own heading —
        // rather than scattered through Here and Rooms where they would read as
        // places you are standing in.
        const elsewhere = group.places.filter((p) => p.vantage);
        const rest = group.places.filter((p) => !p.vantage);
        const here = rest.filter((p) => p.kind === "loc");
        const runs = [
          ["summary", "Summary", rest.filter((p) => p.kind === "zone")],
          // A living character stands in one Location; a GM or a ghost watches
          // every one in the game. The mockup heads the first "Here" and the
          // rest "Locations", and for a player that is the same list under the
          // truer of the two words.
          ["here", here.length === 1 ? "Here" : "Locations", here],
          ["rooms", "Rooms", rest.filter((p) => p.kind === "room")],
          ["conversations", "Conversations", rest.filter((p) => p.kind === "conv")],
          ["elsewhere", "Elsewhere", elsewhere],
        ];
        // Only a zone with a divider can be shut: with one zone there is no
        // button to open it again, so a stale saved fold must not hide it.
        const hasDivider = divided && Boolean(group.zoneName);
        const groupOpen = !hasDivider || !shut(key);
        // What the shut divider says about the rows it is hiding.
        const hiddenUnread = !groupOpen && group.places.some((place) => place.unread);
        const hiddenCount = groupOpen ? 0 : group.places.reduce((sum, place) => sum + place.count, 0);
        return (
          <div className="chat-zone-group" key={key}>
            {hasDivider && (
              <button
                type="button"
                className="zone-div fold"
                aria-expanded={groupOpen}
                aria-label={hiddenUnread || hiddenCount > 0 ? `${group.zoneName}, unread` : group.zoneName}
                data-unread={hiddenUnread || hiddenCount > 0 ? "true" : undefined}
                onClick={() => onToggle(key)}
              >
                <ChevronDownIcon data-open={groupOpen ? "true" : undefined} />
                {group.zoneName}
                {hiddenCount > 0 ? (
                  <span className="badge mono" aria-hidden="true">
                    {hiddenCount}
                  </span>
                ) : hiddenUnread ? (
                  <span className="chat-dot" aria-hidden="true" />
                ) : null}
              </button>
            )}
            {groupOpen &&
              runs.map(([slug, title, rows]) => (
                <Section
                  key={slug}
                  title={title}
                  places={rows}
                  {...sectionFold(key, slug)}
                  onToggle={onToggle}
                  onSelect={onSelect}
                />
              ))}
          </div>
        );
      })}

      {/* STICKY BAR (chat-vocabulary.md §1): pinned to the bottom so a GM's
          every-room list cannot push the seat switch below the fold. It takes
          the ground it is pinned over, opaque, because its whole job is hiding
          the rows that slide under it. */}
      {(viewAs || you || foot) && (
        <div className="chat-places-tail sticky-bar">
          {viewAs && (
            <div className="chat-view-as" role="group" aria-label="View as">
              <div className="segmented">
                <button type="button" aria-pressed={viewAs.mode === "gm"} onClick={() => viewAs.onChange("gm")}>
                  GM
                </button>
                <button type="button" aria-pressed={viewAs.mode === "player"} onClick={() => viewAs.onChange("player")}>
                  Player
                </button>
              </div>
            </div>
          )}
          {/* The sound switches, the volume, the text size, the bell and the
              tick all left this foot (Chat Overhaul.docx): the bell and the tick
              sit by the sound cluster in the top bar now (ChatBarControls.js),
              and on a phone in the chat head. */}
          {you}
          {foot}
        </div>
      )}
    </nav>
  );
}
