"use client";

import PageShell from "@/app/components/PageShell";
import DepotConsole from "@/app/components/DepotConsole";

// What the page draws, from the one object page.js#FreshDepot produces — the
// stored copy first, the fresh one when it lands (web/lib/snapshot). The
// props are exactly what <DepotConsole> always took.
export default function DepotView(props) {
  return (
    <PageShell width="wide">
      <DepotConsole {...props} />
    </PageShell>
  );
}
