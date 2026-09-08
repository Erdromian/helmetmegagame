"use client";

import useHydrated from "./useHydrated";
import useNowTick from "./useNowTick";
import { formatDiscordTimestamp } from "@/lib/discordTime";
import { DEFAULT_TIMESTAMP_STYLE } from "@lifeweb/db/lib/discordMarkup";

// A `<t:EPOCH:style>` from Discord, rendered as a real time.
//
// Split in two so the hooks stay unconditional and an absolute stamp never
// mounts a timer: a DM thread can hold a dozen `<t:…:F>` and not one of them
// needs a heartbeat.

function AbsoluteTime({ ms, format }) {
  const hydrated = useHydrated();
  // Pinned to UTC until hydrated, so the server's string and the browser's
  // first string are byte-identical; local from the pass after.
  const shown = formatDiscordTimestamp(ms, format, hydrated ? {} : { timeZone: "UTC" });
  if (!shown) return null;
  return (
    <time className="discord-time" dateTime={shown.iso} title={shown.title}>
      {shown.text}
    </time>
  );
}

function RelativeTime({ ms }) {
  const hydrated = useHydrated();
  // A minute is the finest granularity any of these labels shows.
  const now = useNowTick(60_000);
  // Before hydration a relative time is unanswerable — the server does not
  // know when the reader will look at it — so it degrades to the absolute
  // short form. A real time, in UTC, the same on both sides.
  const shown = hydrated
    ? formatDiscordTimestamp(ms, "R", { now })
    : formatDiscordTimestamp(ms, "f", { timeZone: "UTC" });
  if (!shown) return null;
  return (
    <time className="discord-time" dateTime={shown.iso} title={shown.title}>
      {shown.text}
    </time>
  );
}

// `epoch` and `format` arrive as strings: they come off a hast node's
// properties, and `style` could not be the prop name because React owns it.
export default function DiscordTime({ epoch, format }) {
  const seconds = Number(epoch);
  if (!Number.isFinite(seconds)) return null;
  const ms = seconds * 1000;
  const chosen = format || DEFAULT_TIMESTAMP_STYLE;
  return chosen === "R" ? <RelativeTime ms={ms} /> : <AbsoluteTime ms={ms} format={chosen} />;
}
