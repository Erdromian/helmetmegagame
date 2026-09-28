// The place-bound affordances, declared once for both faces. A Location
// channel's pinned anchor and a Room thread's starter post carry buttons;
// Chat's place panel carries the same list. The catalog below is the shared
// half — id, label, Discord custom-id prefix; `affordancesFor` is the
// per-character half (which rooms/gates this character can reach).
// db/lib/locationAnchorRow.js and db/lib/roomStarterRow.js build their
// buttons off the catalog, so a new affordance is one entry here plus its
// dialog. The two halves can't be one function: an anchor is ONE message for
// everybody in the street, so it carries only what's true of the place —
// anything true of a person is a dialog on the web, a refusal on Discord.

const { hasNoticeboard } = require("./noticeboard");
const { hasAttribute } = require("./locationAttributes");
const { QUEST_INTERACT_PREFIX } = require("./questText");
const { SEARCH_MOVE_LABEL } = require("./roomSearchCost");
const { INTERCOM_ROOM_SLUG } = require("./intercom");
const {
  MERCHANTS_OFFICE_ROOM_SLUG,
  RAILYARD_ROOM_SLUG,
} = require("./train");
const { ATM_ROOM_SLUGS, MEISTERS_OFFICE_ROOM_SLUG } = require("./depot");
const { RING_TEXT } = require("./ringText");
const { BLACK_MARKET_ROOM_SLUG, BLACK_MARKET_TEXT } = require("./blackMarketText");
const { ACTIONS_OPEN_ID } = require("./turnsConsoleRow");
const { ACTION_START_PREFIX } = require("./actionCatalog");
const { BELL_ROOM_SLUG } = require("./bell");
const { XOM_SHRINE_ROOM_SLUG } = require("./xom");
const {
  CHARON_SLUG,
  PANIC_ROOM_SLUG,
  COCKPIT_SLUG,
  HABITATION_SLUG,
} = require("./charonPlaces");
// The slug only; requiring the machine itself would pull the ledger and the
// Vault in behind it, the posture CENSOR_OFFICE_ROOM_SLUG above already takes.
const CASINO_ROOM_SLUG = "undertown-8-3";
const { linksFor, gateOperable, endpoints, isHeldOpen } = require("./locationGraph");
const { accessibleRooms, roomAccessKeys } = require("./roomAccess");
const { ensureNuke, markNukeRoom } = require("./nuke");
const { NUKE_TEXT } = require("./nukeText");
const { loadRoomsAt } = require("./roomSides");
const {
  GATE_ROOM_SLUG,
  GATE_CONTROLS_ROOM_SLUG,
  GATEHOUSE_WINDOW_ROOM_SLUG,
  BRIDGE_SLUG,
  SQUARE_SLUG,
  GATEHOUSE_TEXT,
} = require("./gatehouseText");
const { anchorGateFor, remoteLeverIn, workedElsewhere, joins } = require("./gateControls");

// The one room with a big red button on the wall (docs/zones.yaml). Named
// here rather than imported from gatehouseTurret.js, which pulls in the whole turret engine.
const CENSOR_OFFICE_ROOM_SLUG = "fortress-1-2";

// The rooms that work a gate, against what that room calls its control. Every
// modular edge in docs/zones.yaml has exactly one of these; Open/Close renders
// on that room's starter post and NOWHERE ELSE — the winch is in the tower,
// not on the open road.
//
// `null` takes the default label, which names the far side, because a
// watchtower can stand over two gates and "Close" alone would be a coin flip.
// A room with exactly one gate may name the thing it actually moves instead.
//
// Two gates are worked some other way now (db/lib/gateControls.js): the
// portcullis from both Locations' anchors, by ring, and the Black Hills gate
// from the Town Gatehouse's Gate Controls, which stands at neither end.
const GATE_CONTROL_ROOMS = new Map([
  // The Den's basement stairs, worked from the Exactor's desk. Not a
  // watchtower at all — the first gate in the game whose winch is in an office.
  ["undertown-9-3", "Shutters"], // undertown/undertown-9 <-> undertown/undertown-8
]);

// Every room whose starter carries a gate button: the watchtowers above, and
// the rooms holding a remote lever. What the Discord refresh after a flip reads.
const WATCHTOWER_ROOM_SLUGS = new Set([...GATE_CONTROL_ROOMS.keys(), GATE_CONTROLS_ROOM_SLUG]);

