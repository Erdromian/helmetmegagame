import Link from "next/link";
import { prisma } from "@lifeweb/db";
import AppHeader from "@/app/components/AppHeader";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import FactionLink from "@/app/components/FactionLink";
import { loadHeaderIdentity } from "@/lib/headerIdentity";
import EscapeToPlay from "./EscapeToPlay";

// The sheet owns its whole screen, the way Chat does (play/layout.js): no
// PageShell, no centred max-width, a 100dvh column whose columns scroll inside
// it (docs/systemdocs/SHEET.md §1). It wears the same AppHeader every page
// wears, and its header is a person rather than a page name: the character's
// name, with the role and faction beside it and the face on the right — the
// same as /character's layout.
//
// The avatar is 24px because that is exactly the bar's content height
// (.desk-header is 0.5rem of padding around a 23px chip), so it can sit in the
// header without making it taller than any other page's.
//
// Beside it, the one action the sheet has: the way back to the game, a link
// to /play that Escape presses for you (EscapeToPlay.js). Both are left out
// when the Play page is switched off (GameConfig.playPanelEnabled), since
// /play would only bounce back here.
//
// Drawn from the layout, not the page: a client component cannot render
// AppHeader. No living character — the lobby, the creation wizard, a closed
// door — falls back to the page name, because there is nobody to name yet.
export default async function LedgerLayout({ children }) {
  const [character, config] = await Promise.all([
    loadHeaderIdentity(),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { playPanelEnabled: true } }),
  ]);
  const playOn = config?.playPanelEnabled ?? true;
  return (
    <div className="sheet-shell">
      <AppHeader
        title={character?.name ?? "Ledger"}
        meta={
          character ? (
            <span className="text-sm text-muted">
              {character.roleTitle ?? "No role"} —{" "}
              <FactionLink factionId={character.faction?.id ?? null} name={character.faction?.name ?? "No faction"} />
            </span>
          ) : null
        }
        actions={
          <>
            {playOn && (
              <Link href="/play" className="btn-secondary">
                ← Back to the game · Esc ‡
              </Link>
            )}
            {character ? (
              <CharacterAvatar
                characterId={character.id}
                name={character.name}
                version={character.updatedAt.getTime()}
                size={24}
              />
            ) : null}
          </>
        }
      />
      {playOn && <EscapeToPlay />}
      {children}
    </div>
  );
}
