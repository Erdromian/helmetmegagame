// One way to show a state, in place of the eight the app had grown.
//
// The tone is the vocabulary, not the colour: callers say what a state MEANS
// and the stylesheet decides what that looks like, so a status cannot pick a
// colour the theme has not solved. That matters because "bad" was being drawn
// with --accent in some places and --danger in others, and --accent is a fill
// token that fails AA as text.
//
// Colour comes from a data-tone attribute rather than an inline style — the
// mechanism the map panel's data-tier already proves, and which nothing else
// in the app was using.
//
// Per-domain label/tone maps stay where they are. A Move's statuses and a
// Request's are genuinely different vocabularies with their own justifying
// comments; what universalizes is the rendering, not the meanings.
// `title` is passed through because several states are only half a sentence
// on their own -- "Catching up" wants to say what is catching up with what.
// It is the one extra prop; a status still cannot be handed a colour.
export default function StatusPill({ tone = "neutral", children, className = "", title }) {
  return (
    <span className={`status-pill ${className}`.trim()} data-tone={tone} title={title}>
      {children}
    </span>
  );
}

// The DB enums, in one place, so a raw ALIVE/DEAD/FULFILLED can never reach a
// player again. Five tables were rendering `{c.status}` straight out of Prisma
// -- two of them on /faction, which players can see.
export const CHARACTER_STATUS = {
  ALIVE: { label: "Alive", tone: "good" },
  DEAD: { label: "Dead", tone: "bad" },
  CURSED: { label: "Cursed", tone: "muted" },
};

export const DESIRE_STATUS = {
  ACTIVE: { label: "Active", tone: "neutral" },
  FULFILLED: { label: "Fulfilled", tone: "good" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};

// Renders a DB enum through one of the maps above, falling back to the raw
// value rather than to nothing — an unmapped enum should look wrong in review,
// not vanish in production.
export function EnumPill({ map, value, className = "" }) {
  const entry = map[value];
  return (
    <StatusPill tone={entry?.tone ?? "neutral"} className={className}>
      {entry?.label ?? value}
    </StatusPill>
  );
}

// LobbyEntry.status, for /gm/dev's lobby roster. The seat's own words rather
// than the enum's: "Seat offered" says what ASSIGNED means to the person
// reading the table, and the two that need chasing (declined, expired) are
// the only ones that take a colour.
export const LOBBY_STATUS = {
  READY: { label: "Ready", tone: "good" },
  ASSIGNED: { label: "Seat offered", tone: "neutral" },
  CREATED: { label: "Created", tone: "good" },
  DECLINED: { label: "Declined", tone: "muted" },
  EXPIRED: { label: "Expired", tone: "warn" },
  UNASSIGNED: { label: "In the lobby", tone: "muted" },
};