/** What this room calls its gate control, or null for the default label. */
function gateControlIn(roomSlug) {
  return GATE_CONTROL_ROOMS.get(roomSlug) ?? null;
}

// Not a prefix but one fixed id: travel needs no location context, since the handler reads the mover's own locationId.
const TRAVEL_CUSTOM_ID = "loc:open";
const WHOS_HERE_PREFIX = "loc:who:";
const NOTICEBOARD_PREFIX = "loc:notice:";
const SECRET_ROOMS_PREFIX = "loc:secret:";
const EXAMINE_PREFIX = "loc:examine:";
const CONVERSE_PREFIX = "loc:converse:";
const GATE_PREFIX = "loc:gate:";
const KEYED_PREFIX = "loc:keyed:";
const ROOM_STORAGE_PREFIX = "room:storage:";
const ROOM_SEARCH_PREFIX = "room:search:";
const ROOM_INTERCOM_PREFIX = "room:intercom:";
const ROOM_TURRET_PREFIX = "room:turret:";
const ROOM_BELL_PREFIX = "room:bell:";
const ROOM_PRAY_PREFIX = "room:pray:";
const ROOM_ATM_PREFIX = "room:atm:";
const ROOM_DEPOT_TURRET_PREFIX = "room:depotturret:";
const ROOM_SLOTS_PREFIX = "room:slots:";
const ROOM_PHONE_PREFIX = "room:phone:";
const ROOM_VENDING_PREFIX = "room:vending:";
// The bomb (docs/systemdocs/NUKE.md). Its keypad's own ids all start
// "room:nuke:" too (db/lib/nukeKeypad.js), so the bot tests those first.
const ROOM_NUKE_PREFIX = "room:nuke:";
const ROOM_BLACK_MARKET_PREFIX = "room:blackmarket:";
// The Town Gatehouse (docs/systemdocs/GATEHOUSE.md). The lever's own button is
// the gate button (GATE_PREFIX); these four are its terminals and windows.
const ROOM_PASSAGE_PREFIX = "room:passage:";
const ROOM_BLOODPRICK_PREFIX = "room:bloodprick:";
const ROOM_GATE_PROCESS_PREFIX = "room:gateprocess:";
const ROOM_GATE_DOCS_PREFIX = "room:gatedocs:";
// The Charon (docs/systemdocs/CHARON.md). Three room buttons and one on the
// Location: the Panic Room's way in, the Cockpit's terminal, the Habitation's
// last one, and Leave on the ship itself.
const ROOM_CHARON_ENTER_PREFIX = "room:charonenter:";
const ROOM_CHARON_LAUNCH_PREFIX = "room:charonlaunch:";
const ROOM_CHARON_SLEEP_PREFIX = "room:charonsleep:";
const CHARON_LEAVE_PREFIX = "loc:charonleave:";
// The Merchant's Terminal (docs/systemdocs/DEPOT.md §0c), on the Depot itself.
const MERCHANT_TERMINAL_PREFIX = "loc:merchantterminal:";

const { MERCHANT_TERMINAL_TEXT } = require("./merchantTerminalText");
// Same bargain: the vending machine's button label is authored once, in the
// zero-require file, so the web panel and the Discord starter post cannot drift.
const { VENDING_TEXT } = require("./vendingText");
const VENDING_LABEL = VENDING_TEXT.btnOpen;

// `tone` is what the affordance MEANS, never a colour — each face maps it to its own look.
const GO = "go";
const PLAIN = "plain";
const DANGER = "danger";

