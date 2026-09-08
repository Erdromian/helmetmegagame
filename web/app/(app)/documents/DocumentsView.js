"use client";

import PageShell, { PageHeader } from "@/app/components/PageShell";
import DocumentsBoard from "./DocumentsBoard";

// What the page draws, from the one object page.js#FreshDocuments produces — the
// stored copy first, the fresh one when it lands (web/lib/snapshot). The
// props are exactly what <DocumentsBoard> always took.
export default function DocumentsView(props) {
  return (
    <PageShell width="wide">
      <PageHeader
        title="Documents"
        subtitle="Use these documents to learn more about your role, the game mechanics, and Ravenheart in general."
      />
      <DocumentsBoard {...props} />
    </PageShell>
  );
}
