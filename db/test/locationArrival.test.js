// The seam between an arrival's two halves (db/lib/locationMove.js).
//
// `applyArrivalFacts` is the GAME: where they stand, what they can see, what let
// go of them, what shot at them. `applyArrivalDiscord` is the TELLING: channel
// access, roles, threads, the lines, the DMs. The web's mover awaits the first
// and defers the second to after(), because awaiting Discord inside a server
// action freezes the page (ARCHITECTURE.md §4) — a travel click used to sit
// there for minutes, and on an eight-hop walk for very much longer.
//
// A SOURCE CHECK, deliberately, rather than standing up a world. The thing that can quietly break this is
// somebody adding a Discord call to the facts half — the halves would still
// both run for every caller of the wrapper, every test would pass, and the
// click would just be slow again. Only reading the file catches that.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  applyLocationMoveSideEffects,
  applyArrivalFacts,
  applyArrivalDiscord,
} = require("../lib/locationMove");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "lib", "locationMove.js"), "utf8");

// The facts half runs from its own signature to the Discord half's.
function halves() {
  const factsAt = SOURCE.indexOf("async function applyArrivalFacts(");
  const discordAt = SOURCE.indexOf("async function applyArrivalDiscord(");
  const wrapperAt = SOURCE.indexOf("async function applyLocationMoveSideEffects(");
  assert.ok(factsAt > -1, "applyArrivalFacts is gone");
  assert.ok(discordAt > factsAt, "applyArrivalDiscord must come after applyArrivalFacts");
  assert.ok(wrapperAt > discordAt, "the wrapper must come after both halves");
  return { facts: SOURCE.slice(factsAt, discordAt), discord: SOURCE.slice(discordAt, wrapperAt) };
}

test("both halves and the wrapper are exported, and all three are functions", () => {
  for (const [name, fn] of Object.entries({
    applyLocationMoveSideEffects,
    applyArrivalFacts,
    applyArrivalDiscord,
  })) {
    assert.equal(typeof fn, "function", `${name} is not a function`);
  }
});

test("the game half makes no Discord calls, so nothing a player waits for can be slow", () => {
  const { facts } = halves();

  // Every helper in this file that reaches Discord, bar the two exceptions
  // below. If a new one is added it belongs in the Discord half — or, if it
  // genuinely cannot be, in the exception list with a comment saying why.
  const reachesDiscord = [
    "openLocationTo",
    "closeLocationTo",
    "swapRole",
    "announceGateCrossing",
    "offerToHoldKeyed",
    "reconcileNarrowcastAccess",
    "syncCharacterRoomAccess",
    "applyPendingInvites",
    "syncPartyMembership",
    "deliverCarryDrop",
  ];
  for (const helper of reachesDiscord) {
    assert.ok(
      !facts.includes(`${helper}(`),
      `${helper}() is called in the FACTS half — that is work a player's click would wait on. ` +
        "Move it into applyArrivalDiscord.",
    );
  }
});

test("the turret keeps its announcement, which is the documented exception", () => {
  const { facts } = halves();

  // A turret kills ABOVE the guard on purpose: being shot is a database fact
  // and must not wait on there being a token (locationMove.js's own comment,
  // and the note on announceTurretBurst). Its letter and burst ride along
  // beside the roll rather than being deferred, because a death announced late
  // reads as a death that did not happen. Rare enough to cost a living arrival
  // nothing.
  assert.ok(facts.includes("announceTurretBurst("), "the turret burst left the facts half");
});

test("the web is told where they stand before Discord is told anything", () => {
  const { facts, discord } = halves();

  // notifyPresence is a Postgres NOTIFY, not a Discord call: it is what makes
  // every open /chat tab re-ask where this character is (CHAT.md §3). It has to
  // fire in the FACTS half, or the one thing the player is actually waiting for
  // would be stuck behind the rate-limited half.
  assert.ok(facts.includes("notifyPresence("), "the facts half must notify presence");
  // And again at the end of the telling, once room and party membership have
  // settled — it is idempotent, and cheap.
  assert.ok(discord.includes("notifyPresence("), "the Discord half must notify presence again when it lands");
});

test("the walk hands its hops' telling back rather than doing it", () => {
  const walk = fs.readFileSync(path.join(__dirname, "..", "lib", "locationWalk.js"), "utf8");

  // The eight-hop case is the one that hurt most: a full arrival per hop, each
  // several rate-limited Discord round trips, all inside one click.
  assert.ok(
    walk.includes("applyArrivalFacts("),
    "the walk must run the GAME half per hop — a turret has to have its say before the next hop starts",
  );
  assert.ok(
    !walk.includes("applyLocationMoveSideEffects("),
    "the walk must not run both halves per hop; that is the click that took minutes",
  );
  assert.ok(walk.includes("arrivalFacts"), "the walk must hand its hops' Discord halves back");
  assert.ok(
    walk.includes("sideEffectsApplied: true"),
    "still required, or the caller re-runs the single-hop loop and every turret fires twice",
  );
});
