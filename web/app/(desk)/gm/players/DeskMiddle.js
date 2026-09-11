"use client";

import { useEffect } from "react";
import { useSelection, selectConversation } from "./selection";
import { useThread, getThread, noteLoading, noteReady, noteError } from "./threadStore";
import PersonShell from "./conversation/PersonShell";
import ConversationSkeleton from "./conversation/Skeleton";

// The desk's middle column: the roster, with a conversation drawn over it when
// one is open.
//
// `children` is the roster route, which is now the desk's only route and stays
// mounted the whole time. That is what makes closing a conversation instant —
// the roster is already there, with its search, sort and scroll intact,
// rather than being re-fetched by a navigation back to it.
//
// Opening somebody is a fetch, not a navigation, and the difference is the
// whole point: a fetch can be ABORTED. Click three people quickly and the
// first two requests are dropped the moment you move on, where three RSC
// navigations would each have run to completion with the third waiting behind
// the other two.
export default function DeskMiddle({ children, gmProfiles, myDiscordUserId }) {
  const selected = useSelection();
  const entry = useThread(selected);

  useEffect(() => {
    if (!selected) return undefined;
    // Already loaded: draw it and ask for nothing. This is the cache paying
    // off — reopening somebody costs no request at all.
    if (getThread(selected)?.status === "ready") return undefined;

    const controller = new AbortController();
    noteLoading(selected);
    (async () => {
      try {
        const res = await fetch(`/api/gm/thread?user=${encodeURIComponent(selected)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (res.status === 204) {
          noteError(selected, "You are not signed in as a GM any more. Reload the page.");
          return;
        }
        if (res.status === 404) {
          noteError(selected, "There is nobody by that id.");
          return;
        }
        if (!res.ok) {
          noteError(selected, "The conversation could not be loaded.");
          return;
        }
        const payload = await res.json();
        if (controller.signal.aborted) return;
        noteReady(selected, payload);
      } catch (err) {
        // An abort is the ordinary case — the GM moved on — and is not an
        // error anybody should be shown.
        if (controller.signal.aborted || err?.name === "AbortError") return;
        noteError(selected, "The conversation could not be loaded.");
      }
    })();

    return () => controller.abort();
  }, [selected]);

  if (!selected) return children;

  // A payload we already had stays on screen while a refetch is in flight, so
  // reopening never flashes empty. Only a conversation with nothing cached
  // draws the skeleton.
  if (entry?.payload) {
    return (
      <PersonShell
        // Keyed on the conversation: the pane seeds local state from its props
        // (the loaded page, the claim, the composer's draft), so switching
        // person has to be a remount. This is what the route change used to do.
        key={selected}
        {...entry.payload}
        // The route answers in REST's shape — `messages` / `hasMore` — and the
        // pane takes the props it always took, which name themselves `initial`
        // because it copies them into state once. Spreading the payload alone
        // left both undefined and the pane threw on its first render.
        initialMessages={entry.payload.messages}
        initialHasMore={entry.payload.hasMore}
        gmProfiles={gmProfiles}
        myDiscordUserId={myDiscordUserId}
      />
    );
  }

  if (entry?.status === "error") {
    // Its own error state rather than components/ErrorPanel, which carries a
    // DeskHeader of its own — a second header inside the column — and says
    // "that page didn't load", which is not what happened. error.js still
    // covers a render THROW; this covers a failed fetch, which no boundary
    // can see.
    return (
      <div className="desk-person">
        <div className="panel m-3 flex flex-col items-start gap-3 p-4">
          <p className="text-sm text-muted">{entry.error}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              // Clearing and re-selecting is what re-runs the effect above.
              const id = selected;
              selectConversation(null, { replace: true });
              selectConversation(id, { replace: true });
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return <ConversationSkeleton />;
}
