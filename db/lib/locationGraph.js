// The travel graph — the ONE place that reads LocationLink, so no caller has to remember an edge is a single undirected row that could have this location on either side. Every surface offering a destination and every crossing check comes through here: db/lib/locationTravel.js#performLocationMove, the bot's Travel picker, the escort per-follower check (MAP.md §3a), and the modular gate button — gating is not cosmetic: a hidden edge must be genuinely absent from a list, and a locked one must refuse server-side even when a client sends its id directly. Deliberately NOT on the @lifeweb/db barrel; require it by path.
const { heldTagSlugs, withRingTokens } = require("./roomAccess");
const { RING_SLUG } = require("./rings");
const { blocksOnFoot, equippedSlugs } = require("./mounts");
const { heldReasonFor } = require("./intercept");
const { cavingRestrictionsFor, cavingRefusalFor } = require("./cavingPass");
const { crossingCost } = require("./crossingCost");
const { travelLockReason, lockedTravelSentence } = require("./turnGate");

// The two endpoints of a link, oriented so `near` is the side you're standing on. Callers only ever want `far`.
function endpoints(link, locationId) {
  const nearIsA = link.aId === locationId;
  return {
    near: nearIsA ? link.a : link.b,
    far: nearIsA ? link.b : link.a,
  };
}

// Canonical endpoint order for a NEW row: ascending slug, so an attribute can never disagree between directions and a modular gate can't end up open one way and shut the other. The sync is the only writer.
function orderEndpoints(slugA, idA, slugB, idB) {
  return slugA <= slugB ? { aId: idA, bId: idB } : { aId: idB, bId: idA };
}

const LINK_INCLUDE = {
  a: { include: { zone: true } },
  b: { include: { zone: true } },
};

async function linksFor(prisma, locationId) {
  if (!locationId) return [];
  return prisma.locationLink.findMany({
    where: { OR: [{ aId: locationId }, { bId: locationId }] },
    include: LINK_INCLUDE,
  });
}

// ONE read of the whole graph, for a caller that asks more than one question
// of the same edges in a single request. /map asks three — what is adjacent,
// what can be walked to, and what to draw — and each used to pay its own round
// trip for the same few dozen rows. Hand the result back in as `graph` to
// resolveNeighbors / travelOptions / routesWithinZone and they share this one
// read instead. NOT a cache: it is request-scoped by being an argument, so
// nothing here can answer with a stale edge.
//
// Locations come back WHOLE rather than as the union of three lean selects —
// ~56 rows, so one wide read beats keeping a second shape in agreement with
// this one.
async function loadGraph(prisma) {
  const [rows, all] = await Promise.all([
    // Endpoints are joined from `byId` below rather than included per row. An
    // `include: LINK_INCLUDE` here is four more round trips — Prisma resolves a
    // relation with its own query, and a and b each drag a Location and a Zone
    // — for rows the Location read beside it already has in hand.
    prisma.locationLink.findMany(),
    // Retired places included, and split rather than filtered: a link may still
    // point at one, and an endpoint that resolved to undefined would throw
    // where the old per-row include quietly handed the retired row back.
    prisma.location.findMany({ include: { zone: true } }),
  ]);
  const byId = new Map(all.map((loc) => [loc.id, loc]));
  const links = rows.map((link) => ({ ...link, a: byId.get(link.aId) ?? null, b: byId.get(link.bId) ?? null }));
  return { links, locations: all.filter((loc) => loc.retiredAt === null), byId };
}

// The edges touching one location, out of an already-loaded graph. The same rows linksFor would have returned, ways to a retired place included — that filter has never been here, and adding one would be a rule change in disguise.
function linksAt(graph, locationId) {
  if (!locationId) return [];
  return graph.links.filter((link) => link.aId === locationId || link.bId === locationId);
}

