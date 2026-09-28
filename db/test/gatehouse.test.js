// The gatehouse rework (Incarn and gates.docx, docs/systemdocs/GATEHOUSE.md).
//
// The pure half runs anywhere: which gate is worked from where, what travel
// says while one is shut, which rooms draw which buttons from which side, who
// carries the two ring tokens, and the geography in docs/zones.yaml.
//
// The rest walks the whole flow against a real Postgres — asking to pass,
// withdrawing by leaving, approving with a bribe and a hand-over, denying,
// the Magma button once a turn, and the Documents with their -10 ¢ account
// and the infoterminal they open. It skips unless DATABASE_URL is a local one
// (db/lib/localDatabase.js), makes its own characters, and deletes them after.
process.env.LOCAL_MODE = "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { isLocalDatabase } = require("../lib/localDatabase");
const {
  anchorGateFor,
  remoteLeverFor,
  remoteLeverIn,
  workedElsewhere,
  shutRefusalFor,
  controlThing,
} = require("../lib/gateControls");
const { crossingCheck } = require("../lib/locationGraph");
const { roomAffordances, gateLabel } = require("../lib/placeAffordances");
const { findGateBypasses } = require("../lib/gateBypass");
const { pickLines, liveOffer } = require("../lib/gatehouse");
const {
  GATEHOUSE_TEXT: T,
  GATEHOUSE_KEY,
  PORTCULLIS_KEY,
  GATE_ROOM_SLUG,
  GATE_CONTROLS_ROOM_SLUG,
  GATEHOUSE_WINDOW_ROOM_SLUG,
} = require("../lib/gatehouseText");

const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

const DOCS = path.join(__dirname, "..", "..", "docs");
const loadYaml = (name) => yaml.load(fs.readFileSync(path.join(DOCS, name), "utf8"));

const place = (slug, name = slug) => ({ id: `loc-${slug}`, slug, name });
const link = (a, b, extra = {}) => ({ a: place(a), b: place(b), modular: true, isOpen: true, ...extra });

// ─── Which gate is worked from where ─────────────────────────────────────

test("the portcullis is an anchor gate on its ring token, from either end", () => {
  const gate = anchorGateFor(link("fortress-2", "town-8"));
  assert.equal(gate?.token, PORTCULLIS_KEY);
  assert.deepEqual(anchorGateFor(link("town-8", "fortress-2")), gate);
  assert.equal(remoteLeverFor(link("fortress-2", "town-8")), null);
});

test("the Black Hills gate is worked by the lever in Gate Controls, at neither end", () => {
  const lever = remoteLeverFor(link("bridge", "town-2"));
  assert.equal(lever?.roomSlug, GATE_CONTROLS_ROOM_SLUG);
  assert.deepEqual(remoteLeverIn(GATE_CONTROLS_ROOM_SLUG), lever);
  assert.equal(anchorGateFor(link("bridge", "town-2")), null);
  // The Den's shutters are still a watchtower's winch.
  assert.equal(workedElsewhere(link("undertown-8", "undertown-9")), false);
});

test("a shut gate says how to get through it", () => {
  const shut = (a, b) => crossingCheck(link(a, b, { isOpen: false }), { tagSlugs: [] }).refusal;
  assert.equal(shut("bridge", "town-2"), T.shutBlackHills);
  assert.equal(shut("fortress-2", "town-8"), T.shutPortcullis);
  assert.match(shut("undertown-8", "undertown-9"), /watchtower/);
  assert.equal(shutRefusalFor(link("town-1", "town-2")), null);
});

test("a control's name reads right on a button and in a sentence", () => {
  assert.equal(gateLabel({ isOpen: true, farName: null, control: T.gateControl }), "Close the Gate");
  assert.equal(gateLabel({ isOpen: false, farName: null, control: T.gateControl }), "Open the Gate");
  assert.equal(controlThing(T.gateControl), "The gate");
  assert.equal(controlThing("Shutters"), "The shutters");
  assert.equal(controlThing(null), null);
});

// ─── The rooms' buttons, side by side ────────────────────────────────────

