import Tooltip from "./Tooltip";

// The little face next to a character's name wherever a GM scans a list of
// them, served by /api/avatar/[characterId] — see PORTRAITS.md.
//
// `version` should be the character's updatedAt.getTime(): the avatar route
// answers with an immutable Cache-Control, so a stale version keeps a GM
// looking at a face from before the last rename or portrait change.
//
// A plain <img>, not next/image: the route serves arbitrary uploaded bytes at
// an unknown intrinsic size, which next/image would refuse without explicit
// dimensions.

function CatatonicDot({ size }) {
  const dot = Math.max(7, Math.round(size * 0.4));
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        right: -1,
        bottom: -1,
        width: dot,
        height: dot,
        borderRadius: "var(--r-full)",
        background: "var(--muted)",
        // Ringed with the surface it sits on so it reads as a badge rather
        // than a smudge on the portrait, whatever the portrait's colours.
        border: "1px solid var(--surface)",
      }}
    />
  );
}

export default function CharacterAvatar({
  characterId,
  name,
  version,
  src,
  size = 20,
  catatonic = false,
  // A face you have not earned. Set for somebody standing here you have not
  // watched speak this turn, and for an archived line said before the game
  // recorded what was over the speaker's face.
  unknown = false,
}) {
  const wrap = (face) =>
    catatonic ? (
      <span style={{ position: "relative", display: "inline-flex", flexShrink: 0, verticalAlign: "middle" }}>
        {face}
        <CatatonicDot size={size} />
      </span>
    ) : (
      face
    );

  // The tooltip is the accessible name for the whole marker, so the AFK
  // state rides it rather than a second stop for a screen reader.
  const label = catatonic ? `${name} — Catatonic (AFK)` : name;

  // The question-mark plate. It must never fall back to an initial the way the
  // bare branch below does: "a young man" would draw an A, and one letter is
  // enough to tell two hoods apart, which is the entire thing this withholds.
  // The tooltip still carries the alias, so a screen reader hears the name the
  // room hears rather than "unknown".
  if (unknown) {
    return (
      <Tooltip text={label}>
        {wrap(
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: size,
              height: size,
              borderRadius: "var(--r-full)",
              background: "var(--field-bg)",
              border: "1px solid var(--border)",
              color: "var(--muted)",
              fontSize: `${Math.max(0.55, size / 32)}rem`,
              flexShrink: 0,
              verticalAlign: "middle",
            }}
          >
            ?
          </span>,
        )}
      </Tooltip>
    );
  }

  if (!characterId && !src) {
    return wrap(
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          borderRadius: "var(--r-full)",
          background: "var(--field-bg)",
          border: "1px solid var(--border)",
          fontSize: "0.6rem",
          flexShrink: 0,
          verticalAlign: "middle",
        }}
      >
        {name?.[0]?.toUpperCase() ?? "?"}
      </span>,
    );
  }

  // An explicit src is a face somebody else already decided — the mask sprite
  // or letter plaque presentedIdentity resolved, frozen onto an archive row or
  // re-derived for a live roster. Used verbatim, with no `?v=`: the file is
  // the same for every wearer and never changes, so cache-busting it would be
  // both pointless and a fingerprint (PROXYING.md §5).
  //
  // Without one this builds the character's own URL, and that route is
  // identity-BLIND — it serves the real face whatever is over it. Never send a
  // concealed character down that branch.
  const imageSrc = src ?? `/api/avatar/${characterId}${version ? `?v=${version}` : ""}`;

  return (
    <Tooltip text={label}>
      {wrap(
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc}
          alt=""
          width={size}
          height={size}
          style={{
            width: size,
            height: size,
            borderRadius: "var(--r-full)",
            objectFit: "cover",
            flexShrink: 0,
            verticalAlign: "middle",
          }}
        />,
      )}
    </Tooltip>
  );
}