// Everything on a Location's anchor, in the order it draws. Travel is first — the others answer where you already are, this is how you leave.
const LOCATION_AFFORDANCES = [
  { id: "travel", label: "Travel", tone: GO, customId: () => TRAVEL_CUSTOM_ID },
  // The Actions menu (bot/src/lib/verbs/index.js): everything this character
  // can do right now, listed for whoever presses it. `discordOnly` — on the
  // web it is the Actions button in /chat's own header, not a place fixture.
  { id: "actions", label: "Actions", tone: PLAIN, customId: () => ACTIONS_OPEN_ID, discordOnly: true },
  { id: "whosHere", label: "Who's here?", tone: PLAIN, prefix: WHOS_HERE_PREFIX },
  { id: "secretRooms", label: "Secret rooms?", tone: PLAIN, prefix: SECRET_ROOMS_PREFIX },
  { id: "examine", label: "Examine", tone: PLAIN, prefix: EXAMINE_PREFIX },
  { id: "converse", label: "Converse", tone: PLAIN, prefix: CONVERSE_PREFIX },
  // Only where docs/zones.yaml declared one (db/lib/noticeboard.js).
  { id: "noticeboard", label: "Noticeboard", tone: PLAIN, prefix: NOTICEBOARD_PREFIX, when: hasNoticeboard },
  // The Merchant's Terminal (Depot Overhaul.docx): "available to anyone in
  // the depot". On the LOCATION rather than one room, where the drop box it
  // replaced used to be. Anybody may open it; it asks to be unlocked
  // (db/lib/merchantTerminal.js).
  {
    id: "merchantTerminal",
    label: MERCHANT_TERMINAL_TEXT.button,
    tone: PLAIN,
    prefix: MERCHANT_TERMINAL_PREFIX,
    when: (location) => hasAttribute(location, "depot"),
  },
  // The Charon's way out, on the ground only — once the ship has launched there
  // is nothing under it to step back onto, and the Location it was is retired
  // anyway (docs/systemdocs/CHARON.md). Matched on the slug rather than an
  // attribute because there is exactly one ship and it is not a KIND of place.
  {
    id: "charonLeave",
    label: "Leave",
    tone: GO,
    prefix: CHARON_LEAVE_PREFIX,
    when: (location) => location?.slug === CHARON_SLUG,
  },
];

