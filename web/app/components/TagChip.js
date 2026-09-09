import ChipLabel from "./ChipLabel";
import HoverCard from "./HoverCard";
import TagDetails, { tagDurationFor } from "./TagDetails";

// A tag as a chip with its details on hover. The details themselves live in
// TagDetails.js, which the sheet's rows also render inline — so the chip and
// the row say exactly the same things about a tag.
//
// `onConsume` is set only for a consumable tag on your own sheet (see
// TagRail.js), which puts a Consume button beside the tag. The action and its
// pending/error state stay in the client parent so this component keeps
// rendering fine on the server everywhere else it's used — and so it never
// says a word about what the thing turns into.
export default function TagChip({
  tag,
  quantity = 1,
  onConsume = null,
  consumeBusy = false,
  consumeError = null,
  expiresTurn = null,
  currentTurn = null,
  // The Nuclear Device only: the turn it fires on, from GameState.nukeArmedTurn
  // (db/lib/nuke.js). Armed state is world state rather than a tag, so the
  // chip has to be told; null means not armed and the row simply isn't there.
  armedTurn = null,
}) {
  const duration = tagDurationFor({ tag, expiresTurn, currentTurn, armedTurn });

  const panel = (
    <TagDetails
      tag={tag}
      quantity={quantity}
      expiresTurn={expiresTurn}
      currentTurn={currentTurn}
      armedTurn={armedTurn}
      inTooltip
    >
      {typeof onConsume === "function" && (
        <button type="button" className="btn-quiet" onClick={onConsume} disabled={consumeBusy}>
          Consume
        </button>
      )}
      {consumeError && <p className="text-muted text-xs">{consumeError}</p>}
    </TagDetails>
  );

  return (
    <HoverCard panel={panel}>
      <ChipLabel tag={tag} quantity={quantity} duration={duration} />
    </HoverCard>
  );
}
