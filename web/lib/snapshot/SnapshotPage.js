"use client";

import { useState } from "react";
import { useSnapshot } from "./snapshotStore";

// The shell a snapshotted page renders (docs/systemdocs/CHAT.md §5c).
//
//   <SnapshotPage scope="character" userId={id} render={CharacterView} fallback={<Loading />}>
//     <Suspense fallback={null}>
//       <FreshCharacter />            ← the page's old async body; returns <SnapshotFresh data />
//     </Suspense>
//   </SnapshotPage>
//
// This component has no awaited data, so it mounts at once: on a first visit
// it draws `fallback` (the route's own skeleton) until the fresh data lands;
// on every visit after that it draws `render` with the stored data in the
// first frame, and the fresh data replaces it when the server answers. The
// children are rendered either way — they are what fetches.
//
// ONE remount, at the moment stored data gives way to fresh. A client island
// that copies its props into state on mount (most of them do, somewhere)
// would otherwise keep the stale copy after the server answered. The key
// flips exactly once per mount — every later refresh (router.refresh after
// an action) is a props update like today, so an open dialog survives it.
// `remountOnFresh={false}` is for a view that already re-seeds itself when
// its props change (Chat.js does).
//
// ONE MORE RULE: once this component has painted the view, it never paints
// `fallback` over it again. `scope` is a prop, and a page that builds it out
// of the open row (/gm/turns does) hands this component a scope nothing has
// been stored under yet every time the GM picks a new row. Reading that cold
// scope as "no data" swapped a live workspace for the route skeleton
// mid-sentence. Holding the last non-null payload makes a cold scope mean what
// it always should have — "nothing stored for this yet, keep showing what you
// have and let the fresh data land underneath".
export default function SnapshotPage({
  scope,
  userId,
  render: View,
  fallback = null,
  remountOnFresh = true,
  children,
}) {
  const data = useSnapshot(scope, userId);
  // What this mount painted FIRST. null on a first visit; the stored copy
  // otherwise. A lazy state initialiser rather than a ref, because the
  // compiler lint forbids reading a ref during render, and this is only
  // ever read.
  const [first] = useState(data);
  // The last payload this mount actually drew. Set during render rather than
  // in an effect (react-hooks/set-state-in-effect is an error here), and only
  // when the store hands over something new, so it costs one extra render per
  // payload and nothing per frame.
  const [held, setHeld] = useState(data);
  if (data !== null && data !== held) setHeld(data);
  const shown = data ?? held;
  const stale = remountOnFresh && first !== null && shown === first;
  return (
    <>
      {shown ? <View key={stale ? "stored" : "fresh"} {...shown} /> : fallback}
      {children}
    </>
  );
}
