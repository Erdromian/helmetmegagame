"use client";

import { useLinkStatus } from "next/link";

// The click's receipt.
//
// Nothing in this app has a route-level loading.js any more, so the router
// holds the page you are reading until the next one has actually loaded —
// Discord's behaviour, and what Bascinet asked for. The cost of that is a
// click with no answer: you press Map, the screen does not move, and for a
// beat you cannot tell whether the press landed.
//
// This is the beat. `useLinkStatus` has to be called from a DESCENDANT of the
// <Link>, which is the whole reason it is a separate component instead of six
// lines inside NavRail.js.
//
// The animation is delayed ~120ms on purpose: a prefetched route arrives
// faster than that, and a hint that flashes on every navigation is worse than
// no hint at all. The node is always rendered and only its opacity moves, so
// it can never shift the rail's layout.
export default function RailLinkPending() {
  const { pending } = useLinkStatus();
  return <span className="rail-item-pending" data-pending={pending ? "true" : "false"} aria-hidden="true" />;
}