test("Request Passage is on the outside of each window, never the inside", () => {
  const ids = (room, locSlug) => roomAffordances(room, place(locSlug)).map((a) => a.id);
  const gateHome = { id: "r-gate", slug: GATE_ROOM_SLUG, sideId: null };
  const gateFromBridge = { ...gateHome, sideId: "side-bridge" };
  const windowHome = { id: "r-window", slug: GATEHOUSE_WINDOW_ROOM_SLUG, sideId: null };
  const windowFromSquare = { ...windowHome, sideId: "side-square" };

  assert.ok(ids(gateFromBridge, "bridge").includes("requestPassage"));
  assert.ok(!ids(gateHome, "town-1").includes("requestPassage"));
  assert.ok(ids(windowFromSquare, "town-2").includes("requestPassage"));
  assert.ok(!ids(windowHome, "town-1").includes("requestPassage"));
  // The finger-prick is on both sides of the Gate; the Window has none.
  assert.ok(ids(gateFromBridge, "bridge").includes("submitDocumentation"));
  assert.ok(ids(gateHome, "town-1").includes("submitDocumentation"));
  assert.ok(!ids(windowFromSquare, "town-2").includes("submitDocumentation"));
  // A side still offers nothing else of the home wall's.
  assert.ok(ids(gateFromBridge, "bridge").includes("storage"));
  assert.ok(!ids(gateFromBridge, "bridge").includes("search"));
});

test("Gate Controls carries the terminal's two buttons", () => {
  const ids = roomAffordances({ id: "r-controls", slug: GATE_CONTROLS_ROOM_SLUG, sideId: null }, place("town-1")).map(
    (a) => a.id,
  );
  assert.ok(ids.includes("processRequests"));
  assert.ok(ids.includes("createDocuments"));
});

// ─── The rings ──────────────────────────────────────────────────────────

test("the two tokens are on exactly the rings the doc names (the Squire's too)", () => {
  const roles = loadYaml("roles.yaml");
  const seats = Object.values(roles.groups).flatMap((g) => Object.entries(g));
  const carrying = (token) =>
    seats
      .filter(([, r]) => (r?.ring?.opens ?? []).includes(token))
      .map(([slug]) => slug)
      .sort();
  assert.deepEqual(carrying(GATEHOUSE_KEY), ["baron", "censor", "cerberus", "hand", "incarn", "squire"]);
  assert.deepEqual(carrying(PORTCULLIS_KEY), ["baron", "censor", "cerberus", "hand", "meister", "squire"]);
  // Each token is also a tag, so db:doctor and the room/way checks know it.
  const tags = fs.readFileSync(path.join(DOCS, "tags.yaml"), "utf8");
  for (const token of [GATEHOUSE_KEY, PORTCULLIS_KEY]) assert.match(tags, new RegExp(`\n  ${token}:`));
});

test("a Migrant starts with no treasury account; the Gatehouse opens one", () => {
  const roles = loadYaml("roles.yaml");
  const migrant = Object.values(roles.groups)
    .map((g) => g.migrant)
    .find(Boolean);
  assert.ok(migrant);
  assert.equal(migrant.bank_account, undefined);
});

// ─── The geography ──────────────────────────────────────────────────────

test("the map: Bridge to Square through the gate, the Gatehouse only from the Square", () => {
  const zones = loadYaml("zones.yaml");
  const pairOf = (entry) => (Array.isArray(entry) ? entry : entry.pair);
  const find = (x, y) =>
    zones.connections.find((c) => {
      const [a, b] = pairOf(c);
      return (a === x && b === y) || (a === y && b === x);
    });
  assert.equal(find("town/town-1", "hills/bridge"), undefined, "the Gatehouse no longer opens onto the Bridge");
  const gate = find("hills/bridge", "town/town-2");
  assert.ok(gate?.modular, "the Bridge and the Square are joined by a gate");
  assert.equal(gate.announce, "true_name");
  assert.equal(find("town/town-1", "town/town-2")?.locked, GATEHOUSE_KEY);
  assert.equal(zones.zones.fortress.locations["fortress-2"].name, "Courtyard");

  const rooms = zones.zones.town.locations["town-1"].rooms;
  assert.deepEqual(Object.keys(rooms), [GATE_ROOM_SLUG, GATE_CONTROLS_ROOM_SLUG, "town-1-3", GATEHOUSE_WINDOW_ROOM_SLUG]);
  assert.equal(rooms[GATE_CONTROLS_ROOM_SLUG].name, "Gate Controls");
  assert.equal(rooms[GATE_CONTROLS_ROOM_SLUG].access, undefined);
  assert.deepEqual(rooms["town-1-3"].access, ["incarns-key"]);
  assert.deepEqual(rooms[GATE_ROOM_SLUG].sides, [{ location: "bridge" }]);
  assert.deepEqual(rooms[GATEHOUSE_WINDOW_ROOM_SLUG].sides, [{ location: "town-2" }]);
});

