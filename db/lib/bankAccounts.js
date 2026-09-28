// Fingerprinted bank accounts, and the Vault that backs most of them.
//
// A BankAccount is a claim. A TREASURY account's claim is HARD-BACKED: every
// obol it pays out comes physically out of the Keep's Vault room, and a
// withdrawal the Vault cannot cover is REFUSED rather than clamped. That makes
// the Vault a real thing worth guarding, and a robbed Vault a real problem for
// everybody banking in it. An OFFSHORE account — the Merchant's and the
// Docker's — skips all of that: their money is held off-world, so there is no
// stash to check.
//
// A CROWN account — the Baron's — is not a claim at all. It IS the Vault: its
// balance is read off the Vault's pile every time (accountBalance below), a
// withdrawal takes coin straight out of the room with no account row to
// debit, and a deposit is coin put back on the pile. Its stored
// `balanceObols` is never written and never read as money; whatever it held
// when the seat became the Crown's stays there, frozen, so the ledger's sum
// for it still matches (ECONOMY.md §3). It is not counted among the claims
// the Vault backs, since counting the pile as a claim on itself would say the
// Vault is always half short. See DEPOT.md §0g.
//
// Every balance move goes through bumpBankAccount below, never a bare update:
// the clamp lives inside one locked statement, the way db/lib/depotState.js
// does the Depot's own columns, so two spenders cannot stomp each other.
//
// THE ORDERING RULE, and it is the only one: room lock first, then the account.
// db/lib/tagWrites.js#dropRoomTag takes the room lock first, so a deposit and a
// withdrawal that took them the other way round would deadlock.
//
// Takes `tx` as a parameter rather than requiring db/index.js back, the
// db/lib/dm.js convention. See docs/systemdocs/DEPOT.md §0g.

const { record, bankParty, BANK_CLEARING } = require("./economyLedger");
const { OBOL_SLUG } = require("./depotState");

// Where the coin actually is. A ROOM slug (docs/zones.yaml) — the Keep's own
// vault, behind the Baron's key, which is the point: the town's money is
// somewhere a person can walk to, and rob.
const VAULT_ROOM_SLUG = "undertown-1-7";

const TREASURY = "TREASURY";
const OFFSHORE = "OFFSHORE";
const CROWN = "CROWN";

// The two classes whose coin is the Vault's: a Treasury claim draws on it, and
// the Crown's account is it. Only an Offshore account's money is elsewhere.
function vaultBacked(account) {
  return account?.class === TREASURY || account?.class === CROWN;
}

function isCrown(account) {
  return account?.class === CROWN;
}

// Something that reads like a stamped account number rather than a cuid, the
// same reasoning db/lib/depotCrates.js#shipmentId gives. Two letters off the
// holder's name so a fingerprint half-tells you whose it is, which is what
// makes an anonymous order a choice worth making.
const FINGERPRINT_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";

