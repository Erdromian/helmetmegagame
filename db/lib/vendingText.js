// The Merchant's vending machine: its numbers, its clock, and every word a
// player reads off it (docs/systemdocs/VENDING.md).
//
// The clock is here rather than in db/lib/vending.js because BOTH faces count
// down — Chat's dialog has to show the seconds ticking, and it cannot import the
// engine without dragging Prisma into the browser. One implementation, so the
// countdown on screen and the refusal on the server can never disagree.
//
// Zero requires, on purpose, like db/lib/slotText.js and db/lib/dropboxText.js:
// web/app/(app)/chat/PlacePanel.js is a client component, and db/lib/vending.js
// requires the ledger, which requires Prisma — importing the machine from the
// browser would drag PrismaClient into the bundle and crash /chat on open.
// db/lib/vending.js re-exports all of this, so a server caller keeps one import.
//
// ¢ is the coin and ⬢ is the material, and they are never swapped (CLAUDE.md).
// Every price and every pool here is obols, so every one of them prints ¢.

// Five minutes at the machine, then you are out. The clock is DERIVED from
// VendingMachine.holderSince and never stored as a deadline — see
// db/lib/vending.js#heldBy for why the bot being down must not hand anybody
// extra time.
const VENDING_HOLD_MS = 5 * 60_000;

// A ceiling on a typo, not on ambition. The ledger's `amount` is int4
// (db/lib/economyLedger.js#MAX_INT4) and a price is multiplied by a quantity
// before it gets there.
const VENDING_MAX_PRICE = 999;

// Discord's select menus hold 25 options, so the shelf does too. The web face
// could show more, but then the two faces would disagree about what is in the
// machine, which is worse than a limit.
const VENDING_SHELF_CAP = 25;

const VENDING_TEXT = {
  // --- the panel ----------------------------------------------------------
  title: "Vendor",
  prompt: "Great deals! Don't miss out!",
  promptMerchant: "The maintenance panel hangs open.",
  closed: "A dirty glass terminal reads all manner of goods available to be bought.",
  empty: "The terminal appears blank.",
  emptyMerchant: "The vendor is empty of goods.",

  floatLine: (n) => `${n} ¢ inserted.`,
  floatNone: "No obols inserted.",
  tillLine: (n) => `${n} ¢ earned awaiting withdrawal.`,
  tillNone: "The vendor storage is empty.",

  slotRow: (name, price, held) => `${name} — ${price} ¢ · ${held} left`,
  slotRowFree: (name, held) => `${name} — free · ${held} left`,

  timeLeft: (seconds) => `${seconds} seconds left.`,
  timeLeftLong: (minutes) => `${minutes} minutes left.`,
  holderIs: (who) => `${who} is using the vendor.`,

  // --- buttons ------------------------------------------------------------
  btnOpen: "Vendor",
  btnInsert: "Insert coins",
  btnWithdraw: "Take your change",
  btnBuy: "Buy",
  btnLeave: "Step away",
  btnUnlock: "Unlock",
  btnLock: "Lock",
  btnCollect: "Withdraw earnings",
  btnStockIn: "Put something in",
  btnStockOut: "Take something out",
  btnSetPrice: "Set a price",

  // --- refusals, the customer's side --------------------------------------
  noMachine: "There's no machine here.",
  notHere: "You're not standing at the machine.",
  noCharacter: "You don't have a living character.",
  noDoor: "You can't get in there.",
  cantAct: (what) => `You can't act — you're ${what}.`,
  busy: "Somebody else is at the vendor, be patient.",
  notHolding: "You aren't at the machine.",
  holdLost: "Your time at the vendor ran out.",
  noCoins: "You aren't carrying any coin.",
  insertAmount: (held) => `You're carrying ${held} ¢.`,
  nothingToWithdraw: "There's nothing in the slot.",
  notEnough: (price, float) => `That costs ${price} ¢ and there's ${float} ¢ in the slot.`,
  gone: "That's gone.",
  // carry.js writes its own sentence; passed through rather than rephrased, so
  // the machine refuses a full pack in the same words everything else does.
  noRoom: (reason) => reason,
  alreadyHave: (name) => `You're already carrying a ${name}, and you can only hold one.`,

  // --- refusals, the merchant's side --------------------------------------
  notYours: "The screen flashes red, refusing you access to unlock it.",
  lockedFirst: "The front is locked.",
  tillEmpty: "The till is empty.",
  untradeable: (name) => `A ${name} isn't something you can put in a machine.`,
  noMoneyOnShelf: "Coin goes in the slot, not on the shelf.",
  dontHave: (name, held) => `You're carrying ${held} × ${name}.`,
  notInMachine: "That isn't in the machine.",
  priceRange: (max) => `A price is a whole number of obols, up to ${max}.`,
  shelfFull: (cap) => `The machine holds ${cap} kinds of thing and no more.`,

  // --- what the room reads ------------------------------------------------
  // `who` is always the PRESENTED identity (db/lib/presentedIdentity.js), never
  // the character row — a hooded buyer reads as "A young man" here exactly as
  // they do anywhere else.
  //
  // Insert and Withdraw post NOTHING on purpose. A coin-by-coin line is noise
  // at 100+ players, and what the room is owed is that somebody is at the
  // machine, which roomOpened already said.
  roomOpened: (who) => `${who} steps up to the vending machine.`,
  roomLeft: (who) => `${who} steps away from the vendor.`,
  // Unsigned, and it never names who was kicked — being timed out in public is
  // a humiliation nobody designed.
  roomExpired: (who) => `The vendor makes a whirring noise, informing ${who} that their time is up.`,
  // The default does NOT name the ware: the Depot's counter is not public and
  // neither is this. roomBoughtNamed is the alternative, for Bascinet to pick.
  roomBought: (who) => `${who} buys something from the vendor.`,
  roomBoughtNamed: (who, what) => `${who} takes a ${what} out of the vendor.`,
  roomUnlocked: (who) => `${who} unlocks the front of the vending machine.`,
  roomLocked: (who) => `${who} locks the vendor.`,
  roomRestocked: (who) => `${who} moves things around inside the machine.`,
  roomTill: (who) => `${who} withdraws the machine's earnings.`,

  // --- what the presser alone reads ---------------------------------------
  youHold: (seconds) => `The machine is yours for ${seconds} seconds.`,
  youInserted: (n, total) => `You feed ${n} ¢ in. ${total} ¢ in the slot.`,
  youWithdrew: (n) => `You withdraw ${n} ¢.`,
  youBought: (what, price, left) => `A ${what}, for ${price} ¢. ${left} ¢ left.`,
  youBoughtFree: (what, left) => `A ${what}, free. ${left} ¢ left.`,
  youLeft: "You step away.",
  youLeftEmpty: "You step away.",
  youUnlocked: "The vendor's maintenance panel swings open.",
  youLocked: "The vending machine locks closed.",
  youCollected: (n) => `You empty the vendor — ${n} ¢.`,
  youStockedIn: (n, what, price) => `${n} × ${what} on the shelf, at ${price} ¢ each.`,
  youStockedInFree: (n, what) => `${n} × ${what} on the shelf, free.`,
  youStockedOut: (n, what) => `${n} × ${what} back in your hands.`,
  youPriced: (what, price) => `${what} — ${price} ¢.`,
  youPricedFree: (what) => `${what} — free.`,
  // A DM, and only when there was something to lose. Being told you walked
  // away from nothing is worse than silence.
  kicked: "Your time at the machine ran out.",

  // --- Discord modal and select labels ------------------------------------
  // Discord caps a modal title at 45 characters, a select option label at 100
  // and a description at 100 (db/lib/depotCounter.js).
  modalInsertTitle: "Insert coins",
  modalInsertField: "How many obols",
  modalStockTitle: "Put something in",
  modalStockQtyField: "Quantity",
  modalStockPriceField: "Price in obols, each",
  modalOutTitle: "Take something out",
  modalOutQtyField: "Quantity",
  modalPriceTitle: "Set a price",
  modalPriceField: "Price in obols",
  selectBuy: "What would you like to buy?",
  selectStock: "What goes in?",
  selectOut: "What comes out?",
  selectPrice: "Which line?",
  selectDesc: (price, held) => `${price} ¢ each · ${held} left`,
};

