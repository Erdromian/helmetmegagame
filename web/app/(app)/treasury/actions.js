"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { setSellTax } from "@lifeweb/db/lib/verbs/place";
import { registerHeldRing } from "@lifeweb/db/lib/ringRegistry";
import { closeAccount } from "@lifeweb/db/lib/depotCounter";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { UserError, acting } from "@/lib/actionResult";

// The terminal's one control. A server action is a public endpoint, so the gate
// is re-checked here and never taken from the page — a superadmin reads the desk
// but does not get the dial, since that is game permission rather than host
// access. The rule is db/lib/verbs/place.js#setSellTax, shared with the Sell tax
// button on the Meister's Study post on Discord. One rate, on the train's
// imports and exports alike (Depot Overhaul.docx).
async function setSellTaxRateImpl({ rate }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const result = await setSellTax(prisma, {
    discordUserId: session.discordUserId,
    rate,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  revalidatePath("/treasury");
  revalidatePath("/gm/audit");
  return { rate: result.rate };
}

export async function setSellTaxRate(input) {
  return acting(() => setSellTaxRateImpl(input));
}

// The terminal's second control: registering a smithed ring (docs/systemdocs/RINGS.md).
// Everything is re-checked in db/lib/ringRegistry.js — where the viewer stands,
// that the ring is in their hands and unregistered, the seats, the account.
async function registerRingAtTerminalImpl(input) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const result = await registerHeldRing(prisma, {
    discordUserId: session.discordUserId,
    ringTagId: input?.ringTagId,
    roleSlugs: input?.roleSlugs,
    accountId: input?.accountId ?? null,
    newAccount: input?.newAccount === true,
    turn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  // The ring may already be on the holder's finger, so its new doors need the room sync.
  await afterInventoryChange(result.characterId);
  revalidatePath("/treasury");
  revalidatePath("/gm/audit");
  return { line: result.line };
}

export async function registerRingAtTerminal(input) {
  return acting(() => registerRingAtTerminalImpl(input));
}

// The third: closing an account, so its holder can be documented afresh at the
// Town Gatehouse (docs/systemdocs/GATEHOUSE.md). Re-checked in
// db/lib/depotCounter.js#closeAccount, the same gate the other two stand behind.
async function closeTreasuryAccountImpl(input) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const result = await closeAccount(prisma, session.discordUserId, {
    accountId: input?.accountId,
    turn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  revalidatePath("/treasury");
  revalidatePath("/gm/audit");
  return { line: result.line };
}

export async function closeTreasuryAccount(input) {
  return acting(() => closeTreasuryAccountImpl(input));
}
