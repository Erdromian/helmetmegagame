"use client";

import { useState } from "react";
import { gambitModifierTotal } from "@lifeweb/db/lib/gambitModifier";
import { bandOf } from "@lifeweb/db/lib/mood";
import StatusStrip from "@/app/(app)/chat/StatusStrip";
import ActionGrid from "./ActionGrid";
import AvatarZoom from "./AvatarZoom";
import SheetTurn from "./SheetTurn";
import SoundTrumpetButton from "./SoundTrumpetButton";
import TagDetails from "./TagDetails";
import TurnForecast from "./TurnForecast";

// One number and its label. The label is the word, the value carries the
// glyph — the house rule for ⬢ (CLAUDE.md), and the reason no tile below
// writes "Resources" next to a hexagon.
//
// A tile with a detail to give is a button: the detail (why the free moves
// are 0, what moves a mood) reads inline under the tiles. It used to be a
// native title=, and this sheet has no tooltips — which is why the Mood box
// hovering OPENS that line rather than floating a bubble over it.
//
// `tone` colours the value by meaning rather than by colour, the rule
// StatusPill.js sets: the stylesheet owns which token a tone gets.
// `word` drops the mono face, because a word is not data.
function Tile({
  label,
  value,
  over = false,
  tone = null,
  word = false,
  hasDetail = false,
  open = false,
  onToggle = null,
  onHover = null,
  children = null,
}) {
  const body = (
    <>
      <span className="field-label">{label}</span>
      <span
        className="ledger-tile-value"
        data-over={over ? "true" : "false"}
        data-tone={tone ?? undefined}
        data-word={word ? "true" : undefined}
      >
        {value}
      </span>
      {children}
    </>
  );
  if (!hasDetail) return <div className="ledger-tile">{body}</div>;
  return (
    <button
      type="button"
      className="ledger-tile ledger-tile-button"
      aria-expanded={open}
      onClick={onToggle}
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
    >
      {body}
    </button>
  );
}

// What the Mood box says when you open it. Bascinet's words, verbatim.
const MOOD_DETAIL =
  "Certain things, like spending time in the wilderness without the Rough Camper trait or receiving wounds harm " +
  "your mood. Other things, like listening to music, fulfilling desires, or eating meals boost your mood. Your " +
  "Mood impacts your Gambit rolls.";

// The band across the top of the sheet — it scrolls away with the rest of the
// page: who this is and where they stand, the five things a player checks
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
  openTurn = null,
  moveState = null,
  pendingOffers = [],
  craftProjects = [],
  sitesHere = [],
  hasTrumpet = false,
  isSelf = true,
}) {
  const gambit = gambitModifierTotal(character.tags, { hungerStreak: character.hungerStreak, mood: character.mood });
  const moodBand = bandOf(character.mood ?? 0);
  const carrying = carry ? `${carry.weightUsed} / ${carry.weightCap}` : null;
  const loadPct = carry
    ? Math.min(100, Math.round((carry.weightUsed / Math.max(carry.weightCap, 1)) * 100))
    : 0;
  // The status chip a player clicked open, read inline under the strip — the
  // sheet has no tooltips, so a chip's wording has to be reachable by a tap.
  const [picked, setPicked] = useState(null);
  // Free moves is the only tile with anything to say. Carrying used to open a
  // breakdown of what holds its cap up; that came off on purpose — the tile is
  // a number, and a number the whole band reads as read-only should not be the
  // one thing on the row that presses.
  // Which tile's detail is open, "moves" or "mood" — one slot, because there
  // is one paragraph under the row of tiles for both to write into.
  const [tileOpen, setTileOpen] = useState(null);
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
            </p>
            <div className="mt-2">
              {/* No ⬢ and no pounds here: the tiles a few inches to the right
                  already carry both, with the caps and the load meter the chips
                  could only half-say. What is left is what is actually worn. */}
              <StatusStrip
                numbers={false}
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
          {/* The mood dial as ONE WORD (docs/systemdocs/MOOD.md) — never the
              number, which is the whole point of the dial. Fine is grey,
              Ecstatic is green and Panicking is red; the tone picks the token. */}
          <Tile
            label="Mood"
            value={moodBand?.label ?? "Fine"}
            tone={moodBand?.tone ?? "muted"}
            word
            hasDetail
            open={tileOpen === "mood"}
            onToggle={() => setTileOpen((was) => (was === "mood" ? null : "mood"))}
            onHover={(inside) => setTileOpen((was) => (inside ? "mood" : was === "mood" ? null : was))}
          />
          {/* The modifier the bot actually rolls the Gambit die against, not a
              second opinion: same module, same arguments as /character's row. */}
          <Tile
            label="Gambit die"
            value={gambit ? `${gambit > 0 ? "+" : ""}${gambit}` : "±0"}
            over={Boolean(gambit)}
          />
          {tileOpen && (
            <p className="sheet-tile-detail">{tileOpen === "moves" ? zoneMovesReason : MOOD_DETAIL}</p>
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
          resources={character.resources}
        />
      </div>

      {isSelf && <ActionGrid variant="strip">{hasTrumpet && <SoundTrumpetButton />}</ActionGrid>}
    </section>
  );
}
