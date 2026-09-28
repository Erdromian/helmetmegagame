"use client";

import { useMemo, useState, useTransition } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import Select from "@/app/components/Select";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { scoreMatch } from "@/lib/fuzzySearch";
import { createStagedRoomEntries } from "./actions";
import { mutationErrorMessage } from "@/app/components/useDeskVersion";
import useEscapeLayer from "./escapeLayers";
import QuickPicks from "./QuickPicks";
import { groupByLocation } from "./RoomEffectComposer";

// Stage a "let in": at the push each target gets the pass a GM's /add would
// give them into a private room (db/lib/roomGuests.js#letInAtPush), and the
// thread and the "you were let in" DM follow. Nothing reaches the player
// before the turn ends, the rule every staged row follows.
//
// Its own composer for the reason DeathComposer has one: a let-in combines
// with nothing else on the row. One target or several, the death shape.
//
// There is no edit mode. The row is its targets and its room, and both are
// fixed once staged, so the tray offers Delete and a fresh one instead.

const SEARCH_LIMIT = 12;

export default function RoomEntryComposer({
  moveId = null,
  cavingRollId = null,
  combatId = null,
  quickPicks = null,
  defaultTarget = null,
  roster,
  stagingRooms = [],
  onDone,
  onCancel,
}) {
  const [targets, setTargets] = useState(() => (defaultTarget ? [defaultTarget] : []));
  const [roomId, setRoomId] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  // The prefilled target alone is not unsaved work, the same exemption the
  // other composers make.
  const { markDirty, markClean, guardedClose } = useDirtyGuard({ alsoDirty: Boolean(roomId) });

  useEscapeLayer(() => {
    if (!pending) guardedClose(onCancel);
  });

  // Only a room that is private somewhere: anyone standing at a public one can already walk in.
  const privateRooms = useMemo(() => stagingRooms.filter((r) => r.private), [stagingRooms]);
  const room = useMemo(() => privateRooms.find((r) => r.id === roomId) ?? null, [privateRooms, roomId]);

  const targetMatches = useMemo(() => {
    const q = targetSearch.trim();
    if (!q) return [];
    const chosen = new Set(targets.map((t) => t.id));
    return roster
      .filter((c) => !chosen.has(c.id))
      .map((c) => ({
        c,
        match: scoreMatch(q, { name: c.name, role: c.roleTitle, zone: c.zoneName, username: c.username }),
      }))
      .filter((r) => r.match)
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, SEARCH_LIMIT)
      .map((r) => r.c);
  }, [targetSearch, roster, targets]);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await createStagedRoomEntries({
          targetCharacterIds: targets.map((t) => t.id),
          roomId,
          moveId,
          cavingRollId,
          combatId,
        });
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        onDone(res.patch);
      } catch (err) {
        setError(mutationErrorMessage(err));
      }
    });
  }

  return (
    <Modal modeless title="Let into a room" onClose={() => !pending && guardedClose(onCancel)} width="wide">
      <div className="mt-3 flex flex-col gap-4">
        <section className="composer-group">
          <h3 className="composer-group-title">Who</h3>
          <div className="flex flex-wrap gap-1.5">
            {targets.map((t) => (
              <button
                key={t.id}
                type="button"
                className="chip"
                onClick={() => {
                  setTargets((prev) => prev.filter((p) => p.id !== t.id));
                  markDirty();
                }}
                title="Remove target"
              >
                {t.name} ✕
              </button>
            ))}
            {!targets.length && <span className="text-sm text-muted">nobody yet</span>}
          </div>
          <QuickPicks
            picks={quickPicks}
            chosen={new Set(targets.map((t) => t.id))}
            onAdd={(list) => {
              setTargets((prev) => [...prev, ...list.map((p) => ({ id: p.id, name: p.name }))]);
              markDirty();
            }}
          />
          <label className="field">
            <span className="field-label">Add a target</span>
            <input value={targetSearch} onChange={(e) => setTargetSearch(e.target.value)} placeholder="name, role, zone…" />
          </label>
          {targetMatches.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {targetMatches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setTargets((prev) => [...prev, { id: c.id, name: c.name }]);
                    setTargetSearch("");
                    markDirty();
                  }}
                >
                  + {c.name}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="composer-group">
          <h3 className="composer-group-title">Which room</h3>
          <label className="field" style={{ width: "22rem", maxWidth: "100%" }}>
            <span className="field-label">Private room</span>
            <Select
              value={roomId}
              onChange={(e) => {
                setRoomId(e.target.value);
                markDirty();
              }}
            >
              <option value="">— pick a room —</option>
              {groupByLocation(privateRooms).map((group) => (
                <optgroup key={group.locationId} label={`${group.zoneName ?? "Unzoned"} — ${group.locationName}`}>
                  {group.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </label>
          {room && (
            <p className="text-xs text-muted">
              They have to be standing at {room.locationName} when the turn pushes, or their row fails. The pass is
              spent when they walk out, the same as /add.
            </p>
          )}
        </section>

        <FormError>{error}</FormError>

        <div className="modal-actions modal-actions--sticky">
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onCancel)} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={submit} disabled={pending || !targets.length || !roomId}>
            {pending ? "Working…" : "Stage it"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
