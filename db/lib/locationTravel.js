// The database half of ANY player-driven location change — the #turns Travel button
// and /location (bot) both come through here; web app writers (creation, GM teleport, Bulk Move) are raw relocations and don't. Validates the hop, enforces the same-zone cooldown or files the Move a zone crossing costs, walks the mover's escort party along, and performs **no Discord side effects** — the caller runs locationMove.js#applyLocationMoveSideEffects over `moved`.
// EVERY crossing lands at once, paid or free — the Move is still spent, and you are there (MAP.md §3). Deliberately NOT on the @lifeweb/db barrel; require it by path.
const { recordArchiveEvent } = require("./archive");
const { sessionGate } = require("./betweenSessions");
const { travelLockReason } = require("./turnGate");
const { seatZoneIdFor } = require("./seatZone");
const { rollCavingOnArrival, cavingRestrictionsFor, cavingRefusalFor, cavingPartyRestrictions } = require("./cavingPass");
const { INCAPACITATING_SLUGS, blockerFor, ACT } = require("./incapacitation");
const { OVERBURDENED_SLUG, TIRED_SLUG, EXHAUSTED_SLUG, LUCKY_SLUG } = require("./constants");
const {
  isMounted,
  blocksOnFoot,
  equippedSlugs,
  fastTravelCapacity,
  fastTravelBonus,
  fastTravelRides,
  fastTravelMountTag,
  mountLabel,
  STOWABLE_SLUGS,
} = require("./mounts");
const { rideMount } = require("./mountRides");
const { rollWithEdge, edgeFor } = require("./advantage");
const { nextFatigueSlug } = require("./fatigue");
const { partyOf, escortAuthority, ESCORT_SELECT } = require("./escort");
const { heldReasonFor, fireWatches, NOT_A_FIGHT } = require("./intercept");
const { linkBetween, crossingCheck } = require("./locationGraph");
const { withRingTokens } = require("./roomAccess");
const { crossingCost, FAR_CROSSING_COST, formatTravel } = require("./crossingCost");
const { dismountForNarrowWay } = require("./indoors");
const { MOTION_SICKNESS_SLUG, VOMITING_SLUG } = require("./constants");
const { expiryForGrant } = require("./grantExpiry");
const { addToStack, grantTagSlugs } = require("./tagWrites");
const { sendDm } = require("./dm");
const { logAudit } = require("./auditLog");
const { GUARD_LINES, guardsOf } = require("./guard");
const { DM_KIND } = require("./dmKinds");
const { capitalizeFirst: cap } = require("./concealedIdentity");

// Too hurt or too dazed to make a whole zone's walk for free. A Peg Leg is absent on
// purpose (Bascinet's call: a wooden leg still walks); Pain Shock joins for the other reason: not injured enough to stop you, just too out of it to find your own way. An equipped mount cancels every one of these — the arelitz is doing the walking (or, for Pain Shock, the finding).
const LAMED_SLUGS = new Set(["crippled-leg", "missing-leg", "sprained-ankle", "pain-shock", "cripple"]);

const CHARACTER_SELECT = {
  id: true,
  name: true,
  status: true,
  discordUserId: true,
  locationId: true,
  zoneId: true,
  buriedAt: true,
  zoneMovesTurnId: true,
  zoneMovesUsed: true,
  zoneMovesBonusUsed: true,
  // The hold: one timestamp, read by heldReasonFor() (INTERCEPT.md), plus WHICH thing has hold of them — a select carrying one without the other tells an attacked player they were ambushed (ATTACK.md §3).
  heldUntil: true,
  heldReason: true,
  // `name` rides along for stowedMounts(), which puts it in a sentence, and
  // for the "plus 1 ride on your Arelitz" half of the travel readout.
  tags: { select: { equipped: true, acquiredAt: true, tag: { select: { slug: true, name: true } } } },
};

// How much TRAVEL this character gets for free this turn, before a crossing
// starts spending their Move (CARRY.md §2). Everyone gets GameConfig.freeZoneMovesPerTurn (default 1). Being Overburdened takes the lot — an overloaded character can still cross, they just pay their Move. A ruined leg takes it too, unless an arelitz is doing the walking.
// A crossing spends what db/lib/crossingCost.js says it costs: ½ between the town zones, 1 anywhere else. A crossing you cannot afford in full spends the Move instead, and whatever travel was left stays for a cheaper hop.
// AN EQUIPPED MOUNT'S RIDES ARE ON THE MOUNT (db/lib/mounts.js, ARELITZ.md §2a): a fresh arelitz carries you across 1 border a turn, a tacked arelitz or a motorcycle 2, whatever each crossing costs — one ride covers a whole crossing. Every ride charged to it takes the mount's tag one rung down its ladder inside the same transaction (mountRides.js#rideMount), so the bonus pool is simply "rides left on the rung", read fresh every time, and nothing subtracts a per-rider counter from it: the ride that was spent already changed the tag. That is what stops a ride being counted twice — once off the rider's sheet and once off the animal.
// The mount's ride is spent BEFORE the base pool. Character.zoneMovesBonusUsed still records what was charged to a mount, but only so the base pool can be told apart (baseSpent = zoneMovesUsed - zoneMovesBonusUsed); it is never read back as "bonus left".

// How much is LEFT right now, for surfaces that must say so before a player commits
// (Travel confirm, character sheet).
function freeMovesLeft(character, config, openTurn, partySize = 0) {
  return movesLeft(moveAllowance(character, config, partySize), character, openTurn);
}

// The two halves of that number, for a surface that says them apart ("2
// travel, plus 2 rides on your Motorcycle"): `baseLeft` is travel, `ridesLeft`
// is crossings on the mount, `mount` its display name (null on foot, and
// null when the mount is out but buying nothing — over its seats — so the
// caller's sentence doesn't promise rides the crossing won't get).
function freeMovesBreakdown(character, config, openTurn, partySize = 0) {
  const allowance = moveAllowance(character, config, partySize);
  const baseLeft = movesLeft({ base: allowance.base, bonus: 0 }, character, openTurn);
  const ridesLeft = allowance.bonus / FAR_CROSSING_COST;
  const mount = ridesLeft > 0 ? fastTravelMountTag(character?.tags ?? []) : null;
  return {
    baseLeft,
    ridesLeft,
    rides: mount ? fastTravelRides(equippedSlugs(character.tags ?? [])) : 0,
    mount: mount ? mountLabel(mount.tag?.name ?? "mount") : null,
  };
}

// The one sentence both faces say for that breakdown — "2 travel, plus 2
// rides on your Arelitz", or just "2 travel" on foot. `travel` is a mass noun
// (never "moves": a Move is the turn action), and the mount's side is in
// rides, because one ride covers any crossing whatever it costs.
function travelSentence({ baseLeft = 0, ridesLeft = 0, mount = null } = {}) {
  const base = `${formatTravel(baseLeft)} travel`;
  if (!mount || ridesLeft <= 0) return base;
  return `${base}, plus ${ridesLeft} ${ridesLeft === 1 ? "ride" : "rides"} on your ${mount}`;
}

