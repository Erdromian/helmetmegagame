// The page chrome every top-level route sits in.
//
// This existed only as a convention before — `mx-auto flex max-w-5xl flex-col
// gap-6 p-6 sm:p-8` plus an `<h1 className="text-2xl font-bold">`, hand-rolled
// on ~15 pages at five different widths (max-w-2xl/3xl/4xl/5xl/6xl). A
// documented convention drifts; a component can't. Widths collapse to three
// named options here, so "how wide is this page" becomes a choice from a menu
// rather than a number someone picks per page.
//
// No "use client" on purpose: this is markup only, so it stays usable from the
// server components every page here is.

const WIDTHS = {
  narrow: "max-w-3xl", // forms and reading-width pages
  default: "max-w-5xl",
  wide: "max-w-6xl", // long GM tables
  // No centring at all — for a page whose own layout is the width, the way
  // /ledger's three columns are. The desk group owns its screen by skipping
  // PageShell entirely; this is the same idea for a page that still wants
  // the shell's padding and gap.
  full: "max-w-none",
};

export default function PageShell({ width = "default", children }) {
  return (
    <div className={`mx-auto flex w-full ${WIDTHS[width] ?? WIDTHS.default} flex-col gap-6 p-6 sm:p-8`}>
      {children}
    </div>
  );
}

// PageHeader used to live here — a `text-2xl font-bold` heading INSIDE this
// centred column, which is what made every page start at a different height
// from the desks and from Chat. It is gone; the one header is
// components/AppHeader.js, drawn full-bleed ABOVE this shell. If you are
// looking for where a page's title went, that is where.

// A shaped placeholder bar. Deliberately not text: a skeleton's job is to
// reserve the space the real content will occupy, so the layout doesn't jump
// when it lands.
export function SkeletonBar({ width = "100%", height = 12 }) {
  return (
    <div
      aria-hidden="true"
      style={{ width, height, background: "var(--field-bg)", borderRadius: "var(--r-sm)" }}
    />
  );
}

// A page-shaped skeleton, built from the same PageShell + PageHeader as the
// page it stands in for, so the two cannot disagree about width or title.
//
// These used to be route-level `loading.js` files, and are not any more.
// A loading.js wraps its segment in Suspense, which means the router swaps to
// the skeleton the instant you click and the page you were reading vanishes
// before the next one exists. Discord does the opposite — it holds the screen
// you are on until the next one is ready — and that is what this app does now,
// so there is no route-level loading.js anywhere.
//
// What survives is the same component under a different name (Skeleton.js),
// used as a Suspense fallback INSIDE a page: the snapshot pages render a
// stored copy first and stream the fresh one in behind it, and this is what
// they show the very first time, when there is no stored copy yet.
//
// Pass the page's real title and roughly the panel shape it lands in.
// Deliberately draws NO header, and `title` is ignored — kept in the signature
// only so the dozen call sites still read as "the skeleton for the Notes page".
//
// The header is the route's now, drawn by a layout (or by the server page)
// ABOVE the Suspense boundary this fallback sits inside. It is therefore
// already on screen while this renders, and a header in here would stack a
// second bar under the real one for as long as the fallback showed — the same
// double-header play/Skeleton.js has a comment about avoiding.
export function SkeletonPage({ width, title, panels = [[70, 100, 45]] }) {
  void title;
  return (
    <PageShell width={width}>
      {panels.map((bars, i) => (
        <div key={i} className="panel animate-pulse p-4">
          <div className="flex flex-col gap-3">
            {bars.map((w, j) => (
              <SkeletonBar key={j} width={`${w}%`} />
            ))}
          </div>
        </div>
      ))}
    </PageShell>
  );
}
