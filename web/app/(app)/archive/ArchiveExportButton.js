"use client";

import { useState } from "react";

// Downloads the transcript as a text file (/api/archive/export). `query` is the
// same string the page's own stream is keyed on, so the file holds what the
// filters show — not more, not less. Fetched rather than linked: a failed export
// says why beside the button instead of navigating away to an error page, and
// the reader's timezone rides along so the times read the way the screen does.
export default function ArchiveExportButton({ query, label = "Export" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
      const qs = [query, tz ? `tz=${encodeURIComponent(tz)}` : ""].filter(Boolean).join("&");
      const res = await fetch(`/api/archive/export?${qs}`);
      if (!res.ok) {
        setError((await res.text().catch(() => "")) || "That didn't export. Try again.");
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "archive.txt";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Not at once: a browser may still be reading the blob for the download.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError("That didn't export. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={run}
        disabled={busy}
        title="Download what is shown as a text file"
      >
        {busy ? "Exporting…" : label}
      </button>
      {error ? (
        <span className="form-error text-xs" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