// The arithmetic both the display above and the spend below run. The base
// pool is the allowance less what was charged to it; the bonus pool is the
// mount's rides left, which the rung already reflects — so it is added as it
// is, and NOT less zoneMovesBonusUsed. A far crossing's worth per ride
// (moveAllowance), so every `left >= cost` gate on the surfaces is satisfied
// while a ride is left, whatever the crossing costs.
function movesLeft({ base, bonus }, character, openTurn) {
  if (!openTurn) return base + bonus;
  const sameTurn = character?.zoneMovesTurnId === openTurn.id;
  const spent = sameTurn ? (character.zoneMovesUsed ?? 0) : 0;
  const bonusSpent = sameTurn ? (character.zoneMovesBonusUsed ?? 0) : 0;
  const baseSpent = Math.max(0, spent - bonusSpent);
  return Math.max(0, base - baseSpent) + bonus;
}

// The counters a crossing writes. Pure, so db/test can pin the arithmetic.
// While the mount has a ride left, the WHOLE cost goes on the bonus counter
// and `rode` is true — one ride covers one crossing, near or far, and the
// caller takes the mount a rung down (mountRides.js#rideMount). Otherwise the
// cost comes off the base. A push on charges the base pool alone and never
// the bonus — that overspend is what exertedThisTurn reads back. `left` is
// what is left afterwards, the ride just spent already off the bonus.
function crossingClaim({ base, bonus }, character, openTurn, cost, { exert = false } = {}) {
  const sameTurn = character?.zoneMovesTurnId === openTurn.id;
  const spentFree = sameTurn ? (character.zoneMovesUsed ?? 0) : 0;
  const spentBonus = sameTurn ? (character.zoneMovesBonusUsed ?? 0) : 0;
  const rode = !exert && bonus > 0;
  const onBonus = rode ? cost : 0;
  return {
    zoneMovesTurnId: openTurn.id,
    zoneMovesUsed: spentFree + cost,
    zoneMovesBonusUsed: spentBonus + onBonus,
    rode,
    left: movesLeft(
      { base, bonus: rode ? Math.max(0, bonus - FAR_CROSSING_COST) : bonus },
      { zoneMovesTurnId: openTurn.id, zoneMovesUsed: spentFree + cost, zoneMovesBonusUsed: spentBonus + onBonus },
      openTurn,
    ),
  };
}

// PUSHING ON (docs/systemdocs/MAP.md §3): one more crossing a turn, on foot,
// after the free ones are gone AND the Move is already spent — the extra
// gamble to go the distance, paid with a die. What the die costs, with
// nothing else on it: no mood or hunger modifier, because a hungry,
// frightened walker is exactly who pushes on, and a −4 on top would make
// the injury a certainty the confirm text does not admit.
const EXERT_INJURY_SLUG = "sprained-ankle";
// What a 6 leaves: a turn's visible mark and nothing else (docs/tags.yaml).
const WINDED_SLUG = "winded";
// Too hurt to force a second day's march, on top of LAMED_SLUGS: the three
// wounds that kill untreated, and the two states that take your wits the way
// Pain Shock does. None of them restrict ACT (db/lib/incapacitation.js), so
// without this they could push on. Bascinet's list, 2026-09-12.
const EXERT_REFUSAL_SLUGS = new Set(["arterial-bleed", "punctured-lung", "gut-wound", "sepsis"]);
// The traits that pull the die (db/lib/advantage.js#rollWithEdge): a runner
// and a stimulant keep the better of two, "more easily tired out by physical
// activity" and "slower" keep the worse. Lucky counts as it does on every
// other die. The count decides; a tie rolls once.
//
// Stimulant High was the second stimulant here until the coca chain left the
// game; nothing granted it any more, so it went with the rest.
const EXERT_BETTER_SLUGS = new Set([LUCKY_SLUG, "quick-footed", "caffeinated"]);
const EXERT_WORSE_SLUGS = new Set(["fat", "old"]);
function exertOutcome(die) {
  if (die <= 1) return "injury";
  if (die <= 3) return "exhausted";
  if (die <= 5) return "tired";
  return "none";
}

// Whether they already pushed on this turn. There is no column for it: an
// exert crossing claims zoneMovesUsed like a free one but never
// zoneMovesBonusUsed, and a paid crossing claims neither, so the base pool
// reading OVER the base allowance can only mean an exert — a free claim
// cannot get there, because it only happens while base > baseSpent. Pure in
// (character, config, openTurn) on purpose: the surfaces compute their
// allowances with different party/destination inputs, and a check hung off
// one of those would offer the button where the server refuses. A GM
// lowering freeZoneMovesPerTurn mid-turn reads as "already pushed on" until
// the turn turns; accepted.
function exertedThisTurn(character, config, openTurn) {
  if (!openTurn || character?.zoneMovesTurnId !== openTurn.id) return false;
  const baseSpent = Math.max(0, (character.zoneMovesUsed ?? 0) - (character.zoneMovesBonusUsed ?? 0));
  return baseSpent > (config?.freeZoneMovesPerTurn ?? 1);
}

// Why this character cannot push on right now, or null. `left` is THIS
// crossing's own travel count, the same per-destination number the surfaces
// already compute, and `cost` what the crossing would spend
// (db/lib/crossingCost.js) — a push on is only for a crossing you cannot
// afford; `acted` is whether an Action already stands for this
// turn — the Move spent, on a paid crossing or anything else — which the
// caller reads, since this stays pure. The reasons a player can read off
// their own sheet come first, the counter last. Bascinet's wording,
// 2026-09-12.
function exertRefusal(character, config, openTurn, { left = 0, cost = 1, acted = false } = {}) {
  const held = character.tags ?? [];
  const active = equippedSlugs(held);
  if (isMounted(active)) return "Your arelitz has ridden as hard as it can.";
  const stopped = held.find((ct) => LAMED_SLUGS.has(ct.tag?.slug) || EXERT_REFUSAL_SLUGS.has(ct.tag?.slug));
  if (stopped) return `${stopped.tag.name} prevents you from pushing on.`;
  // Exhausted is the top of the ladder, so a push on could cost them nothing
  // but the ankle — that is free crossings for the worn out, not a gamble.
  if (held.some((ct) => ct.tag?.slug === EXHAUSTED_SLUG)) {
    return "You're already Exhausted, you have nothing left to push on with.";
  }
  if (held.some((ct) => ct.tag?.slug === OVERBURDENED_SLUG)) return "You're overburdened, drop some weight to push on.";
  if (left >= cost) return "You still have the travel for this crossing.";
  // The gamble is for going the distance: only once the Move is gone.
  if (!acted) return "You haven't spent your Move yet.";
  if (exertedThisTurn(character, config, openTurn)) return "You've already pushed on this turn.";
  return null;
}