// One link between two specific locations, whichever way round it is stored.
async function linkBetween(prisma, locationId, otherLocationId) {
  if (!locationId || !otherLocationId) return null;
  return prisma.locationLink.findFirst({
    where: {
      OR: [
        { aId: locationId, bId: otherLocationId },
        { aId: otherLocationId, bId: locationId },
      ],
    },
    include: LINK_INCLUDE,
  });
}

// Is a keyed edge currently propped open? Nothing closes one — the window simply lapses, which is why this is a comparison and not a stored flag.
function isHeldOpen(link, now = new Date()) {
  return Boolean(link?.openUntil && link.openUntil.getTime() > now.getTime());
}

// Should this crossing raise the "Leave open for 24 hours?" prompt? Only for somebody who actually holds the key — propping a door is the key-holder's decision, not a courtesy inherited by whoever walks through — and only while shut, so a stream of traffic through an open way doesn't re-ask every one of them.
function shouldPromptKeyed(link, { tagSlugs, now = new Date() } = {}) {
  if (!link?.keyed || !link.requiredTagSlug) return false;
  if (isHeldOpen(link, now)) return false;
  const held = tagSlugs instanceof Set ? tagSlugs : new Set(tagSlugs ?? []);
  return held.has(link.requiredTagSlug);
}

// TIGHT SQUEEZE: fixed to the one tag it blocks, unconditionally — see the
// field-doc block on LocationLink.tightSqueeze in schema.prisma.
const GIANT_TAG_SLUG = "giant";

// The pure predicate: may a character holding `tagSlugs` cross this edge right now? Separated from the queries so the picker, mover and re-validation all reach the identical verdict from already-loaded data. `listed` is weaker than `passable`: a LOCKED edge is listed and refuses (so a player can see the door and learn they need the key), while a HIDDEN edge is not listed at all. A propped-open keyed edge satisfies its own tag requirement, which also makes a hidden one listed — deliberate: a door somebody held open must be visible to whoever is meant to follow them through it. `onFootBlocked` is the ONE input here about tags-you-have-out, not tags-you-hold — pass it from blocksOnFoot(equippedSlugs(tags)); an arelitz or cart in your pocket is not one you're riding or pushing.
function crossingCheck(link, { tagSlugs, onFootBlocked = false, now = new Date() } = {}) {
  if (!link) {
    return { listed: false, passable: false, refusal: "You can't get there directly from here." };
  }

  const held = tagSlugs instanceof Set ? tagSlugs : new Set(tagSlugs ?? []);
  const hasTag = !link.requiredTagSlug || held.has(link.requiredTagSlug) || isHeldOpen(link, now);
  // Which of THEIR OWN tags opens this way, for a surface that wants to say so. Deliberately not `hasTag`, which is also true of a keyed way someone else propped open — walking through a door another player wedged isn't your trait opening it. Only ever a tag they hold, so it leaks nothing, and it's absent from every refusing branch below, so a locked way says no more than it did.
  const openedBy =
    link.requiredTagSlug && held.has(link.requiredTagSlug) ? link.requiredTagSlug : null;

  if (link.hidden && !hasTag) {
    // Same wording a nonexistent edge gets, deliberately: a refusal that read differently would tell a player the hidden way is there.
    return { listed: false, passable: false, refusal: "You can't get there directly from here." };
  }
  // A tight squeeze is said to EVERYBODY on every listed branch, Giant or not, passable or not — unlike `openedBy`, which rides only the passable ones. The flag is never a secret (a squeeze is listed, never hidden), and the person who most needs to see it is the one it does not touch: a party leader walking their Giant friend to a hole the friend will be refused at (MAP.md §2a "Tight squeeze"). It says nothing about the lock a refusing branch is keeping quiet about, so it leaks nothing a refusal did not already.
  const tightSqueeze = Boolean(link.tightSqueeze);
  if (!hasTag) {
    return { listed: true, passable: false, refusal: "This way isn't open to you.", tightSqueeze };
  }
  if (tightSqueeze && held.has(GIANT_TAG_SLUG)) {
    return { listed: true, passable: false, refusal: "You're too big to fit through here.", tightSqueeze };
  }
  if (link.modular && !link.isOpen) {
    return {
      listed: true,
      passable: false,
      refusal: "The way is shut. Somebody in the watchtower would have to work the winch.",
      tightSqueeze,
    };
  }
  // Dismounts the traveller rather than refusing — db/lib/indoors.js's dismountForNarrowWay, called from applyLocationMoveSideEffects too, for a move that did not come through the mover. `dismounts` is surfaced so the picker can say so before anyone commits.
  if (link.onFoot && onFootBlocked) {
    return { listed: true, passable: true, refusal: null, dismounts: true, openedBy, tightSqueeze };
  }
  return { listed: true, passable: true, refusal: null, dismounts: false, openedBy, tightSqueeze };
}

