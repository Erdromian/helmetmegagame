"use client";

import { useState } from "react";
import { armorWord, combineArmor } from "@/lib/armorValue";
import { fightingSkill } from "@/lib/fightingSkill";
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

// A tier shift as the catalog writes it: "+2", "−0.5". U+2212 minus, matching
// db/lib/gambitModifier.js#formatGambitModifiers and the bot's roll line.
function tierLabel(tiers) {
  return `${tiers > 0 ? "+" : "−"}${Math.abs(tiers)}`;
}

// What the Combat tile opens: every contributor behind the two bands, and then
// the things a GM has to decide. Written into the shared detail slot under the
// row of tiles rather than floating over anything — this sheet has no tooltips
// (SHEET.md §3), and the Mood box set the precedent that a tile with something
// to say says it on the page.
//
// The SCORE is never printed, only the names and their shifts. Working out
// that Seasoned beats Capable is the player's job, the same posture armour
// takes; a total here would turn a fight into arithmetic and hand somebody a
// way to measure themselves against a person they should not be able to read.
function CombatDetail({ combat }) {
  // One list, not two: a tag's condition is the same kind of fact whichever
  // half of the tree it lands on, and two columns of near-identical rows read
  // as a bug rather than as a distinction.
  const situational = [];
  const seen = new Set();
  for (const tree of ["melee", "ranged"]) {
    for (const entry of combat[tree].situational) {
      if (seen.has(entry.label)) continue;
      seen.add(entry.label);
      situational.push(entry);
    }
  }

  return (
    <div className="sheet-tile-detail">
      {["melee", "ranged"].map((tree) => (
        <p key={tree} className="m-0">
          <span className="field-label">{tree === "melee" ? "Melee" : "Ranged"}</span>{" "}
          {combat[tree].contributors
            .map((c) => (c.base ? c.label : `${c.label} ${c.cancelledBy ? `nil, ${c.cancelledBy}` : tierLabel(c.tiers)}`))
            .join(" · ")}
          {combat[tree].cap && ` · held at ${combat[tree].cap}`}
          {combat[tree].floor && ` · ${combat[tree].floor}`}
        </p>
      ))}
      {situational.length > 0 && (
        <p className="m-0">
          <span className="field-label">If the moment fits</span>{" "}
          {situational
            .map((s) => `${s.label} ${s.tiers ? `${tierLabel(s.tiers)}, ` : ""}${s.when}`)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

// Combat: the two fighting bands, the armour underneath, and the things no
// code can settle. One tile rather than two, because a player deciding whether
// to walk into something is asking one question — how does this go for me? —
// and the answer is how hard you hit and what happens when you are hit.
//
// It spans two columns: it carries three lines where every other tile carries
// one, and squeezing that into a tile's width would wrap every band word.
function CombatTile({ combat, armor, open, onToggle, onHover }) {
  const situationalCount = new Set(
    [...combat.melee.situational, ...combat.ranged.situational].map((s) => s.label),
  ).size;

  return (
    <button
      type="button"
      className="ledger-tile ledger-tile-button ledger-tile-combat"
      aria-expanded={open}
      onClick={onToggle}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <span className="field-label">Combat</span>
      <span className="combat-bands">
        {["melee", "ranged"].map((tree) => (
          <span key={tree} className="combat-band" data-band={combat[tree].band.key}>
            {combat[tree].band.label}
          </span>
        ))}
      </span>
      {/* Armour rides along as its own small line and is never summed into the
          bands above it — it is a separate system with separate words
          (db/lib/armorValue.js), and the only reason it is here is that a
          player should not have to scroll to the rig to read it. */}
      <span className="combat-armor">
        <span aria-hidden="true">⛊</span> {armor}
      </span>
      {situationalCount > 0 && (
        <span className="combat-situational">
          {[...new Set([...combat.melee.situational, ...combat.ranged.situational].map((s) => s.label))].map(
            (label) => (
              <span key={label} className="combat-chip">
                {label}
              </span>
            ),
          )}
        </span>
      )}
    </button>
  );
}

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
  // Derived on every render from the tags already in hand, never stored — the
  // posture combineArmor and gambitModifierTotal take, so it can't go stale.
  // Drawn only on your OWN sheet: a fighting band is the one number nobody
  // should be able to read off somebody they might have to fight, and every
  // fighting tag in the catalog is `visible: false` for the same reason.
  const combat = isSelf ? fightingSkill(character.tags) : null;
  const armorLine = `${armorWord(combineArmor(character.tags, "meleeArmor"))} · ${armorWord(
    combineArmor(character.tags, "ballisticArmor"),
  )}`;
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
          {combat && (
            <CombatTile
              combat={combat}
              armor={armorLine}
              open={tileOpen === "combat"}
              onToggle={() => setTileOpen((was) => (was === "combat" ? null : "combat"))}
              onHover={(inside) => setTileOpen((was) => (inside ? "combat" : was === "combat" ? null : was))}
            />
          )}
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
          {/* One slot under the row, shared by every tile that has something to
              say. Combat writes a block rather than a sentence, so this branches
              on the tile rather than always rendering a paragraph. */}
          {tileOpen === "combat" && combat && <CombatDetail combat={combat} />}
          {tileOpen && tileOpen !== "combat" && (
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
