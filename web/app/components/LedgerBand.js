"use client";

import { useState } from "react";
import { gambitModifierTotal } from "@lifeweb/db/lib/gambitModifier";
import StatusStrip from "@/app/(app)/play/StatusStrip";
import ActionGrid from "./ActionGrid";
import AvatarZoom from "./AvatarZoom";
import SheetTurn from "./SheetTurn";
import SoundTrumpetButton from "./SoundTrumpetButton";
import TagDetails from "./TagDetails";
import TurnForecast from "./TurnForecast";

// What holds a carry cap up, in words, under the carry tile. Assets are absent
// on purpose: they raise the cap without ever weighing on it (CARRY.md §1).
// It lived in a statusBits.js of its own while the old sheet's StatusPanel
// wanted the same string; that sheet is gone and this is the only caller left.
function carryCapTitle(carry) {
  const lines = [`Base ${carry.baseWeightCap} lb`];
  // Signed, because a body can now push the cap down as well as up: a Cart
  // reads "+4", Frail reads "−0.1" (CARRY.md §1).
  for (const m of carry.breakdown ?? []) {
    lines.push(`${m.name} ${m.bonus > 0 ? "+" : "−"}${Math.abs(m.bonus)}`);
  }
  lines.push(`= ${carry.weightCap} lb, and ${carry.weightHardCap} lb is the most you could ever hold.`);
  return lines.join("\n");
}

// One number and its label. The label is the word, the value carries the
// glyph — the house rule for ⬢ (CLAUDE.md), and the reason no tile below
// writes "Resources" next to a hexagon.
//
// A tile with a detail to give is a button: the detail (why the free moves
// are 0, what holds the carry cap up) reads inline under the tiles when
// clicked. It used to be a native title=, and this sheet has no tooltips.
function Tile({ label, value, over = false, hasDetail = false, open = false, onToggle = null, children = null }) {
  const body = (
    <>
      <span className="field-label">{label}</span>
      <span className="ledger-tile-value" data-over={over ? "true" : "false"}>
        {value}
      </span>
      {children}
    </>
  );
  if (!hasDetail) return <div className="ledger-tile">{body}</div>;
  return (
    <button type="button" className="ledger-tile ledger-tile-button" aria-expanded={open} onClick={onToggle}>
      {body}
    </button>
  );
}

// The band across the top of the sheet — it scrolls away with the rest of the
// page: who this is and where they stand, the four numbers a player checks
// before doing anything, then the pieces of the Chat's YOU column that belong
// on a sheet too — the turn card with its Move, the status strip — and under
// them what the turn will change and every verb in one strip.
//
// The numbers are read-only on purpose. The strip is where things happen.
export default function LedgerBand({
  character,
  avatarSrc,
  carry = null,
  zoneMoves = null,
  zoneMovesReason = null,
  travellingTo = null,
  openTurn = null,
  moveState = null,
  pendingOffers = [],
  craftProjects = [],
  sitesHere = [],
  hasTrumpet = false,
  isSelf = true,
}) {
  const gambit = gambitModifierTotal(character.tags, { hungerStreak: character.hungerStreak });
  const carrying = carry ? `${carry.weightUsed} / ${carry.weightCap}` : null;
  const loadPct = carry
    ? Math.min(100, Math.round((carry.weightUsed / Math.max(carry.weightCap, 1)) * 100))
    : 0;
  // The status chip a player clicked open, read inline under the strip — the
  // sheet has no tooltips, so a chip's wording has to be reachable by a tap.
  const [picked, setPicked] = useState(null);
  // Which tile's detail is open: "moves" or "carry".
  const [tileOpen, setTileOpen] = useState(null);
  const carryDetail = carry ? carryCapTitle(carry) : null;
  const pickedRow = picked ? character.tags.find((ct) => (ct.tag.id ?? ct.tagId) === picked) ?? null : null;

  return (
    <section className="sheet-band panel">
      <div className="ledger-band">
        <div className="flex items-start gap-3 min-w-0">
          {avatarSrc ? (
            // The one face on the sheet that is actually yours, so it is the
            // one most worth opening: 64px here, 256 stored. `avatarSrc` is
            // already whatever presentedIdentity resolved for the person
            // looking, so the zoom shows that and never rebuilds a URL.
            <AvatarZoom src={avatarSrc} name={character.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarSrc}
                alt={character.name}
                className="h-16 w-16 object-cover"
                style={{ borderRadius: "var(--radius)", border: "1px solid var(--border)" }}
              />
            </AvatarZoom>
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
              {travellingTo ? <span> · walking to {travellingTo}</span> : null}
            </p>
            <div className="mt-2">
              <StatusStrip
                resources={carry ? carry.resources : character.resources}
                carry={carry}
                tags={character.tags}
                onPick={(ct) => setPicked((was) => (was === (ct.tag.id ?? ct.tagId) ? null : ct.tag.id ?? ct.tagId))}
                pickedId={picked}
              />
              {pickedRow && (
                <div className="sheet-picked">
                  <TagDetails
                    tag={pickedRow.tag}
                    quantity={pickedRow.quantity}
                    expiresTurn={pickedRow.expiresTurn}
                    currentTurn={openTurn?.number ?? null}
                    inTooltip={false}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="ledger-tiles">
          <Tile
            label="Free moves"
            value={zoneMoves != null ? zoneMoves : "—"}
            over={zoneMoves === 0}
            hasDetail={Boolean(zoneMovesReason)}
            open={tileOpen === "moves"}
            onToggle={() => setTileOpen((was) => (was === "moves" ? null : "moves"))}
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
            hasDetail={Boolean(carryDetail)}
            open={tileOpen === "carry"}
            onToggle={() => setTileOpen((was) => (was === "carry" ? null : "carry"))}
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
          {tileOpen && (
            <p className="sheet-tile-detail">{tileOpen === "moves" ? zoneMovesReason : carryDetail}</p>
          )}
        </div>
      </div>

      <div className="sheet-band-row">
        {isSelf && (
          <div className="ledger-turn">
            <span className="field-label">This turn</span>
            <SheetTurn moveState={moveState} pendingOffers={pendingOffers} />
          </div>
        )}
        <TurnForecast
          tags={character.tags}
          openTurnNumber={openTurn?.number ?? null}
          craftProjects={craftProjects}
          sitesHere={sitesHere}
          travellingTo={travellingTo}
          resources={character.resources}
        />
      </div>

      {isSelf && <ActionGrid variant="strip">{hasTrumpet && <SoundTrumpetButton />}</ActionGrid>}
    </section>
  );
}
