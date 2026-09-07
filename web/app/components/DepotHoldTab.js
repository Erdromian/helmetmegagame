"use client";

import { useState, useTransition } from "react";
import { useRefresh } from "./useRefresh";
import { depotSendShuttle } from "@/app/(app)/depot/actions";
import RequestDialog from "./RequestDialog";
import TagChip from "./TagChip";

// What is on the landing pad, and the button that sends it up.
//
// The pad is a real room — a private thread gated on the Depot Keycard — so
// this panel is a VIEW of a stash, not a separate inventory. Anything here can
// also be picked up by hand by anyone who can get into the room, which is the
// point: a shipment sitting on the pad is a shipment that can be robbed.
//
// Sending it up is a HAND action — a Docker with a keycard can do it. The
// payout lands in the station's account either way, so a keycard moves goods,
// never money out of the Depot.
//
// Crates are not here any more. One is opened by consuming it from the sheet,
// wherever it ended up — see docs/systemdocs/DEPOT.md §0e.
export default function DepotHoldTab({ pad, depot, handDisabled, resourceExportPrice }) {
  const [refresh] = useRefresh();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(null); // "send"
  const [error, setError] = useState(null);

  const docked = depot.shuttleState === "DOCKED";
  // Goods at their sell price, plus the room's loose ⬢ at the station's export
  // price. The same arithmetic the server does; see the depot's sendShuttle
  // action.
  const payout =
    pad.rows.reduce((s, r) => s + (r.sellPrice ?? 0) * r.quantity, 0) +
    (pad.resources ?? 0) * resourceExportPrice;

  function submitSend(reason) {
    startTransition(async () => {
      const result = await depotSendShuttle({ reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(null);
      refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="panel p-5">
        <h2 className="panel-header">Landing Pad</h2>

        {(pad.rows.length > 0 || pad.resources > 0) && (
          <ul className="depot-list mt-4">
            {pad.rows.map((row) => (
              <li key={row.id}>
                <TagChip tag={row.tag} />
                <span className="mono">
                  ×{row.quantity}
                  {row.sellPrice ? ` · ${row.sellPrice * row.quantity} ¢` : ""}
                </span>
              </li>
            ))}
            {pad.resources > 0 && (
              <li>
                <span>Resources in the stash</span>
                <span className="mono">
                  {pad.resources} ⬢ · {pad.resources * resourceExportPrice} ¢
                </span>
              </li>
            )}
          </ul>
        )}

        <dl className="depot-totals">
          <div>
            <dt>Sends up as</dt>
            <dd className="mono">{payout} ¢</dd>
          </div>
        </dl>

        <button
          type="button"
          className="btn mt-4"
          disabled={handDisabled || pending || !docked}
          onClick={() => setConfirming("send")}
        >
          Load it up and send it back
        </button>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      {confirming === "send" && (
        <RequestDialog
          open
          title="Send the shuttle back"
          submitLabel="Send it up"
          busy={pending}
          error={error}
          onCancel={() => setConfirming(null)}
          onConfirm={submitSend}
        >
          <p className="text-sm text-muted">
            Everything on the pad goes with it, and {payout} ¢ lands in the account.
          </p>
        </RequestDialog>
      )}

    </div>
  );
}
