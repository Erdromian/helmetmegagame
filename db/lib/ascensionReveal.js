// The Rite of Ascension appears in the Grimoire (docs/systemdocs/THANATI.md §5a). Until the cult has
// finished every objective a GM set it, the rite's block is not in the document at all — see
// web/lib/grimoire.js, which composes the body server-side so an unrevealed rite's ingredients,
// chanter count and Word of the Circle are never sent to a browser.
//
// This pass is the automated half: it runs at every turn close, asks whether the work is done, and on
// the FIRST close where it is, stamps GameState.ascensionRevealedTurn and hands back one DM per living
// cultist. DB writes only — the Discord fan-out returns as `dms` for the side-effect thunk, the
// ascensionPass.js contract, because posting inside the turn transaction risks wedging a turn on a 429.
// Takes `prisma` as a parameter — see db/lib/dm.js.
const { listObjectives } = require("./objectives");
const { THANATI_SLUG } = require("./thanati");

const PARTY_KEY = "thanati";

// Bascinet's line, second person: it is read by the cultist it is sent to, not by a GM about them.
const ASCENSION_REVEAL_DM = "You have satisfied Tzchernobog's will. A new goal is available.";

const IDLE = Object.freeze({ revealed: false, dms: [] });

async function runAscensionRevealPass(prisma, turn) {
  const state = await prisma.gameState.findUnique({
    where: { id: 1 },
    select: { ascensionRevealedTurn: true },
  });
  // Already revealed, or there is no game state to reveal anything in. Return an object, not null —
  // null means "retry forever" to the ledger and would wedge every turn from here on.
  if (!state || state.ascensionRevealedTurn != null) return { turnNumber: turn.number, ...IDLE };

  const objectives = await listObjectives(prisma, { partyKey: PARTY_KEY });

  // NO OBJECTIVES IS NOT "ALL DONE". A cult whose GM has not set its objectives yet would otherwise
  // satisfy `every()` vacuously on the first close of the game and be handed the end of the world
  // before anybody had asked it for anything. Bascinet's doc is explicit: none of this happens until
  // the objectives have been selected by GMs and properly completed.
  if (objectives.length === 0) return { turnNumber: turn.number, ...IDLE };
  if (!objectives.every((o) => o.done)) return { turnNumber: turn.number, ...IDLE };

  // Claim it before speaking (the bomb's rule, db/lib/ascensionPass.js): a guarded updateMany on the
  // null, so a resumed advance — or two closes racing — cannot both stamp it and DM the cult twice.
  const { count } = await prisma.gameState.updateMany({
    where: { id: 1, ascensionRevealedTurn: null },
    data: { ascensionRevealedTurn: turn.number },
  });
  if (count !== 1) return { turnNumber: turn.number, ...IDLE };

  // The living cult only. A dead cultist gets no DM, but the stamp is the game's rather than any one
  // character's, so a cultist converted or revived after this close still opens the full Grimoire.
  const cult = await prisma.character.findMany({
    where: { status: "ALIVE", tags: { some: { tag: { slug: THANATI_SLUG } } } },
    select: { id: true, name: true, discordUserId: true },
  });

  return {
    turnNumber: turn.number,
    revealed: true,
    objectives: objectives.length,
    told: cult.filter((c) => c.discordUserId).length,
    dms: cult
      .filter((c) => c.discordUserId)
      .map((c) => ({ discordUserId: c.discordUserId, content: ASCENSION_REVEAL_DM })),
  };
}

module.exports = { runAscensionRevealPass, ASCENSION_REVEAL_DM };
