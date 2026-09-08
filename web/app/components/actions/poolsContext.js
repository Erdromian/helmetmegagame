"use client";

import { createContext, useContext } from "react";

// The sheet-side prop bag RequestActionsProvider was mounted with — every
// roster and flag character/page.js resolved — handed to whichever dialog is
// open, so a dialog file reads what it needs instead of the provider threading
// sixty props into each one. Lives in its own module because the provider
// imports the dialogs and the dialogs would otherwise import the provider.
export const ActionPoolsContext = createContext(null);

export function useActionPools() {
  return useContext(ActionPoolsContext) ?? {};
}
