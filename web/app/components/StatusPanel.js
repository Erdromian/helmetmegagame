import { gambitModifierTotal } from "@lifeweb/db/lib/gambitModifier";
import { CATATONIC_SLUG, TRUMPET_SLUG } from "@lifeweb/db/lib/constants";
import TagPointsValue from "./TagPointsValue";
import ActionGrid from "./ActionGrid";
import SoundTrumpetButton from "./SoundTrumpetButton";
import StandingHerePanel from "./StandingHerePanel";
import { ThisTurn, carryCapTitle } from "./statusBits";

// A labelled row, so Zone / Resources / Gambit line up on one grid instead
// of each being its own ad-hoc flex line. `stacked` swaps the value cell to a
// column for content that clamps onto multiple lines (the Move description)
// — the default flex-wrap row fights a CSS line-clamp otherwise.
function Row({ label, children, stacked = false }) {
  return (
    <>
      <dt className="field-label" style={{ alignSelf: stacked ? "start" : "center" }}>
        {label}
      </dt>
      <dd className={`m-0 text-sm ${stacked ? "flex flex-col items-start gap-1" : "flex flex-wrap items-center gap-2"}`}>
        {children}
      </dd>
    </>
  );
}

export default function StatusPanel({
  character,
  isSelf,
  currentAction,
  openTurn,
  carry = null,
  zoneMoves = null,
  zoneMovesReason = null,
  travellingTo = null,
  pendingOffers = [],
  // What stands at this Location (db/lib/structures.js), built in
  // character/page.js. Empty on someone else's sheet.
  sitesHere = [],
  // This character's own ACTIVE CraftProjects (db/lib/structures.js is the
  // Structure half; CraftProject is the pocket-item half), also built in
  // character/page.js and otherwise only visible by opening the Craft
  // dialog. Empty on someone else's sheet — CharacterSheet only ever mounts
  // this component for the sheet's own owner.
  craftProjects = [],
}) {
  // Hunger is the only Gambit contributor, and this is the same module the bot
  // rolls against (db/lib/gambitModifier.js) — so what a player reads here is
  // exactly what gets applied.
  const total = gambitModifierTotal(character.tags, { hungerStreak: character.hungerStreak });

  // Same shape tolerance as gambitModifierTotal above: CharacterTag[] with a
  // joined tag. The catatonic tag is granted/cleared only by the turn pass
  // (db/lib/catatonicPass.js), so this row explains itself rather than
  // leaving the player to find one grey chip among their tags.
  const catatonic = character.tags?.some((ct) => (ct?.tag?.slug ?? ct?.slug) === CATATONIC_SLUG);

  // Held, not equipped: you pick a trumpet up to blow it.
  const hasTrumpet = character.tags?.some((ct) => (ct?.tag?.slug ?? ct?.slug) === TRUMPET_SLUG);

  // Standing work, without opening the Craft dialog: a CraftProject is a
  // pocket item in progress, a build site UNDER_CONSTRUCTION here is a
  // Structure in progress (a half-built wall — leaving it off this list
  // would read as a bug, not as "nothing to report"). A finished or ruined
  // site isn't "in progress", so it's left to StandingHerePanel below.
  const sitesInProgress = sitesHere.filter(
    (s) => s.status === "UNDER_CONSTRUCTION",
  );
  const hasWorkInProgress =
    craftProjects.length > 0 || sitesInProgress.length > 0;

  return (
    <>
    <section className="panel p-4">
      <h2 className="panel-header">Status</h2>

      {/* The readout and the Actions block side by side, rather than the
          actions stacked under a divider at the bottom. Everything a player
          does now lives in that grid, so it earns the space next to the
          numbers it acts on — and the panel stays about as tall as the <dl>
          alone used to be. Below `sm` the grid drops underneath. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <dl
          className="grid min-w-0 flex-1 gap-x-4 gap-y-2"
          style={{ gridTemplateColumns: "auto minmax(0, 1fr)", margin: 0 }}
        >
          {catatonic && (
            <Row label="Condition">
              <span className="text-muted">
                Catatonic — lifts the moment {isSelf ? "you" : "they"} act or speak in character.
              </span>
            </Row>
          )}

          {/* Where they stand is the Location; the zone is the region it
              sits in, and what the #summary channel belongs to. */}
          <Row label="Location">{character.location?.name ?? "Nowhere"}</Row>

          <Row label="Zone">{character.zone?.name ?? "Unassigned"}</Row>

          {/* A crossing that cost the Move is a day's walk, and the character
              stays put until the next turn opens (MAP.md §3). */}
          {travellingTo && (
            <Row label="On the road">
              <span title="You arrive when the turn turns. ‡">
                walking to {travellingTo}
              </span>
            </Row>
          )}

          {/* Free zone crossings left this turn (CARRY.md §2). Past these a
              crossing spends the Move; at zero — which is what Overburdened
              does — the first one already does. */}
          {zoneMoves != null && (
            <Row label="Zone moves">
              {/* The reason rides in the hover for the same reason the carry
                  cap's breakdown does: a bare 0 leaves a lamed or overloaded
                  player with nothing to act on. */}
              <span
                className="mono"
                title={zoneMovesReason ?? undefined}
                style={zoneMoves === 0 ? { color: "var(--accent-text)" } : undefined}
              >
                {zoneMoves} free
              </span>
            </Row>
          )}

          {/* Load against the carry caps (CARRY.md). `carry` is computed
              server-side by character/page.js for the owner's own sheet
              only; another player's sheet shows the bare balance. Over a
              cap reads in accent — the Overburdened tag says the rest. */}
          <Row label="Resources">
            {carry ? (
              <span className="mono" style={carry.resources > carry.resourcesCap ? { color: "var(--accent-text)" } : undefined}>
                {carry.resources} / {carry.resourcesCap} ⬢
              </span>
            ) : (
              <>{character.resources} ⬢</>
            )}
          </Row>

          {carry && (
            <Row label="Carrying">
              {/* The cap carries a title= breakdown so a player can see what is
                  holding it up — the base, then one line per active
                  multiplier. Native tooltip on purpose: it needs no state, no
                  portal, and it works on the desk and the phone alike. */}
              <span
                className="mono"
                title={carryCapTitle(carry)}
                style={carry.weightUsed > carry.weightCap ? { color: "var(--accent-text)" } : undefined}
              >
                {carry.weightUsed} / {carry.weightCap} lb
              </span>
            </Row>
          )}

          <Row label="Gambit">
            {total ? (
              <span style={{ color: "var(--accent-text)" }}>{total} to the die</span>
            ) : (
              <span className="text-muted">No modifier</span>
            )}
          </Row>

          <Row label="Tag Points">
            <TagPointsValue points={character.tagPoints} />
          </Row>

          {hasWorkInProgress && (
            <Row label="In progress">
              <div className="flex flex-wrap gap-2">
                {craftProjects.map((p) => (
                  <span key={`project-${p.id}`} className="chip">
                    {p.quantity > 1 ? `${p.quantity}× ` : ""}
                    {p.tagName} —{" "}
                    <span className="mono">
                      {p.turnsDone}/{p.turnsNeeded}
                    </span>{" "}
                    turns
                  </span>
                ))}
                {sitesInProgress.map((s) => (
                  <span key={`site-${s.id}`} className="chip">
                    {s.typeName} —{" "}
                    <span className="mono">
                      {s.turnsDone}/{s.turnsNeeded}
                    </span>{" "}
                    turns
                  </span>
                ))}
              </div>
            </Row>
          )}

          <Row label="This turn" stacked>
            <ThisTurn currentAction={currentAction} openTurn={openTurn} pendingOffers={pendingOffers} />
          </Row>
        </dl>

        {isSelf && <ActionGrid />}
        {/* Only if you are carrying one. Derived here off the same held-tags
            array the catatonic row above reads, so no slug matching reaches
            the browser — and the server action re-checks it anyway. */}
        {isSelf && hasTrumpet && <SoundTrumpetButton />}
      </div>
    </section>

    {/* Its own panel rather than a row in the <dl> above: what stands on the
        ground is a fact about the place, not about the person, and it is a
        list rather than a value. Renders nothing when the ground is bare. */}
    <StandingHerePanel sites={sitesHere} />
    </>
  );
}