// Does this edge have a gate to work at all? Only a modular edge does. The gate button renders off this, on the WATCHTOWER at the gate (db/lib/roomStarterRow.js) — getting into that room is the whole permission model (anyone who can see the winch may pull it), so there's no second predicate here; toggleGate only re-checks the clicker is standing at the gate.
function gateOperable(link) {
  return Boolean(link?.modular);
}

// The destination list for one character standing in one location, already gated, sorted by zone then the location's authoring order. `character` needs id and either a loaded `tags` (as CHARACTER_SELECT shapes it) or nothing, in which case tags are queried. Returns [{ location, link, listed, passable, refusal, crossesZone }] — callers rendering a list must filter on `listed` themselves, since the mover wants the unlisted rows too to refuse correctly. A character already on the road gets every ZONE CROSSING shut, named in the refusal (MAP.md §3); hops inside their own zone are untouched, since a paid crossing costs the day, not the ability to walk across town. Doing this here rather than in each picker is what keeps the map, /chat panel, and bot list from ever disagreeing about a hop — same reason the gates live here.
async function resolveNeighbors(prisma, character, locationId, { fromZoneId = null, graph = null } = {}) {
  const links = graph ? linksAt(graph, locationId) : await linksFor(prisma, locationId);
  if (links.length === 0) return [];

  // Loaded in the shape equippedSlugs expects, not the cheaper flat set: heldTagSlugs returns BARE slugs with no equip state, and a stowed arelitz must not read as a mount.
  const tags =
    character?.tags ??
    (character?.id
      ? await prisma.characterTag.findMany({
          where: { characterId: character.id },
          select: { equipped: true, tag: { select: { slug: true } } },
        })
      : []);
  // Plus the worn ring's doors (docs/systemdocs/RINGS.md) — a caller's own select never carries them.
  const tagSlugs = await withRingTokens(prisma, character?.id, tags);
  const heldPlain = new Set(tags.map((ct) => ct.tag?.slug).filter(Boolean));
  const onFootBlocked = blocksOnFoot(equippedSlugs(tags));

  const zoneId = fromZoneId ?? character?.zoneId ?? null;
  // One clock for the whole list, so a propped-open way cannot lapse halfway down it and show as both open and shut in one render.
  const now = new Date();

  // Somebody has hold of them (docs/systemdocs/INTERCEPT.md). Pure — one comparison against Character.heldUntil, no query — so every picker draws the refusal the mover is about to give, instead of the server refusing after a click.
  // …and so is everybody once Moves lock (turnGate.js#travelLockReason), the same way: every way drawn
  // shut, with the sentence the mover is about to refuse with — Caving.docx's own for a way into the caves.
  const interceptHold = heldReasonFor(character, now);
  const locked = interceptHold ? null : await travelLockReason(prisma, { now });

  const rows = links
    .map((link) => {
      const { near, far } = endpoints(link, locationId);
      const crossesZone = Boolean(zoneId) && far.zoneId !== zoneId;
      const row = {
        location: far,
        link,
        crossesZone,
        // What the crossing spends in travel (db/lib/crossingCost.js): ½
        // between the town zones, 1 anywhere else, 0 inside a zone. Stamped
        // here so every picker quotes the same number the mover charges.
        cost: crossesZone ? crossingCost(near?.zone?.slug, far.zone?.slug) : 0,
        ...crossingCheck(link, { tagSlugs, onFootBlocked, now }),
      };
      // A way the worn ring opened, not a key in hand: name the ring
      // (docs/systemdocs/RINGS.md) — the old key's name would be a key they
      // don't have.
      if (row.openedBy && !heldPlain.has(row.openedBy)) row.openedBy = RING_SLUG;
      // Being held shuts every way out, not just zone crossings — an ambush is a hand on your shoulder (INTERCEPT.md). `listed` is deliberately left alone: the way still draws, just SHUT with why, rather than vanishing and reading like it never existed.
      if (interceptHold || locked) {
        row.passable = false;
        row.refusal = interceptHold ?? lockedTravelSentence(far.zone?.kind);
      }
      return row;
    })
    .sort(
      (x, y) =>
        (x.location.zone?.sortOrder ?? 0) - (y.location.zone?.sortOrder ?? 0) ||
        (x.location.zone?.name ?? "").localeCompare(y.location.zone?.name ?? "") ||
        x.location.sortOrder - y.location.sortOrder ||
        x.location.name.localeCompare(y.location.name),
    );

  // A 1 on the Caving Die this turn shuts the ways UP to the surface, leaving the Caves and the Depths open to each other (CAVING.md §2c) — the whole difference from being held, and why it's applied here rather than above. A result of severity 10 shuts every way (§2e), the next room included, in its own words. One query, and only underground, so a picker anywhere on the surface pays nothing.
  const standingKind = links.length > 0 ? endpoints(links[0], locationId).near?.zone?.kind : null;
  if (character?.id && standingKind === "CAVE_LEVEL") {
    const caving = await cavingRestrictionsFor(prisma, character.id, standingKind);
    if (caving.stuck || caving.hold) {
      for (const row of rows) {
        const refusal = cavingRefusalFor(caving, row.location.zone?.kind);
        if (!refusal) continue;
        row.passable = false;
        row.refusal = refusal;
      }
    }
  }

  return rows;
}

