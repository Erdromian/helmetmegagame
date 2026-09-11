"use client";

import { useDeskStreamState } from "./deskStreamStore";
import StatusPill from "@/app/components/StatusPill";

// Says so when the adjudication desk's live channel has dropped to its
// backstop poll.
//
// The twin of the player desk's InboxStreamChip, and there for the same
// reason: a dropped stream that looks alive is worse than one that never
// existed. The desk is still correct when this shows — the 120s poll in
// Workspace.js carries it, and a GM's own work never depended on either — but
// another GM's staging can now be two minutes stale, and that is worth a word.
// Renders nothing while the stream is up, which is almost always.
export default function DeskStreamChip() {
  const state = useDeskStreamState();
  if (state === "live") return null;
  const fatal = state === "fatal";
  // A warning, not a neutral label: the desk is running on its backstop
  // poll. It used to be a plain .chip, indistinguishable from the turn
  // chip beside it, which is the one thing a dropped stream must not be.
  return (
    <StatusPill
      tone={fatal ? "bad" : "warn"}
      title={
        fatal ?
          "The live connection could not be opened — you may be signed out. Your own work still saves and shows; other GMs' staging arrives every two minutes. Reload to restore the live desk."
        : "The live connection dropped and is retrying. Your own work is unaffected; other GMs' staging may be up to two minutes behind."
      }
    >
      {fatal ? "Live desk off" : "Catching up"}
    </StatusPill>
  );
}
