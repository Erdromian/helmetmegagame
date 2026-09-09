"use client";

// What is true of this body right now, in one wrapping row: what you are
// carrying, and every Status or Health tag you are wearing.
//
// The category test is the SHEET's own (web/lib/sheetCards.js groups on the
// same field), so a new affliction shows up here the day it is added to
// docs/tags.yaml without anybody listing it twice.
const SHOWN_CATEGORIES = new Set(["Status", "Health"]);

// The three that are not news but a problem. Their slugs are literals rather
// than an import, because db/lib/constants.js is a server module and this is
// the browser's copy of three strings.
const BAD = new Set(["overburdened", "dying", "catatonic-afk"]);

// `onPick` turns each tag chip into a button: the sheet's band passes it and
// opens the tag's details inline underneath (LedgerBand.js), so nothing here
// has to be hovered to be read. Chat passes nothing and keeps plain chips.
//
// `meter` draws the load bar under the chips. Chat opts in; the sheet does not,
// because its Carrying tile already draws the same meter off the same numbers
// (LedgerBand.js), and two of them on one screen is one too many. The bar says
// what the chip cannot: how close you are, rather than how much you have. A
// player who has to divide 63 by 71 to see Overburdened coming finds out by
// being told instead, which is too late to put anything down.
export default function StatusStrip({
  resources = 0,
  carry = null,
  tags = [],
  onPick = null,
  pickedId = null,
  meter = false,
}) {
  const worn = tags.filter((ct) => SHOWN_CATEGORIES.has(ct.tag?.category));
  // The sheet's own arithmetic, to the pixel: the same clamp at 100 and the
  // same floor of 1 under the cap, so a character with no cap at all cannot
  // divide by zero.
  const over = Boolean(carry && carry.weightUsed > carry.weightCap);
  const overResources = Boolean(carry && carry.resources > carry.resourcesCap);
  const loadPct = carry
    ? Math.min(100, Math.round((carry.weightUsed / Math.max(carry.weightCap, 1)) * 100))
    : 0;

  return (
    <>
      <div className="chat-chips">
        {/* Each chip reddens for its OWN cap. `carry.over` is the two of them
            ORed together, so a character over on Resources used to turn the
            POUNDS chip red — and now that a load bar sits under that chip, a
            red number over an unfilled bar would be a straight contradiction. */}
        <span className="chip chip-mono" data-tone={overResources ? "danger" : undefined}>
          {resources} ⬢
        </span>
        {carry && (
          <span className="chip chip-mono" data-tone={over ? "danger" : undefined}>
            {Math.round(carry.weightUsed)}/{carry.weightCap} lb
          </span>
        )}
        {worn.map((ct) => {
          const id = ct.tag.id ?? ct.tagId;
          const face = (
            <>
              {ct.tag.name}
              {(ct.quantity ?? 1) > 1 ? ` ×${ct.quantity}` : ""}
            </>
          );
          return onPick ? (
            <button
              key={id}
              type="button"
              className="chip"
              data-tone={BAD.has(ct.tag.slug) ? "danger" : undefined}
              data-active={pickedId === id ? "true" : undefined}
              aria-expanded={pickedId === id}
              onClick={() => onPick(ct)}
            >
              {face}
            </button>
          ) : (
            <span
              key={id}
              className="chip"
              data-tone={BAD.has(ct.tag.slug) ? "danger" : undefined}
              // The tag's own catalog text, not an explainer written for here.
              title={ct.tag.description ?? undefined}
            >
              {face}
            </span>
          );
        })}
      </div>
      {meter && carry && (
        /* The sheet's meter, reused whole (.depot-meter / .depot-meter-fill).
           role="img" with the numbers spelled out, because a bare bar tells a
           screen reader nothing the chip above has not already said better. */
        <div
          className="depot-meter chat-load"
          role="img"
          aria-label={`${Math.round(carry.weightUsed)} of ${carry.weightCap} pounds carried`}
        >
          <span
            className="depot-meter-fill"
            data-tone={over ? "danger" : undefined}
            style={{ width: `${loadPct}%` }}
          />
        </div>
      )}
    </>
  );
}
