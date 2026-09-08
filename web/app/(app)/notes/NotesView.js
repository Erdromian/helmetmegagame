"use client";

import PageShell from "@/app/components/PageShell";
import NotesBoard from "./NotesBoard";

// What the page draws, from the one object page.js#FreshNotes produces — the
// stored copy first, the fresh one when it lands (web/lib/snapshot). The
// props are exactly what <NotesBoard> always took.
export default function NotesView(props) {
  return (
    <PageShell width="narrow">
      {/* How a message GETS here, which is a mechanic rather than an
          explainer — it used to be the header's subtitle, and the header is
          the shared bar now. */}
      <p className="text-sm text-muted">
        React with a ⭐ in a location channel to bring the message here.
      </p>
      <NotesBoard {...props} />
    </PageShell>
  );
}