// --- the clock ------------------------------------------------------------
// Pure, and derived from `holderSince` on every read rather than stored as a
// deadline or ticked by a timer (db/lib/phone.js#ringsDueBy is the same bargain
// for the same reason): the bot being down for six minutes must not hand
// somebody an extra six.

/** Whose hold is live right now, or null. NEVER read the column on its own. */
function heldBy(machine, now = Date.now()) {
  if (!machine?.holderId || !machine.holderSince) return null;
  if (now - new Date(machine.holderSince).getTime() >= VENDING_HOLD_MS) return null;
  return machine.holderId;
}

/** Whole seconds left, 0 once it has run out. What the dialog counts down. */
function secondsLeftOn(machine, now = Date.now()) {
  if (!heldBy(machine, now)) return 0;
  const elapsed = now - new Date(machine.holderSince).getTime();
  return Math.max(0, Math.ceil((VENDING_HOLD_MS - elapsed) / 1000));
}

/**
 * Only ever true while a live hold is open. ANDing the column with the clock is
 * what stops a crashed process, a dead merchant or an expired hold leaving the
 * shop standing open — no sweep has to run for the front to be shut.
 */
function unlockedNow(machine, now = Date.now()) {
  return Boolean(machine?.unlocked) && Boolean(heldBy(machine, now));
}

/** The countdown sentence: seconds under a minute, minutes over it. */
function timeLeftLine(machine, now = Date.now()) {
  const seconds = secondsLeftOn(machine, now);
  if (seconds > 60) return VENDING_TEXT.timeLeftLong(Math.ceil(seconds / 60));
  return VENDING_TEXT.timeLeft(seconds);
}

module.exports = {
  VENDING_HOLD_MS,
  VENDING_MAX_PRICE,
  VENDING_SHELF_CAP,
  VENDING_TEXT,
  heldBy,
  secondsLeftOn,
  unlockedNow,
  timeLeftLine,
};
