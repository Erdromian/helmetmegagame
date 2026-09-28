// The economy's vocabulary: why ⬢ moved, and how a reader should group it. A plain string on
// EconomyEntry.reason, not a Prisma enum, for the reason AuditLog.actionType is one — the list grows
// and a migration per reason is a tax nobody would pay. This module is the ONLY place it is authored.
// Zero requires, ever, like db/lib/dmKinds.js — reachable from a client component (a reason
// chip), and one require of @lifeweb/db here would drag PrismaClient into the browser bundle.

// How a reason behaves in the books — what Faucets/Sinks group on and the supply chart uses to tell a
// mint from a hand-over. FAUCET: ⬢ that didn't exist before, supply up. SINK: ⬢ stops existing, supply
// down. TRANSFER: ⬢ changes hands, supply unchanged, velocity up. INTERNAL: a form change, not a
// movement (the infoterminal turning balance into coin) — must be excluded from velocity or a Depot trip counts twice.
const FLOW = { FAUCET: "FAUCET", SINK: "SINK", TRANSFER: "TRANSFER", INTERNAL: "INTERNAL" };

// reason -> { flow, label }. Label is prose a GM reads, never the word "Resources" beside a ⬢ glyph.
const REASONS = {
  // --- faucets ---
  MINING: { flow: FLOW.FAUCET, label: "Mining" },
  // Nothing writes this any more — the old mining drop die could pay in ⬢, the prospecting table
  // that replaced it on 2026-09-18 only ever grants a tag. Kept so historic rows still have a label,
  // the same posture as UNATTRIBUTED.
  MINING_DROP: { flow: FLOW.FAUCET, label: "Mining drop" },
  CRATE: { flow: FLOW.FAUCET, label: "Crate opened" },
  CONSUME: { flow: FLOW.FAUCET, label: "Purse consumed" },
  RITE_GRANT: { flow: FLOW.FAUCET, label: "Rite" },
  THREAT_SPAWN: { flow: FLOW.FAUCET, label: "Threat spawned" },
  CHARACTER_START: { flow: FLOW.FAUCET, label: "Starting purse" },
  // The Vault's share of a new character's starting balance (db/lib/startingVariance.js#vaultStockFor).
  VAULT_STOCK: { flow: FLOW.FAUCET, label: "Vault stocked" },
  STRUCTURE_YIELD: { flow: FLOW.FAUCET, label: "Structure yield" },
  CAVING: { flow: FLOW.FAUCET, label: "Caving" },
  GM_GRANT: { flow: FLOW.FAUCET, label: "GM grant" },
  OPENING: { flow: FLOW.FAUCET, label: "Opening balance" },

  // --- sinks ---
  // Dead since the hunger rework (db/lib/hunger.js): Hunger is a 0-100 meter
  // now, with no ⬢ cost at all. Kept here, unwritten, because historic
  // EconomyEntry rows still name this reason and the reconciliation math over
  // them must keep resolving it to a label.
  HUNGER: { flow: FLOW.SINK, label: "Hunger" },
  UPKEEP: { flow: FLOW.SINK, label: "Upkeep" },
  CRAFT: { flow: FLOW.SINK, label: "Crafting" },
  BUILD: { flow: FLOW.SINK, label: "Building" },
  TRINKET: { flow: FLOW.SINK, label: "Trinket" },
  MEDICAL: { flow: FLOW.SINK, label: "Medicine" },
  ENGRAVE: { flow: FLOW.SINK, label: "Engraving" },
  RITE_COST: { flow: FLOW.SINK, label: "Rite cost" },
  THANATI: { flow: FLOW.SINK, label: "Cult purchase" },
  LESSON: { flow: FLOW.SINK, label: "Lesson" },
  // The two silent burns — before the ledger, neither left a trace: the Spillway just dropped what
  // was put in, and a debit larger than a balance destroyed the shortfall against a GREATEST(0,...) floor.
  SPILLWAY: { flow: FLOW.SINK, label: "Spillway" },
  CLAMP: { flow: FLOW.SINK, label: "Overdrawn (destroyed)" },
  GM_TAKE: { flow: FLOW.SINK, label: "GM removal" },

  // --- transfers ---
  TRANSFER: { flow: FLOW.TRANSFER, label: "Hand-over" },
  LOOT: { flow: FLOW.TRANSFER, label: "Looted" },
  TAX: { flow: FLOW.TRANSFER, label: "Tax" },
  CARRY_SPILL: { flow: FLOW.TRANSFER, label: "Dropped (overburdened)" },
  GM_TRANSFER: { flow: FLOW.TRANSFER, label: "GM transfer" },
  STAGED_PUSH: { flow: FLOW.TRANSFER, label: "Adjudication push" },
  STASH: { flow: FLOW.TRANSFER, label: "Stash" },
  DEPOT_ORDER: { flow: FLOW.TRANSFER, label: "Depot order" },
  DEPOT_SALE: { flow: FLOW.TRANSFER, label: "Depot sale" },
  BANK_TRANSFER: { flow: FLOW.TRANSFER, label: "Transfer" },
  TRAIN_DELIVERY: { flow: FLOW.TRANSFER, label: "Train delivery" },
  // The Meister's cut of a settled sale, coin into the Keep's Vault. Beside TAX
  // rather than a sink: the money does not stop existing, it changes hands.
  SELL_TAX: { flow: FLOW.TRANSFER, label: "Sell tax" },
  // The Den's slot machine (db/lib/slotMachine.js). A TRANSFER on both legs:
  // a stake and a payout both change hands between a player and the Exactor,
  // and neither mints nor burns a coin — which is the whole reason the machine
  // is backed by a person's account rather than by nothing.
  SLOTS: { flow: FLOW.TRANSFER, label: "Slot machine" },
  // A payphone. TRANSFER, not SINK, for the same reason SLOTS above is: the
  // obol goes into the Keep's Vault rather than out of the game, so the coin
  // is still there and somebody could in principle come and take it.
  PAYPHONE: { flow: FLOW.TRANSFER, label: "Payphone" },
  // The Merchant's vending machine (db/lib/vending.js). All TRANSFER, the SLOTS
  // and PAYPHONE posture: the coin goes on existing inside the machine, so
  // nothing is minted and nothing is burned. Five reasons rather than one
  // because five different things happen to the same box, and a GM reading
  // "money went into a machine" should be able to tell a customer feeding the
  // slot from a merchant emptying the till.
  VENDING_INSERT: { flow: FLOW.TRANSFER, label: "Coins inserted" },
  VENDING_WITHDRAW: { flow: FLOW.TRANSFER, label: "Coins taken back" },
  // The GOODS leg of a purchase. There is no coin leg, on purpose: the money was
  // already in the machine, and moving it from the slot to the till is one
  // account's two trays rather than a movement — db/lib/economyLedger.js#machineParty.
  VENDING_SALE: { flow: FLOW.TRANSFER, label: "Vending machine" },
  VENDING_STOCK: { flow: FLOW.TRANSFER, label: "Machine restocked" },
  VENDING_TILL: { flow: FLOW.TRANSFER, label: "Till emptied" },
  // The Black Market terminal in the Exactor's Office (db/lib/blackMarket.js).
  // TRANSFER to and from the Company, the DEPOT_ORDER posture: coin fed into
  // the slot goes off-world as credit, and an order's goods come back from it.
  BLACK_MARKET_INSERT: { flow: FLOW.TRANSFER, label: "Black Market credit" },
  BLACK_MARKET_ORDER: { flow: FLOW.TRANSFER, label: "Black Market order" },
  // The Merchant's Terminal at the Depot (db/lib/merchantTerminal.js). Its coin
  // is one party, machine:merchant-terminal, the vending machine's posture: the
  // coin goes on existing inside it. The train pays for imports out of it
  // (TRAIN_IMPORT, to the Company) and pays exports into it (TRAIN_EXPORT, from
  // the Company); the Meister's cut on either goes to the Vault as IMPORT_TAX
  // or EXPORT_TAX, levied once per train on the sum.
  TERMINAL_INSERT: { flow: FLOW.TRANSFER, label: "Merchant's Terminal deposit" },
  TERMINAL_WITHDRAW: { flow: FLOW.TRANSFER, label: "Merchant's Terminal withdrawal" },
  TRAIN_IMPORT: { flow: FLOW.TRANSFER, label: "Train import" },
  TRAIN_EXPORT: { flow: FLOW.TRANSFER, label: "Train export" },
  IMPORT_TAX: { flow: FLOW.TRANSFER, label: "Import tax" },
  EXPORT_TAX: { flow: FLOW.TRANSFER, label: "Export tax" },
  // Kept, unwritten: the generator is gone, but a reason is a plain string and
  // deleting one blanks the old rows that name it.
  DEPOT_REFUEL: { flow: FLOW.TRANSFER, label: "Refuelled" },
  // The Town Gatehouse (docs/systemdocs/GATEHOUSE.md). An account opened by a
  // set of Documents starts owing 10 ¢ of processing fees: a claim leg to the
  // bank clearing, and nothing physical moves. Paying it off is an ordinary
  // deposit, whose coin lands in the Vault with no claim left against it.
  DOCUMENTS_FEE: { flow: FLOW.TRANSFER, label: "Documents fee" },
  // The Meister closing an account at the Meister's Terminal. Whatever it held
  // or owed is written off against the bank clearing so its books close at zero.
  ACCOUNT_CLOSED: { flow: FLOW.TRANSFER, label: "Account closed" },
  // The rest of the Meister's Terminal (docs/systemdocs/MEISTERY.md): a balance
  // set by hand, and the daily wages. Claim legs only, against the bank
  // clearing, the posture of the two above — no coin moves, so each one widens
  // or narrows the gap between the claims and the Vault.
  MEISTER_CREDIT: { flow: FLOW.TRANSFER, label: "Balance raised" },
  MEISTER_DEBIT: { flow: FLOW.TRANSFER, label: "Balance lowered" },
  WAGE: { flow: FLOW.TRANSFER, label: "Wage" },
  WAGE_DEDUCTION: { flow: FLOW.TRANSFER, label: "Wage deducted" },

  // --- internal (a form change, not a movement) ---
  BANK_OPEN: { flow: FLOW.INTERNAL, label: "Account opened" },
  BANK_DEPOSIT: { flow: FLOW.INTERNAL, label: "Deposit" },
  BANK_WITHDRAWAL: { flow: FLOW.INTERNAL, label: "Withdrawal" },
  // Kept, unwritten: BANK_DEPOSIT/BANK_WITHDRAWAL replaced it, and the old rows
  // still name it.
  DEPOT_ATM: { flow: FLOW.INTERNAL, label: "Infoterminal" },
  DEPOT_CREDIT: { flow: FLOW.INTERNAL, label: "Credit line" },

  // --- the honest ones ---
  // A write reached the ledger with no reason. Deliberately its own reason rather than a silent
  // default, so an un-hooked call site is visible instead of quietly missing — never filter it out on
  // the read side.
  UNATTRIBUTED: { flow: FLOW.INTERNAL, label: "Unattributed" },
  // What the AuditLog backfill couldn't account for, written once per account so the books close at
  // the seam. Its size is a diagnostic, not a number to trust.
  PLUG: { flow: FLOW.INTERNAL, label: "Unreconciled (before the ledger)" },
};

const DEFAULT_REASON = "UNATTRIBUTED";

module.exports = { FLOW, REASONS, DEFAULT_REASON };
