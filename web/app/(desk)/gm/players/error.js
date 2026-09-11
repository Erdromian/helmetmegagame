"use client";

// The conversation column's own boundary. (desk)/error.js sits above the nav
// rail, so anything thrown while rendering a person replaced the WHOLE desk
// with an error panel — rail, roster, inspector and all — for what is usually
// one bad conversation. A GM's only way back was a reload.
//
// Catching it here keeps the shell up: the rail stays, the other conversations
// stay clickable, and Try again re-renders just this column.
//
// Next 16 names the recovery prop `retry`, not `reset`.

import ErrorPanel from "@/app/components/ErrorPanel";

export default function PlayerDeskError({ error, retry }) {
  return (
    <main className="desk-main">
      <ErrorPanel error={error} retry={retry} />
    </main>
  );
}
