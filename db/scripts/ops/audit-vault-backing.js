// Read-only: how much of what the Treasury accounts claim is actually sitting
// in the Keep's Vault? `npm run db:audit-vault-backing`.
//
// This is NOT reconcile's job and must never be folded into it. reconcile()
// compares ledger legs against live balances, form by form; it never looks at
// COIN at all, so a Health row claiming it checked the backing would be lying.
// This is the separate question: a claim is only worth the coin behind it, and
// under the line somebody walks up to the ATM and is told no through no fault
// of their own. See docs/systemdocs/ECONOMY.md §3.
//
// THE VAULT IS FRACTIONALLY RESERVED ON PURPOSE. It used to hold more coin
// than the claims against it, which made the ATM's refusal path unreachable
// and a bank run impossible. It holds about two thirds now (docs/zones.yaml,
// `undertown-1-7`), so "short" is the normal state and is not a finding. What
// IS a finding is the pile falling far enough that the bank is a rumour rather
// than a bank — somebody emptied the Vault overnight, or a faucet is minting
// claims with no coin behind them.
//
// So this EXITS 1 below RESERVE_FLOOR rather than below parity, and it can be
// a check rather than a readout either way.
require("dotenv").config();
const { prisma } = require("../../index");
const { vaultObols, VAULT_ROOM_SLUG } = require("../../lib/bankAccounts");

// Coin per obol of claim. Below this the run has already happened.
const RESERVE_FLOOR = 0.4;

async function main() {
  const room = await prisma.room.findUnique({ where: { slug: VAULT_ROOM_SLUG }, select: { id: true, name: true } });
  if (!room) {
    console.error(`No "${VAULT_ROOM_SLUG}" room. Run npm run db:import-zones -- --apply first.`);
    process.exitCode = 1;
    return;
  }

  const [coin, accounts] = await Promise.all([
    vaultObols(prisma),
    prisma.bankAccount.findMany({
      where: { class: "TREASURY" },
      select: { fingerprint: true, holderName: true, balanceObols: true },
      orderBy: { balanceObols: "desc" },
    }),
  ]);

  const claims = accounts.reduce((sum, a) => sum + a.balanceObols, 0);
  // No claims is fully backed by definition, and dividing by it is not.
  const ratio = claims > 0 ? coin / claims : 1;
  const pct = Math.round(ratio * 100);

  console.log(`${room.name}: ${coin} ¢`);
  console.log(`Treasury claims: ${claims} ¢ across ${accounts.length} account(s)`);
  console.log(`Reserve: ${pct}% (floor ${Math.round(RESERVE_FLOOR * 100)}%)`);

  for (const a of accounts.slice(0, 10)) {
    if (a.balanceObols > 0) console.log(`  ${a.fingerprint}  ${a.holderName}  ${a.balanceObols} ¢`);
  }

  if (ratio < RESERVE_FLOOR) {
    console.error(`UNDER THE FLOOR by ${claims - coin} ¢. Most of the town cannot be paid.`);
    process.exitCode = 1;
    return;
  }

  if (coin < claims) {
    // The ordinary state. Say what it means so nobody reads it as an alarm.
    console.log(`Short by ${claims - coin} ¢ — fractional by design. First to the ATM gets paid.`);
    return;
  }
  console.log(`Fully backed, with ${coin - claims} ¢ of slack.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
