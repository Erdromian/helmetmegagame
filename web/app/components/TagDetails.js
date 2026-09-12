import { formatCost, costColor, prerequisiteNames } from "@/lib/characterCreation";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { formatTagArmor } from "@/lib/formatTagArmor";
import { formatTagFighting } from "@/lib/formatTagFighting";
import { formatTagWeight } from "@/lib/formatTagWeight";
import { turnsLeft, tagDuration } from "@/lib/turnFormat";
import { chainTokens } from "@/lib/tagChains";
// The deep path, not the @lifeweb/db barrel: TagChip renders this on the
// server and PointBuy renders it in a "use client" bundle, and the barrel
// would drag @prisma/client into the second one. equipSlots.js requires
// nothing, so it costs the bundle nothing.
import { describeEquipFit } from "@lifeweb/db/lib/equipSlots";
import DesireUnlocks from "./DesireUnlocks";
import ChipText from "./ChipText";
import PaperSheet from "./PaperSheet";

// Everything a tag has to say about itself, as one block: name, description,
// the label/value rows, what it unlocks. TagChip.js renders it inside a
// HoverCard; the sheet's rows (TagRow.js) render it inline under the row when
// clicked, and the band's status chips do the same. One block, so the three
// can never disagree about what a tag is.
//
// No hooks and no "use client", so TagChip keeps rendering on the server.

// The countdown a held tag shows, or the catalog wording for a bare one, or
// the bomb's own clock. Exported because the chip's face and this block both
// read it and must agree.
export function tagDurationFor({ tag, expiresTurn = null, currentTurn = null, armedTurn = null }) {
  if (armedTurn != null) {
    return {
      label: `Armed. It fires as turn ${armedTurn} closes.`,
      badge: `armed · ${turnsLeft(armedTurn, currentTurn) ?? "?"}t`,
      armed: true,
    };
  }
  // The CharacterTag's expiresTurn, not the Tag's defaultDurationTurns — the
  // clock started when it was granted. Null for a bare catalog reference,
  // which is what makes tagDuration fall back to the catalog wording.
  return tagDuration(turnsLeft(expiresTurn, currentTurn), tag?.defaultDurationTurns);
}

// One label/value row. Labels are muted and values carry --text, so the block
// reads as answers rather than a flat run of grey <p>s.
// Tag.inspectVisibility as a sentence. NAMED is the one that needs saying out
// loud rather than reading as a plain "Yes": it is the reason a hood or a
// Disguise Kit is worth buying when you are Wanted (db/lib/medicalVision.js).
const SEEN_BY_OTHERS = {
  WORN: "Only while worn",
  NAMED: "Only under your own name",
  ALWAYS: "Yes",
};

// Tag.cures — a flat list of slugs, not the { oneOf } chain shape chainTokens
// takes: an item cures everything on the list that the target happens to hold,
// not a random pick between them (the medical pass, TAGS.md §5c).
function curesTokens(cures) {
  if (!Array.isArray(cures) || !cures.length) return null;
  return cures.map((slug) => `{tag:${slug}}`).join(" and ");
}

