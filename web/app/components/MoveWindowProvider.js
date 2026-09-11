"use client";

import { createContext, useContext, useEffect, useState } from "react";

const MoveWindowContext = createContext(null);

export function useMoveWindow() {
  return useContext(MoveWindowContext);
}

// Makes the open turn's Move cutoff available anywhere in the tree, so the chip
// every header wears (LockChip.js) resolves without eight separate headers
// threading two numbers down from their own server page. Mirrors
// CarryProvider.js — the promise streams from the root layout.
//
// The default is null, which is also what web/lib/turn.js#getMoveWindow returns
// when there is no lock. So a LockChip with no provider above it — the error
// boundary in ErrorPanel.js — draws nothing without having to be told.
//
// Note the name: /gm/turns/useMoveLock.js is something else entirely (which GM
// is holding a Move open on the desk).
export default function MoveWindowProvider({ children, moveWindowPromise }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(moveWindowPromise)
      .then((json) => {
        if (!cancelled && json) setData(json);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [moveWindowPromise]);

  return <MoveWindowContext.Provider value={data}>{children}</MoveWindowContext.Provider>;
}
