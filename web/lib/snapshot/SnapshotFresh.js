"use client";

import { useEffect } from "react";
import { roundTrip, writeSnapshot } from "./snapshotStore";

// The last line of a snapshotted page's async body: the fresh, serialisable
// props, written into the store (and localStorage) as soon as they arrive.
// The page's SnapshotPage re-renders its view off the store, so this draws
// nothing itself.
//
// Round-tripped through JSON BEFORE the store sees it, so a Date the server
// handed over becomes the same string the snapshot would have held — the
// view is written against one shape, not two.
//
// Writing a module store inside an effect is fine under
// react-hooks/set-state-in-effect; it is a setState there that is not.
export default function SnapshotFresh({ scope, userId, data }) {
  useEffect(() => {
    writeSnapshot(scope, userId, roundTrip(data));
  }, [scope, userId, data]);
  return null;
}
