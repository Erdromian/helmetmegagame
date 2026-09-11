"use client";

import { useInboxStreamState } from "./inboxStreamStore";

// Says so when the desk's live inbox has dropped to its backstop poll.
//
// This exists because of PLAYER-DESK.md §9a's objection to a push feed: "a
// dropped stream that looks alive is exactly the failure class this desk has
// already been burned by". It is a fair objection and this is half the answer
// — the desk is still correct when the stream is down (the 30s poll carries
// it), and now it also SAYS it is running on the slow path instead of looking
// identical to a healthy one. Renders nothing while the stream is up, which is
// almost always.
export default function InboxStreamChip() {
  const state = useInboxStreamState();
  if (state === "live") return null;
  const fatal = state === "fatal";
  return (
    <span
      className="chip"
      title={
        fatal ?
          "The live connection could not be opened — you may be signed out. New mail still arrives every 30 seconds; reload to restore the live feed."
        : "The live connection dropped and is retrying. New mail still arrives, just up to 30 seconds behind."
      }
    >
      {fatal ? "Live feed off" : "Catching up"}
    </span>
  );
}
