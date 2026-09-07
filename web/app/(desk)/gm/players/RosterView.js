"use client";

import PageShell, { PageHeader } from "@/app/components/PageShell";
import RosterTable from "./RosterTable";

// What the page draws, from the one object page.js#FreshPlayerRoster produces — the
// stored copy first, the fresh one when it lands (web/lib/snapshot). The
// props are exactly what <RosterTable> always took.
export default function RosterView(props) {
  return (
    <main className="desk-main">
      <RosterTable {...props} />
    </main>
  );
}
