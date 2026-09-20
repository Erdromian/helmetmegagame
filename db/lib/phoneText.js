// The telephone's numbers and every word it says, on the Discord button and
// the Chat dialog alike. See docs/systemdocs/PHONES.md.
//
// Zero requires, on purpose, like db/lib/slotText.js and db/lib/dmKinds.js:
// web/app/(app)/chat/PlacePanel.js is a client component, and db/lib/phone.js
// requires the ledger, which requires Prisma — importing the phone from the
// browser would drag PrismaClient into the bundle and crash /chat on open.
//
// PLACEHOLDER COPY. Every string below is a stand-in written to be replaced;
// none of it has had Bascinet's pass over it yet.

// What a payphone takes, in obols. A named phone takes nothing: it belongs to
// the office it is in, and the officeholder is not renting their own wall.
const PHONE_COST = 1;

// Four rings over 60 seconds, then the line goes dead — modelled on the real
// thing, where a phone gives up rather than ringing until somebody kills it.
// The sweep in bot/src/events/ready.js reads both of these; they are here
// rather than there so the web dialog can say how long is left.
const PHONE_RINGS = 4;
const PHONE_RING_INTERVAL_MS = 15_000;
const PHONE_RING_WINDOW_MS = PHONE_RINGS * PHONE_RING_INTERVAL_MS;

// How long an unanswered payphone call leaves the coin in the slot. The charge
// is for LIFTING THE RECEIVER, not for a number: a real payphone gives your
// obol back when nobody answers, and the nearest thing to that which does not
// need a coin return is simply letting you dial again. Generous on purpose —
// the alternative is charging somebody four times to reach one person who
// happened to be walking between rooms.
const PHONE_PAID_GRACE_MS = 2 * 60_000;

// How much of a bystander's words survive the trip down the line. The same
// fraction a shout loses one Location out (db/lib/shout.js) — a phone carries
// the room behind you, badly, which is the entire social point of the feature.
const PHONE_BACKGROUND_MUFFLE = 0.4;

const PHONE_TEXT = Object.freeze({
  // The payphone's question, asked before it takes anything.
  insert: `The phone costs ${PHONE_COST} ¢. Insert?`,
  // The line a room reads while a phone is ringing in it.
  ringing: "A phone is ringing…",
  busy: "The line is busy.",
  pickedUp: "The person picked up.",
  hungUp: "The person hung up.",
  // What the room reads when somebody in it put the receiver down themselves.
  // Deliberately not `hungUp` — see db/lib/phone.js#hangUp.
  putDown: "They put the receiver down.",
  held: "Someone else is holding the phone.",
  noAnswer: "Nobody picked up.",
  noPhone: "There's no phone here.",
  notHere: "You're not standing by the phone.",
  dialling: "You lift the receiver.",
  // The dropdown's own label. No tooltip — the list is the explanation.
  pick: "Which phone?",
  noneToCall: "There's nobody to call.",
  // What a room hears of a call it is not on. `voice` is the person holding
  // the receiver at the far end; `background` is everyone else in their room.
  voice: (words) => `You hear a voice saying "${words}"`,
  background: (words) => `You hear a voice in the background saying "${words}"`,
});

module.exports = {
  PHONE_COST,
  PHONE_RINGS,
  PHONE_RING_INTERVAL_MS,
  PHONE_RING_WINDOW_MS,
  PHONE_PAID_GRACE_MS,
  PHONE_BACKGROUND_MUFFLE,
  PHONE_TEXT,
};