// Everything on a Room's starter post. Storage is on every one of them;
// Intercom is on exactly one (the Council Room), Toggle Turret on exactly one
// other (the Censor's Office), Sound Bell on the Cathedral's Bell Tower.
const ROOM_AFFORDANCES = [
  // A Quest's one button, and the only affordance that isn't a standing fact
  // about a place — a GM staged it (QUESTS.md). Quest id rides in the
  // custom_id, not the room id, since the quest outlives its room.
  {
    id: "questInteract",
    label: "Interact",
    tone: GO,
    when: (room) => Boolean(room?.questId),
    customId: (_id, room) => `${QUEST_INTERACT_PREFIX}${room?.questId ?? ""}`,
  },
  { id: "storage", label: "Storage", tone: PLAIN, prefix: ROOM_STORAGE_PREFIX },
  // Going through the room for what is under the floor (SEARCH.md §9). On
  // every room like Storage is; Storage is what says how many things are
  // hidden, and a search of a room with none is refused. The price is in the
  // label, because a Discord button has no confirm step and this one spends a
  // third of the Move — a player should never learn that from the refusal.
  { id: "search", label: `Search (${SEARCH_MOVE_LABEL} Move)`, tone: PLAIN, prefix: ROOM_SEARCH_PREFIX },
  {
    id: "intercom",
    label: "Intercom",
    tone: PLAIN,
    prefix: ROOM_INTERCOM_PREFIX,
    when: (room) => room?.slug === INTERCOM_ROOM_SLUG,
  },
  // The only red button in the game: arms a gun that doesn't check who anyone is.
  {
    id: "turret",
    label: "Toggle Turret",
    tone: DANGER,
    prefix: ROOM_TURRET_PREFIX,
    when: (room) => room?.slug === CENSOR_OFFICE_ROOM_SLUG,
  },
  {
    id: "bell",
    label: "Sound Bell",
    tone: PLAIN,
    prefix: ROOM_BELL_PREFIX,
    when: (room) => room?.slug === BELL_ROOM_SLUG,
  },
  // A cash machine. A fixture rather than a page because it is a machine bolted
  // to a wall: you have to be standing at it, and both faces should be able to
  // say so. Most accounts draw on the Keep's Vault through it
  // (db/lib/bankAccounts.js); the Merchant's and the Docker's do not. There are
  // four of them now (db/lib/depot.js#ATM_ROOM_SLUGS) — the counter's own on
  // the Depot's Railway, the Merchant's on his Storefront next door, the
  // Inn's, and the Den's. The last two are the machine alone with no counter
  // behind it.
  {
    id: "atm",
    label: RING_TEXT.infoterminalButton,
    tone: PLAIN,
    prefix: ROOM_ATM_PREFIX,
    when: (room) => ATM_ROOM_SLUGS.has(room?.slug),
  },
  // The Merchant's gun, on the wall the Merchant's Office description has
  // called a big red button since before anything could press one. The second
  // red button in the game, and it works exactly like the Censor's.
  {
    id: "depotTurret",
    label: "Toggle Turret",
    tone: DANGER,
    prefix: ROOM_DEPOT_TURRET_PREFIX,
    when: (room) => room?.slug === MERCHANTS_OFFICE_ROOM_SLUG,
  },
  // The Den's slot machine. The only affordance that takes money off you for
  // an outcome nobody controls (db/lib/slotMachine.js).
  {
    id: "slots",
    label: "Slot Machine",
    tone: PLAIN,
    prefix: ROOM_SLOTS_PREFIX,
    when: (room) => room?.slug === CASINO_ROOM_SLUG,
  },
  // The Black Market terminal in the Exactor's Office (db/lib/blackMarket.js).
  // Drawn for anybody who can get into the room; the ring on the finger is
  // checked when it is pressed, so somebody let in is told no in words.
  {
    id: "blackMarket",
    label: BLACK_MARKET_TEXT.button,
    tone: PLAIN,
    prefix: ROOM_BLACK_MARKET_PREFIX,
    when: (room) => room?.slug === BLACK_MARKET_ROOM_SLUG,
  },
  // The Town Gatehouse (Incarn and gates.docx, docs/systemdocs/GATEHOUSE.md).
  // Request Passage is on the OUTSIDE of each window — the Gate as seen from
  // the Bridge, the Gatehouse Window as seen from the Square — because nobody
  // asks to pass from inside the gatehouse. `sides: true` is what lets it
  // draw on a side's copy of a room at all (see SIDE_AFFORDANCE_IDS below).
  {
    id: "requestPassage",
    label: GATEHOUSE_TEXT.requestButton,
    tone: PLAIN,
    prefix: ROOM_PASSAGE_PREFIX,
    sides: true,
    when: (room, location) =>
      (room?.slug === GATE_ROOM_SLUG && location?.slug === BRIDGE_SLUG) ||
      (room?.slug === GATEHOUSE_WINDOW_ROOM_SLUG && location?.slug === SQUARE_SLUG),
  },
  // The finger-prick terminal in the Gate, from either side of it.
  {
    id: "submitDocumentation",
    label: GATEHOUSE_TEXT.documentButton,
    tone: PLAIN,
    prefix: ROOM_BLOODPRICK_PREFIX,
    sides: true,
    when: (room) => room?.slug === GATE_ROOM_SLUG,
  },
  // Gate Controls' terminal. Grant Passage asks for a gatehouse-key ring
  // when pressed; Documents is anybody's in the room (the doc).
  {
    id: "processRequests",
    label: GATEHOUSE_TEXT.processButton,
    tone: PLAIN,
    prefix: ROOM_GATE_PROCESS_PREFIX,
    when: (room) => room?.slug === GATE_CONTROLS_ROOM_SLUG,
  },
  {
    id: "createDocuments",
    label: GATEHOUSE_TEXT.createButton,
    tone: PLAIN,
    prefix: ROOM_GATE_DOCS_PREFIX,
    when: (room) => room?.slug === GATE_CONTROLS_ROOM_SLUG,
  },
  // The Merchant's vending machine (docs/systemdocs/VENDING.md). Resolved off a
  // COLUMN rather than a slug, the way the phone above is: there is one today,
  // on the Storefront, and a second is a YAML edit plus a tick on
  // /gm/dev/zones rather than a line in this file.
  //
  // One button, four meanings — open it, wait for whoever has it, work the
  // shelf, or open the merchant's side — all decided by
  // db/lib/vending.js#machineView when it is pressed, never here. An anchor is
  // one message for everybody in the room (see the header), so it can only
  // carry what is true of the PLACE: that there is a machine on this wall.
  {
    id: "vending",
    label: VENDING_LABEL,
    tone: PLAIN,
    prefix: ROOM_VENDING_PREFIX,
    when: (room) => Boolean(room?.vendingMachine),
  },
  // The phone on the wall (docs/systemdocs/PHONES.md). The only affordance
  // resolved off a COLUMN rather than a slug: there are thirteen of them and a
  // fourteenth is a YAML edit, which is the whole reason Room.phone holds the
  // name instead of this file holding a list.
  //
  // One button, four meanings — Dial, Answer, Hang up, or a refusal — decided
  // by db/lib/phone.js#phoneView when it is pressed, never here. An anchor is
  // one message for everybody in the room (see the header), so it can only
  // carry what is true of the PLACE: that there is a phone on this wall.
  {
    id: "phone",
    label: "Phone",
    tone: PLAIN,
    prefix: ROOM_PHONE_PREFIX,
    when: (room) => Boolean(room?.phone),
  },
  // The bomb (docs/systemdocs/NUKE.md): a fixture in one public room, rolled
  // every game. The room carries no column for it — GameState.nukeRoomId does —
  // so every caller marks the room first (db/lib/nuke.js#markNukeRoom), and a
  // room nobody marked simply has no bomb in it.
  {
    id: "nuke",
    label: NUKE_TEXT.label,
    tone: DANGER,
    prefix: ROOM_NUKE_PREFIX,
    when: (room) => room?.nuke === true,
  },
  // The Charon (docs/systemdocs/CHARON.md). Three buttons, and which of them a
  // room offers depends on where the ship IS — the Cockpit and the Habitation
  // travel with it when it launches, so the same two Room rows mean different
  // things on the ground and in orbit. That is what the second argument is for.
  //
  // Enter is offered whether or not the ship has gone: after a launch it
  // refuses in words, which is the one thing a player standing in the Panic
  // Room is owed an answer about.
  {
    id: "charonEnter",
    label: "Enter the Charon",
    tone: GO,
    prefix: ROOM_CHARON_ENTER_PREFIX,
    when: (room) => room?.slug === PANIC_ROOM_SLUG,
  },
  {
    id: "charonLaunch",
    label: "Launch",
    tone: DANGER,
    prefix: ROOM_CHARON_LAUNCH_PREFIX,
    when: (room, location) => room?.slug === COCKPIT_SLUG && !hasAttribute(location, "offMap"),
  },
  {
    id: "charonSleep",
    label: "Sleep",
    tone: DANGER,
    prefix: ROOM_CHARON_SLEEP_PREFIX,
    when: (room, location) => room?.slug === HABITATION_SLUG && hasAttribute(location, "offMap"),
  },

  // The Shrine of an Old Man: the only button that hands you a permanent tag that can kill you, with no way back off it.
  {
    id: "pray",
    label: "Pray",
    tone: DANGER,
    prefix: ROOM_PRAY_PREFIX,
    when: (room) => room?.slug === XOM_SHRINE_ROOM_SLUG,
  },

  // Send money, from the Railway's infoterminal (docs/systemdocs/DEPOT.md).
  // `discordOnly` — the web sends from the infoterminal's own dialog. It
  // starts the verb of the same name (bot/src/lib/verbs/place.js), which
  // refuses anybody not standing here. The Merchant's credit button that sat
  // beside it is gone with the credit line.
  {
    id: "sendMoney",
    label: "Send money",
    tone: PLAIN,
    customId: () => `${ACTION_START_PREFIX}sendmoney`,
    when: (room) => room?.slug === RAILYARD_ROOM_SLUG,
    discordOnly: true,
  },
  // The Meister's terminal (docs/systemdocs/DEPOT.md): the sell tax. The web
  // has it on /treasury, so `discordOnly` again. The office is behind a
  // locked door, and setSellTax asks canReadTreasury on every press.
  {
    id: "sellTax",
    label: "Sell tax",
    tone: PLAIN,
    customId: () => `${ACTION_START_PREFIX}selltax`,
    when: (room) => room?.slug === MEISTERS_OFFICE_ROOM_SLUG,
    discordOnly: true,
  },
];

