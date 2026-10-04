"use client";

import { useMemo, useState, useTransition } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import Select from "@/app/components/Select";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { createStagedMessage, updateStagedMessage } from "./actions";
import { mutationErrorMessage } from "@/app/components/useDeskVersion";
import useEscapeLayer from "./escapeLayers";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { chunkMessage } from "@lifeweb/db/lib/chunkText";
import { groupByLocation } from "./RoomEffectComposer";
import { groupByZone } from "./EffectComposer";

// Stage a public declaration. Posts at the push to the zone's #summary
// channel, or into one place's chat: a Location's channel or a Room's thread
// (ADJUDICATION.md §1). `defaultZoneId` seeds the zone picker from the Move's
// own zone when staging from a Move desk — leave it null from the tray, where
// there's no Move to infer a zone from, so the GM has to choose rather than
// silently posting to whatever zone happens to sort first.
const WHERE_LABELS = { zone: "Zone summary", location: "A Location's chat", room: "A Room's chat" };

export default function PublicComposer({
  moveId = null,
  cavingRollId = null,
  combatId = null,
  existing = null,
  defaultZoneId = null,
  zones,
  stagingLocations = [],
  stagingRooms = [],
  onDone,
  onCancel,
}) {
  const [content, setContent] = useState(existing?.content ?? "");
  const [zoneId, setZoneId] = useState(existing?.zoneId ?? defaultZoneId ?? "");
  const [where, setWhere] = useState(existing?.roomId ? "room" : existing?.locationId ? "location" : "zone");
  const [locationId, setLocationId] = useState(existing?.locationId ?? "");
  const [roomId, setRoomId] = useState(existing?.roomId ?? "");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const { markDirty, markClean, guardedClose } = useDirtyGuard({
    alsoDirty: !existing && Boolean(content.trim()),
  });

  // Escape closes this before it reaches the Move underneath (escapeLayers.js).
  useEscapeLayer(() => {
    if (!pending) guardedClose(onCancel);
  });

  // No maxLength on the textarea: a paste that runs long stays whole and
  // visible so the GM can trim it, rather than being silently cut at the cap.
  const over = content.length > GM_MESSAGE_MAX_LENGTH;
  const chunkCount = useMemo(() => chunkMessage(content.trim()).length, [content]);
  // A cave level has no #summary channel and never did, so a declaration there
  // posts into every Location channel in the level instead (ADJUDICATION.md
  // §1). Worth saying before the GM writes it, not after it has gone out.
  const underground = where === "zone" && zones.find((z) => z.id === zoneId)?.kind === "CAVE_LEVEL";
  const roomGroups = useMemo(() => groupByLocation(stagingRooms), [stagingRooms]);
  const locationGroups = useMemo(() => groupByZone(stagingLocations), [stagingLocations]);

  function submit() {
    setError(null);
    if (where === "zone" && !zoneId) return setError("Pick a zone.");
    if (where === "location" && !locationId) return setError("Pick a Location.");
    if (where === "room" && !roomId) return setError("Pick a Room.");
    // Exactly one of the three goes to the server, which works a place's zone out itself.
    const target = where === "room" ? { roomId } : where === "location" ? { locationId } : { zoneId };
    startTransition(async () => {
      try {
        const res = existing
          ? await updateStagedMessage({ stagedMessageId: existing.id, content, ...target })
          : await createStagedMessage({ kind: "PUBLIC", content, ...target, moveId, cavingRollId, combatId });
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        onDone(res.patch);
      } catch (err) {
        setError(mutationErrorMessage(err));
      }
    });
  }

  return (
    <Modal
      modeless
      title={existing ? "Edit public declaration" : "Stage a public declaration"}
      onClose={() => !pending && guardedClose(onCancel)}
    >
      <div className="mt-3 flex flex-col gap-4">
        <label className="field">
          <span className="field-label">
            Declaration{" "}
            <span className={over ? "text-danger" : "text-muted"}>
              ({content.length}/{GM_MESSAGE_MAX_LENGTH})
            </span>
          </span>
          <textarea
            data-autofocus
            rows={5}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              markDirty();
            }}
            placeholder={
              where !== "zone"
                ? "What everyone there sees when the turn ends. Posts into that chat."
                : underground
                  ? "What everyone learns when the turn ends. Posts to every Location channel down here."
                  : "What everyone learns when the turn ends. Posts to the summary channel."
            }
          />
          {over ? (
            <span className="text-xs text-danger">
              Over the {GM_MESSAGE_MAX_LENGTH}-character cap — trim it before staging.
            </span>
          ) : chunkCount > 1 ? (
            <span className="text-xs text-muted">Arrives as {chunkCount} messages, split on blank lines.</span>
          ) : null}
        </label>

        <div className="flex flex-wrap items-start gap-3">
          <label className="field" style={{ width: "12rem" }}>
            <span className="field-label">Post to</span>
            <Select
              value={where}
              onChange={(e) => {
                setWhere(e.target.value);
                markDirty();
              }}
            >
              {Object.entries(WHERE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </label>

          {where === "zone" && (
            <label className="field" style={{ width: "14rem" }}>
              <span className="field-label">Zone</span>
              <Select
                value={zoneId ?? ""}
                onChange={(e) => {
                  setZoneId(e.target.value);
                  markDirty();
                }}
                required
              >
                {!zoneId && <option value="">Pick a zone…</option>}
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </Select>
              {underground && (
                <span className="text-xs text-muted">
                  No summary channel down here — this lands in every Location in the zone.
                </span>
              )}
            </label>
          )}

          {where === "location" && (
            <label className="field" style={{ width: "14rem" }}>
              <span className="field-label">Location</span>
              <Select
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  markDirty();
                }}
              >
                {!locationId && <option value="">Pick a Location…</option>}
                {locationGroups.map((group) => (
                  <optgroup key={group.zoneId ?? "loose"} label={group.zoneName ?? "Unzoned"}>
                    {group.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </label>
          )}

          {where === "room" && (
            <label className="field" style={{ width: "16rem" }}>
              <span className="field-label">Room</span>
              <Select
                value={roomId}
                onChange={(e) => {
                  setRoomId(e.target.value);
                  markDirty();
                }}
              >
                {!roomId && <option value="">Pick a Room…</option>}
                {roomGroups.map((group) => (
                  <optgroup key={group.locationId} label={group.locationName}>
                    {group.rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </label>
          )}
        </div>

        <FormError>{error}</FormError>

        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onCancel)} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={submit} disabled={pending || over}>
            {pending ? "Working…" : existing ? "Save" : "Stage it"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
