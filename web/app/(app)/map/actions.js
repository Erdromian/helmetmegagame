"use server";

import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { crossingCheck, travelOptions, routesWithinZone, loadGraph } from "@lifeweb/db/lib/locationGraph";
import { heldReasonFor } from "@lifeweb/db/lib/intercept";
import { recordArrival, knownLocations } from "@lifeweb/db/lib/locationVisits";
import { accessibleRooms, roomAccessKeys } from "@lifeweb/db/lib/roomAccess";
import { conversationsFor } from "@lifeweb/db/lib/conversations";
import { blocksOnFoot } from "@lifeweb/db/lib/mounts";
import { hasAttribute } from "@lifeweb/db/lib/locationAttributes";
import {
  ESCORT_SELECT as MOVER_SELECT,
  partyOf,
} from "@lifeweb/db/lib/escort";
import {
  freeMovesLeft,
  freeMovesBreakdown,
  travelSentence,
  freeZoneMovesReason,
  exertRefusal,
  exertEdgeFor,
  exertEdgeSentence,
} from "@lifeweb/db/lib/locationTravel";
import { plateOf, plates } from "@/lib/mapPlates";
import { zoneKey } from "@/lib/zones";
import { RING_SLUG } from "@lifeweb/db/lib/rings";
import { scrambleState, scrambleFields, scrambleText } from "@lifeweb/db/lib/memoryScramble";
import { mapHeadcounts } from "@lifeweb/db/lib/mapHeadcounts";
import { spectatorsVisibleNow } from "@lifeweb/db/lib/spectatorAccess";

// The map's one loader (/map and the /chat overlay both call it). THE FOG IS
// REAL, NOT CSS: an unknown Location is absent from the payload entirely,
// since a server action is a public endpoint and anything shipped is shipped
// to the player (MAP.md §2a). Travel itself is NOT here — moving stays with
// travelTo on /chat, so there is one mover and one set of rules.

// There is no surface/under axis any more, and the old one was wrong anyway:
// Undertown is declared `kind: surface`, so a cave-level test put NOTHING on
// the second plate. A place belongs to whichever plate draws it, and a place
// no plate draws yet — the Caves, the Depths — belongs to neither and is
// listed rather than drawn (MAP.md §6h).

// `revealAll` is the GM's Show all switch (Map.docx): the whole plate, every
// place and every way, while still standing where their character stands. It is
// a request, not a grant — re-checked against the guild here, since a server
// action is a public endpoint and a player posting `true` must get their own
// fogged map back.
export async function loadMap({ revealAll = false } = {}) {
  const session = await auth();
  if (!session?.discordUserId) return { ok: false, error: "You are not signed in." };

  const [character, { isGm, isSpectator }] = await Promise.all([
    prisma.character.findFirst({
      where: { discordUserId: session.discordUserId, status: "ALIVE" },
      select: MOVER_SELECT,
    }),
    getGmSession(),
  ]);

  // A GM with no living character reads the whole plate, with nothing to switch.
  // A SPECTATOR with none reads it too, while the game is on (the same phase
  // rule as their Chat, web/lib/feedAccess.js#loadFeedViewer) — every place and
  // every room, but never a hidden way: a secret crawl is a thing somebody in
  // the game found, not a fact about the board.
  if (!character) {
    if (isGm) return buildMap({ character: null, unfogged: true, canReveal: false });
    if (isSpectator && (await spectatorsVisibleNow(prisma))) {
      return buildMap({ character: null, unfogged: true, canReveal: false, hiddenWays: false });
    }
    return { ok: false, error: "You have no living character." };
  }

  // The self-heal below used to run HERE, awaited, before anything else — two
  // writes and a graph read in front of every single map load. It moved inside
  // buildMap, where the neighbour list it needs already exists (MAP.md §4).
  return buildMap({ character, unfogged: Boolean(isGm && revealAll), canReveal: Boolean(isGm) });
}

// The headcounts alone, for the board's slow re-read (MAP.md §6j). People walk
// in and out of a watched street without the watcher moving, and nothing else
// about the board changes when they do, so asking for the whole map again
// would be ten queries to move one digit. `at` is where the character stood
// when this was answered: the board drops an answer for a place it has since
// been walked out of.
export async function loadHeadcounts() {
  const session = await auth();
  if (!session?.discordUserId) return { ok: false };
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true, locationId: true },
  });
  const counts = await mapHeadcounts(prisma, character);
  return { ok: true, at: character?.locationId ?? null, counts: Object.fromEntries(counts) };
}

