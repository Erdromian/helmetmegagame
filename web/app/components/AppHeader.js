import { Suspense } from "react";
import { getOpenTurn } from "@/lib/turn";
import DeskHeader from "./DeskHeader";
import { SkeletonBar } from "./PageShell";
import TurnMeta from "./TurnMeta";
import LockChip from "./LockChip";

// The header every page wears.
//
// There used to be three of these. The desks and Chat had `DeskHeader` — a
// full-bleed bar with a serif title, a rule under it, and meta chips beside
// the name. Everything else had `PageHeader`, a `text-2xl` heading sitting
// INSIDE the centred column, so no two pages began at the same height and
// moving between them jumped the eye down and back up. And /character and
// /ledger each had their own again. Bascinet's note was simply that the Chat
// one is the right one, everywhere.
//
// So this is `DeskHeader` plus the one thing every page wants in it and no
// page should have to remember: where you are and when it is. That chip used
// to be a bubble pinned to the corner of the viewport for every route except
// Chat, which drew its own — see TurnMeta.js.
//
// Not a client component, and it does not await the turn: the promise goes
// into a Suspense boundary so the bar, the title and the actions all paint
// immediately and the chip streams in behind them. A header that blocked on a
// query would undo the whole point of holding the old page during navigation.
//
// `meta` is for a page's OWN chips — the character's role and faction, a
// count, a status — and they sit before the turn, nearest the title.
export default function AppHeader({ title, meta = null, actions = null }) {
  const turnPromise = getOpenTurn();
  return (
    <DeskHeader
      title={title}
      meta={
        <>
          {meta}
          <Suspense fallback={<SkeletonBar width="11rem" height={22} />}>
            <TurnMeta turnPromise={turnPromise} />
          </Suspense>
          {/* Outside the boundary: it awaits nothing on the server, it reads
              the root layout's streamed cutoff from context. */}
          <LockChip />
        </>
      }
      actions={actions}
    />
  );
}
