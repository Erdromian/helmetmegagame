"use client";

import { useSyncExternalStore } from "react";

// False during the server render AND during the hydration render, true on
// every render after. React calls getServerSnapshot for both of those passes
// and then re-renders with getSnapshot, so the two trees React actually
// compares are identical by construction.
//
// That is the point: it lets a component render one thing for hydration and a
// better thing immediately afterwards, with no hydration warning, no
// suppressHydrationWarning (which tells React never to fix the text, so a
// timestamp would keep the SERVER's timezone forever), and no effect —
// react-hooks/set-state-in-effect is an error in this repo.
//
// Same discipline as Modal.js over matchMedia and usePins.js over
// localStorage; this one just has nothing to subscribe to.
const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

export default function useHydrated() {
  return useSyncExternalStore(subscribe, onClient, onServer);
}
