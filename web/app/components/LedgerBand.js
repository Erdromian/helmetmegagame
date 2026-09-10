"use client";

import { useRef, useState } from "react";
import { armorWord, combineArmor } from "@/lib/armorValue";
import { fightingSkill, TREES } from "@/lib/fightingSkill";
import { formatGambitModifiers, gambitModifiers } from "@lifeweb/db/lib/gambitModifier";
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
// A tile with something to say SWAPS ITS OWN FACE for it: hover, focus or
// click and the value is replaced by the detail, inside the same box, at the
// same height. Nothing outside the tile moves.
//
// That shape is the point. The detail used to be appended under the whole row,
// which pushed the rest of the sheet down every time somebody read it — a
// readout that moves the thing you were reading. Floating it instead would
// have been a tooltip, and this sheet has none (SHEET.md §3). Swapping in
// place is the third answer: it costs no layout and it stays on the page.
//
// Click matters as much as hover and is not a fallback: a phone has no hover
// at all, and a tap is the same gesture with the same result. Focus is in
// there for the same reason in the other direction — a keyboard has no
// pointer, and a detail only a mouse can reach is a detail half the people
// using this cannot.
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
  detail = null,
  open = false,
  onOpen = null,
  children = null,
  wide = false,
}) {
  // Whether a MOUSE is currently over this tile. A touch tap fires a
  // synthesised mouseenter before its click, so without this the enter opened
  // the tile and the click immediately toggled it shut again — a tap that
  // looked like it did nothing. Declared before the early return below,
  // because a hook may not be called conditionally.
  const hovering = useRef(false);
  const className = `ledger-tile${wide ? " ledger-tile-wide" : ""}`;
  if (!detail) {
    return (
      <div className={className}>
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
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`${className} ledger-tile-button`}
      aria-expanded={open}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        hovering.current = true;
        onOpen(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        hovering.current = false;
        onOpen(false);
      }}
      // Under a mouse the tile is already open, so a click would only close it
      // under the cursor. Touch and keyboard both land here with no pointer
      // over the tile, and there the click IS the way in and back out.
      onClick={() => {
        if (hovering.current) return;
        onOpen(!open);
      }}
      // :focus-visible rather than focus, so a tap (which also focuses) does
      // not fight the click above. A keyboard is the only thing that reaches
      // this, and it is the only way a keyboard reaches the detail at all.
      onFocus={(e) => {
        if (e.target.matches(":focus-visible")) onOpen(true);
      }}
      onBlur={() => onOpen(false)}
    >
      <span className="field-label">{label}</span>
      {/* Both faces live in one relative box and the detail is ABSOLUTE inside
          it, so the tile is sized by its resting face alone and opening it
          cannot change its height — which is the whole reason for this shape.
          Sizing it by the taller of the two instead would have made every tile
          permanently as tall as its longest explanation.

          `visibility` rather than the `hidden` attribute: the stylesheet's
          reset makes [hidden] display:none !important, and a display:none face
          cannot be the thing holding the box open. visibility also does the
          right thing for a screen reader, which display:none would too. */}
      <span className="ledger-tile-faces">
        <span className="ledger-tile-face" data-open={open ? "true" : "false"}>
          <span
            className="ledger-tile-value"
            data-over={over ? "true" : "false"}
            data-tone={tone ?? undefined}
            data-word={word ? "true" : undefined}
          >
            {value}
          </span>
          {children}
        </span>
        <span className="ledger-tile-detail" data-open={open ? "true" : "false"}>
          {detail}
        </span>
      </span>
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

// "Melee (Expert)" under a run already headed MELEE is the word twice. The
// catalog names the ladder and its specialisms that way because a tag has to
// stand alone in a list of five hundred; here it does not, and the prefix was
// costing a line of a box that has few to spare.
function shortName(label, tree) {
  const prefix = tree === "melee" ? "Melee (" : "Ranged (";
  return label.startsWith(prefix) && label.endsWith(")") ? label.slice(prefix.length, -1) : label;
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
  for (const tree of TREES) {
    for (const entry of combat[tree].situational) {
      if (seen.has(entry.label)) continue;
      seen.add(entry.label);
      situational.push(entry);
    }
  }

  return (
    <>
      {TREES.map((tree) => (
        <span key={tree} className="combat-line">
          <span className="field-label">{tree === "melee" ? "Melee" : "Ranged"}</span>{" "}
          {combat[tree].contributors
            .map((c) => {
              const name = shortName(c.label, tree);
              if (c.base) return name;
              return `${name} ${c.cancelledBy ? `nil, ${c.cancelledBy}` : tierLabel(c.tiers)}`;
            })
            .join(" · ")}
          {combat[tree].cap && ` · held at ${combat[tree].cap}`}
          {combat[tree].floor && ` · ${combat[tree].floor}`}
        </span>
      ))}
      {situational.length > 0 && (
        <span className="combat-line combat-line-span">
          <span className="field-label">If it fits</span>{" "}
          {situational
            .map((s) => `${shortName(shortName(s.label, "melee"), "ranged")}${s.tiers ? ` ${tierLabel(s.tiers)}` : ""}, ${s.when}`)
            .join(" · ")}
        </span>
      )}
    </>
  );
}

// Combat's resting face: the two fighting bands, the armour under them, and
// one quiet line naming what a GM might apply. One tile rather than two,
// because a player deciding whether to walk into something is asking one
// question — how does this go for me? — and the answer is how hard you hit and
// what happens when you are hit.
function CombatFace({ combat, armor }) {
  // Names only, and only once each: a tag on both halves of the tree would
  // otherwise be printed twice on a line whose whole job is being small.
  const names = [...new Set(TREES.flatMap((t) => combat[t].situational.map((s) => s.label)))];
  return (
    <>
      <span className="combat-bands">
        {TREES.map((tree) => (
          <span key={tree} className="combat-band" data-band={combat[tree].band.key}>
            {combat[tree].band.label}
          </span>
        ))}
      </span>
      {/* Armour rides along as its own small line and is never summed into the
          bands above it — a separate system with separate words
          (db/lib/armorValue.js). The only reason it is here is that a player
          should not have to scroll to the rig to read it. */}
      <span className="combat-armor">
        <span aria-hidden="true">⛊</span> {armor}
      </span>
      {/* A footnote, not a row of controls. These are not clickable and never
          were, so the bordered chips they used to be were lying about what
          they are. What each one MEANS is in the swapped face; this line only
          says that there is something to ask about. */}
      {names.length > 0 && <span className="combat-situational">{names.join(" · ")}</span>}
    </>
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
  // Both of these are already computed by db/lib — carryStatus returns
  // `breakdown` and gambitModifiers returns its named list — so neither tile
  // is deriving a second opinion about its own number.
  const carryDetail = carry?.breakdown?.length
    ? carry.breakdown
        .map((b) => `${b.name} ${b.bonus > 0 ? "+" : "−"}${Math.abs(Math.round(b.bonus * 100))}%`)
        .join(" · ")
    : "Nothing you hold changes what you can carry.";
  const gambitParts = gambitModifiers(character.tags, {
    hungerStreak: character.hungerStreak,
    mood: character.mood,
  });
  // Summed from the parts rather than asked for separately: two calls to the
  // same module with the same arguments is two chances for the number and its
  // explanation to disagree.
  const gambit = gambitParts.reduce((sum, m) => sum + m.value, 0);
  const gambitDetail = gambitParts.length
    ? formatGambitModifiers(gambitParts)
    : "Nothing is weighing on your roll.";
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

        {/* Two ranks, deliberately, rather than one row left to wrap where it
            likes. The top is what you HAVE and the bottom is what you ARE —
            and the split is also what stops a seven-slot row (Combat spans
            two of them) from folding one orphan tile onto a line of its own at
            every width that is not quite wide enough for all seven. */}
        <div className="ledger-tiles">
          <div className="ledger-rank">
            {/* One open slot across both ranks, so two tiles are never showing
                their detail at once — a row where three boxes had all swapped
                their faces would read as a different row rather than as one
                tile answering a question. */}
            <Tile
              label="Free moves"
              value={zoneMoves != null ? zoneMoves : "—"}
              over={zoneMoves === 0}
              detail={zoneMovesReason || null}
              open={tileOpen === "moves"}
              onOpen={(want) => setTileOpen(want ? "moves" : null)}
            />
            <Tile
              label="Resources"
              value={carry ? `${carry.resources} / ${carry.resourcesCap} ⬢` : `${character.resources} ⬢`}
              over={Boolean(carry && carry.resources > carry.resourcesCap)}
            />
            {/* What holds the cap up, back on the sheet. carryBreakdown has
                said "for the hover breakdown on /character" in db/lib/carry.js
                the whole time — it came off only because ONE pressable tile in
                a row of read-only ones read as a bug, and that reason is gone
                now they all press. */}
            <Tile
              label="Carrying"
              value={carrying ? `${carrying} lb` : "—"}
              over={Boolean(carry && carry.weightUsed > carry.weightCap)}
              detail={carryDetail}
              open={tileOpen === "carrying"}
              onOpen={(want) => setTileOpen(want ? "carrying" : null)}
            >
              {carry && (
                <span
                  className="depot-meter"
                  role="img"
                  aria-label={`${carry.weightUsed} of ${carry.weightCap} pounds carried`}
                >
                  <span className="depot-meter-fill" style={{ width: `${loadPct}%` }} />
                </span>
              )}
            </Tile>
          </div>

          <div className="ledger-rank">
            {combat && (
              <Tile
                label="Combat"
                wide
                value={<CombatFace combat={combat} armor={armorLine} />}
                detail={<CombatDetail combat={combat} />}
                open={tileOpen === "combat"}
                onOpen={(want) => setTileOpen(want ? "combat" : null)}
              />
            )}
            {/* The mood dial as ONE WORD (docs/systemdocs/MOOD.md) — never the
                number, which is the whole point of the dial. Fine is grey,
                Ecstatic is green and Panicking is red; the tone picks the
                token. */}
            <Tile
              label="Mood"
              value={moodBand?.label ?? "Fine"}
              tone={moodBand?.tone ?? "muted"}
              word
              detail={MOOD_DETAIL}
              open={tileOpen === "mood"}
              onOpen={(want) => setTileOpen(want ? "mood" : null)}
            />
            {/* The modifier the bot actually rolls the Gambit die against, not
                a second opinion: same module, same arguments as the bot's own
                call — and now it says WHICH modifiers, which is the question a
                player looking at a bare −3 was always about to ask. */}
            <Tile
              label="Gambit die"
              value={gambit ? `${gambit > 0 ? "+" : ""}${gambit}` : "±0"}
              over={Boolean(gambit)}
              detail={gambitDetail}
              open={tileOpen === "gambit"}
              onOpen={(want) => setTileOpen(want ? "gambit" : null)}
            />
          </div>
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
