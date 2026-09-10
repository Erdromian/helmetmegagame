// Only ever rendered as layout.js's `{children}` — the layout already draws
// the one AppHeader above where Suspense cuts in. All this needs to hold still
// is the band's height and the three-column body.
//
// 300 is what the band actually measures now that the identity cluster carries
// the name, the role and faction and a 9rem face (SHEET.md §2). It was 120,
// which was already short of the mark and got shorter, so the page jumped when
// Suspense resolved.
//
// It cannot know which of the four kinds is arriving (the sheet, the lobby,
// the wizard, a closed door), so it traces the sheet: that is the common case
// by a long way, and the one a player sees every day.
export default function Loading() {
  return (
    <div className="sheet-body" aria-hidden="true">
      <div className="sheet-band panel animate-pulse" style={{ minHeight: 300 }} />
      <div className="ledger-body">
        <div className="ledger-col">
          <div className="panel animate-pulse" style={{ height: 320 }} />
        </div>
        <div className="ledger-col">
          <div className="panel animate-pulse" style={{ height: 200 }} />
          <div className="panel animate-pulse" style={{ height: 160 }} />
        </div>
        <div className="ledger-col">
          <div className="panel animate-pulse" style={{ height: 240 }} />
          <div className="panel animate-pulse" style={{ height: 240 }} />
        </div>
      </div>
    </div>
  );
}