// TWO WAVES, not a queue of awaits. Everything here used to be awaited one at
// a time — the graph, then the spent Move, then the fog, then the neighbours,
// then the walks, then the party, then the rooms — about ten round trips in a
// line, each waiting on the last for no reason but the order it was written in.
// Wave A is everything that depends on nothing; wave B is the three answers
// that need wave A. Nothing below reads a table twice: `graph` is ONE read of
// Location and LocationLink, handed to the two callers that used to fetch their
// own (db/lib/locationGraph.js#loadGraph).
// `hiddenWays` lifts the `listed` filter on top of the fog — a GM's Show all
// does both, a spectator's whole plate only the first.
async function buildMap({ character, unfogged, canReveal, hiddenWays = unfogged }) {

  const [graph, config, openTurn, known, party, keys, conversations, acted] = await Promise.all([
    loadGraph(prisma),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
    character ? knownLocations(prisma, character.id) : { stood: new Set(), seen: new Set() },
    character ? partyOf(prisma, character.id) : [],
    character ? roomAccessKeys(prisma, character.id) : null,
    character ? conversationsFor(prisma, character.id) : [],
    // Whether the Move is spent — a push on is only offered after it is
    // (MAP.md §3). The same read the Travel panel and the sheet make. Asked
    // through the turn's STATUS rather than an id fetched first, so it stops
    // waiting on the openTurn query beside it and joins this wave.
    character
      ? prisma.action
          .findFirst({ where: { characterId: character.id, turn: { status: "OPEN" } }, select: { id: true } })
          .then(Boolean)
      : false,
  ]);
  const locations = graph.locations;
  const links = graph.links;
  // OFF THE MAP (docs/systemdocs/CHARON.md). A place carrying `offMap` has no
  // marker on either plate and no edge to anywhere, so every question the rest
  // of this function answers — which plate, what is adjacent, where you could
  // walk — has no answer for it, and the honest picture is the one the board
  // draws from this: grey nothingness, the layer switch off, and the one
  // crosshair you are standing on.
  //
  // Before all the work below rather than filtered out after it, because none
  // of that work means anything here and a travelOptions call on a Location
  // with no links is a query asked for nothing.
  //
  // A GM reading the whole plate is deliberately NOT sent here — `unfogged`
  // has no location of its own to be off the map at, and a GM looking at the
  // barony should see the barony.
  const standing = character?.locationId
    ? locations.find((l) => l.id === character.locationId)
    : null;
  if (standing && !unfogged && hasAttribute(standing, "offMap")) {
    return {
      ok: true,
      offMap: true,
      // The plate list is sent, and the board draws the switch DISABLED off it
      // rather than hiding it: a switch that vanishes reads as a bug, and one
      // that is visibly off says the thing that is actually true — there is no
      // plate under you to switch between. Nothing is drawn from them.
      plates: plates(),
      you: { locationId: standing.id, plate: null, gm: unfogged, canReveal },
      nodes: [
        {
          id: standing.id,
          slug: standing.slug,
          name: standing.name,
          zoneName: standing.zone?.name ?? null,
          zoneKey: zoneKey(standing.zone?.name) ?? "none",
          plate: null,
          x: null,
          y: null,
          state: "here",
          headcount: (await mapHeadcounts(prisma, character, standing)).get(standing.id),
          description: standing.description || null,
          inside: (await roomsInside(prisma, character, unfogged, new Set([standing.id]), { keys, conversations })).get(standing.id) ?? null,
          adjacent: false,
          passable: false,
          walkable: false,
          walkHops: null,
          walkThrough: null,
          crossesZone: false,
          cost: 0,
          freeLeft: null,
          canExert: false,
          exertWhy: null,
          exertNote: null,
          reason: null,
          openedBy: null,
        },
      ],
      edges: [],
      travel: null,
      known: 1,
      total: 1,
    };
  }

  // WAVE B. All three read wave A and nothing from each other. travelOptions
  // and routesWithinZone are handed `graph`, so they make no read of Location
  // or LocationLink where they used to make three. Underground each still asks
  // the Caving Die once (cavingRestrictionsFor — the hold and the severity-10 stop),
  // so a caver's map costs two small counts; on the surface, none.
  // The tags that open a gated way, by name, for the hover on its line
  // (Map.docx). Only the slugs some way actually names — a dozen rows.
  const gateSlugs = [...new Set(links.map((l) => l.requiredTagSlug).filter(Boolean))];
  const [neighbours, walks, inside, gateTags, ringRoles, headcounts] = await Promise.all([
    // Same call the Travel panel makes, so the two never disagree about a hop.
    character?.locationId ? travelOptions(prisma, character, character.locationId, { graph }) : [],
    // Everywhere in their own zone they could WALK to (MAP.md §3c). Fed the very
    // set `visible()` below reads, so a walkable node is always one the board was
    // already drawing — no new row ships, and the fog rule of §6b is untouched.
    character?.locationId ? routesWithinZone(prisma, character, { known: known.seen, graph }) : [],
    // Only places they have stood — a room is a door you must have stood in front of.
    roomsInside(prisma, character, unfogged, known.stood, { keys, conversations }),
    gateSlugs.length
      ? prisma.tag.findMany({ where: { slug: { in: gateSlugs } }, select: { slug: true, name: true } })
      : [],
    // Which door tokens a seat's signet ring carries (docs/systemdocs/RINGS.md):
    // a way keyed to one of those opens to the ring as well as to the key.
    gateSlugs.length
      ? prisma.role.findMany({ where: { ringAccessSlugs: { hasSome: gateSlugs } }, select: { ringAccessSlugs: true } })
      : [],
    // How many people are at the places this character is watching — where they
    // stand and the lit streets in this zone, and nowhere else (MAP.md §6j).
    // Theirs even on a GM's Show all: that lifts the fog, not the rule here.
    mapHeadcounts(prisma, character, standing),
  ]);
  const gateNames = new Map(gateTags.map((t) => [t.slug, t.name]));
  const ringTokens = new Set(ringRoles.flatMap((r) => r.ringAccessSlugs ?? []));
  const adjacent = new Map(neighbours.map((row) => [row.location.id, row]));
  const walkTo = new Map(walks.map((row) => [row.location.id, row]));

  // Self-healing: applyLocationMoveSideEffects's post-commit write can drop, so
  // re-recording here closes that gap. NOT awaited, and handed the neighbour
  // list above so it costs two writes and no read — it repairs the NEXT load,
  // never this one, and a player should not wait on somebody else's dropped
  // write. `known` was read in wave A, so the standing place's own row can be
  // one load behind: harmless, because `here` already draws that node stood.
  if (character?.locationId) {
    void recordArrival(prisma, character, character.locationId, { neighbours }).catch(() => {});
  }

  // roomAccessKeys' held set already counts the worn ring's doors (docs/systemdocs/RINGS.md).
  const heldPlain = new Set((character?.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
  const tagSlugs = keys?.heldSlugs ?? heldPlain;
  const onFootBlocked = blocksOnFoot(character?.tags);
  // One clock for the whole graph, so a way can't lapse halfway through the loop.
  const now = new Date();

  const visible = (id) => unfogged || known.seen.has(id) || adjacent.has(id);

  // THE MAP IS A MEMORY (Map.docx; db/lib/mapMemory.js), so Concussed and
  // Amnesiac scramble it the way they scramble /memories (MEMORIES.md §6) —
  // same seed, same three-in-four roll for every word, nothing stored. A
  // place's name and description come out with most of their words garbled;
  // the real ones are never sent. A GM's Show all is not a memory and is
  // never scrambled.
  const scramble = character && !unfogged
    ? scrambleState({ characterId: character.id, tags: character.tags, dayNumber: openTurn?.dayNumber ?? 0 })
    : { active: false };
  const recall = new Map();
  const remembered = (location) => {
    let row = recall.get(location.id);
    if (!row) {
      row = scrambleFields(scramble, `place:${location.id}`, {
        name: location.name,
        description: location.description || "",
      });
      recall.set(location.id, row);
    }
    return row;
  };

  const nodes = [];
  for (const location of locations) {
    if (!visible(location.id)) continue;
    // Which plate draws this place, and where on it — null for the ones no
    // plate has yet. That is NOT a reason to drop the row: the Caves and the
    // Depths are real places a character can walk to, and a dropped row is a
    // place with no card and no way out of the room.
    const at = plateOf(location.slug);

    const here = Boolean(character?.locationId && location.id === character.locationId);
    const near = adjacent.get(location.id) ?? null;
    const walk = walkTo.get(location.id) ?? null;
    const stood = unfogged || known.stood.has(location.id);
    const freeLeft = near ? freeMovesLeft(character, config, openTurn, party.length) : null;
    // The server's own refusal of a push on here, asked ahead of time
    // (MAP.md §3); null is yes. Same question the Travel panel asks per
    // option, and the reason is shown once the Move is spent and this was
    // the only way across.
    const exertWhy = near?.crossesZone
      ? exertRefusal(character, config, openTurn, { left: freeLeft, cost: near.cost, acted })
      : null;

    const memory = remembered(location);
    nodes.push({
      id: location.id,
      slug: location.slug,
      name: memory.name,
      // Drawn in a quieter hand on the board, so a garbled name reads as a
      // memory slipping rather than as a place really called that.
      scrambled: memory.scrambled || undefined,
      zoneName: location.zone?.name ?? null,
      zoneKey: zoneKey(location.zone?.name) ?? "none",
      plate: at?.plate ?? null,
      x: at?.x ?? null,
      y: at?.y ?? null,
      state: here ? "here" : stood ? "stood" : "seen",
      // Absent, not 0, for a place they are not watching.
      headcount: headcounts.get(location.id),
      // `near.passable`, NOT `near`: a locked/shut way is visible but blocked,
      // and its description stays hidden until it's actually open.
      description: stood || near?.passable ? memory.description || null : null,
      // Rooms/conversations only where actually stood — see roomsInside().
      inside: inside.get(location.id) ?? null,
      adjacent: Boolean(near),
      passable: Boolean(near?.passable),
      // Reachable on foot inside this zone, through places they already know.
      // The board's Go reads this as well as `passable`; the DOUBLE-CLICK reads
      // it and nothing else, which is what keeps a gesture off every crossing.
      walkable: Boolean(walk),
      walkHops: walk?.hops ?? null,
      // The stops on the way, named before they commit — the guard that makes
      // the gesture safe (MAP.md §6c). Never the destination itself.
      walkThrough: walk ? walk.path.slice(0, -1).map((l) => remembered(l).name) : null,
      // A tight squeeze on the road, or AS the road (MAP.md §2a). Said to
      // everybody, not only the Giant it refuses, so a party can see where
      // its Giant friend cannot follow.
      walkTightSqueeze: Boolean(walk?.tightSqueeze),
      tightSqueeze: Boolean(near?.tightSqueeze),
      crossesZone: Boolean(near?.crossesZone),
      // What the crossing spends in travel — ½ between the town zones, 1
      // anywhere else (db/lib/crossingCost.js), 0 inside the zone.
      cost: near?.cost ?? 0,
      freeLeft,
      // Whether Push on belongs on the card for this crossing (MAP.md §3).
      canExert: Boolean(near?.crossesZone && exertWhy === null),
      exertWhy,
      // Which way the push on's die leans, said before they commit. Null when
      // it doesn't; the same sentence the Travel panel carries.
      exertNote: near?.crossesZone ? exertEdgeSentence(exertEdgeFor(character?.tags ?? [])) : null,
      reason: near?.refusal ?? null,
      // Same field the Travel panel draws a chip from; only ever set for a tag this character already holds.
      openedBy: near?.openedBy ?? null,
    });
  }

  const shown = new Set(nodes.map((n) => n.id));
  const placeById = new Map(locations.map((l) => [l.id, l]));

  // Draws only when both ends are known AND the way is LISTED (MAP.md §2a):
  // `listed` is weaker than `passable`, so a locked door draws dashed but a hidden crawl draws nothing.
  //
  // A STAIR needs only one end (MAP.md §6g). A way to the other plate is part
  // of the place it leaves from, so knowing the Square is knowing its stair
  // down to the Slums. Such a way draws no line and sends no node for the far
  // side: `stairsAt` carries the near place's id and the far side's name only.
  const edges = [];
  const stairsAt = [];
  for (const link of links) {
    const knowA = shown.has(link.aId);
    const knowB = shown.has(link.bId);
    if (!knowA && !knowB) continue;
    const oneEnd = knowA !== knowB;
    const near = placeById.get(knowA ? link.aId : link.bId);
    const far = placeById.get(knowA ? link.bId : link.aId);
    if (oneEnd) {
      const nearPlate = plateOf(near?.slug ?? "")?.plate;
      const farPlate = plateOf(far?.slug ?? "")?.plate;
      if (!nearPlate || !farPlate || nearPlate === farPlate) continue;
    }
    const verdict = crossingCheck(link, { tagSlugs, onFootBlocked, now });
    // The GM sees every way; only the `listed` filter is lifted.
    if (!hiddenWays && !verdict.listed) continue;
    // A scrambled way comes off the board, except one touching where they
    // stand: what is next door is in front of them, not remembered (Map.docx).
    // The Ways out list and every travel check are untouched — this is only
    // what is DRAWN. A way has no words, so it rolls as one: the stand-in "x"
    // is a single word, lost three times in four.
    const touchesHere = link.aId === character?.locationId || link.bId === character?.locationId;
    if (!touchesHere && scrambleText(scramble, `way:${link.id}`, "x").scrambled) continue;
    if (oneEnd) {
      // Through `remembered`, so a scrambled memory garbles this name the
      // way it garbles every other place name on the board.
      stairsAt.push({ at: near.id, name: remembered(far).name });
      continue;
    }
    edges.push({
      a: link.aId,
      b: link.bId,
      gate: gateOf(link, verdict),
      // A way the worn ring opened names the ring, not the old key (docs/systemdocs/RINGS.md).
      openedBy: verdict.openedBy && !heldPlain.has(verdict.openedBy) ? RING_SLUG : (verdict.openedBy ?? null),
      // Drawn pinched on the board for everybody (MAP.md §2a).
      squeeze: Boolean(link.tightSqueeze),
      // What opens it, for the hover on the line (Map.docx). Only ever on a way
      // already in this payload, so a hidden crawl the character cannot use is
      // never named — it was dropped above with the rest of it.
      needs: link.requiredTagSlug
        ? { name: gateNames.get(link.requiredTagSlug) ?? link.requiredTagSlug, ring: ringTokens.has(link.requiredTagSlug) }
        : null,
      // Only on Show all, where a hidden way is drawn for a GM who holds nothing:
      // without it a hidden crawl and a locked door looked the same.
      hidden: hiddenWays && link.hidden ? true : undefined,
    });
  }

  // Only the plates holding something this character knows. Offering the
  // second one before that would say Undertown exists, which is the kind of
  // thing the fog is for.
  const shownPlates = plates().filter((p) => nodes.some((n) => n.plate === p.id));

  return {
    ok: true,
    plates: shownPlates,
    you: {
      locationId: character?.locationId ?? null,
      plate: plateOf(locations.find((l) => l.id === character?.locationId)?.slug ?? "")?.plate ?? null,
      gm: unfogged,
      canReveal,
    },
    nodes,
    edges,
    stairsAt,
    travel: character
      ? {
          held: heldReasonFor(character),
          freeLeft: freeMovesLeft(character, config, openTurn, party.length),
          freeReason: freeZoneMovesReason(character, party.length, { config, openTurn }),
          // The two halves of that count and their sentence, for the card's
          // line and the confirm (MAP.md §3a) — built here, MapBoard is a client.
          breakdown: freeMovesBreakdown(character, config, openTurn, party.length),
          travelLine: travelSentence(freeMovesBreakdown(character, config, openTurn, party.length)),
          partySize: party.length,
          // The Move already spent this turn: Go leaves the card and the push
          // on is the only way across a zone with no travel left (MAP.md §3).
          moved: acted,
        }
      : null,
    known: nodes.length,
    total: locations.length,
  };
}

// Public rooms, private rooms they may enter, and their own conversations.
// Private filter is accessibleRooms(), the SAME predicate the channel doctor,
// Secret rooms? and Transfer use — no second copy of that rule here.
// `keys` and `conversations` are handed in rather than fetched — they depend on
// the character alone, so buildMap asks for them in its first wave and this is
// left with one query.
async function roomsInside(prisma, character, unfogged, stoodIds, { keys, conversations }) {
  const ids = unfogged ? undefined : [...stoodIds];
  if (!unfogged && ids.length === 0) return new Map();

  const rooms = await prisma.room.findMany({
    where: { retiredAt: null, ...(ids ? { locationId: { in: ids } } : {}) },
    select: { id: true, name: true, kind: true, locationId: true, accessTagSlugs: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const allowed = unfogged
    ? rooms
    : accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds);

  const out = new Map();
  const at = (id) => {
    if (!out.has(id)) out.set(id, { public: [], private: [], conversations: [] });
    return out.get(id);
  };
  for (const id of ids ?? rooms.map((r) => r.locationId)) at(id);
  for (const room of allowed) {
    const bucket = at(room.locationId);
    (room.kind === "PRIVATE" ? bucket.private : bucket.public).push(room.name);
  }
  for (const thread of conversations) {
    if (!thread.locationId) continue;
    if (!unfogged && !stoodIds.has(thread.locationId)) continue;
    at(thread.locationId).conversations.push(thread.name || "A conversation");
  }
  return out;
}

// What to draw the line as. Only states a player can DO something about get a mark.
function gateOf(link, verdict) {
  if (verdict.passable) return null;
  if (link.modular && !link.isOpen) return "shut";
  if (link.requiredTagSlug) return "locked";
  return "closed";
}
