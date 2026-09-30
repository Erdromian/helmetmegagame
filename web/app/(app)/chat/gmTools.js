"use client";

import { createContext, useContext } from "react";

// The GM's pieces of Chat, handed down rather than imported. Every component
// this page imports ships in one bundle to everybody who opens it, and the GM
// asides pull in the character panel (DevPanelModal), whose Identity tab
// carries the Vampire fields and through them the secret seats' slugs. So
// ChatNext.js and Chat.js never import them: ./layout.js wraps a GM's page in
// ./GmToolsProvider.js, whose bundle a player's page never names, and they
// read the components off this context. Anybody else gets the stand-ins
// below, which draw nothing — every place they are drawn is already gated on
// `gm`, `gmZones` or `viewAs`, none of which a player's page is ever sent.
const nothing = () => null;

export const NO_GM_TOOLS = {
  GmAside: nothing,
  NextGmAside: nothing,
  GmSystemComposer: nothing,
  DecreeDialog: nothing,
  GmNoticeCards: nothing,
  GmSpeakerPanel: nothing,
};

export const GmToolsContext = createContext(NO_GM_TOOLS);

export function useGmTools() {
  return useContext(GmToolsContext);
}
