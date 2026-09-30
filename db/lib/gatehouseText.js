// Every line a player reads at the two gates and in the Town Gatehouse
// (Incarn and gates.docx, docs/systemdocs/GATEHOUSE.md), on both the Discord
// panels and the Chat dialogs, in one table so a copy pass edits one file.
//
// Zero requires, on purpose, like db/lib/blackMarketText.js:
// web/app/(app)/chat/PlacePanel.js is a client component, and
// db/lib/gatehouse.js requires the ledger, which requires Prisma — importing
// it from the browser would drag PrismaClient into the bundle.
//
// Lines marked "the doc" are Bascinet's own, with the house copy pass applied.
// Everything else was drafted to fill a gap the doc leaves.

// The places, by slug. Here rather than in gatehouse.js so
// db/lib/placeAffordances.js and db/lib/gateControls.js can name them without
// pulling the ledger in behind them.
const GATEHOUSE_SLUG = "town-1";
const SQUARE_SLUG = "town-2";
const BRIDGE_SLUG = "bridge";
const COURTYARD_SLUG = "fortress-2";
const RESIDENCES_SLUG = "town-8";

const GATE_ROOM_SLUG = "town-1-1";
const GATE_CONTROLS_ROOM_SLUG = "town-1-2";
const INCARNS_CHAMBERS_ROOM_SLUG = "town-1-3";
const GATEHOUSE_WINDOW_ROOM_SLUG = "town-1-4";

// The ring tokens (docs/roles.yaml `ring: opens:`, docs/tags.yaml).
// gatehouse-key: the Baron's, the Hand's, the Incarn's, the Censor's, the
// Cerberi's and the Squires' rings. portcullis-key: the same, plus the
// Meister's, the Baroness's, the Heir's and the Successor's.
const GATEHOUSE_KEY = "gatehouse-key";
const PORTCULLIS_KEY = "portcullis-key";

// A new treasury account opened by the Documents starts this far under (the doc).
const DOCUMENTS_FEE_OBOLS = 10;

// Caps on what a player types, so a request fits a Discord select and a modal.
const REQUEST_TEXT_MAX = 500;
const DOCUMENT_FIELD_MAX = 60;