function fingerprintFor(name, rng = Math.random) {
  const letters = String(name ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  const a = letters[0] ?? FINGERPRINT_LETTERS[Math.floor(rng() * FINGERPRINT_LETTERS.length)];
  const b = letters[1] ?? FINGERPRINT_LETTERS[Math.floor(rng() * FINGERPRINT_LETTERS.length)];
  const digits = String(Math.floor(rng() * 9000) + 1000);
  return `${a}${b}-${digits}`;
}

// Collisions are a fact of a four-digit number, not an error. Retry a handful
// of times, then let the unique index refuse — an account that cannot be
// stamped is better than two accounts wearing one stamp.
async function freeFingerprint(tx, name) {
  for (let i = 0; i < 8; i++) {
    const candidate = fingerprintFor(name);
    const taken = await tx.bankAccount.findUnique({ where: { fingerprint: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return fingerprintFor(name);
}

function loadAccount(tx, characterId) {
  return tx.bankAccount.findUnique({ where: { characterId } });
}

// Opens one, or hands back the one that is already there. Idempotent on
// purpose: creation calls it, the counter's own button calls it, and neither
// should have to know whether the other went first.
async function openAccount(tx, character, { accountClass = TREASURY, turnNumber = null } = {}) {
  const existing = await loadAccount(tx, character.id);
  if (existing) return existing;

  return tx.bankAccount.create({
    data: {
      characterId: character.id,
      class: accountClass === OFFSHORE || accountClass === CROWN ? accountClass : TREASURY,
      fingerprint: await freeFingerprint(tx, character.name),
      holderName: character.name ?? "",
      openedTurn: turnNumber,
    },
  });
}

// Lock the row, clamp inside the UPDATE, report what moved — the shape
// db/lib/depotState.js#bumpColumn uses. The clamp is a FLOOR, never a
// substitute for the caller's own check: compare `delta` against what you asked
// for and refuse on a short move, or a race quietly sells something for less
// than it cost.
//
// `ctx` records the claim moving on the ledger (form ACCOUNT). The default
// counterparty is BANK_CLEARING, because the coin half of most movements is
// already booked by the tag hook and booking both ends twice is a double-count.
//
// NEGATIVE BALANCES. An account opened by the Town Gatehouse's Documents
// starts owing its processing fee (docs/systemdocs/GATEHOUSE.md), so a
// balance can be under zero. The floor is never ABOVE where the account
// already stands: a deposit into -10 lands at -7 rather than being clamped up
// to 0 (which would quietly write the debt off), and a debit from -10 moves
// nothing, which every caller already refuses as a short move. `opts.floor`
// lowers it, and only the fee passes one.
async function bumpBankAccount(tx, accountId, amount, ctx, opts = {}) {
  const floor = Math.min(0, Math.trunc(Number(opts.floor) || 0));
  const delta = Math.trunc(Number(amount) || 0);

  if (!delta) {
    const row = await tx.bankAccount.findUnique({ where: { id: accountId }, select: { balanceObols: true } });
    const current = row?.balanceObols ?? 0;
    return { before: current, after: current, delta: 0 };
  }

  const rows = await tx.$queryRawUnsafe(
    `
    WITH prev AS (
      SELECT "balanceObols" AS before FROM "BankAccount" WHERE "id" = $2 FOR UPDATE
    )
    UPDATE "BankAccount" b
    SET "balanceObols" = GREATEST(LEAST($3::int, prev.before), prev.before + $1::int), "updatedAt" = NOW()
    FROM prev
    WHERE b."id" = $2
    RETURNING prev.before AS before, b."balanceObols" AS after
    `,
    delta,
    accountId,
    floor,
  );

  const before = rows[0]?.before ?? 0;
  const after = rows[0]?.after ?? before;
  const moved = { before, after, delta: after - before };

  if (ctx && moved.delta) {
    const econ = ctx.econ ?? {};
    const self = bankParty({ id: accountId, holderName: ctx.holderName ?? null });
    const other = econ.other ?? BANK_CLEARING;
    // record() never throws (economyLedger.js's rule 2) — a hiccup logs and drops the row.
    await record(
      tx,
      moved.delta > 0
        ? { from: other, to: self, form: "ACCOUNT", amount: moved.delta }
        : { from: self, to: other, form: "ACCOUNT", amount: -moved.delta },
      econ,
    );
  }

  return moved;
}

// The Vault room and the obol Tag, looked up together because every caller
// below needs both and neither is worth a second round trip.
async function vaultAndCoin(tx) {
  const [room, coin] = await Promise.all([
    tx.room.findUnique({
      where: { slug: VAULT_ROOM_SLUG },
      select: { id: true, name: true, location: { select: { zoneId: true } } },
    }),
    tx.tag.findUnique({ where: { slug: OBOL_SLUG }, select: { id: true, slug: true, name: true } }),
  ]);
  return { room, coin };
}

// How much coin is actually in the Vault right now. What a TREASURY withdrawal
// is refused against, and what db:audit-vault-backing compares the claims to.
async function vaultObols(tx) {
  const { room, coin } = await vaultAndCoin(tx);
  if (!room || !coin) return 0;
  const row = await tx.roomTag.findUnique({
    where: { roomId_tagId: { roomId: room.id, tagId: coin.id } },
    select: { quantity: true },
  });
  return row?.quantity ?? 0;
}

// What an account holds, as a person at an infoterminal reads it. The stored
// balance, except for the Crown's, which is whatever is in the Vault this
// moment — so it moves when anybody deposits, withdraws, robs or restocks it.
async function accountBalance(tx, account) {
  if (!account) return 0;
  if (isCrown(account)) return vaultObols(tx);
  return account.balanceObols ?? 0;
}

// Takes `amount` obols out of the Vault stash, or throws. A conditional
// updateMany rather than a read-then-write, the db/lib/resourceStack.js shape:
// `count === 0` is the refusal, and it rolls the caller's account debit back
// with it.
async function takeFromVault(tx, amount, { coin, room }) {
  const { count } = await tx.roomTag.updateMany({
    where: { roomId: room.id, tagId: coin.id, quantity: { gte: amount } },
    data: { quantity: { decrement: amount } },
  });
  if (!count) {
    const err = new Error("ERROR: The treasury is empty.");
    err.userMessage = "ERROR: The treasury is empty.";
    throw err;
  }
  // Coin still under the Vault's floor (RoomTag.hiddenQuantity, SEARCH.md §9) keeps the row.
  await tx.roomTag.deleteMany({ where: { roomId: room.id, tagId: coin.id, quantity: { lte: 0 }, hiddenQuantity: { lte: 0 } } });
}

module.exports = {
  VAULT_ROOM_SLUG,
  TREASURY,
  OFFSHORE,
  CROWN,
  vaultBacked,
  isCrown,
  accountBalance,
  fingerprintFor,
  freeFingerprint,
  loadAccount,
  openAccount,
  bumpBankAccount,
  vaultAndCoin,
  vaultObols,
  takeFromVault,
};
