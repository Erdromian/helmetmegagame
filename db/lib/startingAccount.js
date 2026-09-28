// A new character's bank account, what is in it, and the Vault's share of it.
//
// The seat's account opens (docs/roles.yaml `bank_account:`), gets its
// `starting_account:` balance rolled within 10% (db/lib/startingVariance.js),
// and — for the starting cast only — that balance puts
// GameConfig.vaultReservePercent of itself into the Keep's Vault as coin, the
// Baron's excepted. All three in one transaction,
// so a failed credit takes the account and the coin with it, and the Vault can
// never hold stock for a balance that was never opened.
//
// THE ORDERING RULE (db/lib/bankAccounts.js): room lock first, then the
// account. The Vault is locked before anything else here, the way the ATM does
// it, so a creation and a withdrawal cannot deadlock each other.
//
// THE STARTING CAST is whoever builds the seat Start Game rolled them, inside
// its creation window (`startingCast`, which createActions.js answers from the
// lobby entry). Anybody who arrives after that — a late join, a late party's
// seat, a second life, a role picked off the open menu — still gets their
// balance, but the Vault is not topped up for it: the pile is set by the town
// the game started with, and a new arrival does not make it any bigger.
//
// Called from web/app/(app)/character/createActions.js. Takes `prisma` as a
// parameter (the db/lib/dm.js convention) and is not on the barrel.

const { openAccount, bumpBankAccount, vaultAndCoin } = require("./bankAccounts");
const { addToRoomStack } = require("./tagWrites");
const { turnStamp } = require("./economyLedger");
const {
  varyStarting,
  vaultStockFor,
  VAULT_UNSTOCKED_ROLE_SLUGS,
  DEFAULT_VAULT_RESERVE_PERCENT,
} = require("./startingVariance");

// Returns { account, balance, stock } — `balance` the obols credited, `stock`
// the obols put in the Vault — or null when the seat opens no account.
async function openStartingAccount(
  prisma,
  { character, role, config = null, openTurn = null, startingCast = false, rng = Math.random },
) {
  if (!role?.bankAccountClass) return null;
  const percent = config?.vaultReservePercent ?? DEFAULT_VAULT_RESERVE_PERCENT;
  const stocks =
    startingCast && role.startingAccountObols > 0 && percent > 0 && !VAULT_UNSTOCKED_ROLE_SLUGS.has(role.slug);
  const { room: vault, coin } = stocks ? await vaultAndCoin(prisma) : {};

  return prisma.$transaction(async (tx) => {
    if (vault && coin) await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${vault.id} FOR UPDATE`;
    const account = await openAccount(tx, character, {
      accountClass: role.bankAccountClass,
      turnNumber: openTurn?.number ?? null,
    });
    if (!account || !(role.startingAccountObols > 0)) return { account, balance: 0, stock: 0 };

    const moved = await bumpBankAccount(tx, account.id, varyStarting(role.startingAccountObols, rng), {
      holderName: account.holderName,
      econ: { reason: "CHARACTER_START", ...turnStamp(openTurn) },
    });
    const stock = vault && coin ? vaultStockFor({ roleSlug: role.slug, balance: moved.delta, percent }) : 0;
    if (stock > 0) {
      await addToRoomStack(tx, vault.id, coin.id, stock, {
        econ: { reason: "VAULT_STOCK", roomId: vault.id, ...turnStamp(openTurn) },
      });
    }
    return { account, balance: moved.delta, stock };
  });
}

module.exports = { openStartingAccount };
