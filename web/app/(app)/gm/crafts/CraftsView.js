"use client";

import PageShell, { PageHeader } from "@/app/components/PageShell";
import CraftsTable from "./CraftsTable";

// What the page draws, from the one object page.js#FreshCrafts produces — the
// stored copy first, the fresh one when it lands (web/lib/snapshot). The
// props are exactly what <CraftsTable> always took.
export default function CraftsView(props) {
  return (
    <PageShell>
      <PageHeader
        title="Craft projects"
      />
      <CraftsTable {...props} />
    </PageShell>
  );
}
