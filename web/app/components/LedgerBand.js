"use client";

import { gambitModifierTotal } from "@lifeweb/db/lib/gambitModifier";
import RichText from "./RichText";
import { ThisTurn, carryCapTitle } from "./statusBits";

// One number and its label. The label is the word, the value carries the
// glyph — the house rule for ⬢ (CLAUDE.md), and the reason no tile below
// writes "Resources" next to a hexagon.
function Tile({ label, value, over = false, title = null, children = null }) {
  return (
    <div className="ledger-tile" title={title ?? undefined}>
      <span className="field-label">{label}</span>
      <span className="ledger-tile-value" data-over={over ? "true" : "false"}>
        {value}
      </span>
      {children}
    </div>
  );
}

// The banner across the top of /ledger: who this is, where they stand, and
// the four numbers a player checks before doing anything — then the Move they
// filed this turn, in the same words /character uses for it (statusBits.js).
//
// The numbers are read-only here on purpose. Everything that CHANGES one of
// them is a button in the working column below, so the banner stays an
// instrument panel rather than a second place to act.
export default function LedgerBand({
  character,
  avatarSrc,
  carry = null,
  zoneMoves = null,
  zoneMovesReason = null,
  travellingTo = null,
  currentAction = null,
  openTurn = null,
  pendingOffers = [],
}) {
  const gambit = gambitModifierTotal(character.tags, { hungerStreak: character.hungerStreak });
  const carrying = carry ? `${carry.weightUsed} / ${carry.weightCap}` : null;
  const loadPct = carry
    ? Math.min(100, Math.round((carry.weightUsed / Math.max(carry.weightCap, 1)) * 100))
    : 0;

  return (
    <section className="panel p-4 flex flex-col gap-4">
      <div className="ledger-band">
        <div className="flex items-start gap-3 min-w-0">
          {avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarSrc}
              alt={character.name}
              className="h-16 w-16 object-cover"
              style={{ borderRadius: "var(--radius)", border: "1px solid var(--border)" }}
            />
          ) : (
            <div
              aria-hidden="true"
              className="h-16 w-16"
              style={{
                background: "var(--field-bg)",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
              }}
            />
          )}
          {/* The name, the role and the faction used to be repeated here. They
              are the page's header now (ledger/layout.js), and saying them
              twice, 40px apart, only made the band look like a second title.
              Where you STAND is not up there, so it stays. */}
          <div className="min-w-0">
            <p className="m-0 text-sm text-muted">
              {character.zone?.name ?? "Unassigned"} · {character.location?.name ?? "Nowhere"}
              {travellingTo ? (
                <span title="You arrive when the turn turns. ‡"> · walking to {travellingTo}</span>
              ) : null}
            </p>
          </div>
        </div>

        <div className="ledger-tiles">
          <Tile
            label="Free moves"
            value={zoneMoves != null ? zoneMoves : "—"}
            over={zoneMoves === 0}
            title={zoneMovesReason ?? undefined}
          />
          <Tile
            label="Resources"
            value={carry ? `${carry.resources} / ${carry.resourcesCap} ⬢` : `${character.resources} ⬢`}
            over={Boolean(carry && carry.resources > carry.resourcesCap)}
          />
          <Tile
            label="Carrying"
            value={carrying ? `${carrying} lb` : "—"}
            over={Boolean(carry && carry.weightUsed > carry.weightCap)}
            title={carry ? carryCapTitle(carry) : undefined}
          >
            {carry && (
              <div
                className="depot-meter"
                role="img"
                aria-label={`${carry.weightUsed} of ${carry.weightCap} pounds carried`}
              >
                <span className="depot-meter-fill" style={{ width: `${loadPct}%` }} />
              </div>
            )}
          </Tile>
          {/* The modifier the bot actually rolls the Gambit die against, not a
              second opinion: same module, same arguments as /character's row. */}
          <Tile
            label="Gambit die"
            value={gambit ? `${gambit > 0 ? "+" : ""}${gambit}` : "±0"}
            over={Boolean(gambit)}
          />
        </div>
      </div>

      {/* What everyone else sees when they look at you. Read-only here — the
          textarea that writes it is in the Bio panel below, and two editors
          for one field is how a draft gets lost. */}
      {character.appearance && (
        <div className="ledger-turn">
          <span className="field-label">Appearance</span>
          <p className="m-0 text-sm">
            <RichText text={character.appearance} />
          </p>
        </div>
      )}

      <div className="ledger-turn">
        <span className="field-label">This turn</span>
        <ThisTurn currentAction={currentAction} openTurn={openTurn} pendingOffers={pendingOffers} />
      </div>
    </section>
  );
}
