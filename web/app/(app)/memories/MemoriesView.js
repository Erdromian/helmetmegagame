"use client";

import PageShell from "@/app/components/PageShell";
import MemoriesBoard from "./MemoriesBoard";

// What the page draws, from the one object page.js#FreshMemories produces —
// the stored copy first, the fresh one when it lands (web/lib/snapshot).
export default function MemoriesView(props) {
  return (
    <PageShell width="narrow">
      <MemoriesBoard {...props} />
    </PageShell>
  );
}
