import AppHeader from "@/app/components/AppHeader";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import FactionLink from "@/app/components/FactionLink";
import { loadHeaderIdentity } from "@/lib/headerIdentity";

// The second sheet's header, and the same one is a person rather than a page name. The title is
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
// back to the page name, because there is nobody to name yet.
export default async function LedgerLayout({ children }) {
  const character = await loadHeaderIdentity();
  return (
    <>
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
          character ? (
            <CharacterAvatar
              characterId={character.id}
              name={character.name}
              version={character.updatedAt.getTime()}
              size={24}
            />
          ) : null
        }
      />
      {children}
    </>
  );
}
