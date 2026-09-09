"use client";

import PageShell from "@/app/components/PageShell";
import TagCatalog from "./TagCatalog";

// What the page draws, from the one object page.js#FreshDevTags produces — the
// stored copy first, the fresh one when it lands (web/lib/snapshot). The
// props are exactly what <TagCatalog> always took.
export default function TagCatalogView(props) {
  return (
    <PageShell width="wide">
      <TagCatalog {...props} />
    </PageShell>
  );
}
