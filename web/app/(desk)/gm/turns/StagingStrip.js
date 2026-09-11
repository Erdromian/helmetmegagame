"use client";

// The one "+ Effect / + Message / + Public" strip.
//
// It existed three times — on the Move desk, on the Caving desk and on the
// push tray — in three slightly different orders, with the tray's extra
// "+ Transfer" wedged into the middle of its copy. Three strips is three
// places for a fourth composer to be added to two of them.
//
// Order is fixed here and never at the call site: Effect, Transfer, Message,
// Public — mechanics first, then words, because that is the order a GM stages
// them in. `onTransfer` is optional; only the tray has anything to transfer
// between.
export default function StagingStrip({
  onEffect,
  onTransfer = null,
  onMessage,
  onPublic,
  disabled = false,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn-quiet" disabled={disabled} onClick={onEffect}>
        + Effect
      </button>
      {onTransfer && (
        <button type="button" className="btn-quiet" disabled={disabled} onClick={onTransfer}>
          + Transfer
        </button>
      )}
      <button type="button" className="btn-quiet" disabled={disabled} onClick={onMessage}>
        + Message
      </button>
      <button type="button" className="btn-quiet" disabled={disabled} onClick={onPublic}>
        + Public
      </button>
    </div>
  );
}
