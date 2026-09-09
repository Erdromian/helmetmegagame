import { describeTurn } from "@/lib/turnFormat";
import { loadFeedViewer } from "@/lib/feedAccess";

// "TOWN · DAY 6 · DUSK · CLEAR" — where you are and when it is, in the header
// of every page. A .chip, so it is the same bubble the desks' meta chips are
// rather than a shape of its own.
//
// This was Chat's alone (play/ChatTurn.js), while every other page got the
// same fact from a small bubble pinned to the bottom-right corner of the
// viewport. Two answers to one question, and the floating one had to be
// hidden by a `body:has(.chat-shell)` rule wherever they met. Now every page
// wears the same header (AppHeader.js) and the header carries this, so the
// floating chip is gone and this is the only place the turn is stated.
//
// A server component, always rendered inside a Suspense boundary, so the
// header paints before either half of it resolves. It loads the zone itself
// rather than taking it from the page: it is used from layouts as well as
// pages, and a layout cannot be handed a prop by its child.
export default async function TurnMeta({ turnPromise }) {
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