// Which way the die leans for this character, before it is thrown — the
// confirm says so. { edge: "better" | "worse" | null, names }.
function exertEdgeFor(characterTags) {
  return edgeFor(characterTags, { better: EXERT_BETTER_SLUGS, worse: EXERT_WORSE_SLUGS });
}

// The sentence the confirm adds when the die leans, on both faces; null when
// it doesn't. "Lucky and Quick-Footed" for two, "Lucky, Quick-Footed and
// Caffeinated" for three.
function exertEdgeSentence({ edge, names } = {}) {
  if (!edge || !names?.length) return null;
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Due to ${who} you have ${edge === "better" ? "advantage" : "disadvantage"} on this roll.`;
}

// The die, and what it did. Runs inside the crossing's own transaction, after
// the claim above has already won the race. Fatigue is granted at N+1 so a
// push at the tail of a turn still costs the whole next one — the same clock
// a day's mining runs on (docs/tags.yaml, Exhausted); the ankle keeps its own
// three turns from now. Winded is granted at N and gone when the turn closes:
// it is only the mark of having pushed on today, with nothing to carry over
// (Bascinet, 2026-09-13). A held Tired is consumed by the step up to Exhausted
// rather than left to expire beside it, for the reason db/lib/moveEffects.js
// gives — so for a Tired walker the table reads 1 ankle, 2–5 Exhausted, 6
// Winded. An Exhausted one was refused before the claim (exertRefusal).
async function pushOn(tx, character, openTurn, targetLocation) {
  const roll = rollWithEdge(character.tags ?? [], { better: EXERT_BETTER_SLUGS, worse: EXERT_WORSE_SLUGS });
  const effect = exertOutcome(roll.die);
  const held = new Set((character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
  let slug = null;
  if (effect === "injury") slug = EXERT_INJURY_SLUG;
  else if (effect === "exhausted") slug = EXHAUSTED_SLUG;
  else if (effect === "tired") slug = nextFatigueSlug(held);
  else slug = WINDED_SLUG;

  let tagName = null;
  if (slug) {
    if (slug === EXHAUSTED_SLUG && held.has(TIRED_SLUG)) {
      await tx.characterTag.deleteMany({ where: { characterId: character.id, tag: { slug: TIRED_SLUG } } });
    }
    const at = slug === EXERT_INJURY_SLUG || slug === WINDED_SLUG ? openTurn.number : openTurn.number + 1;
    const [granted] = await grantTagSlugs(tx, character.id, [slug], at);
    tagName = granted?.tagName ?? null;
  }

  // No Action is filed — the Move was never spent — so this row is the GM's
  // only record of the push.
  await logAudit(tx, {
    actorDiscordUserId: character.discordUserId ?? null,
    actionType: "exert_crossing",
    targetCharacterId: character.id,
    turnId: openTurn.id,
    details: {
      die: roll.die,
      rolls: roll.rolls,
      edge: roll.edge,
      edgeFrom: roll.names,
      effect,
      granted: slug,
      to: targetLocation.name,
      zone: targetLocation.zone.name,
    },
  });
  return { die: roll.die, rolls: roll.rolls, edge: roll.edge, names: roll.names, effect, tagName };
}

// The one sentence both faces say after a push on. Bare: the bot's respond()
// and the Travel panel's line each add their own dressing. Only the die that
// counted is shown — the discarded one and the trait behind it stay off the
// line, Bascinet's call. Winded is named outright rather than read off the
// row so the line still reads if the catalog is behind (db:sync-tags).
function exertResultLine(exert) {
  if (!exert) return null;
  const rolled = `Rolled: **${exert.die}**`;
  if (exert.effect === "none") return `You pushed on and have arrived only Winded. ${rolled}`;
  if (exert.effect === "injury") return `You pushed on and sprained your ankle. ${rolled}`;
  return `You pushed on and are now ${exert.tagName ?? "Tired"}. ${rolled}`;
}

// What undoing a Move should also undo on the Character row — a zone crossing spends
// OUTSIDE Action.appliedEffects entirely (performLocationMove writes it straight onto Character instead of snapshotting on the Action): EVERY crossing this turn, free or paid, claims against zoneMovesUsed/zoneMovesTurnId, so deleting the Action alone left the day's free crossings spent even though the Move that (over-)spent them came back.
// WHAT IT NO LONGER UNDOES IS THE CROSSING ITSELF — travel lands at once now (MAP.md §3), the character is already at the destination, and handing their Move back doesn't walk them home; a GM who wants that teleports them.
// Pure on purpose — web/lib/moveEconomy.js#deleteActionRestoringTurn is the only caller and applies whatever this returns, but keeping the decision separate from the write is what makes it testable without a database. `action` needs { turnId, characterId, character: { zoneMovesTurnId, zoneMovesUsed, zoneMovesBonusUsed } }. Returns a Character update object, or null when this Action never claimed a crossing — zoneMovesBonusUsed resets alongside zoneMovesUsed, a claim undone this turn owes back whatever pool it was charged to. Action.turnId is unique per character (@@unique([characterId, turnId])), so a match against it can only mean THIS Action.
// THE MOUNT'S RUNG IS NOT WALKED BACK UP. A ride lives on the animal's tag now (mounts.js), the animal did carry them, and a GM who wants it fresh again can retag it from /gm/dev; the turn pass does it anyway at the close.
function travelClaimsToUndo(action) {
  const character = action?.character;
  if (!character) return null;
  const data = {};
  if (character.zoneMovesTurnId === action.turnId) {
    data.zoneMovesUsed = 0;
    data.zoneMovesBonusUsed = 0;
    data.zoneMovesTurnId = null;
  }
  return Object.keys(data).length ? data : null;
}

// Motion Sickness can't be equipped onto a mount (equipActions.js), so the only
// way it ever rides one is being dragged along by someone else's. Best-effort and swallows its own errors — a DM or tag write going wrong should never break the move itself. Fires once per zone crossing that way, and does nothing if the character already holds vomiting.
async function vomitOnTheRide(prisma, row, openTurn) {
  try {
    const already = row.tags?.some((ct) => ct.tag.slug === VOMITING_SLUG);
    if (already) return;
    const tag = await prisma.tag.findUnique({
      where: { slug: VOMITING_SLUG },
      select: { id: true, defaultDurationTurns: true },
    });
    if (!tag) return;
    const expiresTurn = await expiryForGrant(prisma, tag, openTurn);
    await addToStack(prisma, row.id, tag.id, 1, { source: "EVENT", expiresTurn });
    if (row.discordUserId) {
      await sendDm(prisma, row.discordUserId, "The ride makes you sick. You're **Vomiting**.");
    }
  } catch (err) {
    console.error("vomitOnTheRide failed:", err);
  }
}

function freeZoneMoves(character, config, partySize = 0) {
  const { base, bonus } = moveAllowance(character, config, partySize);
  return base + bonus;
}

// The same rules, split into the two pools now spent in order: BONUS is what the equipped mount has left in it, BASE is the flat per-turn allowance everybody gets. Both are in TRAVEL, not crossings — each ride left on the mount is worth a far crossing (FAR_CROSSING_COST), because one ride covers any crossing. The rides come off the mount's own rung (mounts.js#fastTravelBonus), which is why a mount picked up fresh from the stable rides at once and one handed over after a ride does not: the tag says which it is.
function moveAllowance(character, config, partySize = 0) {
  const held = character.tags ?? [];
  if (held.some((ct) => ct.tag?.slug === OVERBURDENED_SLUG)) return { base: 0, bonus: 0 };
  const base = config?.freeZoneMovesPerTurn ?? 1;
  const active = equippedSlugs(held);
  // An arelitz carries you whatever your legs are, so it's checked FIRST and cancels
  // lameness outright rather than adding one to a zero — but only while the party FITS it (fastTravelCapacity counts the rider: an arelitz seats two, a cart six, mounts.js). No cap on party size — going over just costs the mount's rides, so an overloaded arelitz is never WORSE than legs, only no better.
  if (isMounted(active)) {
    return { base, bonus: fitsMount(active, partySize) ? fastTravelBonus(active) * FAR_CROSSING_COST : 0 };
  }
  if (held.some((ct) => LAMED_SLUGS.has(ct.tag?.slug))) return { base: 0, bonus: 0 };
  return { base, bonus: 0 };
}

// Whether the mover and their party fit the seats their mount actually has. Split out
// since three surfaces ask it: the allowance above, the hover below, and the dashed-card panel. A capacity of 0 is somebody on foot, no seats to overfill.
function fitsMount(activeSlugs, partySize = 0) {
  const seats = fastTravelCapacity(activeSlugs);
  if (seats <= 0) return true;
  return partySize + 1 <= seats;
}

// One sentence explaining the sheet's crossing count, for its hover. Usually
// that means why the number is 0 — a bare 0 leaves a lamed or overloaded player
// with nothing to act on.
//
// `turn` is optional { config, openTurn }: with it, a 0 that comes from having
// pushed on this turn says so, since nothing else on the sheet does.
function freeZoneMovesReason(character, partySize = 0, turn = null) {
  const held = character.tags ?? [];
  if (held.some((ct) => ct.tag?.slug === OVERBURDENED_SLUG)) {
    return "Overburdened: you don't have any free travel anymore.";
  }
  const active = equippedSlugs(held);
  if (isMounted(active)) {
    // The one case where the number is lower than a player expects for a
    // reason they cannot read off their own sheet.
    if (!fitsMount(active, partySize)) {
      return `You're taking more people than your ${fastTravelCapacity(active)} seats, so you've lost the free travel.`;
    }
    // A rung with nothing left on it says so in its own name, but the number
    // beside it is still lower than a rider expects the first time.
    if (fastTravelBonus(active) === 0) {
      const mount = fastTravelMountTag(held);
      return `Your ${mount?.tag?.name ?? "mount"} has ridden as far as it will this turn. It'll be fresh again next turn.`;
    }
    return null;
  }
  const lamed = held.find((ct) => LAMED_SLUGS.has(ct.tag?.slug));
  if (lamed) return `${lamed.tag.name}: you can't cross a zone for free without riding.`;
  if (turn && exertedThisTurn(character, turn.config, turn.openTurn)) return "You've already pushed on this turn.";
  return null;
}

