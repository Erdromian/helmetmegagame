"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { setSellTax } from "@lifeweb/db/lib/verbs/place";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { UserError, acting } from "@/lib/actionResult";

// The terminal's one control. A server action is a public endpoint, so the gate
// is re-checked here and never taken from the page — a superadmin reads the desk
// but does not get the dial, since that is game permission rather than host
// access. The rule is db/lib/verbs/place.js#setSellTax, shared with the Sell tax
// button on the Meister's Study post on Discord.
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
  revalidatePath("/depot");
  revalidatePath("/gm/audit");
  return { rate: result.rate };
}

export async function setSellTaxRate(input) {
  return acting(() => setSellTaxRateImpl(input));
}
