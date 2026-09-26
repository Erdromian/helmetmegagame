// What a hop costs, in the fewest words that fit under a node.
//
// Lives here rather than in TravelNodes.js because there are two surfaces
// offering the same crossing now — the Travel panel's "ways out" grid and
// /map — and a second copy of this would drift the moment somebody tuned one.
// Pure, no Prisma, no JSX: both callers are clients, and the numbers it reads
// are already computed server-side by loadTravel/loadMap.
//
// A local hop is free full stop and never touches the header's count. A zone
// crossing you can still afford SPENDS travel, which used to read as the
// identical word "free" and told a player nothing about the difference. "1
// travel" or "½ travel" is what it actually costs (`option.cost`, stamped by
// db/lib/locationGraph.js from db/lib/crossingCost.js: ½ between the town
// zones, 1 anywhere else) — "travel" as a mass noun, whatever the number,
// and every number printed through formatTravel so a half reads "½".
//
// `moved` is whether the Move is already spent this turn. Past that point a
// crossing you cannot afford is paid on the push on's die (MAP.md §3) —
// "exertion" — or not at all until next turn, when the server would refuse the
// push on too (`option.canExert`).
import { formatTravel } from "@lifeweb/db/lib/crossingCost";

export { formatTravel };

export function affordsCrossing(option, freeLeft) {
  return (freeLeft ?? 0) >= (option.cost ?? 1);
}

export function travelFoot(option, freeLeft, mounted, moved = false) {
  if (!option.passable) {
    const reason = option.reason ?? "";
    if (/locked/i.test(reason)) return "locked";
    if (/shut/i.test(reason)) return "shut";
    return reason || "no way";
  }
  const cost = !option.crossesZone
    ? "free"
    : affordsCrossing(option, freeLeft)
      ? `${formatTravel(option.cost ?? 1)} travel`
      : !moved
        ? "the turn"
        : option.canExert
          ? "exertion"
          : "next turn";
  // Only worth saying when there's something to lose — dismounts wins over
  // indoors when a way is both, since either one ends the same way and saying
  // it twice would be noise.
  if (option.dismounts) return `${cost} · on foot`;
  if (mounted && option.indoors) return `${cost} · indoors`;
  return cost;
}

// The line over the buttons once a destination is picked, on both surfaces.
// `nextTurn` is the caller's "this crossing cannot be afforded" (a
// destination's OWN count against its own cost); `moved` whether the Move is
// already spent. Once it is, Go is gone and the push on is the only way
// across — or none this turn, and `option.exertWhy` is the server's reason.
export function crossingLine(option, nextTurn, moved) {
  if (!nextTurn) return `To ${option.name}.`;
  if (!moved) return `To ${option.name}. This one spends your Move.`;
  if (option.canExert) return `To ${option.name}. Your Move is spent, so this one costs exertion.`;
  return `To ${option.name}. Your Move is spent.${option.exertWhy ? ` ${option.exertWhy}` : ""}`;
}

// The sentence behind the trait chip on a way your own tag opens. The chip
// itself is just the tag's name — there is no room on a node for more — so this
// is what the hover and the screen reader get. Here rather than in either
// component for the same reason travelFoot is: /chat and /map both say it, and
// two copies would drift.
export function openedByLabel(tagName) {
  return `Opened by your ${tagName}.`;
}

// The chip on a way that is a tight squeeze (MAP.md §2a), and the sentence
// behind it. Drawn for EVERYBODY, not only the Giant it refuses — the point of
// marking it is that a party knows where its Giant friend cannot follow before
// they set off. The chip is the two words; the hover and the screen reader get
// the sentence. Same home as openedByLabel, for the same reason: /chat and
// /map both draw it, and two copies would drift. `onWalk` is the several-hop
// version, where the squeeze is somewhere along the road rather than the road.
export const TIGHT_SQUEEZE_LABEL = "Tight squeeze";
export function tightSqueezeNote(onWalk = false) {
  return onWalk
    ? "A tight squeeze on the way. No Giant fits through it."
    : "A tight squeeze. No Giant fits through here.";
}

// Second-look warning before Go, null otherwise — CAVING.md §2a's Customs/Depot exemption is already in `caveLevel`.
function crossingWarning(option) {
  if (!option.caveLevel) return null;
  return "You will roll Caving Die every time you move through here.";
}

