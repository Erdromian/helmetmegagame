import { describeTurn } from "@/lib/turnFormat";
import { loadFeedViewer } from "@/lib/feedAccess";

// "TOWN · DAY 6 · DUSK · CLEAR" — where you are and when it is, the one chip
// standing over the whole Chat. A .chip, so it is the same bubble the desks'
// turn chips are rather than a shape of its own.
//
// A server component inside the layout's Suspense boundary, so the shell
// paints before either half of it resolves. It loads the zone itself rather
// than taking it from the page: a layout cannot be handed a prop by its child,
// and the alternative — hoisting the whole character load into the layout —
// would make every navigation wait for it.
export default async function ChatTurn({ turnPromise }) {
  const [turn, viewer] = await Promise.all([turnPromise, loadFeedViewer()]);
  const { label } = describeTurn(turn);
  const zone = viewer.character?.location?.zone?.name ?? (viewer.gm ? "Gamemaster" : null);

  return (
    <span className="chip">
      {zone ? `${zone} · ` : ""}
      {label}
    </span>
  );
}