const GATEHOUSE_TEXT = Object.freeze({
  noCharacter: "You don't have a living character.",
  cantAct: (what) => `You can't do that now — you're ${what}.`,
  notHere: "You're not standing there any more.",
  noDoor: "You can't get in there.",

  // ─── The gates ──────────────────────────────────────────────────────────
  // The control's name on its button: "Open the Gate" / "Close the Gate".
  gateControl: "the Gate",
  // The doc: "Nothing happens when someone without one of those rings
  // attempts to open/close the gate."
  nothingHappens: "Nothing happens.",
  // Travel refusals while a gate is shut.
  shutBlackHills: "The gate is shut. You'll have to request passage.",
  shutPortcullis: "The portcullis is shut.",
  // Examine's gate line, after "the way stands open." / "the way is closed."
  workedFromLever: "Worked from the gatehouse.",
  workedFromRings: "Worked from either side, by the right rings.",

  // ─── Request Passage (the Gate from the Bridge, the Window from the Square)
  requestButton: "Request Passage",
  requestTitle: "Request Passage",
  requestIntroIn:
    "Ask the gatehouse to let you into Ravenheart. Say who you are and why, and offer what you like. Nothing leaves your hands unless somebody inside takes it.",
  requestIntroOut:
    "Ask the gatehouse to let you out of Ravenheart. Say who you are and why, and offer what you like. Nothing leaves your hands unless somebody inside takes it.",
  requestTextLabel: "Your request",
  requestOfferLabel: "Offer",
  requestOfferNone: "You have nothing you can offer.",
  requestSend: "Send request",
  requestWaiting: "You already have a request waiting. Sending another replaces it.",
  requestNoText: "Say something to the gatehouse.",
  requestInside: "You can't request passage from inside the gatehouse.",
  requestNotHere: "You can't request passage from here.",
  requestSent: "Your request is with the gatehouse. Leaving this place withdraws it.",

  // ─── Submit for Documentation (the Gate) ────────────────────────────────
  documentButton: "Submit for Documentation",
  documentTitle: "Submit for Documentation",
  // After the doc: "a small button, which pricks their finger, sampling their
  // blood and adding it to a database."
  documentConfirm:
    "Press your finger into the small hole, taking a sample of blood for the gatehouse's database. Somebody in the gatehouse can then make your documents.",
  documentConfirmLabel: "Give blood",
  documentDone: "You feel a small prick.",
  documentWaiting: "You are already in the database, waiting to be processed.",
  documentAlready: "The terminal already knows your blood. You have an account at the treasury.",

  // ─── Grant Passage (Gate Controls) ───────────────────────────────────
  processButton: "Grant Passage",
  processTitle: "Grant Passage",
  processNoRing: "Access denied.",
  groupIn: "Into Ravenheart",
  groupOut: "Out of Ravenheart",
  groupEmpty: "Nobody is waiting.",
  offeredNone: "Nothing offered.",
  approve: "Approve",
  deny: "Deny",
  magma: "Magma",
  history: "History",
  pickOne: "Pick a request first.",
  requestGone: "That request is gone.",
  back: "Back",

  // Approve: moving things between the offer and the clerk's own hands.
  approveTitle: "Approve",
  approveIntro:
    "Take what you want from their offer, and add anything you want to give them. Whatever is left in the offer goes back to them.",
  approveOffered: "Their offer",
  approveYours: "Your things",
  approveKeep: "Take",
  approveGive: "Give",
  approveReturn: "Put back",
  approveConfirm: "Let them through",
  approveInHands: "Going to them",
  approveTaking: "You take",
  approveNothing: "Nothing changes hands.",
  approveTheyLackIt: (name) => `They no longer have ${name}.`,
  approveYouLackIt: (name) => `You no longer have ${name}.`,
  approveNotTradeable: (name) => `${name} can't be handed over.`,
  approveHeld: "They can't move right now, so they can't be let through.",
  approvedLine: (who, where) => `You let ${who} through the gate to the ${where}.`,
  approvedDm: (where) => `Your request was approved. You are let through the gate to the ${where}.`,

  // Deny.
  deniedLine: (who) => `You deny ${who}.`,
  // The doc.
  deniedDm: "You were denied access through the gate.",

  // Magma. The confirm is the doc's.
  magmaConfirm: "This will kill ALL individuals seeking access into Ravenheart. Proceed?",
  magmaConfirmLabel: "Proceed",
  magmaNoTurn: "The magma isn't ready.",
  magmaOnce: "The magma is spent. It will be ready again next turn.",
  magmaNobody: "Nobody is waiting to come in.",
  magmaLine: (n) => (n === 1 ? "Magma floods the approach. One person dies." : `Magma floods the approach. ${n} people die.`),
  magmaPlace: "Magma pours from the gatehouse and floods the approach to the gate.",
  magmaDeath: "You were caught in the magma at the gate.",

  // History.
  historyTitle: "History",
  historyEmpty: "Nothing has been decided yet.",
  historyIn: "Asked to come in",
  historyOut: "Asked to leave",
  outcome: { APPROVED: "Approved", DENIED: "Denied", MAGMA: "Killed by magma" },
  historyBy: (name, ring) => (ring ? `${name}, wearing the ${ring}` : `${name}, wearing no ring`),
  historyKept: "Taken",
  historyGiven: "Given",

  // ─── Create Documents (Gate Controls) ───────────────────────────────────
  createButton: "Documents",
  createTitle: "Create Documents",
  pendingTitle: "New submissions",
  pendingEmpty: "No new submissions.",
  registerTitle: "Register",
  registerEmpty: "Nobody is on the register.",
  registerRing: "Ring",
  registerDocuments: "Documents",
  registerAccountHeader: "Account",
  registerKindHeader: "On file by",
  nameLabel: "Name",
  // The job the clerk writes, not the fate: a fate is fixed for a character,
  // a job is whatever they work in Ravenheart now (CHARACTERS.md §2). The
  // column is still GatehouseSubmission.occupation.
  occupationLabel: "Job",
  printButton: "Print documents",
  denyButton: "Deny",
  needBoth: "Write a name and a job.",
  submissionGone: "That submission is gone.",
  alreadyHasAccount:
    "They already have an account at the treasury. The Meister must close it before new documents can be printed.",
  printedLine: (name) => `The terminal prints a set of documents for ${name}.`,
  deniedSubmission: "The submission is struck from the database.",
  deniedSubmissionDm: "Your application for documents was denied.",

  // The paper itself. Its name travels with it; the text is behind the
  // literacy gate like any paper's (db/lib/paper.js).
  documentsName: (name) => `Documents (${name})`,
  documentsText: ({ name, occupation, fingerprint, pin }) =>
    [
      "DOCUMENTS OF RAVENHEART",
      "",
      `Name: ${name}`,
      `Job: ${occupation}`,
      `Treasury account: ${fingerprint}`,
      `PIN: ${pin}`,
    ].join("\n"),

  // At an infoterminal, when the account the documents were printed for is gone.
  documentsVoid: "The infoterminal reads your documents and finds no account behind them.",

  // ─── The archive ────────────────────────────────────────────────────────
  // What the transcript keeps of each thing done at the controls. Real names,
  // like every archive row; never on a feed, since the terminal keeps no log of
  // its own (the doc). Never the PIN.
  archiveGate: (who, open, a, b) => `${who} ${open ? "opened" : "closed"} the gate between the ${a} and the ${b}.`,
  archiveApproved: (clerk, asker, direction, took, gave) =>
    [
      `${clerk} let ${asker} ${direction === "OUT" ? "out of" : "into"} Ravenheart.`,
      took ? `Took: ${took}.` : null,
      gave ? `Gave: ${gave}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
  archiveDenied: (clerk, asker, direction) =>
    `${clerk} denied ${asker} passage ${direction === "OUT" ? "out of" : "into"} Ravenheart.`,
  archiveMagma: (clerk, names) => `${clerk} poured magma on the approach to the gate. ${names} died.`,
  archiveDocuments: (clerk, realName, name, occupation) =>
    `${clerk} printed documents for ${realName} as ${name}, ${occupation}.`,
  archiveDocumentsDenied: (clerk, realName) => `${clerk} denied ${realName}'s application for documents.`,

  // The Meister's Close account moved to the Meister's Terminal, and its words
  // to db/lib/meisterTerminalText.js.
});

module.exports = {
  GATEHOUSE_SLUG,
  SQUARE_SLUG,
  BRIDGE_SLUG,
  COURTYARD_SLUG,
  RESIDENCES_SLUG,
  GATE_ROOM_SLUG,
  GATE_CONTROLS_ROOM_SLUG,
  INCARNS_CHAMBERS_ROOM_SLUG,
  GATEHOUSE_WINDOW_ROOM_SLUG,
  GATEHOUSE_KEY,
  PORTCULLIS_KEY,
  DOCUMENTS_FEE_OBOLS,
  REQUEST_TEXT_MAX,
  DOCUMENT_FIELD_MAX,
  GATEHOUSE_TEXT,
};
