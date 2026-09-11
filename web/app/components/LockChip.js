"use client";

import { useMoveWindow } from "./MoveWindowProvider";
import useNowTick from "./useNowTick";
import { lockCountdown } from "@/lib/turnFormat";

// When Moves stop being accepted — "LOCK 9:00 PM · 2h 14m" — in the reader's
// own timezone, in the header of every page.
//
// The header already said where you are and when it is (TurnMeta.js). It did
// not say the one clock fact anybody plans an evening around: Moves close three
// hours before the turn rolls over (TURN-ENGINE.md §6a). That was only on
// surfaces you had to go and find, and only ever as a relative "closes in 3 h",
// which a player two timezones over has to do arithmetic on.
//
// Takes no props. The two numbers come from the root layout through
// MoveWindowProvider, so a header adds this by writing <LockChip /> and nothing
// else. That is the point: there are six header call sites, and three of them
// are rendered from client components, which cannot hold an async server child
// however the data is fetched.
//
// The clock time is a local time, and that is the whole point, so it is only
// honest once there is a browser to ask: the context fills after mount, so this
// renders nothing on the server and nothing during hydration. No
// suppressHydrationWarning — that one tells React never to repair the text, and
// a header pinned to the SERVER's timezone forever is the exact bug this
// feature exists to fix (see useHydrated.js).

// The reader's own clock, in the reader's own locale — so a 24-hour locale gets
// 21:00 and a 12-hour one gets 9:00 PM, which is the whole request. Not
// discordTime.js's "t" style, which is Discord's and pads the hour: "09:00 PM"
// in a header reads like a typo, and nothing here has to match a <t:…:t> tag.
function clockTime(ms) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

export default function LockChip() {
  const moveWindow = useMoveWindow();
  const now = useNowTick(30_000);

  if (!moveWindow) return null;
  const { cutoffAtMs, endsAtMs } = moveWindow;

  // Nothing once the turn's own end has passed: the push is a cron, and the
  // next turn's numbers arrive with the next load. /gm/turns' push countdown
  // makes the same call (Workspace.js).
  if (now >= endsAtMs) return null;

  // Derived here rather than sent as a boolean, so a desk left open all evening
  // crosses the cutoff honestly instead of freezing at whatever was true when
  // the page loaded. Same reason untilLabel() counts in the browser.
  const locked = now >= cutoffAtMs;
  const clock = clockTime(cutoffAtMs);
  const countdown = lockCountdown(cutoffAtMs - now);
  if (!locked && !countdown) return null;

  return (
    <span
      className="chip chip-mono"
      data-tone={locked ? "danger" : undefined}
      title="Moves close three hours before the turn ends"
    >
      {locked ? "MOVES LOCKED" : `LOCK ${clock} · ${countdown}`}
    </span>
  );
}
