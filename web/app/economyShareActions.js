"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { getEconSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { getEconomyReportFile } from "@/lib/economyReport";
import { isShareablePage, NEVER_SHARED, reportPageTitle } from "@/lib/economyShareHtml";
import { guarded, UserError } from "@/lib/actionResult";

// Making and revoking a public link to one page of the economy report (ECONOMY.md §7a). Shared by
// /gm/economy and /econ/economy, which is why it lives here rather than in either route group — the
// same reason feedbackActions.js does. The public side is web/app/(public)/share/economy/[token]/route.js.
//
// The gate is the report's own, repeated: a GM, an Economist or a superadmin, still in the guild. Both
// pages' layouts check the same thing, but a server action is a public endpoint and they do not run for it.

const PAGES = ["/gm/economy", "/econ/economy"];

async function requireReportReader() {
  const { session, isGm, isEconomist, inGuild } = await getEconSession();
  const id = session?.discordUserId;
  if (!id || !inGuild || !(isGm || isEconomist || isSuperadmin(id))) {
    throw new UserError("Only a GM or an Economist can share the economy report.");
  }
  return id;
}

// Share one page. Hands back the page's existing link when it already has one, so pressing Share twice
// gives one link to revoke rather than two. `page` is a filename the report actually built, e.g.
// "wages.html" — never a path, never one of the CSS/JS files beside the pages, and never the Secret
// recipes page (economyShareHtml.js NEVER_SHARED).
export async function createEconomyShare(page) {
  return guarded(async () => {
    const actor = await requireReportReader();
    if (NEVER_SHARED.has(page)) throw new UserError("The Secret recipes page can't be shared.");
    if (!isShareablePage(page)) throw new UserError("That is not a page of the report.");
    const file = await getEconomyReportFile(page);
    if (!file) throw new UserError("That page is not in the report.");

    const select = { id: true, token: true };
    const existing = await prisma.economyReportShare.findUnique({ where: { page }, select });
    if (existing) return { share: existing };

    const title = reportPageTitle(file.content);
    let share;
    try {
      share = await prisma.economyReportShare.create({
        data: { token: crypto.randomBytes(18).toString("base64url"), page, createdBy: actor },
        select,
      });
    } catch (err) {
      // Two people shared the same page at the same moment. `page` is unique, so the second create
      // lost, and the first one's link is the page's one link.
      if (err?.code !== "P2002") throw err;
      const won = await prisma.economyReportShare.findUnique({ where: { page }, select });
      if (!won) throw err;
      return { share: won };
    }
    await prisma.auditLog.create({
      data: { actorDiscordUserId: actor, actionType: "gm_economy_share_created", details: { shareId: share.id, page, title } },
    });
    for (const p of PAGES) revalidatePath(p);
    return { share };
  });
}

// Revoke a link. Deleting the row is the whole act: the public route looks the token up on every read
// and serves no-store, so the link is dead the moment this returns.
export async function revokeEconomyShare(id) {
  return guarded(async () => {
    const actor = await requireReportReader();
    if (typeof id !== "string" || !id) throw new UserError("That link does not exist.");
    const share = await prisma.economyReportShare.findUnique({ where: { id }, select: { page: true } });
    if (!share) return {}; // already gone, which is what was asked for
    await prisma.economyReportShare.deleteMany({ where: { id } });
    const file = await getEconomyReportFile(share.page);
    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: actor,
        actionType: "gm_economy_share_revoked",
        details: { shareId: id, page: share.page, title: reportPageTitle(file?.content) },
      },
    });
    for (const p of PAGES) revalidatePath(p);
    return {};
  });
}
