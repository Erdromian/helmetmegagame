// The telephone's numbers and every word it says, on the Discord keypad and
// the Chat dialog alike. See docs/systemdocs/PHONES.md.
//
// Zero requires, on purpose, like db/lib/slotText.js and db/lib/dmKinds.js:
// web/app/(app)/chat/PlacePanel.js is a client component, and db/lib/phone.js
// requires the ledger, which requires Prisma — importing the phone from the
// browser would drag PrismaClient into the bundle and crash /chat on open.
//
// The lines marked "Bascinet's words" come from the Phones design document,
// brought into house typography (straight quotes). The rest are stand-ins
// that have not had Bascinet's pass yet.

// What a payphone takes, in obols, to dial out or to answer. A named phone
// takes nothing: it belongs to the office it is in, and the officeholder is
// not renting their own wall.
const PHONE_COST = 1;

// How long one obol keeps a payphone in your hand. In the last
// PHONE_OBOL_PROMPT_MS of it the phone asks for another; if none goes in, the
// holder is ejected and any call on the line hangs up.
const PHONE_PAID_MS = 10 * 60_000;
const PHONE_OBOL_PROMPT_MS = 60_000;

// A named phone drops whoever is holding it after this long with no call
// connected, so a receiver cannot be kept off the hook all day.
const PHONE_HOLD_IDLE_MS = 10 * 60_000;

// A phone rings until somebody answers it (or the caller gives up), one ring
// line into the room every interval. The sweep in bot/src/events/ready.js
// runs on the same interval.
const PHONE_RING_INTERVAL_MS = 15_000;

// How long a dud number rings out before the exchange tells you so — a
// number nobody has, or a line that is already busy. The caller hears
// `phone-calling` for this long, then the error.
const PHONE_MISDIAL_MS = 3_000;

// How many digits a number has. Numbers run 1000–9999, so every one of them
// reads as four digits and none starts with a zero.
const PHONE_DIGITS = 4;

// How much of the words survive the trip down the line, for everybody who is
// not holding a receiver. The same fraction a shout loses one Location out
// (db/lib/shout.js).
const PHONE_BACKGROUND_MUFFLE = 0.4;

const PHONE_TEXT = Object.freeze({
  // Bascinet's words. Printed at the phone itself — the only place a number
  // can be matched to a phone, apart from the Phonebook.
  ownNumber: (number) => `This phone's number is ${number}.`,
  // Bascinet's words. The line a room reads, over and over, while its phone
  // rings.
  ringing: "The phone rings urgently.",
  // Bascinet's words, into the dialling room's chat.
  notInService: "The number you are trying to call is no longer in service.",
  busy: "The number you are trying to call is currently busy.",
  // Bascinet's words, into the room at the end that did NOT hang up.
  hungUp: "The call hung up.",

  // The payphone's price, said before it takes anything.
  insert: `The phone costs ${PHONE_COST} ¢.`,
  // The last minute of paid time.
  insertAgain: `The phone wants another ${PHONE_COST} ¢.`,
  held: "Someone else is using the phone.",
  noPhone: "There's no phone here.",
  notHere: "You're not standing by the phone.",
  notHolding: "You aren't holding the phone.",
  hangUpFirst: "Hang up first.",
  badNumber: `Dial all ${PHONE_DIGITS} digits.`,
  nothingToPay: "The phone doesn't want a coin right now.",
  notRinging: "Nothing is ringing here.",
  noCall: "There's no call to hang up.",
  // Into the caller's room, when the far end picks up — or never does.
  farPickedUp: "The person picked up.",
  noAnswer: "Nobody picked up.",

  // Replies to the person pressing the button.
  pickedUp: "You pick up the phone.",
  answered: "You answer the phone.",
  dialled: (digits) => `You dial ${digits}.`,
  hungUpSelf: "You hang up.",
  walkedAway: "You leave the phone hanging.",
  paid: "The coin drops.",

  // What the handset is doing, for the dialog and the Discord keypad.
  stateIdle: "Dial tone.",
  stateCalling: "Ringing…",
  stateConnected: "Connected.",
  stateDead: "The line is dead.",
  stateRinging: "The phone is ringing.",
  timeLeft: "Time left",

  // The controls.
  dial: "Dial",
  hangUp: "Hang up",
  walkAway: "Walk away",
  insertCoin: "Insert obol",
  answer: "Answer",
  clear: "Clear",

  // What a far room hears of a call. `voice` is the person holding the
  // receiver at the other end; `background` is everyone else in their room.
  // Neither ever names anybody (PHONES.md §6).
  voice: (words) => `You hear a voice saying "${words}"`,
  background: (words) => `You hear a voice in the background saying "${words}"`,
});

// A string of exactly PHONE_DIGITS digits, or null. What a keypad sends is
// untrusted, on both faces.
function normalizeDigits(raw) {
  const digits = String(raw ?? "").replace(/\s+/g, "");
  return new RegExp(`^[0-9]{${PHONE_DIGITS}}$`).test(digits) ? digits : null;
}

// "9:05" for a countdown — the payphone's timer on the web.
function clockLeft(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

module.exports = {
  PHONE_COST,
  PHONE_PAID_MS,
  PHONE_OBOL_PROMPT_MS,
  PHONE_HOLD_IDLE_MS,
  PHONE_RING_INTERVAL_MS,
  PHONE_MISDIAL_MS,
  PHONE_DIGITS,
  PHONE_BACKGROUND_MUFFLE,
  PHONE_TEXT,
  normalizeDigits,
  clockLeft,
};
