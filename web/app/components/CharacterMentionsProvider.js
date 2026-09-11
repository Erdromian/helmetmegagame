"use client";

import { createContext, useContext, useMemo } from "react";

// Deliberately NOT mounted in the root layout, unlike TagsProvider and its
// two siblings (ProductionRatesProvider, DocumentsProvider). Only /chat and
// /notes render a {char:…} token, and each hands down its own list. The
// default is an empty Map, so a {char:…} token anywhere else in the app
// simply fails to resolve — which now means the neutral chip its renderer
// draws, not the raw token, and it still means mounting this provider can
// never regress a page that doesn't use it.
const CharacterMentionsContext = createContext(new Map());

export function useCharacterMentions() {
  return useContext(CharacterMentionsContext);
}

// Two lists, because offering a name and resolving one are different
// questions and answering both with the room you are standing in was the bug
// (web/lib/mentionDirectory.js has the whole argument).
//
//   characters — the narrow one. The @ menu's list, the people here. It wins
//                on a collision because it carries the avatar path whosHere()
//                already resolved.
//   directory  — every character whose name is safe to print, so a ping of
//                somebody in another zone still renders as a person.
//
// Both are `{ id, name, updatedAt, avatarPath }[]`, and both pages pass both:
// /chat's narrow list is the room it stands in, /notes' is everybody not
// currently presenting as somebody else. The wide one is deliberately blind to
// hoods, because it is read against OLD lines — see mentionDirectory.js.
export default function CharacterMentionsProvider({ characters = [], directory = [], children }) {
  const mentionsById = useMemo(() => {
    const map = new Map();
    for (const c of directory) map.set(c.id, c);
    for (const c of characters) map.set(c.id, c);
    return map;
  }, [characters, directory]);
  return <CharacterMentionsContext.Provider value={mentionsById}>{children}</CharacterMentionsContext.Provider>;
}