// `subject` is the whole row the affordance resolved against, for the one def needing a field off it rather than its id.
function customIdFor(def, id, subject = null) {
  return def.customId ? def.customId(id, subject) : `${def.prefix}${id}`;
}

// Location affordances for this place. `location` may be a bare id, dropping
// conditional ones — nothing can be decided about a place that's only a string.
// `web: true` leaves out the ones that are Discord's own (`discordOnly`).
function locationAffordances(location, { web = false } = {}) {
  const id = typeof location === "string" ? location : location?.id;
  const known = typeof location === "string" ? null : location;
  return LOCATION_AFFORDANCES.filter(
    (def) => !(web && def.discordOnly) && (!def.when || (known ? def.when(known) : false)),
  ).map((def) => ({
    id: def.id,
    label: def.label,
    tone: def.tone,
    customId: customIdFor(def, id),
  }));
}

// `room` needs { id, slug, questId }.
// `location` is the place the room hangs off. Most `when`s ignore it and match
// on the room's own slug; the Charon's two need it, because its rooms MOVE
// (docs/systemdocs/CHARON.md) and the same Room row means a different thing on
// the ground and in orbit. Optional, so a caller with only a room in hand still
// gets every affordance that does not depend on one.
//
// A room seen from a side it opens onto rather than its home (db/lib/roomSides.js
// — `sideId` is set) offers Storage and nothing else. What passes over a counter
// is talk and what is left lying on it; the bell, the phone, the machine and the
// rest are fixtures on the home side's wall. The one exception is a fixture
// that is ABOUT the far side — the gatehouse's windows (`sides: true`), whose
// `when` then decides from which side.
const SIDE_AFFORDANCE_IDS = new Set(["storage"]);
function roomAffordances(room, location = null, { web = false } = {}) {
  return ROOM_AFFORDANCES.filter(
    (def) =>
      !(web && def.discordOnly) &&
      (!room.sideId || SIDE_AFFORDANCE_IDS.has(def.id) || def.sides === true) &&
      (!def.when || def.when(room, location)),
  ).map((def) => ({
    id: def.id,
    label: def.label,
    tone: def.tone,
    roomId: room.id,
    customId: customIdFor(def, room.id, room),
  }));
}

