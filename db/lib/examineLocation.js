// The Examine readout: what can be worked here, what the place IS, and what
// the ways out are doing. One composer, so the anchor's Examine button and
// Chat's Examine dialog answer the same three questions in the same order.
//
// Information only — it files nothing, costs nothing, and is deliberately
// readable by anyone standing here whether or not they hold Prospecting.
// Scouting a place is the point, and a scout reporting back to a digger is a
// conversation the game wants.
const { qualityWord } = require("./miningYield");
const { workVerbFor } = require("./gathering");
const { linksFor, endpoints } = require("./locationGraph");
const { anchorGateFor, remoteLeverFor } = require("./gateControls");
const { GATEHOUSE_TEXT } = require("./gatehouseText");
const { describeLocation, hasAttribute } = require("./locationAttributes");
const { loadDepot } = require("./depotState");
const { trainHere } = require("./train");
const { structuresAt } = require("./structures");
const { isDayLongTurn } = require("./turnClock");

// Returns { ok: true, name, lines } or { ok: false, error }. `lines` is
// plain text — whichever face is asking adds its own `»` or its own markup.
async function examineLines(prisma, locationId) {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: {
      name: true,
      slug: true,
      indoors: true,
      attributes: true,
      mining: { select: { current: true } },
      // The verb the place wears — Mining underground, Gathering in the hills
      // (db/lib/gathering.js) — so the readout says what the button says.
      zone: { select: { slug: true } },
    },
  });
  if (!location) return { ok: false, error: "That place is gone." };

  // The gate state is read through the graph rather than off any button,
  // because a GM can flip an edge without anyone refreshing a message and
  // Examine must never be the stale one.
  const links = await linksFor(prisma, locationId);
  const gates = links
    .filter((link) => link.modular)
    .map((link) => ({
      isOpen: link.isOpen,
      farName: endpoints(link, locationId).far.name,
      // Where it is worked from, when that is not a watchtower (db/lib/gateControls.js).
      workedFrom: remoteLeverFor(link)
        ? GATEHOUSE_TEXT.workedFromLever
        : anchorGateFor(link)
          ? GATEHOUSE_TEXT.workedFromRings
          : null,
    }));

  // No row means you cannot dig here at all (MINING.md §3), so the line is
  // left off entirely rather than printed as a permanent ×. A row that has
  // drifted to 0 still prints — that is a place worth checking back on, not
  // one that can never pay.
  const miningLine = location.mining
    ? `**${workVerbFor(location.zone?.slug).examineLabel}**: ${qualityWord(location.mining.current)}`
    : null;

  // The Depot's machinery and anything standing on the ground are LIVE state,
  // so they are loaded here and handed to describeLocation as ctx rather than
  // being authored on the Location.
  let depot = null;
  if (hasAttribute(location, "depot")) {
    const [row, openTurn] = await Promise.all([
      loadDepot(prisma),
      prisma.turn.findFirst({ where: { status: "OPEN" }, orderBy: { number: "desc" }, select: { number: true } }),
    ]);
    depot = {
      turretArmed: row.turretArmed,
      trainHere: trainHere(openTurn?.number ?? 0),
    };
  }
  const structures = await structuresAt(prisma, locationId);
  // A building going up counts its progress in turns, and only a whole-day turn is a day (turnClock.js#isDayLongTurn).
  // Read only when there is one, so a place with nothing under construction costs no extra query.
  const dayLongTurn = structures.some((s) => s.status === "UNDER_CONSTRUCTION")
    ? isDayLongTurn(await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { turnLengthHours: true } }))
    : true;

  return {
    ok: true,
    name: location.name,
    // A place with no LocationMining row at all (Town) has nothing to say
    // here — dropped rather than printed as an empty line, same as every
    // other part of this readout that has nothing to say.
    lines: [...(miningLine ? [miningLine] : []), ...describeLocation(location, { gates, depot, structures, dayLongTurn })],
  };
}

module.exports = {
  examineLines,
};
