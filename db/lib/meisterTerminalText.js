// Every line a player reads on the Meister's Terminal, on both faces
// (docs/systemdocs/MEISTERY.md), in one table so a copy pass edits one file.
// Zero requires, so a "use client" component may import it.
//
// {braces} are filled in by fillMeisterText; everything else is literal.
//
// Three more pieces of the Meistery's text live where the game reads them, not
// here: the Meistery Window's description (docs/zones.yaml fortress-5-4, and
// the INSERT in migration 20261120000000_meistery), the Meister's role
// description (docs/roles.yaml) and the Economy paper (docs/documents.yaml).

// The Baron's seat. Its account is the treasury itself (Meistery.docx), so the
// terminal never edits it, closes it, or pays it a wage.
const BARON_ROLE_SLUG = "baron";

// The terminal's bounds. The doc sets no figures; these keep a typo from
// minting a fortune, and fit a Discord modal field.
const MAX_BALANCE = 999999;
const MAX_WAGE = 9999;

const MEISTER_TERMINAL_TEXT = {
  // ─── The frame ───────────────────────────────────────────────────────────
  button: "Meister's Terminal",
  title: "The Meister's Terminal",
  loading: "The screen flickers on…",
  noCharacter: "You don't have a living character.",
  noTerminal: "There's no terminal here.",
  notHere: "The terminal is in the Meister's Study.",
  noStudy: "The Meister's Study isn't in the database yet.",
  accessDenied: "The terminal won't answer to you. It reads the Meister's, the Hand's or the Baron's ring.",
  cantAct: "You can't act — you're {state}.",

  // ─── The totals, always on top ───────────────────────────────────────────
  totalVault: "Treasury",
  totalClaimed: "Claimed",
  totalOnOrder: "On order",
  totalTax: "Tax",
  totalWages: "Wages a day",
  short: "The treasury holds less than the accounts claim — withdrawals will be refused.",

  // ─── Tax ─────────────────────────────────────────────────────────────────
  taxLabel: "Tax rate, percent",
  taxHelp:
    "The tax is taken on everything the train brings in and everything it takes away, once per train on the whole load. It deposits in the treasury.",
  taxSet: "Set it",
  taxBounds: "A rate is a whole number from 0 to 100.",
  taxDone: "The tax is {rate}% now.",

  // ─── Tabs ────────────────────────────────────────────────────────────────
  tabAccounts: "Accounts",
  tabWages: "Wages",
  tabRings: "Rings",
  tabLedger: "Ledger",

  // ─── Accounts ────────────────────────────────────────────────────────────
  searchAccounts: "Search accounts",
  colHolder: "Holder",
  colFingerprint: "Fingerprint",
  colFate: "Fate",
  colClass: "Class",
  colBalance: "Balance",
  colWage: "Wage",
  classTreasury: "Treasury",
  classOffshore: "Offshore",
  classCrown: "Crown",
  noAccounts: "No accounts yet.",
  noAccount: "There's no account like that.",
  lockedBadge: "Locked",
  lockedNote: "The Baron's account is the treasury itself. It can't be edited or closed.",
  balanceLabel: "Balance",
  balanceSet: "Set balance",
  balanceBounds: "A balance is a whole number from {min} to {max}.",
  balanceLocked: "The Baron's account can't be edited.",
  balanceDone: "{name}'s balance is {balance} ¢ now.",
  balanceSame: "{name}'s balance is already {balance} ¢.",
  deleteButton: "Close account",
  deleteConfirm: "Close {name}'s account? Its balance is written off, and any documents printed for it stop working.",
  deleteDone: "{name}'s account is closed.",
  deleteGone: "That account is already closed.",
  deleteLocked: "The Baron's account can't be closed.",
  deletePending: "{name} still has goods on order from the old counter. Close the account once they've arrived.",
  backToAccounts: "← All accounts",

  // ─── Wages ───────────────────────────────────────────────────────────────
  wagesHelp:
    "A wage is paid at the end of every in-game day. A negative wage takes that much instead. A character's own wage replaces their fate's; set it to 0 to exempt them.",
  wagesByFate: "By fate",
  wagesByCharacter: "By character",
  wageLabel: "Daily wage",
  wageSave: "Save",
  wageClear: "Clear",
  wageAdd: "Set a wage",
  wagePickCharacter: "Character",
  wageNone: "—",
  fateHolders: "{count} with accounts",
  wageFromFate: "fate",
  wageOwn: "own",
  wageBounds: "A wage is a whole number from {min} to {max}.",
  wageBaron: "The Baron's account is the treasury itself. It takes no wage.",
  wageNoFate: "That fate doesn't exist.",
  wageNoCharacter: "That character has no account to pay into.",
  wageSetDone: "{name}'s wage is {amount} ¢ a day now.",
  wageClearedDone: "{name}'s wage is cleared.",
  noCharacterWages: "No character has a wage of their own.",
  dailyBill: "Paid each day: {credit} ¢ in, {debit} ¢ out.",

  // ─── Rings ───────────────────────────────────────────────────────────────
  registerTitle: "Register a ring",
  registerIntro:
    "Hold a ring that isn't connected to an account yet. Choose what access it grants and which account it reaches.",
  registerNone: "You aren't holding a ring that needs an account.",
  registerRoles: "Grants the access of",
  registerSeatsFixed: "This ring is already registered to {roles}. Only its account can be connected.",
  registerSeatsFixedNone: "This ring is already registered, with no access. Only its account can be connected.",
  registerAccountNew: "Open a new account for {name}",
  registerAccountOwn: "{name}'s account",
  registerAccountExisting: "Link an existing account",
  registerConfirm: "Register",
  registerDone: "Registered. The ring now grants {roles} access.",
  registerDoneNone: "Registered. The ring reaches its account and grants no access.",
  registerDoneAccount: "Connected. The ring now reaches {name}'s account.",
  // A seat whose access only its holder of office may hand out (`ring.authorised_by`).
  registerNeedsAuth: "Granting the {role}'s access needs the {item} in your hands.",
  registerAlready: "That ring is already connected to an account.",
  registerNoSeat: "That seat doesn't exist.",
  registerOwnerGone: "Whoever this ring was made for is gone. Link an existing account.",
  ringLabel: "Ring",
  accountLabel: "Account",

  // ─── Ledger ──────────────────────────────────────────────────────────────
  searchLedger: "Search transactions",
  ledgerEmpty: "No transactions yet.",
  colTurn: "Turn",
  colType: "Type",
  colDetail: "Detail",
  colAmount: "Amount",
  ledgerAllAccounts: "All accounts",
  ledgerTheTreasury: "the treasury",
  ledgerFrom: "from {name}",
  ledgerTo: "to {name}",
  // One row for a whole payout of wages, in the unfiltered view.
  ledgerWageDay: "{count} accounts",
  ledgerSale: "{quantity} × {name} — {gross} ¢ less {tax} ¢ tax",
  ledgerSaleToTreasury: ", paid to the treasury",
  ledgerAnonymous: "Anonymous",

  // ─── Discord only ────────────────────────────────────────────────────────
  setTaxButton: "Set tax",
  wageButton: "Wage",
  clearSearch: "Clear search",
  searching: "Searching for \"{query}\".",
  prev: "Prev",
  next: "Next",
  back: "Back",
  search: "Search",
  history: "History",
  continue: "Continue",
  cancel: "Cancel",
  pageOf: "Page {page} of {pages}",
  pickAccount: "Pick an account…",
  pickFate: "Pick a fate…",
  pickRing: "Pick a ring…",
  pickSeats: "Grant the access of…",
  pickAccountFor: "Which account?",
  byFingerprint: "By fingerprint…",
  fingerprintLabel: "Fingerprint",
  noSuchFingerprint: "There's no account with that fingerprint.",
  searchLabel: "Name or fingerprint",
  wageBlankClears: "Leave it blank to clear it.",
  draftExpired: "That took too long. Start again.",
};

