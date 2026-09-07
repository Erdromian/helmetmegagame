// The Hall is not a PageShell page, so it cannot be a SkeletonPage either —
// that component draws a centred column with a title, which is the shape this
// route deliberately left behind. What it can do is hold the same three
// columns still, so the layout does not jump when the scene lands.
export default function Loading() {
  return (
    <div className="hall-body" aria-hidden="true">
      <div className="hall-places" />
      <div className="hall-centre" />
      <aside className="hall-aside" />
    </div>
  );
}
