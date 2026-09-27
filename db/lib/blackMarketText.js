// The Black Market terminal's words, on both the Discord panel and the Chat
// dialog (docs/systemdocs/DEPOT.md §0n).
//
// Zero requires, on purpose, like db/lib/slotText.js and db/lib/dropboxText.js:
// web/app/(app)/chat/PlacePanel.js is a client component, and
// db/lib/blackMarket.js requires the ledger, which requires Prisma — importing
// the terminal from the browser would drag PrismaClient into the bundle.

// The Exactor's Office, where the terminal stands. Here rather than in
// blackMarket.js so db/lib/placeAffordances.js can name the room without
// pulling the ledger in behind it.
const BLACK_MARKET_ROOM_SLUG = "undertown-9-3";

const BLACK_MARKET_TEXT = Object.freeze({
  button: "Black Market",
  title: "Black Market",
  noCharacter: "You don't have a living character.",
  noTerminal: "There's no terminal here.",
  notHere: "You're not standing in the Exactor's Office.",
  noDoor: "You can't get in there.",
  cantAct: (what) => `You can't do that now — you're ${what}.`,
  notYourRing: "Access denied.",
  noCoin: "The obol isn't in the catalog yet. A GM needs to run the tag sync.",
  jammed: "The terminal jammed. Try again.",

  credit: (n) => `Credit: ${n} ¢`,
  carrying: (n) => `You're carrying ${n} ¢.`,
  insertLabel: "Insert obols",
  insertButton: "Insert",
  noCoins: "You don't have any obols to put in.",
  insertAmount: (carried) => `Input between 1 and ${carried} ¢.`,
  // The one thing a player must know before feeding it, and the doc's rule:
  // nothing comes back out. Bascinet's words.
  noWithdraw: "Insert your obols and your desires will wash away.",
  youInserted: (n, total) => `You feed ${n} ¢ into the slot. The terminal holds ${total} ¢.`,

  buyButton: "Buy",
  owned: "You have one",
  total: (n) => `Order total: ${n} ¢`,
  orderLabel: "Order",
  quantityLabel: "How many?",
  emptyShelf: "The terminal lists nothing for sale.",
  nothingPicked: "You didn't order anything.",
  tooManyLines: (n) => `More than ${n} lines — split the order.`,
  notAQuantity: "That isn't a quantity.",
  notStocked: "The terminal doesn't list that.",
  onlyOne: (name) => `The terminal won't sell more than one ${name}.`,
  alreadyHave: (name) => `You already have ${name} and cannot hold another.`,
  // Bascinet's call: the terminal does not say how short you are.
  notEnough: () => "Insufficient funds.",
  noRoom: (reason) => reason,
  youBought: (summary, total, left) => `${summary} — ${total} ¢. The market terminal spits out your order; ${left} ¢ remain.`,
});

module.exports = { BLACK_MARKET_ROOM_SLUG, BLACK_MARKET_TEXT };
