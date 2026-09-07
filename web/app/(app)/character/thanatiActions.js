"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { guarded, UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { requireFreeMove, fileAutoRoutine } from "@/lib/moveSpend";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { sendDm } from "@/lib/discordGuild";
import { accessibleRooms, roomAccessKeys } from "@lifeweb/db/lib/roomAccess";
import { grantTagSlugs, addToRoomStack, dropRoomTag } from "@lifeweb/db/lib/tagWrites";
import { announceInRoom } from "@lifeweb/db/lib/roomAnnounce";
import {
  THANATI_SLUG,
  THANATI_LEADER_SLUG,
  RECOVERABLE_SLUGS,
  THANATI_WARES,
  OBOL_SLUG,
  listComrades,
  formatComrades,
  hideoutRoom,
} from "@lifeweb/db/lib/thanati";

// The THANATI section of the character panel (docs/systemdocs/THANATI.md):
// Recall Comrades, Recover Equipment, Set Hideout, Purchase Gear. Each one
// resolves the cultist from the session, never from a posted id, and
// re-checks the tag the button's `show` already read — a server action is a
// public endpoint and a hidden button is a hint, not a lock.

async function cultist() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const me = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      age: true,
      gender: true,
      locationId: true,
      zoneId: true,
      discordUserId: true,
      tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { slug: true } } } },
    },
  });
  if (!me) redirect("/character");
  const slugs = new Set(me.tags.map((ct) => ct.tag.slug));
  if (!slugs.has(THANATI_SLUG)) throw new UserError("Not yours to press.");
  return { session, me, slugs };
}

function revalidate() {
  revalidatePath("/character");
  revalidatePath("/gm/audit");
}

// ---- Recall Comrades -------------------------------------------------------
// The roster arrives as a DM, so a cultist reading it in a crowded room gives
// nothing away. Costs nothing and spends no Move.
async function recallComradesImpl() {
  const { session, me } = await cultist();
  const rows = await listComrades(prisma);
  const line = formatComrades(rows);
  await logAudit(prisma, {
    actorDiscordUserId: session.discordUserId,
    actionType: "request_recall_comrades",
    targetCharacterId: me.id,
    details: { comrades: rows.map((r) => r.name) },
  });
  after(() =>
    sendDm(me.discordUserId, line, { source: "player_event" }).catch((err) =>
      console.error(`Recall Comrades DM to ${me.name} failed:`, err),
    ),
  );
  revalidate();
  return { ok: true };
}

// ---- Recover Equipment -----------------------------------------------------
// Hands back whichever of the robes and the mask the cultist is not holding.
// Spends the Move, and not on two turns running: the previous turn's row in
// the audit log is the cooldown, the same way the medic's ration counts rows
// (REQUESTS.md §1a), so it needs no column of its own.
const RECOVER_ACTION = "request_recover_equipment";

async function recoverEquipmentImpl() {
  const { session, me, slugs } = await cultist();
  const missing = RECOVERABLE_SLUGS.filter((slug) => !slugs.has(slug));
  if (missing.length === 0) throw new UserError("You already hold both.");

  const openTurn = await getOpenTurn();
  await requireFreeMove(me, openTurn);

  const recentTurns = await prisma.turn.findMany({
    where: { number: { in: [openTurn.number, openTurn.number - 1] } },
    select: { id: true },
  });
  const recent = await prisma.auditLog.count({
    where: {
      actionType: RECOVER_ACTION,
      actorDiscordUserId: session.discordUserId,
      turnId: { in: recentTurns.map((t) => t.id) },
    },
  });
  if (recent > 0) throw new UserError("Not again so soon.");

  const granted = await prisma.$transaction(async (tx) => {
    const rows = await grantTagSlugs(tx, me.id, missing, openTurn.number);
    await fileAutoRoutine(tx, me, openTurn, "Recovered equipment. ‡", "auto:recover");
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: RECOVER_ACTION,
      targetCharacterId: me.id,
      turnId: openTurn.id,
      details: { granted: rows.map((r) => r.tagName) },
    });
    return rows;
  });
  await afterInventoryChange([me.id]);
  revalidate();
  return { ok: true, granted: granted.map((r) => r.tagName) };
}