async function travelOptions(prisma, character, locationId, opts) {
  return (await resolveNeighbors(prisma, character, locationId, opts)).filter((row) => row.listed);
}

// How far a shout carries, in hops. Everything past this hears nothing. Three (Bascinet's call — the far ring carried too much and said too little).
const SOUND_HOPS = 3;

// Who can hear a noise made at `originLocationId`, and which way it came from — the only multi-hop question in this file, allowed here because nothing outside this module may read LocationLink. EVERY EDGE COUNTS: locked, hidden, shut, on-foot — sound doesn't care, because none of those are about sound; deliberately the one traversal that never calls crossingCheck. Returns [{ locationId, name, discordChannelId, distance, viaName }], sorted nearest first, origin included at distance 0. `viaName` is the HEARER's own neighbour on the shortest path back (the next step toward the noise, never the noise itself) — the whole privacy rule: a shout tells you which way to run, not who or how far.
async function soundRange(prisma, originLocationId, maxHops = SOUND_HOPS) {
  if (!originLocationId) return [];

  // One query for the whole graph — ~56 Locations and a few dozen edges, so paying per-hop for linksFor() would be more round trips than rows.
  const [links, locations] = await Promise.all([
    prisma.locationLink.findMany({ select: { aId: true, bId: true, hidden: true } }),
    prisma.location.findMany({ where: { retiredAt: null }, select: { id: true, slug: true, name: true, discordChannelId: true } }),
  ]);

  const byId = new Map(locations.map((loc) => [loc.id, loc]));
  const adjacency = new Map();
  const link = (from, to, hidden) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ id: to, hidden });
  };
  for (const edge of links) {
    link(edge.aId, edge.bId, edge.hidden);
    link(edge.bId, edge.aId, edge.hidden);
  }
  // Sorted by slug so a tie between two equally-short ways back resolves the same on every run — otherwise one shout could name a different direction than the next for no reason a player could see.
  for (const [, list] of adjacency) {
    list.sort((x, y) => (byId.get(x.id)?.slug ?? "").localeCompare(byId.get(y.id)?.slug ?? ""));
  }

  const out = [];
  const seen = new Set([originLocationId]);
  // `via` is the hearer's own step BACK toward the origin, always the node this one was reached FROM — BFS guarantees that's exactly one hop nearer the origin. No path reconstruction needed.
  let frontier = [{ id: originLocationId, via: null, viaHidden: false }];

  for (let distance = 0; distance <= maxHops && frontier.length > 0; distance += 1) {
    const next = [];
    for (const node of frontier) {
      const loc = byId.get(node.id);
      if (loc) {
        out.push({
          locationId: node.id,
          name: loc.name,
          discordChannelId: loc.discordChannelId,
          distance,
          // NULL when the step back runs through a HIDDEN edge. Sound still carries (the row stays), but the DIRECTION is withheld, since naming it would reveal a way exists where none was said to — a hidden edge is absent from every travel list for exactly that reason (crossingCheck below), and a shout must not be the hole in it.
          viaName:
            node.viaHidden
              ? null
              : node.via
                ? (byId.get(node.via)?.name ?? null)
                : null,
        });
      }
      if (distance === maxHops) continue;
      for (const neighbor of adjacency.get(node.id) ?? []) {
        if (seen.has(neighbor.id)) continue;
        seen.add(neighbor.id);
        // Only the hearer's OWN step counts, deliberately not sticky: the direction names one adjacent Location and nothing else, so nothing is given away if that neighbour is reachable by an open way — a shout from deep in the caves should still say which way down the road it came from.
        next.push({ id: neighbor.id, via: node.id, viaHidden: neighbor.hidden });
      }
    }
    frontier = next;
  }

  return out;
}

