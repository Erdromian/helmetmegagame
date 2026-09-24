"use client";

import { bandOf } from "@lifeweb/db/lib/mood";
import { obolsOf } from "@/lib/purse";
import StatusStrip from "../StatusStrip";

// PLATE over WELL (chat-vocabulary.md §1): what you ARE rather than what is
// true of the moment, so it gets the sprite frame instead of a block.
//
// It sits in the bottom-left corner, pinned in the places column's foot
// (Chat Overhaul.docx: "Move the YOU tab from the top of the rightside bar to
// the bottom left corner"). On a phone that column is the ≡ drawer, so the
// plate rides at the bottom of that drawer instead.
export default function YouPlate({ name, roleTitle, zone, sheet, carry, currentTurn = null }) {
  const moodBand = bandOf(sheet?.mood ?? 0);
  const obols = obolsOf(sheet);
  const resources = sheet?.resources ?? 0;
  const worn = (sheet?.tags ?? []).filter((ct) => ct.tag?.category === "Status" || ct.tag?.category === "Health");

  return (
    <section className="chat-you" aria-label="You">
      <h2 className="bar">You</h2>
      <div className="you-frame">
        <div className="you-well">
          <p className="you-name">{name}</p>
          <p className="you-role">
            {roleTitle ?? "No role"} · {zone?.name ?? "Nowhere"}
          </p>
          <dl className="m-0">
            <div className="kv">
              <dt>Mood</dt>
              <dd>{moodBand?.label ?? "Fine"}</dd>
            </div>
            <div className="kv">
              <dt>Resources</dt>
              <dd className="mono">{resources} ⬢</dd>
            </div>
            <div className="kv">
              <dt>Purse</dt>
              <dd className="mono">{obols} ¢</dd>
            </div>
            {carry && (
              <div className="kv">
                <dt>Carrying</dt>
                <dd className="mono">
                  {Math.round(carry.weightUsed)}/{carry.weightCap} lb
                </dd>
              </div>
            )}
          </dl>
          {/* The sheet's own load bar and chips, not a second copy of either.
              numbers={false} — Resources and Carrying are already said above. */}
          <StatusStrip
            resources={resources}
            carry={carry}
            tags={worn}
            currentTurn={currentTurn}
            meter
            numbers={false}
          />
        </div>
      </div>
    </section>
  );
}
