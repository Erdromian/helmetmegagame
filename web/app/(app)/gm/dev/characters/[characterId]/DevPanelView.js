"use client";

import PageShell from "@/app/components/PageShell";
import DevPanel from "./DevPanel";

// What the page draws, from the one object page.js#FreshDevCharacterPanel produces — the
// stored copy first, the fresh one when it lands (web/lib/snapshot). The
// props are exactly what <DevPanel> always took.
export default function DevPanelView(props) {
  return (
    <PageShell width="wide">
      <DevPanel {...props} />
    </PageShell>
  );
}
