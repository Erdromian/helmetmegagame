"use client";

import { useEffect } from "react";
import { clearSnapshots } from "./snapshotStore";

// Mounted by the public layout, which is where a signed-out browser lands.
// No account on the page means every stored snapshot is somebody's old
// sheet on a shared machine, so they go.
export default function SnapshotGuard({ userId }) {
  useEffect(() => {
    if (!userId) clearSnapshots();
  }, [userId]);
  return null;
}