function Meta({ label, children }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export default function TagDetails({
  tag,
  quantity = 1,
  expiresTurn = null,
  currentTurn = null,
  armedTurn = null,
  // Whether {tag:…} tokens inside may become real, hoverable chips. True
  // inside a pinned HoverCard panel and inline on the sheet; TagChip passes it
  // through as before.
  inTooltip = true,
  // Slot for a control that acts on the holding — TagChip's Consume button and
  // its error line — rendered between the description and the rows.
  children = null,
  // The name row is the chip's own face on a row, so the row can drop it.
  showName = true,
  // "· smells wrong" (the medical pass, M4) — whether THIS held stack is
  // actually poisoned, already gated server-side to poison-sense / poison-
  // snooper holders before it reaches a client. Never the raw poisonedCount
  // or which poison: only the yes/no doctor's-eye read.
  poisonMarker = false,
}) {
  const stack = quantity > 1 ? quantity : null;
  const requirement = formatTagRequirement(tag);
  const armor = formatTagArmor(tag);
  const fighting = formatTagFighting(tag);
  const weight = formatTagWeight(tag, quantity);
  const duration = tagDurationFor({ tag, expiresTurn, currentTurn, armedTurn });
  const fit = describeEquipFit(tag);
  const becomes = chainTokens(tag.expiresInto);
  const treated = chainTokens(tag.removesInto);
  const cures = curesTokens(tag.cures);

  return (
    <>
      {showName && (
        <div className="flex items-start justify-between gap-2">
          <strong>
            {tag.name}
            {stack ? ` ×${stack}` : ""}
            {poisonMarker && <span className="text-muted"> · smells wrong</span>}
          </strong>
          {(tag.group?.name || tag.category) && (
            <span className="text-muted whitespace-nowrap text-xs">
              {[tag.group?.name, tag.category].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
      )}
      {tag.paper ? (
        <PaperSheet paper={tag.paper} />
      ) : (
        tag.description && <ChipText text={tag.description} as="p" inTooltip={inTooltip} />
      )}
      {children}
      <dl className="tag-meta">
        {duration && <Meta label={duration.armed ? "Armed" : "Expires"}>{duration.label}</Meta>}
        {becomes && (
          <Meta label="Becomes">
            <ChipText text={becomes} inTooltip={inTooltip} />
          </Meta>
        )}
        {treated && (
          <Meta label="Treated">
            <ChipText text={treated} inTooltip={inTooltip} />
          </Meta>
        )}
        {/* What this item cures when consumed or administered (the medical
            pass, TAGS.md §5c). */}
        {cures && (
          <Meta label="Cures">
            <ChipText text={cures} inTooltip={inTooltip} />
          </Meta>
        )}
        {/* Labelled, not bare: formatTagRequirement's leading "1t" is turns of
            WORK, which collided with the expiry countdown's own "1t" when both
            sat unlabelled in the same panel. Which work it is depends on the
            tag — on a wound the block is the cost to remove it, on a craftable
            it is the recipe to make one. */}
        {requirement && (
          <Meta label={tag.craftable ? "Recipe" : tag.healable ? "Cure" : "Requirement"}>
            {requirement}
          </Meta>
        )}
        {/* What this ONE tag does in a fight — never the holder's band, which
            is a different question and deliberately not readable off a chip
            (COMBAT.md). Above Armour because the two answer the same worry in
            order: how you hit, then what happens when you are hit. */}
        {fighting && <Meta label="In a fight">{fighting}</Meta>}
        {armor && <Meta label="Armour">{armor}</Meta>}
        {weight && <Meta label="Weight">{weight}</Meta>}
        {/* Appraisal's readout (docs/systemdocs/TAGS.md §4a): only present
            on a tag object at all when the viewer holds the skill — see
            web/lib/appraisal.js. Drawn even when the tag has no price, so an
            appraiser can tell the skill fired rather than wondering whether
            the row was left out. */}
        {"valueObols" in tag && (
          <Meta label="Worth">
            <span className="mono">{tag.valueObols != null ? `${tag.valueObols} ¢` : "—"}</span>
          </Meta>
        )}
        {/* Where it goes and what it costs to put there. This used to say
            only "Hands: Two", which named the one gear rule a buyer could
            already guess and none of the ones they couldn't — that a coif
            goes under a helm, that trinkets run out. */}
        {fit && <Meta label="Worn">{fit}</Meta>}
        {tag.inspectVisibility && tag.inspectVisibility !== "HIDDEN" && (
          <Meta label="Seen by others">{SEEN_BY_OTHERS[tag.inspectVisibility] ?? "Yes"}</Meta>
        )}
        {tag.concealsIdentity && (
          <Meta label="Conceals you">{tag.forcesConceal ? "Always, while worn" : "Optional, while worn"}</Meta>
        )}
        {prerequisiteNames(tag).length > 0 && (
          <Meta label="Requires">{prerequisiteNames(tag).join(", ")}</Meta>
        )}
        <Meta label="Cost">
          <span style={{ color: costColor(tag.pointCost) }}>
            {formatCost(tag.pointCost)} {Math.abs(tag.pointCost ?? 0) === 1 ? "pt" : "pts"}
          </span>
        </Meta>
      </dl>
      <DesireUnlocks tag={tag} />
    </>
  );
}
