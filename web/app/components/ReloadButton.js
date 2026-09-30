"use client";

// The top bar's Refresh, for a phone on the map or a GM desk. Those pages pin
// the screen and switch off the bounce (globals.css, "the document behind those
// three"), and on a phone that takes pull-to-refresh with it — so this is the
// pull-down, as a button. Hidden everywhere else by CSS: a desktop has F5, and
// an ordinary page still pulls down. Chat hides the top bar on a phone and
// carries its own copy in the head's ⋯ menu (ChatBarControls.js).
//
// A full reload rather than router.refresh(): what a player wants from a
// refresh is the whole page fresh, live connections included.
export default function ReloadButton() {
  return (
    <span className="top-bar-reload">
      <button type="button" className="nav-link" onClick={() => window.location.reload()}>
        Refresh
      </button>
      <span className="action-strip-sep" aria-hidden="true" />
    </span>
  );
}
