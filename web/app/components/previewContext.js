"use client";

import { createContext, useContext } from "react";

// A GM'S PREVIEW OF A DIALOG. A GM in /chat can open the dialog behind any
// fixture a place has — the phone, the vending machine, the Meister's
// Terminal — to see what a player standing there gets
// (web/app/(app)/chat/GmFixturePreview.js). Inside one, NOTHING reaches the
// server: the dialog starts from `snapshot`, the one read made when it opened,
// everything typed or picked stays in the browser, and every button that
// would change the game is greyed out.
//
// The value is { snapshot } inside a preview — one object for the life of the
// dialog, so it is safe in an effect's dependencies — and null everywhere
// else, so a player's dialog, which is never inside one, reads null and is
// unchanged.
// Two layers hold it shut:
//   - each dialog greys its commit buttons, skips its own reads, and starts
//     from `snapshot`;
//   - useActionRunner reads this too, and inside a preview its runner calls
//     nothing at all — so a button a dialog forgot to grey still sends nothing.
//
// No GM secrets live here: it is a flag and a bag the GM's own bundle fills.
export const PreviewContext = createContext(null);

/** { snapshot } inside a GM's preview, or null. */
export function usePreview() {
  return useContext(PreviewContext);
}

/** The line that says so, at the top of every previewed dialog. Nothing outside one. */
export function PreviewNote() {
  if (!usePreview()) return null;
  return <p className="chat-quiet-line">GM preview: nothing here is sent, and the buttons that would change the game are greyed out.</p>;
}