// WHO FOLLOWS YOU is not decided here — db/lib/escort.js owns it, one authority for a party you attach once. This module only walks whoever is already attached.

class MoveRefused extends Error {
  constructor(reason, extra = {}) {
    super(reason);
    this.refused = true;
    Object.assign(this, extra);
  }
}

// `character` is the mover as loaded by the caller (needs id, name,
// locationId, zoneId, discordUserId, tags);
// `targetLocation` must include its zone.
//
// WHO COMES ALONG is not a parameter any more. The party is read off
// Character.escortedById inside this function's own transaction, so a client
// cannot post a list of ids at all — which deletes the whole class of
// re-authorising a picker's output that the old `dragged` argument needed.
//
// `exert`: push on for one more crossing on the die instead of the Move (see
// pushOn). Refused, not downgraded, when it does not apply — the surfaces
// only offer it where exertRefusal says nothing.
//
// `skipCooldown`: this hop is a step INSIDE a walk that already claimed the
// debounce at its first hop (db/lib/locationWalk.js, MAP.md §3c). It swaps the
// same-zone claim's clock condition for "you are still standing where I read
// you" — a narrower guard, not a missing one, and the right one for a walk,
// since the thing a walk must never do is step on from a position it no longer
// occupies. NEVER pass it from a client, and never spread a caller's opts
// object in here: it is refused below for anything but a same-zone hop, so it
// can never be the hole that skips the free-crossing arithmetic.
//
// `chain`: everybody already moved by this one press, so an escort following an escort (MAP.md §3d) can
// never walk in a circle. Internal, like skipCooldown — the follow step below passes it to itself.
async function performLocationMove(prisma, character, targetLocation, { exert = false, skipCooldown = false, chain = null } = {}) {
  if (!targetLocation?.zone) throw new Error("performLocationMove needs targetLocation.zone");

  // Shut between sittings (SESSIONS.md §5). This is the floor, not the policy — both faces refuse the button long
  // before here — but every crossing in the game funnels through this one function, so a surface that forgets to ask
  // still cannot walk somebody across the map with no GM in the room. A GM's own move does not come this way; it goes
  // straight to applyLocationMoveSideEffects.
  const session = await sessionGate(prisma);
  if (!session.ok) return { ok: false, reason: session.message };

  // Nobody walks once Moves lock (Combat Overhaul.docx; turnGate.js#travelLockReason), and a walk into
  // the caves says so in Caving.docx's words. A first placement is not a walk, so it is let through.
  if (character.locationId) {
    const locked = await travelLockReason(prisma, { intoZoneKind: targetLocation.zone.kind });
    if (locked) return { ok: false, reason: locked };
  }

  // The MOVER's own state — escorting asks whether the TARGET is helpless, but "can this
  // character walk at all" was never asked before this gate existed, so a bound, paralyzed or unconscious character could stroll out of the room they were held in. Every crossing funnels through here (locationGraph.js), so this one gate covers the bot's picker, /location, and the staged push alike.
  const stuck = blockerFor(character.tags, ACT);
  if (stuck) return { ok: false, reason: `You can't go anywhere — you're ${stuck.name}.` };

  // Somebody laid in wait and stopped them (INTERCEPT.md). Beside the ACT gate, not inside it — a hold takes MOVEMENT only, so held you can still act, speak and fight back. One timestamp comparison, and it lapses on its own.
  const held = heldReasonFor(character);
  if (held) return { ok: false, reason: held };

  let currentLocation = null;
  let crossingLink = null;
  if (character.locationId) {
    if (character.locationId === targetLocation.id) {
      return { ok: false, reason: "You're already there." };
    }
    currentLocation = await prisma.location.findUnique({
      where: { id: character.locationId },
      include: { zone: true },
    });
    if (!currentLocation) {
      return { ok: false, reason: "You can't get there directly from here." };
    }

    // The edge, and what it lets this character do — a missing, hidden (no key), locked or
    // shut-modular edge all refuse here; the picker filters the same verdict, but a client can post any location id, so this is the check that counts.
    crossingLink = await linkBetween(prisma, currentLocation.id, targetLocation.id);
    const gate = crossingCheck(crossingLink, {
      // Held tags plus the worn ring's doors (docs/systemdocs/RINGS.md).
      tagSlugs: await withRingTokens(prisma, character.id, character.tags),
      // Equipped, not merely held — CHARACTER_SELECT already loads `equipped`
      // for exactly this kind of question.
      onFootBlocked: blocksOnFoot(equippedSlugs(character.tags ?? [])),
    });
    // `edge` marks the one refusal an escort following them must never be told the reason for (§3d):
    // naming a hidden way's refusal would announce the way is there (MAP.md §2a).
    if (!gate.passable) return { ok: false, reason: gate.refusal, edge: true };
  }

  // A first placement (no current location) is free — it isn't travel, it's arrival. A walk inside the zone is free on the cooldown. Only a hop whose edge crosses into another zone files the Move.
  const first = !currentLocation;
  const crossedZone = !first && currentLocation.zoneId !== targetLocation.zoneId;
  // A walk never crosses a zone, so its cooldown shortcut must never reach the branch that spends a free crossing or the Move. Refused rather than quietly downgraded: a silent no-op here would be a free border hop.
  if (skipCooldown && crossedZone) {
    return { ok: false, reason: "You can't walk into another zone." };
  }

  // The Caving Die's two refusals, off one query, and only asked underground
  // (docs/systemdocs/CAVING.md §2c, §2e). A result of severity 10 stops every
  // hop, the next room included; any 1 this turn stops only the way up to the
  // surface — the Caves and the Depths stay open to each other, resolved or
  // not, until the push.
  const underground = currentLocation?.zone?.kind === "CAVE_LEVEL";
  const caving = await cavingRestrictionsFor(prisma, character.id, currentLocation?.zone?.kind);
  const cavingRefusal = cavingRefusalFor(caving, targetLocation.zone.kind);
  if (cavingRefusal) return { ok: false, reason: cavingRefusal };

  let openTurn = null;
  if (crossedZone) {
    openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
    if (!openTurn) return { ok: false, reason: "No turn is currently open." };
  }
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: {
      locationMoveCooldownSeconds: true,
      archiveTravelEvents: true,
      freeZoneMovesPerTurn: true,
    },
  });
  const cooldownMs = Math.max(0, config.locationMoveCooldownSeconds) * 1000;

  const now = new Date();
  const outcome = {
    spentTurn: false,
    usedFreeMove: false,
    freeMovesLeft: null,
    partyRows: [],
    // Followers the edge would not take. They are detached and left standing rather than failing the whole move (MAP.md §3a); the caller DMs them and their leader off this list.
    leftBehind: [],
    // Mounts a too-narrow way made them leave behind — see the dismount step at the top of the transaction below.
    dismounted: [],
  };

  // The party, read BEFORE the transaction so the free-move arithmetic below
  // knows how many seats are in use. Re-read inside it, where it counts.
  const partyPreview = await partyOf(prisma, character.id);

  // The edge everybody is crossing, read once out here rather than per
  // follower inside the transaction. Null on a first placement, which has no
  // edge to check.
  const followerLink = currentLocation ? await linkBetween(prisma, currentLocation.id, targetLocation.id) : null;

  try {
    await prisma.$transaction(async (tx) => {
      // A way too narrow for what they had out dismounts them instead of refusing outright
      // (indoors.js#dismountForNarrowWay) — but it must happen HERE, first, inside this same transaction, not as a post-commit side effect: it affects free-move accounting for THIS crossing. A mount buys an extra free crossing (freeZoneMoves below), so dismounting after the fact would let a rider bank that bonus on a ride that never survives the threshold — the exploit refusing at the threshold exists to close (MAP.md §2c). Mutating `character.tags` in memory is what makes freeZoneMoves see the dismount too, with no extra query.
      outcome.dismounted = await dismountForNarrowWay(tx, character.id, crossingLink);
      if (outcome.dismounted.length > 0) {
        character.tags = (character.tags ?? []).map((ct) =>
          STOWABLE_SLUGS.has(ct.tag?.slug) ? { ...ct, equipped: false } : ct,
        );
      }

      // The party is re-loaded and re-authorized INSIDE the transaction, and this copy is
      // the one that counts — everything above it is a preview. Two things drop a follower here, and NEITHER refuses the move (the change from dragging, where one bad passenger threw the whole hop away): somebody who wandered off, or somebody the edge won't take. Both are let go and left standing, and the caller tells them.
      const party = await partyOf(prisma, character.id, { tx });
      if (party.length > 0) {
        const mover = await tx.character.findUnique({ where: { id: character.id }, select: ESCORT_SELECT });
        // Which of them the Caving Die has hold of, and which it has stopped outright — one query for the whole party rather than one per follower, and only underground, since a surface follower can have neither. The hold only matters on the way up to the surface; the stop matters on every hop.
        const cavingParty = await cavingPartyRestrictions(tx, party.map((row) => row.id), currentLocation?.zone?.kind);
        const cavingHeld = underground && targetLocation.zone.kind !== "CAVE_LEVEL" ? cavingParty.held : cavingParty.stuck;
        const coming = [];
        for (const row of party) {
          // Held where they stand — a follower is walked by an updateMany and never comes
          // past the mover's own gate, so without this a friend could carry somebody straight out of an ambush. ABOVE escortAuthority on purpose, though that refuses a held character too: its refusal reads here as "gone", while "held" is the ONE leftBehind reason told to the leader out loud (somebody holding your friend is plain to see) — ordered the other way, they'd never hear it.
          if (heldReasonFor(row)) {
            // "held" reads to the leader as "Somebody has hold of X", so it needs a somebody. A hold with no holder (a
            // caught thief, THEFT.md §1e) is "stuck", which every reader draws as the plain "couldn't follow".
            outcome.leftBehind.push({ row, reason: row.heldById ? "held" : "stuck" });
            continue;
          }
          // The Die has hold of them, same shape and reason: a follower never comes past
          // the mover's own gate, so without this a friend carries the caver out of their own unadjudicated encounter — or, at ten 1s, walks somebody the Die has stopped into the next room. Its own reason, not "held" (intercept's word) — an unknown reason falls through to the plain "couldn't follow" everywhere it's read.
          if (cavingHeld.has(row.id)) {
            outcome.leftBehind.push({ row, reason: "caving" });
            continue;
          }
          if (!escortAuthority(mover, row)) {
            outcome.leftBehind.push({ row, reason: "gone" });
            continue;
          }
          // The edge, judged against the FOLLOWER's own tags and mount, not the leader's — a crawl the leader has the Caving for is still a crawl their unskilled companion can't follow, and a rider can't be led through an onFoot gap.
          if (currentLocation) {
            const gate = crossingCheck(followerLink, {
              tagSlugs: await withRingTokens(prisma, row.id, row.tags),
              onFootBlocked: blocksOnFoot(equippedSlugs(row.tags ?? [])),
            });
            if (!gate.passable) {
              outcome.leftBehind.push({ row, reason: "edge" });
              continue;
            }
          }
          coming.push(row);
        }
        if (outcome.leftBehind.length > 0) {
          await tx.character.updateMany({
            where: { id: { in: outcome.leftBehind.map((e) => e.row.id) } },
            data: { escortedById: null },
          });
        }
        outcome.partyRows = coming;
      }

      if (crossedZone) {
        // A crossing spends FREE TRAVEL first, only spending the Move once there is not enough left for it
        // (CARRY.md §2) — a peasant walks Town->Fortress for ½, out to the Black Hills for 1, and once the travel is short the crossing costs the Move and the way back waits for next turn. What this one costs is db/lib/crossingCost.js's answer for the two zones. The allowance is claimed by a conditional updateMany whose WHERE is the check, so two tabs can't both spend the last of it; a differing turn id resets the counter in the same statement, so nothing ever has to sweep this field. partyPreview, not the re-authorized list — seats are spent on who you SET OUT with, since somebody the gate drops at the threshold already took a saddle for this crossing.
        const allowance = moveAllowance(character, config, partyPreview.length);
        const sameTurn = character.zoneMovesTurnId === openTurn.id;
        const spentFree = sameTurn ? (character.zoneMovesUsed ?? 0) : 0;
        const left = movesLeft(allowance, character, openTurn);
        const cost = crossingCost(currentLocation?.zone?.slug, targetLocation.zone?.slug) || FAR_CROSSING_COST;
        // The claim's WHERE, shared by a free crossing and a push on: the
        // counter as this read saw it, or a stale/absent turn id.
        const claimWhere =
          character.zoneMovesTurnId === openTurn.id
            ? { id: character.id, zoneMovesTurnId: openTurn.id, zoneMovesUsed: spentFree }
            : {
                id: character.id,
                // `{ not: x }` never matches NULL in SQL, so the null case
                // has to be spelled out or a character who has not moved
                // this turn could never claim their first free move.
                OR: [{ zoneMovesTurnId: null }, { zoneMovesTurnId: { not: openTurn.id } }],
              };

        if (exert) {
          // The same read the paid branch below makes, asked the other way
          // round: a push on needs the Move already spent.
          const acted = await tx.action.findFirst({
            where: { characterId: character.id, turnId: openTurn.id },
            select: { id: true },
          });
          const why = exertRefusal(character, config, openTurn, { left, cost, acted: Boolean(acted) });
          if (why) throw new MoveRefused(why);
          // Charged to the base pool and never the bonus — that overspend is
          // what exertedThisTurn reads back.
          const { left: leftAfter, rode: _rode, ...claim } = crossingClaim(allowance, character, openTurn, cost, { exert: true });
          const claimed = await tx.character.updateMany({ where: claimWhere, data: claim });
          if (claimed.count === 0) throw new MoveRefused("You've already moved. Try again in a moment.");
          outcome.exert = await pushOn(tx, character, openTurn, targetLocation);
          outcome.freeMovesLeft = leftAfter;
        } else if (left >= cost) {
          // The mount's ride goes first — and the ride is spent ON THE MOUNT, in this same transaction, after the claim has won its race: the tag goes a rung down (mountRides.js), so the next read of the allowance sees one ride fewer without any counter having to remember it. Unequipping the arelitz afterwards (a narrow way, or by hand) gives back nothing and takes back nothing: the rung stays where the ride left it, and the base travel was never touched.
          const { left: leftAfter, rode, ...claim } = crossingClaim(allowance, character, openTurn, cost);
          const claimed = await tx.character.updateMany({ where: claimWhere, data: claim });
          if (claimed.count === 0) throw new MoveRefused("You've already moved. Try again in a moment.");
          if (rode) outcome.rode = await rideMount(tx, character.id);
          outcome.usedFreeMove = true;
          outcome.freeMovesLeft = leftAfter;
          // The two halves of that, for the result line (travelSentence): the
          // rung has already moved, so the rides are what the claim left.
          outcome.travelLeft = {
            baseLeft: Math.max(0, allowance.base - (claim.zoneMovesUsed - claim.zoneMovesBonusUsed)),
            ridesLeft: Math.max(0, allowance.bonus - (rode ? FAR_CROSSING_COST : 0)) / FAR_CROSSING_COST,
            mount: allowance.bonus > 0 ? mountLabel(fastTravelMountTag(character.tags ?? [])?.tag?.name ?? "mount") : null,
          };
        } else {
          // Not enough travel for this one, so it costs the Move. Acting and crossing are mutually exclusive within a turn, in either order — @@unique([characterId, turnId]) is the real enforcement and this read is for the message.
          const existing = await tx.action.findFirst({
            where: { characterId: character.id, turnId: openTurn.id },
            select: { id: true },
          });
          if (existing) {
            throw new MoveRefused(
              allowance.base + allowance.bonus === 0
                ? "You're overburdened, so you have no free travel left."
                : "You don't have the travel left for this crossing and you've already acted.",
            );
          }
          await tx.action.create({
            data: {
              characterId: character.id,
              turnId: openTurn.id,
              type: "MOVE",
              status: "CONFIRMED",
              moveReviewStatus: "SOLVED",
              description: `Travelled to ${targetLocation.name} (${targetLocation.zone.name}).`,
              // The SEAT zone, not the presence zone — a Move filed from the
              // Railroad belongs on the Caves GM's table.
              zoneId: seatZoneIdFor(targetLocation.zone),
              resultMessage: `» Travelled to ${targetLocation.name}.`,
              gmNotes: "auto:zone_change",
            },
          });
          outcome.spentTurn = true;
          // Whatever was short of this crossing is still there for a cheaper one.
          outcome.freeMovesLeft = left;
        }
        outcome.freeMovesLeft ??= 0;
        // Paid or free, the crossing lands NOW — a paid one used to park its destination and wait for turn advance; it doesn't any more (MAP.md §3), so the two branches are one write.
        await tx.character.update({
          where: { id: character.id },
          data: {
            locationId: targetLocation.id,
            zoneId: targetLocation.zoneId,
            lastLocationMoveAt: now,
            // Walking under your own power is how a willing follower leaves
            // (MAP.md §3a). A helpless one never reaches this line.
            escortedById: null,
          },
        });
      } else {
        // Same zone (or first placement): the cooldown, enforced by the WHERE of a conditional update so two clicks in one tick can't both pass.
        // A later hop of a walk swaps that clock for the position it read, which is why the claim is never simply dropped — see skipCooldown's note on the signature. `data` is untouched either way, so every hop re-stamps lastLocationMoveAt and the walk's LAST hop is the one the next click waits on.
        const cutoff = new Date(now.getTime() - cooldownMs);
        const claimed = await tx.character.updateMany({
          where: skipCooldown
            ? { id: character.id, locationId: character.locationId }
            : {
                id: character.id,
                OR: [{ lastLocationMoveAt: null }, { lastLocationMoveAt: { lte: cutoff } }],
              },
          data: {
            locationId: targetLocation.id,
            zoneId: targetLocation.zoneId,
            lastLocationMoveAt: now,
            escortedById: null,
          },
        });
        if (claimed.count === 0) {
          // Inside a walk the claim can only have failed because somebody else moved them — an escort, a GM teleport, a Stepstone — so the breath line would be a lie.
          if (skipCooldown) throw new MoveRefused("Somebody moved you before you got there.");
          const row = await tx.character.findUnique({
            where: { id: character.id },
            select: { lastLocationMoveAt: true },
          });
          const readyAt = (row?.lastLocationMoveAt?.getTime() ?? 0) + cooldownMs;
          const seconds = Math.max(1, Math.ceil((readyAt - now.getTime()) / 1000));
          throw new MoveRefused(`You're still catching your breath — ${seconds}s.`, { retryAfterSeconds: seconds });
        }
      }

      // Walking off releases anybody this character was holding — a hold is a hand on a
      // shoulder (INTERCEPT.md), you can't keep one from the next zone. One of three writers that end a hold early (the others: the holder's own Release, and their death). A FIGHT is not this clear's to end (releaseHeldBy's rule: heldById names one opponent, a brawl has several, so a blind clear would free somebody out of a fight still going) — a held character can't walk anyway, so this never meets a fight, but the guard stays so that if it ever does, it must not fire; combat.js#leaveCombatsFor is the writer for that, off every relocation (locationMove.js).
      await tx.character.updateMany({
        where: { heldById: character.id, heldUntil: { gt: now }, ...NOT_A_FIGHT },
        data: { heldUntil: null, heldById: null, heldReason: null },
      });

      if (outcome.partyRows.length > 0 || outcome.leftBehind.length > 0) {
        // The party lands with the mover, whether or not the crossing cost a Move — one statement for all of them, no Action, cooldown claim or mount claim of their own (MAP.md §3a).
        await tx.character.updateMany({
          where: { id: { in: outcome.partyRows.map((t) => t.id) } },
          data: { locationId: targetLocation.id, zoneId: targetLocation.zoneId, lastLocationMoveAt: now },
        });
        await logAudit(tx, {
          actorDiscordUserId: character.discordUserId ?? null,
          actionType: "characters_escorted",
          targetCharacterId: character.id,
          details: {
            mover: character.name,
            to: targetLocation.name,
            zone: targetLocation.zone.name,
            party: outcome.partyRows.map((t) => ({ id: t.id, name: t.name })),
            leftBehind: outcome.leftBehind.map((e) => ({ id: e.row.id, name: e.row.name, why: e.reason })),
          },
        });
      }
    });
  } catch (err) {
    if (err?.refused) return { ok: false, reason: err.message, retryAfterSeconds: err.retryAfterSeconds };
    if (err?.code === "P2002") return { ok: false, reason: "You've already acted this turn." };
    throw err;
  }

  // Off by default (GameConfig.archiveTravelEvents), and only for a zone crossing — a row per cooldown step would be exactly the volume the gate exists to prevent.
  if (config?.archiveTravelEvents && crossedZone) {
    await recordArchiveEvent(prisma, {
      kind: "TRAVEL",
      character,
      zoneId: targetLocation.zoneId,
      zoneName: targetLocation.zone.name,
      content: `${character.name} left ${currentLocation.zone.name} for ${targetLocation.zone.name}.`,
    });
  }

  // Whether ANY leg of this move was a free ride, for the Motion Sickness check below — a dragged passenger with no mount of their own still gets sick if the one dragging them does.
  const ridden = crossedZone && isMounted(equippedSlugs(character.tags ?? []));

  const moved = [];
  for (const row of [character, ...outcome.partyRows]) {
    const fromLocationId = row.id === character.id ? currentLocation?.id ?? null : row.locationId;
    const fromZoneId = row.id === character.id ? currentLocation?.zoneId ?? null : row.zoneId;
    // The Caving Die, which is now the only thing arrival does — null on a surface or
    // SAFE Location; kind, open turn and error swallowing all live in the helper. Walking back somewhere you already saw today rolls again — no per-Location cap any more (CAVING.md 2b).
    const cavingDm = await rollCavingOnArrival(prisma, row, targetLocation);
    if (ridden && row.id !== character.id && row.status === "ALIVE") {
      const carsick = row.tags?.some((ct) => ct.tag.slug === MOTION_SICKNESS_SLUG);
      if (carsick) {
        await vomitOnTheRide(prisma, row, openTurn);
      }
    }
    moved.push({
      character: { id: row.id, name: row.name, discordUserId: row.discordUserId, status: row.status },
      fromLocationId,
      fromZoneId,
      toLocationId: targetLocation.id,
      toZoneId: targetLocation.zoneId,
      zoneChanged: fromZoneId !== targetLocation.zoneId,
      cavingDm,
    });
  }

  // Anybody laying in wait here (INTERCEPT.md). Hooked HERE, not on applyLocationMoveSideEffects
  // (the writer every relocation runs) — an intercept is one person acting on another, stopped ON THE ROAD, so a GM teleport, Bulk Move, staged Relocate to, rite or first placement must not trip somebody's ambush. The whole party goes in at once, mover first, making "if several people come up together they all get stopped" free. Sends nothing; the caller sends `interceptDms` like it sends `cavingDm`, after this returns and outside any transaction.
  let interceptDms = [];
  const turnForWatches = moved.length > 0 ? openTurn ?? (await prisma.turn.findFirst({ where: { status: "OPEN" } })) : null;
  if (moved.length > 0) {
    // Wrapped: a watch that throws must never wedge a move that has already committed. The mover is standing at the destination either way.
    try {
      ({ dms: interceptDms } = await fireWatches(prisma, {
        // Each arrival carries the zone it came FROM, for a watch set to ignore anybody who
        // was already in this one (intercept.js#originHolds). Per arrival rather than per move: an escort party is judged one person at a time, since a leader crossing a border can be carrying somebody who never left the zone.
        arrivals: moved.map((entry) => ({ ...entry.character, fromZoneId: entry.fromZoneId })),
        locationId: targetLocation.id,
        zoneId: targetLocation.zoneId,
        openTurn: turnForWatches,
      }));
    } catch (err) {
      console.error(`Intercept: firing watches at ${targetLocation.id} failed:`, err.message ?? err);
    }
  }

  // ESCORTS FOLLOW (MAP.md §3d). Everybody escorting somebody who just moved, and standing where that
  // somebody set out from, walks after them — AFTER the watches, so an ambush on the road catches the charge
  // first and the escort walks into the fight behind them. Each follows through this same function under
  // their own power, so the way judges their own keys and their own feet, and a crossing spends their own
  // travel and then their Move (Bascinet, 2026-09-30). A guard who can't follow is left standing and the
  // escort waits. Wrapped: a follower going wrong must never make a move that has committed look refused.
  const follow = { moved: [], leftBehind: [], interceptDms: [], escortDms: [] };
  if (moved.length > 0 && currentLocation) {
    const seen = chain ?? new Set();
    for (const entry of moved) seen.add(entry.character.id);
    for (const entry of moved) {
      if (entry.character.status !== "ALIVE" || !entry.fromLocationId) continue;
      try {
        const guards = await guardsOf(prisma, [entry.character.id], entry.fromLocationId, { select: ESCORT_SELECT, not: [...seen] });
        for (const guard of guards) {
          if (seen.has(guard.id)) continue;
          seen.add(guard.id);
          await followCharge(prisma, { guard, chargeId: entry.character.id, targetLocation, crossedZone, seen, into: follow });
        }
      } catch (err) {
        console.error(`Escort: following ${entry.character.id} failed:`, err.message ?? err);
      }
    }
  }
  const allMoved = [...moved, ...follow.moved];

  // An escort who has just arrived — following, or on their own feet — and finds their charge defending in a
  // fight here steps in (ATTACK.md §6a). Only the top of a chain asks: a nested follow's own call has none of
  // this press's escorts in its list yet. The DMs ride interceptDms, which both faces already send with a
  // fight DM's buttons.
  if (!chain && turnForWatches && allMoved.length > 0) {
    try {
      const { escortsArrive } = require("./combat");
      const arrived = await escortsArrive(prisma, {
        characterIds: allMoved.map((entry) => entry.character.id),
        locationId: targetLocation.id,
        turn: turnForWatches,
      });
      follow.interceptDms.push(...arrived.dms);
    } catch (err) {
      console.error(`Escort: stepping in at ${targetLocation.id} failed:`, err.message ?? err);
    }
  }

  return {
    ok: true,
    interceptDms: [...interceptDms, ...follow.interceptDms],
    // One line per escort who followed or was left behind (MAP.md §3d). Each carries a `key`, so a walk of
    // several hops keeps only the last one per escort (locationWalk.js).
    escortDms: follow.escortDms,
    oldLocation: currentLocation,
    oldZone: currentLocation?.zone ?? null,
    targetLocation,
    targetZone: targetLocation.zone,
    crossedZone,
    spentTurn: outcome.spentTurn,
    usedFreeMove: outcome.usedFreeMove,
    dismounted: outcome.dismounted,
    // Followers the way wouldn't take. Detached and still standing where they were; the caller owes them and their leader a line. The reason is deliberately NOT the edge's own refusal — "the way is locked" on a hidden crawl would announce the crawl is there (MAP.md §2a).
    leftBehind: [
      ...outcome.leftBehind.map((e) => ({
        character: { id: e.row.id, name: e.row.name, discordUserId: e.row.discordUserId, status: e.row.status },
        reason: e.reason,
      })),
      ...follow.leftBehind,
    ],
    freeMovesLeft: outcome.freeMovesLeft,
    // The two halves of that for the result line (travelSentence); null on a
    // paid crossing or a walk, where there is nothing to split.
    travelLeft: outcome.travelLeft ?? null,
    // The push on's die and what it cost, or null. Said by the caller in
    // exertResultLine's words; the AuditLog row already exists.
    exert: outcome.exert ?? null,
    // The mover and their party, then every escort who followed (flagged `followed`, the charge's id) —
    // a caller runs the arrival over all of them, but tells only the party "brought you along".
    moved: allMoved,
  };
}

