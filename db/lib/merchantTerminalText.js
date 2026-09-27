// The Merchant's Terminal's words, on both the Discord panel and the Chat
// dialog (docs/systemdocs/DEPOT.md §0c).
//
// Zero requires, on purpose, like db/lib/blackMarketText.js: the Chat dialog is
// a client component, and db/lib/merchantTerminal.js requires the ledger, which
// requires Prisma.

// The ring token that unlocks the terminal besides the Merchant's License. The
// Merchant's own ring carries it (docs/roles.yaml), and nobody else's: the
// Dockers' rings carry the depot-keycard token and not this one.
const MERCHANT_TERMINAL_TOKEN = "merchants-terminal-key";

// Taxes are whole obols (Depot Overhaul.docx: "Fractional obols cannot
// exist"): the Meister's rate on a sum, rounded to the nearest. Here rather
// than in a module with requires so the dialog can price a cart the way the
// server will.
function taxOn(gross, rate) {
  const pct = Math.max(0, Math.min(100, Math.trunc(rate ?? 0)));
  if (!pct || !(gross > 0)) return 0;
  return Math.min(gross, Math.round((gross * pct) / 100));
}

// What a cart costs the terminal when the train brings it: the goods and the
// tax on them, both whole.
function withTax(subtotal, rate) {
  const s = Math.max(0, Math.trunc(subtotal ?? 0));
  return s + taxOn(s, rate);
}

const MERCHANT_TERMINAL_TEXT = Object.freeze({
  button: "Merchant's Terminal",
  title: "Merchant's Terminal",
  noCharacter: "You don't have a living character.",
  notHere: "You're not standing at the Depot.",
  cantAct: (what) => `You can't do that now — you're ${what}.`,
  noCoin: "The obol isn't in the catalog yet. A GM needs to run the tag sync.",
  jammed: "The terminal jammed. Try again.",

  locked: "LOCKED",
  lockedPrompt: "The screen asks for the Merchant's License, or the Merchant's ring.",
  unlockButton: "Unlock",
  refused: "Access denied.",

  tabOrder: "Order",
  tabPending: "Pending orders",

  holds: (n) => `The terminal holds ${n} ¢.`,
  committed: (n) => `${n} ¢ of it is promised to pending orders.`,
  carrying: (n) => `You're carrying ${n} ¢.`,
  taxNote: (rate) =>
    rate > 0
      ? `Prices include the Meister's ${rate}% tax. It is taken on the whole train, so a total can be an obol off the sum of its lines.`
      : "The Meister takes no tax right now.",

  insertLabel: "Insert obols",
  insertButton: "Insert",
  withdrawLabel: "Withdraw obols",
  withdrawButton: "Withdraw",
  noCoins: "You don't have any obols to put in.",
  insertAmount: (carried) => `Input between 1 and ${carried} ¢.`,
  withdrawAmount: (free) => `Input between 1 and ${free} ¢.`,
  nothingFree: "Every obol in the terminal is promised to pending orders.",
  youInserted: (n, total) => `You feed ${n} ¢ into the terminal. It holds ${total} ¢.`,
  youWithdrew: (n, total) => `The terminal pays out ${n} ¢. It holds ${total} ¢.`,

  emptyShelf: "The terminal lists nothing for sale.",
  quantityLabel: "How many?",
  orderButton: "Order",
  saveButton: "Save",
  removeButton: "Remove",
  cartTotal: (n) => `Order total: ${n} ¢`,
  pendingTotal: (n) => `${n} ¢ before tax`,
  nothingPicked: "You didn't order anything.",
  tooManyLines: (n) => `More than ${n} lines — split the order.`,
  notAQuantity: "That isn't a quantity.",
  notStocked: "The terminal doesn't list that.",
  onlyOne: (name) => `The Company won't ship more than one ${name} in an order.`,
  notEnough: (cost, holds) =>
    `With what is already on order, that comes to ${cost} ¢, and the terminal holds ${holds} ¢.`,
  youOrdered: (summary, total) => `Ordered: ${summary} — ${total} ¢ before tax, paid when the train comes in.`,
  noOrder: "That order isn't pending any more.",
  orderSaved: "Order changed.",
  orderRemoved: "Order removed.",
  noPending: "Nothing is on order.",
  placedBy: (name, turn) => `Ordered by ${name}, turn ${turn}`,
});

module.exports = { MERCHANT_TERMINAL_TOKEN, MERCHANT_TERMINAL_TEXT, taxOn, withTax };
