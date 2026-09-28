"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma, DEPOT_LOCATION_SLUG } from "@lifeweb/db";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { TURNS_PATH } from "@/lib/routes";
import { UserError, acting, guarded } from "@/lib/actionResult";
import { postMessage } from "@lifeweb/db/lib/discordRest";
import { ambientLine } from "@lifeweb/db/lib/ambientLine";
import { SFX } from "@lifeweb/db/lib/sfx";
import {
  counterState,
  bankMove,
  bankSend,
  depotTurretPanel,
  toggleDepotTurret,
} from "@lifeweb/db/lib/depotCounter";

// The infoterminal and the Merchant's gun, as Chat's place panel works them
// (./PlacePanel.js). Both are fixtures on walls, so the rules live once in
// db/lib/depotCounter.js and Discord calls the same functions; what is left
// here is the web's own half — the session, the turn, and telling Next what to
// re-render. These lived beside the /depot page until the Depot Overhaul took
// the page away (docs/systemdocs/DEPOT.md §0c).
//
// Every one of them is a public endpoint and re-checks standing, papers and
// money on the server.

// depotCounter returns `{ ok: false, error }` rather than throwing; `lift`
// turns that into the UserError `guarded` already knows how to answer with.
function lift(result) {
  if (!result?.ok) throw new UserError(result?.error ?? "That didn't work.");
  return result;
}

async function whoAmI() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  return session;
}

function revalidateAll() {
  revalidatePath("/character");
  revalidatePath("/gm/players", "layout");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
}

// A line the room witnesses, spoken into the Depot's Location channel.
// Best-effort, never inside a transaction: a Discord outage must not roll back
// a switch that really was thrown.
async function speakAtDepot(text) {
  if (!text) return;
  const location = await prisma.location
    .findUnique({ where: { slug: DEPOT_LOCATION_SLUG }, select: { discordChannelId: true } })
    .catch(() => null);
  if (!location?.discordChannelId) return;
  await postMessage(location.discordChannelId, ambientLine(text, [], { signed: false })).catch((err) =>
    console.error("Depot ambient line failed:", err),
  );
}

// `pin` is what the viewer typed when the infoterminal asked for one
// (db/lib/depotCounter.js#terminalAccount); absent, the account is withheld.
async function depotCounterStateImpl(input) {
  const session = await whoAmI();
  return lift(await counterState(prisma, session.discordUserId, { pin: input?.pin ?? null }));
}

async function depotBankImpl(input) {
  const session = await whoAmI();
  const openTurn = await getOpenTurn();
  const result = lift(await bankMove(prisma, session.discordUserId, { ...input, turn: openTurn }));
  await afterInventoryChange(result.characterId);
  revalidateAll();
  return { direction: result.direction, amount: result.amount, sfx: SFX.COIN };
}

// No tags move, so no afterInventoryChange: this is two numbers and a ledger row.
async function depotSendImpl(input) {
  const session = await whoAmI();
  const openTurn = await getOpenTurn();
  const result = lift(await bankSend(prisma, session.discordUserId, { ...input, turn: openTurn }));
  revalidateAll();
  return { amount: result.amount, line: result.line, sfx: SFX.COIN };
}

async function depotTurretPanelImpl() {
  const session = await whoAmI();
  return lift(await depotTurretPanel(prisma, session.discordUserId));
}

async function depotTurretImpl(input) {
  const session = await whoAmI();
  const openTurn = await getOpenTurn();
  const result = lift(await toggleDepotTurret(prisma, session.discordUserId, { ...input, turn: openTurn }));
  await speakAtDepot(result.ambient);
  revalidateAll();
  // The actor hears the warning buzzer. The yard does not: speakAtDepot posts to Discord
  // only, so there is no archive row for a sound to ride.
  return { armed: result.armed, line: result.line, sfx: SFX.TURRET };
}

// ─── The exported surface. `guarded` turns a UserError into { ok: false }. ───

export async function depotCounterState(input) {
  return guarded(() => depotCounterStateImpl(input));
}

export async function depotBank(input) {
  return acting(() => depotBankImpl(input));
}

export async function depotSend(input) {
  return acting(() => depotSendImpl(input));
}

export async function depotTurret(input) {
  return acting(() => depotTurretImpl(input));
}

export async function depotTurretRead() {
  return guarded(() => depotTurretPanelImpl());
}
