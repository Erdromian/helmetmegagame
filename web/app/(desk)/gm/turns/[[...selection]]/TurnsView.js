"use client";

import PageShell from "@/app/components/PageShell";
import Workspace from "../Workspace";

// What the page draws, from the one object page.js#FreshTurnsWorkspace produces — the
// stored copy first, the fresh one when it lands (web/lib/snapshot). The
// props are exactly what <Workspace> always took.
export default function TurnsView(props) {
  return (
      <Workspace {...props} />
  );
}
