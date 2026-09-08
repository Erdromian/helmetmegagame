// Discord's seven timestamp styles, formatted for the web. Pure — no React,
// no DOM — so it can be exercised straight from node, and so DiscordTime.js
// can call it twice with different options in the same render.
//
// It sits beside dmTime.js rather than inside it: dmTime is the DM thread's
// OWN house style ("Today at 14:02"), which is a deliberate chat-app voice we
// choose. These are Discord's styles, which we do not get to choose — a
// `<t:E:D>` means a long date because Discord says so.
//
// Both Intl constructors used here are built in. No new dependency.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Discord's own approximations. A month is not 30 days, but a relative label
// reading "1 month ago" for 31 days is what a reader expects; exactness here
// would produce "4 weeks ago" and look broken beside Discord's own rendering.
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

// The options each style renders with, in Intl terms.
const STYLE_OPTIONS = {
  t: { hour: "2-digit", minute: "2-digit" },
  T: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
  d: { day: "2-digit", month: "2-digit", year: "numeric" },
  D: { day: "numeric", month: "long", year: "numeric" },
  f: { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" },
  F: { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" },
};

const UNITS = [
  [YEAR, "year"],
  [MONTH, "month"],
  [DAY, "day"],
  [HOUR, "hour"],
  [MINUTE, "minute"],
];

// The largest unit that fits, which is Discord's rule: 90 minutes is "2 hours
// ago", not "90 minutes ago". Falls through to seconds so "now" has a word.
function relativeParts(ms, now) {
  const diff = ms - now;
  const size = Math.abs(diff);
  for (const [span, unit] of UNITS) {
    if (size >= span) return [Math.round(diff / span), unit];
  }
  return [Math.round(diff / SECOND), "second"];
}

// { text, title, iso } for one timestamp.
//
// `timeZone` is passed ONLY on the pre-hydration pass, pinned to "UTC", so the
// server and the browser produce a byte-identical string and React has nothing
// to complain about. Omitted afterwards — which is what makes the second pass
// local, and is the whole mechanism in DiscordTime.js.
export function formatDiscordTimestamp(ms, style = "f", { now = Date.now(), timeZone } = {}) {
  const at = new Date(ms);
  if (Number.isNaN(at.getTime())) return null;
  const zone = timeZone ? { timeZone } : {};
  const iso = at.toISOString();
  // The hover always shows the full absolute moment, whatever the style — a
  // relative "3 days ago" with no way to see the actual date is a worse
  // timestamp than the raw tag was.
  const title = new Intl.DateTimeFormat(undefined, { ...STYLE_OPTIONS.F, ...zone }).format(at);

  if (style === "R") {
    const [value, unit] = relativeParts(ms, now);
    const text = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(value, unit);
    return { text, title, iso };
  }

  const options = STYLE_OPTIONS[style] ?? STYLE_OPTIONS.f;
  return { text: new Intl.DateTimeFormat(undefined, { ...options, ...zone }).format(at), title, iso };
}
