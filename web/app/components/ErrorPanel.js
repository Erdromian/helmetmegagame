"use client";

// The body of every error boundary in the app, so the three of them can't
// drift into three different apologies.
//
// The digest is shown deliberately. In a production build Next replaces a
// server-side error's real message with a hash and logs the message
// server-side only, so the hash is the one thing a player can tell a GM that
// makes the container logs searchable. Hiding it would leave them with
// nothing to report.

import PageShell from "@/app/components/PageShell";
import DeskHeader from "@/app/components/DeskHeader";

// DeskHeader rather than AppHeader: AppHeader streams the turn chip in, and a
// boundary that is already here because a query failed has no business firing
// another one. Same bar, same height, no fetch.
export default function ErrorPanel({ error, retry, title = "Something went wrong" }) {
  return (
    <>
      <DeskHeader title={title} />
      <PageShell width="narrow">
      <div className="panel flex flex-col items-start gap-4 p-4">
        <p className="text-sm text-muted">That page didn&apos;t load.</p>
        <p className="text-sm text-muted">
          If it keeps happening, tell a GM. Give them the reference below:
        </p>
        {error?.digest && (
          <p className="mono text-xs text-muted">
            Reference: {error.digest}
          </p>
        )}
        <button type="button" className="btn" onClick={() => retry?.()}>
          Try again
        </button>
      </div>
      </PageShell>
    </>
  );
}
