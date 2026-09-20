"use client";

import { useState } from "react";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { noticeLine } from "./noticeLines";
import { FULL_NAME_LIMIT } from "@/lib/characterName";
import {
  excommunicateRequest,
  liftExcommunicationRequest,
} from "@/app/(app)/character/bishopActions";

// The Bishop's one verb. TYPES its target instead of picking it, Engrave's
// reasoning: a dropdown here would be a roster of everybody alive, handed to
// whoever opened it. The whole name, either the full display form or just
// first and last, since first names repeat.
//
// Both halves live in one dialog on purpose. Excommunicating is capped, so
// the only way to lay a new one is often to lift an old one, and a Bishop
// sent to a second button for that would be sent there without being told.
// The list under the field is that answer, and the counter above it is why.
//
// Every sentence a player reads here is Bascinet's. Do not add one.
export default function ExcommunicateDialog({ mode, onDone, onClose }) {
  const pools = useActionPools();
  const cap = pools.excommunicationSeats ?? 1;
  // Seeded from the sheet, then kept live off whatever the server hands back,
  // so laying and lifting inside one open dialog never disagrees with it.
  const [rows, setRows] = useState(() => pools.excommunications ?? []);
  const [name, setName] = useState("");
  const { submit, busy, error } = useSubmit();

  const full = rows.length >= cap;

  return (
    <ActionDialog
      title="Excommunicate"
      busy={busy}
      error={error}
      canSubmit={Boolean(name.trim()) && !full}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => excommunicateRequest({ name }),
          (res) => {
            setRows(res.roster ?? []);
            setName("");
            onDone(noticeLine(mode, res));
          },
        )
      }
    >
      {/* Bascinet's counter, and the reason the Confirm below is off when it
          is full. It is the field's own label rather than a note under it:
          how many seats are left is the first thing a Bishop needs. */}
      <p className="text-sm text-muted mono">{`${rows.length}/${cap} people excommunicated`}</p>

      <label className="field">
        <span className="field-label">Whose name?</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          autoComplete="off"
          maxLength={FULL_NAME_LIMIT}
          disabled={full}
          required
          data-autofocus
        />
      </label>

      {/* Lifting takes no typing — these are names the Bishop already wrote
          down once, and typing one of them again is a chance to get it wrong.
          Only this Bishop's own marks are ever in here; bishopActions.js
          refuses anybody else's. */}
      {rows.length > 0 ? (
        <div className="field">
          <span className="field-label">You have excommunicated</span>
          {rows.map((row) => (
            <div key={row.id} className="chip-row">
              <span className="text-sm">{row.name}</span>
              <button
                type="button"
                className="btn-quiet"
                disabled={busy}
                onClick={() =>
                  submit(
                    () => liftExcommunicationRequest({ targetId: row.id }),
                    (res) => {
                      setRows(res.roster ?? []);
                      onDone(noticeLine(mode, res));
                    },
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </ActionDialog>
  );
}
