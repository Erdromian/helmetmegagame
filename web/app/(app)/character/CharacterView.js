"use client";

import CharacterSheet from "@/app/components/CharacterSheet";
import CreateCharacterWizard from "./CreateCharacterWizard";
import CreationClosed from "./CreationClosed";
import CreationCursed from "./CreationCursed";
import Lobby from "./lobby/Lobby";
import LatePartyMuster from "./lobby/LatePartyMuster";

// What /character draws, from page.js#FreshCharacter (stored copy first, then
// fresh via web/lib/snapshot). Six kinds, one component each. The other
// five draw their own PageShell; the sheet is the full-width workspace
// (CharacterSheet.js), so the layout above wears no shell of its own.
export default function CharacterView({ kind, open, phase, lobby, muster, wizard, sheet }) {
  if (kind === "closed") return <CreationClosed open={open} phase={phase} />;
  if (kind === "cursed") return <CreationCursed />;
  if (kind === "lobby") return <Lobby {...lobby} />;
  if (kind === "muster") return <LatePartyMuster {...muster} />;
  if (kind === "wizard") return <CreateCharacterWizard {...wizard} />;
  return <CharacterSheet {...sheet} />;
}