// The one link a remote lever works, with its ends, or null.
async function remoteLink(prisma, lever) {
  const rows = await prisma.locationLink.findMany({
    where: {
      modular: true,
      OR: [
        { a: { slug: lever.ends[0] }, b: { slug: lever.ends[1] } },
        { a: { slug: lever.ends[1] }, b: { slug: lever.ends[0] } },
      ],
    },
    include: { a: true, b: true },
  });
  return rows.find((link) => joins(link, lever.ends)) ?? null;
}

// The label a gate button wears. Far side named by default, because a location
// can hold two gates and "Close" alone would be a coin flip — unless the room
// working it named its own control, in which case that is the truer word for
// what the click does ("Close Shutters").
function gateLabel({ isOpen, farName, control = null }) {
  const verb = isOpen ? "Close" : "Open";
  return control ? `${verb} ${control}` : `${verb} the way to ${farName}`;
}

// EVERYTHING this character can do where they are standing, one ordered
// list; Chat's place panel is a render of this and nothing else. Each entry
// is { id, label, tone, kind, roomId?, linkId?, roomName? } — `kind` is
// "place"/"room"/"gate"/"keyed". `character` needs { id, locationId, role:
// { slug }, tags: [{ tag: { slug } }] }.
async function affordancesFor(prisma, character) {
  if (!character?.locationId) return [];

  const [location, rawRooms, keys, links, bomb] = await Promise.all([
    prisma.location.findUnique({
      where: { id: character.locationId },
      select: { id: true, name: true, slug: true, attributes: true },
    }),
    // Every room that opens onto here, each as seen from this side.
    loadRoomsAt(prisma, character.locationId, {
      select: {
        id: true,
        name: true,
        slug: true,
        kind: true,
        accessTagSlugs: true,
        questId: true,
        phone: true,
        vendingMachine: true,
      },
    }),
    roomAccessKeys(prisma, character.id),
    linksFor(prisma, character.locationId),
    ensureNuke(prisma),
  ]);
  if (!location) return [];
  const rooms = markNukeRoom(rawRooms, bomb?.roomId ?? null);

  const out = locationAffordances(location, { web: true }).map((entry) => ({ ...entry, kind: "place" }));

  // A room's buttons, for every room this character can actually get into — a locked door offers nothing.
  const open = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds);
  for (const room of open) {
    for (const entry of roomAffordances(room, location, { web: true })) {
      out.push({ ...entry, kind: "room", roomName: room.name });
    }
  }

  // Reaching the room IS the permission — anyone its `access:` list lets in may work the gate.
  const gateRoom = open.find((room) => !room.sideId && GATE_CONTROL_ROOMS.has(room.slug)) ?? null;
  const control = gateRoom ? gateControlIn(gateRoom.slug) : null;
  const tagSlugs = (character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean);
  for (const link of links ?? []) {
    if (!gateOperable(link)) continue;
    // The portcullis: a button on this Location's own card, for everybody. The
    // ring is asked for when it is pressed (db/lib/gates.js).
    const anchor = anchorGateFor(link);
    if (anchor) {
      const farName = endpoints(link, character.locationId).far.name;
      out.push({
        id: "gate",
        kind: "gate",
        linkId: link.id,
        label: gateLabel({ isOpen: link.isOpen, farName, control: anchor.control }),
        tone: link.isOpen ? DANGER : GO,
        isOpen: link.isOpen,
        farName,
        control: anchor.control,
      });
      continue;
    }
    if (workedElsewhere(link)) continue;
    if (!gateRoom) continue;
    const farName = endpoints(link, character.locationId).far.name;
    out.push({
      id: "gate",
      kind: "gate",
      linkId: link.id,
      label: gateLabel({ isOpen: link.isOpen, farName, control }),
      tone: link.isOpen ? DANGER : GO,
      isOpen: link.isOpen,
      farName,
      control,
    });
  }

  // A lever for a gate somewhere else (db/lib/gateControls.js): drawn in its
  // room, like any room fixture, for anybody who can get in.
  for (const room of open) {
    const lever = !room.sideId ? remoteLeverIn(room.slug) : null;
    if (!lever) continue;
    const link = await remoteLink(prisma, lever);
    if (!link) continue;
    out.push({
      id: "gateLever",
      kind: "room",
      roomId: room.id,
      roomName: room.name,
      linkId: link.id,
      label: gateLabel({ isOpen: link.isOpen, farName: null, control: lever.control }),
      tone: link.isOpen ? DANGER : GO,
      isOpen: link.isOpen,
      control: lever.control,
    });
  }

  // A keyed door is not a gate: no winch, no anchor button. Only the key
  // holder gets it, and already-held ways are listed rather than offering a click that refuses.
  for (const link of links ?? []) {
    if (!link.keyed) continue;
    if (!tagSlugs.includes(link.requiredTagSlug)) continue;
    const farName = endpoints(link, character.locationId).far.name;
    out.push({
      id: "keyed",
      kind: "keyed",
      linkId: link.id,
      label: `Hold the way to ${farName} open`,
      tone: PLAIN,
      held: isHeldOpen(link),
      farName,
    });
  }

  return out;
}

