"use client";

// The one "+ Effect / + Transfer / + Room / + Let in / + Death / + Message / + Public"
// strip, shared by the Move desk, Caving desk and push tray so a new composer
// is added once, not three times. Order is fixed here, never at the call
// site: mechanics first, then words, the order a GM stages them in.
// `onTransfer` is optional — only the tray has anything to transfer between.
// `onRoom`/`onLetIn`/`onDeath` are offered everywhere: a staged kill belongs on the
// causing Move or caving result as much as on the tray, and so does a door opening.
export default function StagingStrip({
  onEffect,
  onTransfer = null,
  onRoom = null,
  onLetIn = null,
  onDeath = null,
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
      {onRoom && (
        <button type="button" className="btn-quiet" disabled={disabled} onClick={onRoom}>
          + Room
        </button>
      )}
      {onLetIn && (
        <button type="button" className="btn-quiet" disabled={disabled} onClick={onLetIn}>
          + Let in
        </button>
      )}
      {onDeath && (
        <button type="button" className="btn-quiet" disabled={disabled} onClick={onDeath}>
          + Death
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