// One escort walks after their charge (MAP.md §3d). Same-zone steps skip the breath cooldown (the walk's
// position claim), since they are walking beside somebody rather than pressing a button; a crossing never
// does, and pays. Everything this move owes is merged into `into` for the charge's caller to send.
async function followCharge(prisma, { guard, chargeId, targetLocation, crossedZone, seen, into }) {
  const hop = await performLocationMove(prisma, guard, targetLocation, { skipCooldown: !crossedZone, chain: seen });
  const { seenById } = require("./intercept");
  const name = await seenById(prisma, guard.id, chargeId);
  const tell = (content) => {
    if (guard.discordUserId) into.escortDms.push({ key: `follow:${guard.id}`, discordUserId: guard.discordUserId, content: `*${content}*`, kind: DM_KIND.QUIET });
  };
  if (!hop.ok) {
    // Already there (carried along by the charge's own party) or moved by something else mid-walk: nothing to say.
    if (hop.reason === "You're already there." || hop.reason === "Somebody moved you before you got there.") return;
    // The reason is about their own sheet (their travel, their Move, a hold on them) — except a way refusing
    // them, which is never explained.
    tell(hop.edge || !hop.reason ? GUARD_LINES.LOST(name) : `${GUARD_LINES.LOST(name)} ${hop.reason}`);
    return;
  }
  for (const entry of hop.moved) {
    into.moved.push(entry.character.id === guard.id ? { ...entry, followed: chargeId } : entry);
  }
  // Somebody the ESCORT was carrying whom the way would not take. Told here rather than handed up with the
  // charge's own leftBehind, which every caller reads as the charge's party — the charge was never their leader.
  // The same words the bot's travel already uses, and still never why (MAP.md §2a).
  for (const entry of hop.leftBehind ?? []) {
    const follower = await seenById(prisma, guard.id, entry.character.id);
    if (guard.discordUserId) {
      into.escortDms.push({
        discordUserId: guard.discordUserId,
        content: entry.reason === "edge" ? `*You can't move ${follower} through here. You left them behind.*` : `*${cap(follower)} isn't with you any more.*`,
        kind: DM_KIND.QUIET,
      });
    }
    if (entry.character.status === "ALIVE" && entry.character.discordUserId) {
      into.escortDms.push({
        discordUserId: entry.character.discordUserId,
        content: `*${cap(await seenById(prisma, entry.character.id, guard.id))} went on without you.*`,
        kind: DM_KIND.QUIET,
      });
    }
  }
  into.interceptDms.push(...(hop.interceptDms ?? []));
  into.escortDms.push(...(hop.escortDms ?? []));
  tell(hop.spentTurn ? `${GUARD_LINES.FOLLOWED(name, targetLocation.name)} ${GUARD_LINES.FOLLOW_COST_MOVE}` : GUARD_LINES.FOLLOWED(name, targetLocation.name));
}

module.exports = {
  performLocationMove,
  freeZoneMoves,
  freeMovesLeft,
  freeZoneMovesReason,
  freeMovesBreakdown,
  travelSentence,
  crossingClaim,
  crossingCost,
  travelClaimsToUndo,
  fitsMount,
  exertOutcome,
  exertedThisTurn,
  exertRefusal,
  exertEdgeFor,
  exertEdgeSentence,
  exertResultLine,
  CHARACTER_SELECT,
};