// ---- Set Hideout -----------------------------------------------------------
// Leader only. The room must be at the leader's own Location and behind a door
// they can open — the same accessibleRooms every other door in the game reads.
async function setHideoutImpl({ roomId }) {
  const { session, me, slugs } = await cultist();
  if (!slugs.has(THANATI_LEADER_SLUG)) throw new UserError("Not yours to press.");
  const room = await prisma.room.findUnique({
    where: { id: String(roomId ?? "") },
    select: { id: true, name: true, kind: true, locationId: true, accessTagSlugs: true },
  });
  if (!room || room.locationId !== me.locationId) throw new UserError("That room isn't here.");
  const keys = await roomAccessKeys(prisma, me.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds).length === 0) {
    throw new UserError("That door is locked.");
  }
  await prisma.gameState.update({ where: { id: 1 }, data: { thanatiHideoutRoomId: room.id } });
  await logAudit(prisma, {
    actorDiscordUserId: session.discordUserId,
    actionType: "thanati_hideout_set",
    targetCharacterId: me.id,
    details: { roomId: room.id, room: room.name },
  });
  revalidate();
  return { ok: true, room: room.name };
}

// ---- Purchase Gear ---------------------------------------------------------
// Pays from the hideout room's FLOOR — its ⬢ or its obols, the buyer's pick —
// and drops the goods on the same floor. The cult stockpiles there, so this is
// the shared purse spending on itself. Decrement-as-check on both currencies,
// the room-stash rule (CARRY.md): two cultists buying at once cannot overdraw.
function formatGoods(lines) {
  return lines.map((l) => (l.quantity > 1 ? `${l.name} ×${l.quantity}` : l.name)).join(", ");
}

async function purchaseGearImpl({ items, source }) {
  const { session, me } = await cultist();
  const hideout = await hideoutRoom(prisma);
  if (!hideout) throw new UserError("Set a hideout first.");
  if (hideout.locationId !== me.locationId) throw new UserError("Not at the hideout.");
  if (source !== "obols" && source !== "resources") throw new UserError("Pick a currency.");

  const wanted = Array.isArray(items) ? items : [];
  const wareBySlug = new Map(THANATI_WARES.map((w) => [w.slug, w]));
  const tags = await prisma.tag.findMany({
    where: { slug: { in: [...wareBySlug.keys(), OBOL_SLUG] } },
    select: { id: true, slug: true, name: true },
  });
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const obolTag = tags.find((t) => t.slug === OBOL_SLUG);

  const lines = [];
  for (const raw of wanted) {
    const tag = tagById.get(String(raw?.tagId ?? ""));
    const ware = tag ? wareBySlug.get(tag.slug) : null;
    const quantity = Math.trunc(Number(raw?.quantity));
    if (!ware || !Number.isInteger(quantity) || quantity < 1) continue;
    lines.push({ tagId: tag.id, name: tag.name, quantity: Math.min(quantity, 99), each: ware[source] });
  }
  if (lines.length === 0) throw new UserError("Nothing to buy.");
  const total = lines.reduce((sum, l) => sum + l.each * l.quantity, 0);

  await prisma.$transaction(async (tx) => {
    if (source === "resources") {
      const { count } = await tx.room.updateMany({
        where: { id: hideout.id, resources: { gte: total } },
        data: { resources: { decrement: total } },
      });
      if (count === 0) throw new UserError("Not enough there.");
    } else {
      if (!obolTag || !(await dropRoomTag(tx, hideout.id, obolTag.id, total))) {
        throw new UserError("Not enough there.");
      }
    }
    for (const line of lines) await addToRoomStack(tx, hideout.id, line.tagId, line.quantity);
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "thanati_purchase",
      targetCharacterId: me.id,
      details: {
        room: hideout.name,
        roomId: hideout.id,
        source,
        total,
        lines: lines.map((l) => ({ name: l.name, quantity: l.quantity, each: l.each })),
      },
    });
  });

  // The room's ordinary stash line, the one Transfer already posts.
  after(() => announceInRoom(hideout, me, `leaves ${formatGoods(lines)} here.`));
  revalidate();
  return { ok: true, total };
}

export async function recallComrades() {
  return guarded(() => recallComradesImpl());
}
export async function recoverEquipment() {
  return guarded(() => recoverEquipmentImpl());
}
export async function setHideout(input) {
  return guarded(() => setHideoutImpl(input ?? {}));
}
export async function purchaseGear(input) {
  return guarded(() => purchaseGearImpl(input ?? {}));
}
