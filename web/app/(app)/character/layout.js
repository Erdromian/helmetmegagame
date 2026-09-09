import Link from "next/link";
import { prisma } from "@lifeweb/db";
import AppHeader from "@/app/components/AppHeader";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import FactionLink from "@/app/components/FactionLink";
import { loadHeaderIdentity } from "@/lib/headerIdentity";
import EscapeToPlay from "./EscapeToPlay";

// The one page whose header is a person rather than a page name. The title is
// the character's name, with the role and faction as meta chips beside it and
// the face on the right — the same three facts the old PageHeader carried,
// in the bar every other page now wears.
//
// The avatar is 24px because that is exactly the bar's content height
// (.desk-header is 0.5rem of padding around a 23px chip), so it can sit in the
// header without making it taller than any other page's.
//
// Drawn from the layout, not the page: /character renders a client view, and
// a client component cannot render AppHeader.
//
// No living character — the lobby, the creation wizard, a closed door — falls
// back to the page name, because there is nobody to name yet, and gets neither
// the Back link nor the Escape listener: those belong to the sheet, and a
// player halfway through the creation wizard who taps Escape means "close
// this", not "leave". `loadHeaderIdentity()` is the same ALIVE-character
// question page.js asks to decide it draws the sheet at all, and it is
// cache()d, so asking it twice costs one query.
//
// There is no full-height shell here. The sheet is an ordinary page that
// scrolls with the document, like every other route in this group
// (docs/systemdocs/SHEET.md §1).
export default async function CharacterLayout({ children }) {
  const [character, config] = await Promise.all([
    loadHeaderIdentity(),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { playPanelEnabled: true } }),
  ]);
  // Left out when the Play page is switched off (GameConfig.playPanelEnabled),
  // since /play would only bounce back here.
  const backToPlay = Boolean(character) && (config?.playPanelEnabled ?? true);
  return (
    <>
      <AppHeader
        title={character?.name ?? "Character"}
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
            {backToPlay && (
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
                zoomable
              />
            ) : null}
          </>
        }
      />
      {backToPlay && <EscapeToPlay />}
      {children}
    </>
  );
}
