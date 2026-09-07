"use client";

import PageShell, { PageHeader } from "@/app/components/PageShell";
import StructuresTable from "./StructuresTable";

// What the page draws, from the one object page.js#FreshStructures produces — the
// stored copy first, the fresh one when it lands (web/lib/snapshot). The
// props are exactly what <StructuresTable> always took.
export default function StructuresView(props) {
  return (
    <PageShell>
      <PageHeader
        title="Structures"
      />
      <StructuresTable {...props} />
    </PageShell>
  );
}
