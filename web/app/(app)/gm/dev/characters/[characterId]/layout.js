import Link from "next/link";
import { prisma } from "@lifeweb/db";
import AppHeader from "@/app/components/AppHeader";
import CharacterAvatar from "@/app/components/CharacterAvatar";

// The Dev Panel's header. Drawn here rather than in DevPanel because that is a
// client component, and because the panel has two frames — a page and a
// modeless modal — only one of which wants a page header at all.
//
// The name is the row's, not the staged rename sitting in the panel's own
// state: a layout cannot see client state, and the staged name is already
// visible in the Identity tab where it is being typed.
export default async function DevCharacterLayout({ children, params }) {
  const { characterId } = await params;
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, name: true, updatedAt: true },
  });

  return (
    <>
      <AppHeader
        title={character?.name ?? "Character"}
        meta={
          character ? (
            <CharacterAvatar
              characterId={character.id}
              name={character.name}
              version={character.updatedAt.getTime()}
              size={24}
            />
          ) : null
        }
        actions={
          <Link href="/gm/players" className="btn-quiet">
            &larr; Players
          </Link>
        }
      />
      {children}
    </>
  );
}
