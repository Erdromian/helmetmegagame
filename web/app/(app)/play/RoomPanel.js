"use client";

import { useEffect, useState } from "react";
import FormError from "@/app/components/FormError";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import { readStash } from "./actions";
import { TONE_CLASS } from "./PlacePanel";

// THIS ROOM: the storage and the fixtures of the room whose feed is OPEN, and
// of no other room.
//
// This is the fix for the Intercom complaint. affordancesFor() answers "what
// can this character do where they are standing", which at a Location with
// six rooms is every room's buttons at once — so standing anywhere in the
// Keep offered the Council Room's Intercom and six Storage buttons. The list
// is right; what was missing was the grouping. The open place says which room
// this is, and one room's worth is what draws.
//
// Absent entirely when the open place is the Location, a conversation or the
// zone summary: the Location's own fixtures are on the place card above.

function roomIdOf(selected) {
  if (!selected || selected.kind !== "room") return null;
  return selected.placeKey?.slice("room:".length) || null;
}

export default function RoomPanel({ selected, affordances = [], onFixture, pending = false }) {
  const roomId = roomIdOf(selected);
  const [stash, setStash] = useState(null);
  const actions = useRequestActions();

  // Re-read whenever the open room changes. The answer is stamped with the
  // room it came from, so a slow reply for the room you have just left is
  // rendered for nobody rather than under the wrong name.
  useEffect(() => {
    if (!roomId) return undefined;
    let cancelled = false;
    readStash(roomId)
      .then((res) => {
        if (!cancelled) setStash({ roomId, ...res });
      })
      .catch(() => {
        if (!cancelled) setStash({ roomId, ok: false, error: "Couldn't see in there. ‡" });
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  if (!roomId) return null;

  const here = stash?.roomId === roomId ? stash : null;
  const fixtures = affordances.filter(
    (entry) => entry.kind === "room" && entry.roomId === roomId && entry.id !== "storage",
  );

  return (
    <div className="hall-room">
      <p className="hall-section-title">This room ‡</p>

      {/* Three states, not two. A read still in flight says so; one that
          came back refused says WHY, which is the whole point of the
          sentence the action returned — it used to be swallowed and drawn as
          "looking…", so a locked cupboard looked like a slow one forever. */}
      {here?.ok ? (
        <p className="hall-quiet-line">Storage · {here.line}</p>
      ) : here ? (
        <FormError>{here.error ?? "Couldn't see in there. ‡"}</FormError>
      ) : (
        <p className="hall-quiet-line">Storage · looking… ‡</p>
      )}
      {here?.ok && (
        <div className="hall-buttons">
          {/* The same Transfer dialog the sheet has, with this room already
              picked as the far side — a room stash is one of its parties, so
              there is nothing here to fork. */}
          <button
            type="button"
            className="btn-quiet"
            onClick={() => actions?.open?.("transfer", null, { toKey: `room:${roomId}` })}
          >
            Move things ‡
          </button>
        </div>
      )}

      {fixtures.length > 0 && (
        <div className="hall-buttons">
          {fixtures.map((entry) => (
            <button
              key={`${entry.id}:${entry.roomId}`}
              type="button"
              className={TONE_CLASS[entry.tone] ?? "btn-secondary"}
              disabled={pending}
              onClick={() => onFixture(entry)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