// What a ledger row calls each kind of movement. EconomyEntry reasons
// (db/lib/economyReasons.js) on the left, what the Meister reads on the right.
const MEISTER_LEDGER_KINDS = {
  BANK_DEPOSIT: "Deposit",
  BANK_WITHDRAWAL: "Withdrawal",
  CHARACTER_START: "Opening balance",
  BANK_TRANSFER: "Transfer",
  DOCUMENTS_FEE: "Documents fee",
  ACCOUNT_CLOSED: "Account closed",
  WAGE: "Wage",
  WAGE_DEDUCTION: "Wage deducted",
  MEISTER_CREDIT: "Balance raised",
  MEISTER_DEBIT: "Balance lowered",
  IMPORT_TAX: "Import tax",
  EXPORT_TAX: "Export tax",
  SELL_TAX: "Sell tax",
  ORDER: "Order",
  SALE: "Sale",
  WAGE_DAY: "Wages",
};

// Initials end in a full stop ("A.V."), so one set at the end of a sentence
// would print "A.V.." — the doubled stop is folded into one (ringText.js does
// the same).
function tidyStops(text) {
  return text.replace(/\.\.(?=\s|$)/g, ".");
}

function fillMeisterText(key, vars = {}) {
  const template = MEISTER_TERMINAL_TEXT[key];
  if (template == null) throw new Error(`meisterTerminalText: no line "${key}"`);
  return tidyStops(template.replace(/\{(\w+)\}/g, (whole, name) => (vars[name] != null ? String(vars[name]) : whole)));
}

// "the Baron", "the Baron and the Hand", "the Baron, the Hand and the Meister".
function roleListText(names) {
  const the = (names ?? []).map((n) => `the ${n}`);
  if (the.length <= 1) return the.join("");
  return `${the.slice(0, -1).join(", ")} and ${the[the.length - 1]}`;
}

// "+5 ¢", "-3 ¢", "0 ¢".
function signedObols(amount) {
  return amount > 0 ? `+${amount} ¢` : `${amount} ¢`;
}

module.exports = {
  BARON_ROLE_SLUG,
  MAX_BALANCE,
  MAX_WAGE,
  MEISTER_TERMINAL_TEXT,
  MEISTER_LEDGER_KINDS,
  fillMeisterText,
  roleListText,
  signedObols,
};