// ------------------------------------------------- walking across a zone

// How many hops a walk may be. A safety rail, not a game rule: zones hold well
// under a dozen Locations, so the BFS is naturally bounded, and this only stops
// a mistake in the graph turning into a thirty-hop run of Discord calls.
const WALK_HOPS = 8;

// One sentence for every "there is no walk there", whatever the reason — the
// place is unknown, it is in another zone, the only way is a hidden crawl, or a
// gate is shut across the middle of it. Same discipline as crossingCheck's
// hidden branch (MAP.md §2a): a refusal that read differently for a hidden way
// would announce the way is there.
const NO_WALK = "You don't know a way there.";

// Asking to walk to the ground you are already standing on. Its OWN sentence,
// never NO_WALK: a picker that has gone stale — you moved on the bot, or an
// escort carried you, or another tab already took the hop — sends the id of the
// place you are now in, and answering that with the fog line reads as the game
// having forgotten the road you can see. It leaks nothing; a place you are
// standing in is not a place you could be told about.
const ALREADY_THERE = "You're already there.";

// Every place this character could WALK to inside their own zone: the shortest
// known, passable route to each, origin excluded from the path and destination
// last. The second multi-hop question in this file, and allowed here for the
// same reason soundRange is — nothing outside this module may read LocationLink.
//
// `known` is the character's FOG, handed in rather than read. That is
// mandatory, not a style: db/lib/locationVisits.js already requires this module,
// so requiring it back would close a cycle and resolve to a half-built exports
// object at require time. Callers pass knownLocations(...).seen — `seen` and not
// `stood`, because web/app/(app)/map/actions.js already draws the board off
// `seen`, and a finder using the narrower set would refuse a rhombus the player
// can see for a reason they cannot.
//
// Nothing here re-derives a gate: every edge is judged by crossingCheck, the
// very verdict performLocationMove reaches again per hop. The Caving Die's
// HOLD is deliberately NOT asked — it only ever shuts a way up out of the
// caves, which a same-zone walk never takes, so the mover asks it, in its own
// words, at the hop that meets it, and a copy here would be a second rule to
// keep in agreement. Its STOP is asked (CAVING.md §2e), once, up front and
// only underground, for the reason a HOLD is asked once up front: it shuts
// every way, adjacent or not, so a stopped character has no first hop to take
// and there is no walk to offer — not a per-edge re-check, just the one
// predicate resolveNeighbors already calls the same way. Being held
// (INTERCEPT.md) is the same shape and asked the same way.
async function routesWithinZone(prisma, character, { known, maxHops = WALK_HOPS, graph = null } = {}) {
  const from = character?.locationId ?? null;
  const zoneId = character?.zoneId ?? null;
  if (!from || !zoneId) return [];
  if (heldReasonFor(character)) return [];
  if (await travelLockReason(prisma)) return [];

  const knownIds = known instanceof Set ? known : new Set(known ?? []);

  // An already-loaded graph answers both of these with no round trip at all. The
  // same-zone rule is applied in memory rather than dropped, so this branch and
  // the WHERE below mean exactly the same thing.
  const [links, locations] = graph
    ? [graph.links, graph.locations.filter((loc) => loc.zoneId === zoneId)]
    : await Promise.all([
      prisma.locationLink.findMany({
        // Exactly what crossingCheck and isHeldOpen read, plus the endpoints.
        select: {
          id: true,
          aId: true,
          bId: true,
          hidden: true,
          requiredTagSlug: true,
          modular: true,
          isOpen: true,
          keyed: true,
          onFoot: true,
          tightSqueeze: true,
          openUntil: true,
        },
      }),
      // The same-zone rule falls out of this WHERE rather than being re-checked
      // per node, so a route can never leave the zone and come back through a
      // Location nobody looked at.
      prisma.location.findMany({
        where: { zoneId, retiredAt: null },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          sortOrder: true,
          indoors: true,
          attributes: true,
          zoneId: true,
          zone: { select: { id: true, name: true, slug: true, kind: true, sortOrder: true } },
        },
      }),
    ]);

  const byId = new Map(locations.map((loc) => [loc.id, loc]));
  // Standing here counts whether or not a visit row says so — you are looking
  // at the place. Everywhere else has to be somewhere they already know.
  const usable = (id) => byId.has(id) && (id === from || knownIds.has(id));
  if (!usable(from)) return [];

  // A caving result of severity 10 and there is no walk at all (CAVING.md
  // §2e). Asked only underground, off the very Location rows just loaded, so a
  // surface walker pays no query for a rule that cannot apply to them.
  const standingKind = byId.get(from)?.zone?.kind;
  if (character?.id && standingKind === "CAVE_LEVEL") {
    const caving = await cavingRestrictionsFor(prisma, character.id, standingKind);
    if (caving.stuck) return [];
  }

  // Equip-shaped, not the flat set: heldTagSlugs returns bare slugs and a stowed
  // an arelitz would read as one you are riding (MAP.md §2c).
  const tags =
    character?.tags ??
    (character?.id
      ? await prisma.characterTag.findMany({
          where: { characterId: character.id },
          select: { equipped: true, tag: { select: { slug: true } } },
        })
      : []);
  // Plus the worn ring's doors (docs/systemdocs/RINGS.md) — a caller's own select never carries them.
  const tagSlugs = await withRingTokens(prisma, character?.id, tags);
  const onFootBlocked = blocksOnFoot(equippedSlugs(tags));
  // One clock for the whole traversal, the way resolveNeighbors takes one, so a
  // propped keyed way cannot lapse halfway down the search and be both open and
  // shut in a single route.
  const now = new Date();

  const slugOf = (id) => byId.get(id)?.slug ?? "";
  const adjacency = new Map();
  const join = (a, b, verdict) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a).push({ id: b, dismounts: Boolean(verdict.dismounts), tightSqueeze: Boolean(verdict.tightSqueeze) });
  };
  for (const link of links) {
    if (!usable(link.aId) || !usable(link.bId)) continue;
    const verdict = crossingCheck(link, { tagSlugs, onFootBlocked, now });
    if (!verdict.passable) continue;
    join(link.aId, link.bId, verdict);
    join(link.bId, link.aId, verdict);
  }
  // Sorted by slug so two equally short roads always resolve to the same one —
  // soundRange's reason, sharper here: the surface that SHOWS the route and the
  // walk that takes it must agree, or somebody is shot by a turret they were
  // never told they would pass.
  for (const [, list] of adjacency) {
    list.sort((x, y) => slugOf(x.id).localeCompare(slugOf(y.id)));
  }

  const prev = new Map();
  const dismountBy = new Map([[from, false]]);
  // Same shape as dismountBy: a walk that goes through a tight squeeze at any hop is a walk a Giant companion cannot finish, and the party leader is told so before they commit rather than after the Giant is refused mid-road.
  const squeezeBy = new Map([[from, false]]);
  // Which hop first reached each place — a later road of the SAME length may
  // still take it over (below); a longer one never does.
  const claimedAt = new Map([[from, 0]]);
  const found = [];
  let frontier = [from];

  const take = (nodeId, neighbor) => {
    prev.set(neighbor.id, nodeId);
    // Sticky: a route that took your arelitz off you at hop 2 is still a
    // route you finish on foot.
    dismountBy.set(neighbor.id, Boolean(dismountBy.get(nodeId)) || neighbor.dismounts);
    squeezeBy.set(neighbor.id, Boolean(squeezeBy.get(nodeId)) || neighbor.tightSqueeze);
  };

  for (let hops = 1; hops <= maxHops && frontier.length > 0; hops += 1) {
    const next = [];
    for (const nodeId of frontier) {
      for (const neighbor of adjacency.get(nodeId) ?? []) {
        const at = claimedAt.get(neighbor.id);
        if (at !== undefined) {
          // Two roads equally short, and the one already found goes through a
          // tight squeeze this one avoids: walk the clear one, so a party is
          // never led to lose its Giant when it had no need to (MAP.md §2a).
          // Still deterministic — the frontier is walked in slug order, so the
          // same clear road wins every time.
          if (at === hops && squeezeBy.get(neighbor.id) && !squeezeBy.get(nodeId) && !neighbor.tightSqueeze) {
            take(nodeId, neighbor);
          }
          continue;
        }
        claimedAt.set(neighbor.id, hops);
        take(nodeId, neighbor);
        next.push(neighbor.id);
        found.push({ id: neighbor.id, hops });
      }
    }
    // The next level is walked in slug order too, so which node claims a
    // contested neighbour never depends on the order rows came back in.
    next.sort((x, y) => slugOf(x).localeCompare(slugOf(y)));
    frontier = next;
  }

  const pathTo = (id) => {
    const steps = [];
    for (let at = id; at && at !== from; at = prev.get(at)) steps.unshift(byId.get(at));
    return steps;
  };

  return found
    .map((row) => ({
      location: byId.get(row.id),
      hops: row.hops,
      path: pathTo(row.id),
      dismounts: Boolean(dismountBy.get(row.id)),
      tightSqueeze: Boolean(squeezeBy.get(row.id)),
    }))
    .sort((x, y) => x.hops - y.hops || x.location.slug.localeCompare(y.location.slug));
}

