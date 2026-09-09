"use client";

import FormError from "@/app/components/FormError";
import { useState, useTransition } from "react";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { archiveCurrentGame } from "./actions";

// Write the current game's transcript out to the bucket as one packet.
//
// Separate from Restart Game on purpose (docs/systemdocs/ARCHIVE.md): this is
// minutes of read-only work and a multi-megabyte upload, and Restart Game's
// button promises it returns in a second or two. It deletes nothing, so it is
// safe to press early, safe to press twice, and safe to press mid-game.
export default function ArchiveGameButton({ exportKey, entryCount }) {
  const confirm = useConfirm();
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [pending, startTransition] = useTransition();

  async function onClick() {
    if (exportKey && !(await confirm({
      title: "Archive again?",
      message: "This game already has a packet. Writing a new one replaces it with the transcript as it stands right now. ‡",
      confirmLabel: "Replace it",
    }))) return;

    setError(null);
    setDone(null);
    startTransition(async () => {
      try {
        const res = await archiveCurrentGame();
        if (res?.ok) setDone(res.entryCount);
        else setError(res?.error ?? "Something went wrong.");
      } catch {
        setError("Could not reach the server. Nothing was changed. ‡");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn" onClick={onClick} disabled={pending}>
          {pending ? "Writing the packet…" : "Archive this game"}
        </button>
        {exportKey ? (
          <span className="text-sm mono">
            {entryCount ?? "?"} lines already written
          </span>
        ) : null}
      </div>
      <FormError>{error}</FormError>
      {done != null ? (
        <p className="text-sm">
          » <em>Packet written and checked — {done} lines.</em> Restart Game can keep this game now. ‡
        </p>
      ) : null}
    </div>
  );
}
