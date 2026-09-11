import Link from "next/link";
import { prisma } from "@lifeweb/db";
import AppHeader from "@/app/components/AppHeader";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import DevSubNav from "@/app/(app)/gm/dev/DevSubNav";

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
              zoomable
            />
          ) : null
        }
        actions={
          <>
            {/* The same sub-nav /gm/dev/tags and its siblings wear. This page
                is reached from a CharacterLink anywhere in the app, so it was
                the one Dev page with no way on to the rest of the Dev pages. */}
            <DevSubNav current="characters" />
            <Link href="/gm/players" className="btn-quiet">
              &larr; Players
            </Link>
          </>
        }
      />
      {children}
    </>
  );
}