// The question asked before a zone crossing, on both surfaces.
//
// A crossing is the one move here that is expensive and cannot be taken back:
// it spends a travel or the whole Move, it drags whoever is with you along, and
// it lands at once. A hop inside a zone is none of those things and is never
// asked about. So this exists, and travelFoot's local "free" case has no
// counterpart below.
//
// Built here rather than in either component for the reason travelFoot is: two
// surfaces, one sentence. `freeLeft` is the DESTINATION's own count, weighed
// against the destination's own `cost`.
//
// `exert` is the other question, asked from the other button: pushing on for
// one more crossing on a die instead of the Move (MAP.md §3). `option.exertNote`
// is the server's sentence about which way the die leans, when it does
// (db/lib/locationTravel.js#exertEdgeSentence), so the two faces say it the
// same way.
export function crossingConfirm(option, freeLeft, partySize = 0, { exert = false } = {}) {
  // Said out loud because it is the half of an accidental crossing that costs
  // somebody else their afternoon too.
  const party =
    partySize > 0
      ? partySize === 1
        ? " One person comes with you."
        : ` ${partySize} people come with you.`
      : "";
  // The tunnel, and it is asked EVERY time — no cost branch, no free-move
  // branch, no exert branch, which is why it sits above all of them. The train
  // is not a price anybody can be quoted (db/lib/railroad.js), so the only
  // honest sentence is the same one every time. It deliberately costs the
  // player the cost line and the party count: "regardless of circumstance" is
  // the whole point of the warning.
  if (option.railroad) {
    return {
      title: "Go into the tunnel?",
      message: `This is dangerous.${party}`,
      confirmLabel: "Go",
      cancelLabel: "Stay",
    };
  }
  if (exert) {
    const note = option.exertNote ? ` ${option.exertNote}` : "";
    return {
      title: `Push on to ${option.zoneName}?`,
      message: `${option.name} is in ${option.zoneName} and you don't have the travel left for it. You can choose to push yourself, risking exhaustion and possible injury.${note}${party}`,
      confirmLabel: "Push on",
      cancelLabel: "Stay",
    };
  }
  const cost = option.cost ?? 1;
  const left = freeLeft ?? 0;
  const price = affordsCrossing(option, freeLeft)
    ? `This spends ${formatTravel(cost)} of your ${formatTravel(left)} travel.`
    : left > 0
      ? `This costs ${formatTravel(cost)} travel and you only have ${formatTravel(left)} left, so it spends your Move for the turn.`
      : "You have no travel left, so this spends your Move for the turn.";
  return {
    title: `Cross into ${option.zoneName}?`,
    message: `${option.name} is in ${option.zoneName}. ${price}${party}`,
    confirmLabel: "Go",
    cancelLabel: "Stay",
  };
}

// "A", "A and B", "A, B and C" — for naming the stops on a walk.
function listOf(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// What a WALK costs, in the words both surfaces print (MAP.md §3c). A walk is
// inside your own zone and spends nothing at all — no travel, no Move — so the
// only things worth saying are how far it is and whether the road is too narrow
// for what you are riding. Here rather than in either component for the reason
// travelFoot is here: /chat and /map both say it, and two copies would drift.
export function walkFoot(route, mounted) {
  const far = route.hops === 1 ? "1 away" : `${route.hops} away`;
  // Same precedence travelFoot uses — a dismount is the one consequence worth
  // the space, and saying "indoors" beside it would be the same news twice.
  if (route.dismounts) return `${far} · on foot`;
  if (mounted && route.indoors) return `${far} · indoors`;
  return far;
}

// The line over Go once a walk is picked, and it NAMES THE STOPS.
//
// That is not decoration. The map moves on a double-click again (MAP.md §6c),
// and the thing that makes a gesture safe — beyond it never crossing a zone —
// is that the places you are about to walk through are on the screen before you
// make it. If this sentence ever gets cut for space, the gesture should be cut
// with it.
export function walkLine(route) {
  const through = route.through ?? [];
  if (through.length === 0) return `To ${route.name}.`;
  return `To ${route.name}, through ${listOf(through)}.`;
}

// The hint under the strip, on a mouse only. A walk is the only thing the
// gesture may do, so this is only ever drawn beside one.
export const WALK_HINT = "Double-click the place, or press Enter.";
