import Link from "next/link";
import { prisma } from "@lifeweb/db";
import AppHeader from "@/app/components/AppHeader";
import { loadHeaderIdentity } from "@/lib/headerIdentity";
import EscapeToChat from "./EscapeToChat";

// An ordinary page name, and nothing else. This header used to be a person —
// the character's name as the title, their role and faction as the meta line,
// their face as a 24px avatar in the actions. All four of those are the band's
// now (LedgerBand.js), where they sit beside a face big enough to be worth
// looking at, so repeating them 40px above only made the page say who you are
// twice.
//
// `loadHeaderIdentity()` is still asked, because `backToChat` needs to know
// whether there IS a living character: the Back link and the Escape listener
// belong to the sheet, and a player halfway through the creation wizard who
// taps Escape means "close this", not "leave". It is the same ALIVE-character
// question page.js asks to decide it draws the sheet at all, and it is
// cache()d, so asking it twice costs one query.
//
// Drawn from the layout, not the page: /character renders a client view, and
// a client component cannot render AppHeader.
//
// There is no full-height shell here. The sheet is an ordinary page that
// scrolls with the document, like every other route in this group
// (docs/systemdocs/SHEET.md §1).
export default async function CharacterLayout({ children }) {
  const [character, config] = await Promise.all([
    loadHeaderIdentity(),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { playPanelEnabled: true } }),
  ]);
  // Left out when the Chat page is switched off (GameConfig.playPanelEnabled),
  // since /chat would only bounce back here.
  const backToChat = Boolean(character) && (config?.playPanelEnabled ?? true);
  return (
    <>
      <AppHeader
        title="Character"
        actions={
          backToChat ? (
            <Link href="/chat" className="btn-secondary">
              ← Back to the game · Esc
            </Link>
          ) : null
        }
      />
      {backToChat && <EscapeToChat />}
      {children}
    </>
  );
}
