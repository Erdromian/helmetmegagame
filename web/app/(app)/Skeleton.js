import PageShell from "@/app/components/PageShell";

// The generic body skeleton, for a page in this group with no shaped one of
// its own. It deliberately renders no title: unlike every other skeleton here
// it cannot know whose page it is standing in for.
//
// It is NOT a loading.js any more — see the note in PageShell.js#SkeletonPage.
// Nothing in this app has a route-level loading.js now; a skeleton is only
// ever a Suspense fallback INSIDE a page, for the snapshot swap.
export default function Loading() {
  return (
    <PageShell>
      <div className="panel animate-pulse p-4" style={{ height: 96 }} />
      <div className="panel animate-pulse p-4" style={{ height: 220 }} />
    </PageShell>
  );
}