test("the Bridge–Square gate is the only way between the Town and the Hills", () => {
  const zones = loadYaml("zones.yaml");
  const links = zones.connections.map((c) => {
    const [a, b] = Array.isArray(c) ? c : c.pair;
    const end = (ref) => ({ zone: ref.split("/")[0], name: ref });
    return { a: end(a), b: end(b), modular: Boolean(c.modular), requiredTagSlug: c.locked ?? c.hidden ?? null };
  });
  assert.deepEqual(findGateBypasses(links), []);
});

// ─── Offers ─────────────────────────────────────────────────────────────

test("an offer is cut down to what is still held", () => {
  const tags = [
    { tagId: "obol", quantity: 3, tag: { name: "Obol", tradeable: true, stackable: true } },
    { tagId: "knife", quantity: 1, tag: { name: "Knife", tradeable: true } },
    { tagId: "soul", quantity: 1, tag: { name: "Soulbound", tradeable: false } },
  ];
  const offer = liveOffer(
    [
      { tagId: "obol", quantity: 5 },
      { tagId: "gone", quantity: 1 },
      { tagId: "soul", quantity: 1 },
      { tagId: "knife", quantity: 1 },
    ],
    tags,
  );
  assert.deepEqual(
    offer.map((l) => [l.tagId, l.quantity]),
    [
      ["obol", 3],
      ["knife", 1],
    ],
  );
  // A strict pick refuses rather than clamping.
  const available = [{ tagId: "obol", name: "Obol", quantity: 3 }];
  assert.equal(pickLines([{ tagId: "obol", quantity: 4 }], available, { strict: true }).name, "Obol");
  assert.deepEqual(pickLines([{ tagId: "obol", quantity: 2 }], available, { strict: true }).lines, [
    { tagId: "obol", name: "Obol", quantity: 2 },
  ]);
});

// ─── The whole flow, against Postgres ───────────────────────────────────