module.exports = {
  GO,
  DANGER,
  TRAVEL_CUSTOM_ID,
  WHOS_HERE_PREFIX,
  NOTICEBOARD_PREFIX,
  SECRET_ROOMS_PREFIX,
  EXAMINE_PREFIX,
  CONVERSE_PREFIX,
  GATE_PREFIX,
  KEYED_PREFIX,
  ROOM_STORAGE_PREFIX,
  ROOM_SEARCH_PREFIX,
  ROOM_INTERCOM_PREFIX,
  ROOM_TURRET_PREFIX,
  ROOM_BELL_PREFIX,
  ROOM_PRAY_PREFIX,
  ROOM_ATM_PREFIX,
  ROOM_DEPOT_TURRET_PREFIX,
  ROOM_SLOTS_PREFIX,
  ROOM_PHONE_PREFIX,
  ROOM_VENDING_PREFIX,
  ROOM_NUKE_PREFIX,
  ROOM_BLACK_MARKET_PREFIX,
  ROOM_PASSAGE_PREFIX,
  ROOM_BLOODPRICK_PREFIX,
  ROOM_GATE_PROCESS_PREFIX,
  ROOM_GATE_DOCS_PREFIX,
  ROOM_CHARON_ENTER_PREFIX,
  ROOM_CHARON_LAUNCH_PREFIX,
  ROOM_CHARON_SLEEP_PREFIX,
  CHARON_LEAVE_PREFIX,
  MERCHANT_TERMINAL_PREFIX,
  QUEST_INTERACT_PREFIX,
  CENSOR_OFFICE_ROOM_SLUG,
  CASINO_ROOM_SLUG,
  WATCHTOWER_ROOM_SLUGS,
  GATE_CONTROL_ROOMS,
  gateControlIn,
  ROOM_AFFORDANCES,
  locationAffordances,
  roomAffordances,
  gateLabel,
  remoteLink,
  affordancesFor,
};
