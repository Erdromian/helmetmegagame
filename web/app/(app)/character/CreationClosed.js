import Link from "next/link";
import PageShell from "@/app/components/PageShell";
import Wordmark from "@/app/components/Wordmark";

// Shown in place of the creation wizard when a player can't roll a character
// yet. TWO different refusals live here, and they do not look alike:
//
//   the game is shut (GameState.phase === "CLOSED")
//       The door, not a page. The wordmark, the word "Closed", and the one
//       thing there is to do in the meantime. Nothing else on the screen,
//       because there is nothing else — the rail above is narrowed to five
//       items for the same reason (web/lib/navItems.js).
//
//   the game is open, but not to you
//       Not on the roster (PLAYER_ROLE_ID), or turned away by playtest mode
//       (page.js's `gate.masked`, which says "not open yet" rather than "not
//       on the roster" — a closed rehearsal shouldn't advertise itself). A
//       bare wordmark would say nothing useful about either, so these keep the
//       panel and the sentence that explains them.
//
// createCharacter enforces all of it independently; this just surfaces the
// reason up front instead of after four steps of work.
export default function CreationClosed({ open, phase }) {
  if (phase === "CLOSED") {
    return (
      /* min-h rather than h-full: HomeScreen sits directly in the root layout's
         h-full chain, but this renders inside .app-main, where there is no
         height to inherit and h-full collapses to the content. */
      <main className="relative z-10 flex min-h-[70vh] flex-col items-center justify-center gap-8 px-6 text-center">
        <Wordmark note="Closed" />
        <Link href="/documents" className="btn-secondary">
          Read documents
        </Link>
      </main>
    );
  }

  return (
    <PageShell>
      <h2 className="section-title">{open ? "You are not on the roster" : "Ravenheart is not open yet"}</h2>
      <div className="panel flex flex-col gap-3 p-4">
        <p className="text-sm">
          {open
            ? "Character creation is open, but your Discord account doesn't carry the player role for this game. Apply in #apply."
            : "Character creation's not open yet!"}
        </p>
        <p className="text-sm text-muted">
          {open
            ? "If you think that's a mistake, ask a GM to add you. In the meantime, the public rules are worth reading."
            : "Have a look at the Documents page in the meantime."}
        </p>
        <div>
          <Link href="/documents" className="btn-secondary">
            Read the documents
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