test("asking, approving, denying, magma and documents, end to end", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const G = require("../lib/gatehouse");
  const { createRingRow } = require("../lib/ringMint");
  const { terminalAccount } = require("../lib/depotCounter");
  const { bumpBankAccount } = require("../lib/bankAccounts");
  const { OBOL_SLUG } = require("../lib/depotState");

  const slugs = ["town-1", "town-2", "town-3", "bridge"];
  const locations = await prisma.location.findMany({ where: { slug: { in: slugs } } });
  const at = Object.fromEntries(locations.map((l) => [l.slug, l]));
  const coin = await prisma.tag.findUnique({ where: { slug: OBOL_SLUG } });
  const gateRoom = await prisma.room.findUnique({ where: { slug: GATE_ROOM_SLUG }, include: { sides: true } });
  if (slugs.some((s) => !at[s]) || !coin || !gateRoom?.sides?.length) {
    await prisma.$disconnect();
    return t.skip("the local database has not had the gatehouse migration — run npm run dev:setup");
  }

  const run = Math.random().toString(36).slice(2, 8);
  const started = new Date();
  const made = [];
  const mintedTags = [];
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { gatehouseMagmaTurnId: true } });
  t.after(async () => {
    // What they hold first: CharacterTag does not cascade from Character.
    const papers = await prisma.tag.findMany({
      where: { documentsBankAccount: { characterId: { in: made } } },
      select: { id: true },
    });
    await prisma.characterTag.deleteMany({ where: { characterId: { in: made } } });
    await prisma.tag.deleteMany({ where: { id: { in: [...mintedTags, ...papers.map((p) => p.id)] } } });
    await prisma.character.deleteMany({ where: { id: { in: made } } });
    await prisma.auditLog.deleteMany({ where: { actorDiscordUserId: { startsWith: `gh-test-${run}` } } }).catch(() => {});
    // The archive rows this run wrote: its own GATEHOUSE and DEATH rows, and the
    // lever's "The gate opens." scene lines, which name nobody.
    await prisma.archiveEntry.deleteMany({ where: { characterId: { in: made } } }).catch(() => {});
    await prisma.archiveEntry
      .deleteMany({ where: { sentAt: { gte: started }, source: "SYSTEM", content: { in: ["The gate opens.", "The gate closes."] } } })
      .catch(() => {});
    if (state) {
      await prisma.gameState
        .update({ where: { id: 1 }, data: { gatehouseMagmaTurnId: state.gatehouseMagmaTurnId } })
        .catch(() => {});
    }
    await prisma.$disconnect();
  });

  async function person(key, slug, name) {
    const loc = at[slug];
    const row = await prisma.character.create({
      data: {
        discordUserId: `gh-test-${run}-${key}`,
        firstName: name,
        lastName: "Test",
        name: `${name} Test`,
        status: "ALIVE",
        zoneId: loc.zoneId,
        locationId: loc.id,
      },
    });
    made.push(row.id);
    return row;
  }
  const uid = (c) => c.discordUserId;
  const coins = async (c) =>
    (await prisma.characterTag.findUnique({ where: { characterId_tagId: { characterId: c.id, tagId: coin.id } } }))
      ?.quantity ?? 0;
  const give = (c, quantity) => prisma.characterTag.create({ data: { characterId: c.id, tagId: coin.id, quantity, source: "EVENT" } });

  const clerk = await person("clerk", "town-1", "Clerk");
  const ring = await createRingRow(prisma, clerk, { name: "Censor's Ring" });
  mintedTags.push(ring.id);
  await prisma.tag.update({
    where: { id: ring.id },
    data: { ringRegisteredAt: new Date(), ringAccessSlugs: [GATEHOUSE_KEY, PORTCULLIS_KEY], ringRoleSlugs: ["censor"] },
  });
  await prisma.characterTag.create({ data: { characterId: clerk.id, tagId: ring.id, quantity: 1, equipped: true, source: "EVENT" } });
  await give(clerk, 3);

  const inbound = await person("in", "bridge", "Inbound");
  await give(inbound, 5);
  const outbound = await person("out", "town-2", "Outbound");
  const doomed = await person("doomed", "bridge", "Doomed");
  const plain = await person("plain", "town-1", "Plain");
  const turn = { id: `gh-test-turn-${run}`, number: 999 };

  // ── Asking ──
  const inside = await G.requestPassage(prisma, uid(clerk), { roomSlug: GATE_ROOM_SLUG, text: "Let me out" });
  assert.equal(inside.error, T.requestInside, "nobody asks from inside the gatehouse");
  const asked = await G.requestPassage(prisma, uid(inbound), {
    roomSlug: GATE_ROOM_SLUG,
    text: "A trader, with coin.",
    offered: [{ tagId: coin.id, quantity: 5 }],
  });
  assert.equal(asked.ok, true);
  assert.equal((await G.passageView(prisma, uid(inbound), { roomSlug: GATE_ROOM_SLUG })).direction, "IN");
  assert.equal((await G.requestPassage(prisma, uid(outbound), { roomSlug: GATEHOUSE_WINDOW_ROOM_SLUG, text: "Out, please." })).ok, true);
  assert.equal((await G.requestPassage(prisma, uid(doomed), { roomSlug: GATE_ROOM_SLUG, text: "Let me in." })).ok, true);

  // ── The terminal ──
  assert.equal((await G.processView(prisma, uid(plain))).error, T.processNoRing, "the terminal wants the ring");
  const view = await G.processView(prisma, uid(clerk));
  assert.equal(view.ok, true);
  assert.ok(view.into.length >= 2);
  const inRow = view.into.find((r) => r.text === "A trader, with coin.");
  assert.deepEqual(inRow.offered.map((l) => l.quantity), [5]);
  assert.ok(view.outOf.some((r) => r.text === "Out, please."));

  // ── Leaving withdraws ──
  const { applyArrivalFacts } = require("../lib/locationMove");
  await applyArrivalFacts(prisma, { characterId: outbound.id, fromLocationId: at["town-2"].id, toLocationId: at["town-3"].id });
  assert.equal(await prisma.gatePassage.count({ where: { characterId: outbound.id, status: "PENDING" } }), 0);

  // ── Approve, with a bribe taken and a coin given back ──
  const approved = await G.approvePassage(prisma, uid(clerk), {
    passageId: inRow.id,
    keep: [{ tagId: coin.id, quantity: 3 }],
    give: [{ tagId: coin.id, quantity: 1 }],
    turn,
  });
  assert.equal(approved.ok, true, approved.error);
  assert.equal(await coins(inbound), 3, "5 offered, 3 taken, 1 handed over");
  assert.equal(await coins(clerk), 5);
  assert.equal((await prisma.character.findUnique({ where: { id: inbound.id } })).locationId, at["town-2"].id);
  assert.equal((await G.approvePassage(prisma, uid(clerk), { passageId: inRow.id })).error, T.requestGone);

  // ── Magma: kills those coming in, once a turn ──
  assert.equal((await G.requestPassage(prisma, uid(outbound), { roomSlug: GATEHOUSE_WINDOW_ROOM_SLUG, text: "Out." })).ok, true);
  const poured = await G.pourMagma(prisma, uid(clerk), { turn });
  assert.equal(poured.ok, true, poured.error);
  assert.equal((await prisma.character.findUnique({ where: { id: doomed.id } })).status, "DEAD");
  assert.equal((await prisma.character.findUnique({ where: { id: outbound.id } })).status, "ALIVE", "leaving is never punished");
  const late = await person("late", "bridge", "Late");
  await G.requestPassage(prisma, uid(late), { roomSlug: GATE_ROOM_SLUG, text: "Me too." });
  assert.equal((await G.pourMagma(prisma, uid(clerk), { turn })).error, T.magmaOnce);

  // ── Deny, and the history ──
  const outRow = (await G.processView(prisma, uid(clerk))).outOf.find((r) => r.text === "Out.");
  assert.equal((await G.denyPassage(prisma, uid(clerk), { passageId: outRow.id, turn })).ok, true);
  const history = await G.passageHistory(prisma, uid(clerk));
  const statuses = history.rows.filter((r) => ["A trader, with coin.", "Let me in.", "Out."].includes(r.text)).map((r) => r.status);
  assert.deepEqual(statuses.sort(), ["APPROVED", "DENIED", "MAGMA"]);
  assert.ok(history.rows.every((r) => !r.by.includes("undefined")));
  assert.ok(history.rows.some((r) => r.by.includes("Censor's Ring")));

  // ── Documents ──
  const migrant = await person("migrant", "bridge", "Migrant");
  assert.equal((await G.submitDocumentation(prisma, uid(migrant), { turn })).ok, true);
  assert.equal((await G.submitDocumentation(prisma, uid(migrant), { turn })).error, T.documentWaiting);
  const docs = await G.documentsView(prisma, uid(plain));
  assert.equal(docs.ok, true, "Create Documents is anybody's in the room");
  const submission = docs.pending.find((p) => p.id);
  const mine2 = await prisma.gateDocumentation.findFirst({ where: { characterId: migrant.id, status: "PENDING" } });
  assert.ok(submission && mine2);
  assert.equal((await G.approveDocumentation(prisma, uid(plain), { submissionId: mine2.id, name: " ", occupation: "x" })).error, T.needBoth);
  const printed = await G.approveDocumentation(prisma, uid(plain), {
    submissionId: mine2.id,
    name: "Ivo Stone",
    occupation: "Mason",
    turn,
  });
  assert.equal(printed.ok, true, printed.error);
  const account = await prisma.bankAccount.findUnique({ where: { characterId: migrant.id } });
  assert.equal(account.balanceObols, -10);
  assert.equal(account.holderName, "Ivo Stone");
  const paper = await prisma.characterTag.findFirst({
    where: { characterId: plain.id, tag: { paperKind: "DOCUMENTS" } },
    include: { tag: true },
  });
  assert.equal(paper.tag.documentsBankAccountId, account.id);
  assert.match(paper.tag.paperText, /PIN: \d{4}/);
  assert.equal((await G.submitDocumentation(prisma, uid(migrant), { turn })).error, T.documentAlready);
  assert.ok((await G.documentsView(prisma, uid(plain))).register.some((r) => r.name === "Ivo Stone" && r.occupation === "Mason"));

  // ── A refused submission ──
  const refused = await person("refused", "bridge", "Refused");
  assert.equal((await G.submitDocumentation(prisma, uid(refused), { turn })).ok, true);
  const theirs = await prisma.gateDocumentation.findFirst({ where: { characterId: refused.id, status: "PENDING" } });
  assert.equal((await G.denyDocumentation(prisma, uid(plain), { submissionId: theirs.id, turn })).ok, true);

  // ── The lever: anybody in Gate Controls, and on the record ──
  const { toggleGate, GATE_CHARACTER_SELECT } = require("../lib/gates");
  const bridgeGate = (await prisma.locationLink.findMany({ include: { a: true, b: true } })).find((l) => remoteLeverFor(l));
  const leverRoom = await prisma.room.findUnique({ where: { slug: GATE_CONTROLS_ROOM_SLUG } });
  const puller = await prisma.character.findUnique({ where: { id: plain.id }, select: GATE_CHARACTER_SELECT });
  for (let i = 0; i < 2; i++) {
    // Twice, so the gate ends as it began.
    const flipped = await toggleGate(prisma, { character: puller, linkId: bridgeGate.id, actorDiscordUserId: uid(plain) });
    assert.equal(flipped.ok, true, flipped.error);
  }
  const pulls = await prisma.auditLog.findMany({
    where: { actorDiscordUserId: uid(plain), actionType: { in: ["gate_opened", "gate_closed"] } },
  });
  assert.equal(pulls.length, 2);
  assert.ok(pulls.every((row) => row.roomId === leverRoom.id && row.locationId === leverRoom.locationId));

  // ── Everything done at the controls is in the audit log and the archive ──
  const clerkRows = await prisma.auditLog.findMany({
    where: { actorDiscordUserId: { in: [uid(clerk), uid(plain)] } },
    select: { actionType: true, roomId: true },
  });
  for (const type of ["gate_passage_approved", "gate_passage_denied", "gate_magma", "documents_issued", "documentation_denied"]) {
    const row = clerkRows.find((r) => r.actionType === type);
    assert.ok(row, `${type} is audited`);
    assert.equal(row.roomId, leverRoom.id, `${type} names Gate Controls`);
  }
  const archived = await prisma.archiveEntry.findMany({
    where: { kind: "GATEHOUSE", characterId: { in: [clerk.id, plain.id] } },
    orderBy: { seq: "asc" },
  });
  const lines = archived.map((row) => row.content);
  // The magma takes everybody waiting to come in, and a local database may
  // hold other people waiting besides this run's.
  assert.ok(lines[1].startsWith(T.archiveMagma(clerk.name, "").split(".")[0]) && lines[1].includes(doomed.name));
  lines[1] = "magma";
  assert.deepEqual(lines, [
    T.archiveApproved(clerk.name, inbound.name, "IN", `${coin.name} ×3`, coin.name),
    "magma",
    T.archiveDenied(clerk.name, outbound.name, "OUT"),
    T.archiveDocuments(plain.name, migrant.name, "Ivo Stone", "Mason"),
    T.archiveDocumentsDenied(plain.name, refused.name),
    T.archiveGate(plain.name, !bridgeGate.isOpen, bridgeGate.a.name, bridgeGate.b.name),
    T.archiveGate(plain.name, bridgeGate.isOpen, bridgeGate.a.name, bridgeGate.b.name),
  ]);
  assert.ok(archived.every((row) => row.placeKey === null), "never on a feed");
  const migrantPin = (await prisma.character.findUnique({ where: { id: migrant.id } })).pin;
  assert.ok(!lines.some((line) => line.includes(migrantPin)), "the PIN is never archived");

  // ── The infoterminal reads the papers, and asks a stranger for the PIN ──
  const holder = await prisma.character.findUnique({
    where: { id: plain.id },
    include: { tags: { include: { tag: true } } },
  });
  const asked2 = await terminalAccount(prisma, holder);
  assert.equal(asked2.pinNeeded, true);
  const pin = (await prisma.character.findUnique({ where: { id: migrant.id } })).pin;
  const opened = await terminalAccount(prisma, holder, { pin });
  assert.equal(opened.account?.id, account.id);

  // ── A debt is paid down, never written off, and never drawn on ──
  const paid = await prisma.$transaction((tx) => bumpBankAccount(tx, account.id, 3, null));
  assert.deepEqual([paid.before, paid.after], [-10, -7]);
  const drawn = await prisma.$transaction((tx) => bumpBankAccount(tx, account.id, -5, null));
  assert.equal(drawn.delta, 0);
});
