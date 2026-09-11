import Link from "next/link";

import { DEV_PAGES } from "@/lib/devNav";

// The nav for the three PageShell sub-pages this sits above — characters,
// factions, tags — plus a link back to the desk-style /gm/dev.
//
// It and the Dev Panel's own OpsNav "Elsewhere" group are one navigation now:
// both read DEV_PAGES from web/lib/devNav.js, which is the single list of
// where /gm/dev can take you. They stay two renderers because the two shells
// are genuinely different shapes — a vertical rail inside the desk, a
// horizontal row in a page header — but neither owns the destinations any more.
//
// No "use client": a leaf of plain <Link>s, so every server-component
// sub-page can render it without joining a client bundle.
const ITEMS = DEV_PAGES;

export default function DevSubNav({ current }) {
  return (
    <nav className="flex flex-wrap items-center gap-4 text-sm">
      {ITEMS.map((item) =>
        item.key === current ? (
          <span key={item.key} className="menu-item text-muted" aria-current="page">
            {item.label}
          </span>
        ) : (
          <Link key={item.key} href={item.href} className="menu-item">
            {item.label}
          </Link>
        ),
      )}
    </nav>
  );
}
