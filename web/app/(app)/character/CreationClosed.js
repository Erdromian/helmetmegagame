import Link from "next/link";
import PageShell from "@/app/components/PageShell";

// Shown in place of the creation wizard when a player can't roll a character
// yet — either the game isn't running (GameState.phase) or they aren't on the
// roster (PLAYER_ROLE_ID in db/lib/roleIds.js).
//
// A third case borrows the first one's face: with GameConfig.playtestModeEnabled
// on, anyone outside the build crew is turned away as "not open yet" rather
// than "not on the roster" (page.js's `gate.masked`). There is nothing for them
// to apply for, and a closed rehearsal should not advertise itself.
//
// createCharacter enforces both independently; this exists so the reason is
// legible up front rather than arriving as an error after four steps of work.
// Both branches point at /documents, which is readable either way and is the
// whole reason a locked-out player has something to do here.
export default function CreationClosed({ open }) {
  return (
    <PageShell>
      <h2 className="section-title">{open ? "You Are Not On The Roster" : "Ravenheart Is Not Open Yet"}</h2>
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
