// The slot machine's numbers and the words on its front, on both the Discord
// button and the Chat dialog.
//
// Zero requires, on purpose, like db/lib/dmKinds.js:
// web/app/(app)/chat/PlacePanel.js is a client component, and db/lib/slotMachine.js
// requires the ledger, which requires Prisma — importing the machine from the
// browser would drag PrismaClient into the bundle and crash /chat on open.

const SLOT_COST = 5;

// The table, and the only place it is authored. Three dice, 216 outcomes:
//
//   three alike        6/216 =  2.78%   50 ¢
//   a run, any order  12/216 =  5.56%   15 ¢   (1-2-3 or 4-5-6)
//   exactly a pair    90/216 = 41.67%    6 ¢
//   nothing          108/216 = 50.00%    —
//
// Expected return 4.72 ¢ on a 5 ¢ stake: a 5.6% house edge. Half of spins pay
// something, so the edge lives in the money rather than in how often the
// lights come on — which is how a real machine keeps its cut and still feels
// worth another five. db/test/slotMachine.test.js checks the odds still add up.
const SLOT_PAYOUTS = Object.freeze({ triple: 50, run: 15, pair: 6 });

const SLOT_MAX_PAYOUT = Math.max(...Object.values(SLOT_PAYOUTS));

// What the machine asks before it takes anything.
const SLOT_PROMPT = `Playing slots costs ${SLOT_COST} obols. Enter coins?`;

module.exports = { SLOT_COST, SLOT_PAYOUTS, SLOT_MAX_PAYOUT, SLOT_PROMPT };
