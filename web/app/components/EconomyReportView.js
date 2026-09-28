"use client";

import { useState } from "react";
import { useConfirm } from "./ConfirmProvider";
import { actionThrowMessage } from "./actionThrow";
import { createEconomyShare, revokeEconomyShare } from "@/app/economyShareActions";

// The economy report's frame, with the bar above it that makes and revokes public links to one page
// (ECONOMY.md §7a). Mounted by EconomyReport.js for both /gm/economy and /econ/economy.
//
// The bar shares whatever page the frame is showing. The frame is same-origin, so its location is
// readable on every load; the report's own <nav> moves it and this side just follows.

const SRC = "/api/economy/report/";

function shareUrl(token) {
  return `${window.location.origin}/share/economy/${token}`;
}

export default function EconomyReportView({ shares, titles }) {
  const confirm = useConfirm();
  const [page, setPage] = useState("index.html");
  const [listOpen, setListOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  // A link the clipboard refused, shown in a box to copy by hand.
  const [manualUrl, setManualUrl] = useState(null);

  const titleOf = (p) => titles[p] ?? p;
  const current = shares.find((s) => s.page === page);

  function onFrameLoad(e) {
    try {
      const path = e.currentTarget.contentWindow?.location.pathname ?? "";
      if (path.startsWith(SRC)) setPage(path.slice(SRC.length) || "index.html");
    } catch {
      // Same-origin, so this does not throw; if it ever did, the bar keeps the last page it knew.
    }
    setNotice(null);
    setManualUrl(null);
  }

  async function copy(token) {
    const url = shareUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setManualUrl(null);
      setNotice("Link copied.");
    } catch {
      setNotice(null);
      setManualUrl(url);
    }
  }

  async function run(fn) {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) setNotice(res.error);
      return res.ok ? res : null;
    } catch (err) {
      setNotice(actionThrowMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    const ok = await confirm({
      title: `Share "${titleOf(page)}"?`,
      message:
        "Anyone with the link can read this one page without signing in, secret recipes included if the page has any. They can't reach the rest of the report. The page follows the report as it changes, and you can revoke the link at any time.",
      confirmLabel: "Make link",
    });
    if (!ok) return;
    const res = await run(() => createEconomyShare(page));
    if (res) await copy(res.share.token);
  }

  async function revoke(s) {
    const ok = await confirm({
      title: "Revoke this link?",
      message: `Anyone holding the link to "${titleOf(s.page)}" loses it at once. Sharing the page again makes a new link.`,
      confirmLabel: "Revoke",
    });
    if (!ok) return;
    if (await run(() => revokeEconomyShare(s.id))) {
      setManualUrl(null);
      setNotice("Link revoked.");
    }
  }

  return (
    <>
      <div className="desk-header">
        <div className="flex min-w-0 items-center gap-3">
          {shares.length > 0 && (
            <button
              type="button"
              className="chip"
              data-active={listOpen ? "true" : undefined}
              aria-pressed={listOpen}
              aria-controls="economy-shares"
              onClick={() => setListOpen((v) => !v)}
            >
              Shared links · {shares.length}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {notice && (
            <span className="text-muted text-xs" role="status">
              {notice}
            </span>
          )}
          {manualUrl && (
            <input
              className="control economy-share-url mono"
              readOnly
              value={manualUrl}
              aria-label="Public link"
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
          {current ? (
            <>
              <span className="text-muted text-xs">This page has a public link</span>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => copy(current.token)}>
                Copy link
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => revoke(current)}>
                Revoke
              </button>
            </>
          ) : (
            <button type="button" className="btn-secondary" disabled={busy} onClick={share}>
              Share this page
            </button>
          )}
        </div>
      </div>

      {listOpen && shares.length > 0 && (
        <ul id="economy-shares" className="economy-shares">
          {shares.map((s) => (
            <li key={s.id}>
              <a href={`/share/economy/${s.token}`} target="_blank" rel="noreferrer">
                {titleOf(s.page)}
              </a>
              <time className="mono text-xs text-muted" dateTime={s.createdAt}>
                {s.createdAt.slice(0, 10)}
              </time>
              <button type="button" className="btn-quiet" disabled={busy} onClick={() => copy(s.token)}>
                Copy
              </button>
              <button type="button" className="btn-quiet" disabled={busy} onClick={() => revoke(s)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="economy-frame">
        {/* Its own multi-page document — own CSS, own table-sort script, its own <nav> between sections
            (db/scripts/analysis/economy/report.js) — sandboxed from the app's theme by an iframe rather
            than pasted inline. Clicking a section link navigates this frame alone, ordinary browser
            navigation against /api/economy/report/<section>.html, and onLoad tells the bar which page
            that is. Not `sandbox`-restricted: this is our own generated content, never third-party
            input, and the sort script needs to run. */}
        <iframe title="Economy report" src={`${SRC}index.html`} onLoad={onFrameLoad} />
      </div>
    </>
  );
}
