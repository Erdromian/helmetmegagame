"use client";

import CharacterSheet from "@/app/components/CharacterSheet";
import CreateCharacterWizard from "./CreateCharacterWizard";
import CreationClosed from "./CreationClosed";
import Lobby from "./lobby/Lobby";

// What /character draws, from the one object page.js#FreshCharacter produces
// — the stored copy first, the fresh one when it lands (web/lib/snapshot).
// Four kinds, one component each; the props are exactly what each of them
// always took.
//
// The other three draw their own PageShell and scroll like any other page.
// The sheet does not: it is the full-width workspace (CharacterSheet.js),
// which is why the layout above wears no shell of its own.
export default function CharacterView({ kind, open, lobby, wizard, sheet }) {
  if (kind === "closed") return <CreationClosed open={open} />;
  if (kind === "lobby") return <Lobby {...lobby} />;
  if (kind === "wizard") return <CreateCharacterWizard {...wizard} />;
  return <CharacterSheet {...sheet} />;
}