// The one route to one place, for the mover. A lookup over the same BFS rather
// than a second traversal, so what a picker showed and what the walk takes can
// never be different roads.
async function pathWithinZone(prisma, character, targetLocationId, { known } = {}) {
  if (!targetLocationId) return { ok: false, reason: NO_WALK };
  if (targetLocationId === character?.locationId) {
    return { ok: false, reason: ALREADY_THERE, alreadyThere: true };
  }
  const routes = await routesWithinZone(prisma, character, { known });
  const hit = routes.find((row) => row.location.id === targetLocationId);
  if (!hit) return { ok: false, reason: NO_WALK };
  return { ok: true, hops: hit.hops, path: hit.path, dismounts: hit.dismounts, tightSqueeze: hit.tightSqueeze };
}

// How long a propped door stays propped. Real hours, not turns: a physical door somebody wedged, and the point is that people can follow within the day.
const KEYED_OPEN_MS = 24 * 60 * 60 * 1000;

// How far every traveller is from `originLocationId`, in Locations, counting only the ways EACH of them
// could walk (docs/systemdocs/ATTACK.md, Combat Overhaul.docx — "accounting for locked connections some
// characters have access through"). The gated twin of soundRange, and pure over loadGraph()'s result:
// every edge goes through crossingCheck exactly as the mover would judge it, so a locked door, a hidden
// way, a shut gate and a squeeze a Giant cannot fit through all cost what they cost on foot.
//
// `travellers` is [{ id, locationId, accessSlugs }], accessSlugs a Set from rings.js#accessSlugsOf (held
// slugs plus the worn ring's doors). Returns Map(id -> { hops, fromLocationId }), hops capped at
// `maxHops` — which means "that far or further, or no way at all".
//
// One BFS per ACCESS SIGNATURE, not per traveller: the only slugs that can change an edge's verdict are
// the ones some edge requires, plus `giant`, so everybody holding the same subset of those walks the same
// map. With a hundred characters that is a handful of searches. The edge rules are symmetric (a link is one
// undirected row), so searching outward from the fight is the same as each traveller searching toward it.
function distancesFrom(graph, originLocationId, travellers, { maxHops = 4, now = new Date() } = {}) {
  const out = new Map();
  const list = Array.isArray(travellers) ? travellers : [];
  if (!graph || !originLocationId) {
    for (const t of list) out.set(t.id, { hops: maxHops, fromLocationId: t.locationId ?? null });
    return out;
  }

  const adjacency = new Map();
  const edge = (from, to, link) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ to, link });
  };
  const deciding = new Set([GIANT_TAG_SLUG]);
  for (const link of graph.links ?? []) {
    edge(link.aId, link.bId, link);
    edge(link.bId, link.aId, link);
    if (link.requiredTagSlug) deciding.add(link.requiredTagSlug);
  }

  const bfs = (slugs) => {
    const dist = new Map([[originLocationId, 0]]);
    let frontier = [originLocationId];
    for (let hops = 1; hops < maxHops && frontier.length > 0; hops += 1) {
      const next = [];
      for (const at of frontier) {
        for (const { to, link } of adjacency.get(at) ?? []) {
          if (dist.has(to)) continue;
          if (!crossingCheck(link, { tagSlugs: slugs, now }).passable) continue;
          dist.set(to, hops);
          next.push(to);
        }
      }
      frontier = next;
    }
    return dist;
  };

  const bySignature = new Map();
  for (const t of list) {
    const held = t.accessSlugs instanceof Set ? t.accessSlugs : new Set(t.accessSlugs ?? []);
    const subset = [...deciding].filter((slug) => held.has(slug)).sort();
    const key = subset.join("|");
    if (!bySignature.has(key)) bySignature.set(key, bfs(new Set(subset)));
    const hops = t.locationId ? bySignature.get(key).get(t.locationId) : undefined;
    out.set(t.id, { hops: hops == null ? maxHops : Math.min(hops, maxHops), fromLocationId: t.locationId ?? null });
  }
  return out;
}

module.exports = {
  LINK_INCLUDE,
  KEYED_OPEN_MS,
  distancesFrom,
  GIANT_TAG_SLUG,
  WALK_HOPS,
  NO_WALK,
  ALREADY_THERE,
  routesWithinZone,
  pathWithinZone,
  soundRange,
  endpoints,
  orderEndpoints,
  linksFor,
  linksAt,
  loadGraph,
  linkBetween,
  crossingCheck,
  gateOperable,
  isHeldOpen,
  shouldPromptKeyed,
  resolveNeighbors,
  travelOptions,
};
