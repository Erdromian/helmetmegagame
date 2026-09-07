import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import CraftsTable from "./CraftsTable";

// Every craft project, running or done — the pocket-item twin of
// /gm/structures. A running project is otherwise invisible to a GM: it
// lives on one player's sheet, its spent ingredients live in
// CraftProject.consumed, and the audit rows only say it started. This page
// is the read; the repair, when one is needed, stays by hand on /gm/dev,
// with the Spent column saying exactly what went in. Open to every GM, no
// rail item — reachable through ⌘K, like /gm/structures.
export default async function CraftsPage() {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!isGm) redirect("/character");

  const rows = await prisma.craftProject.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      character: { select: { name: true } },
      tag: { select: { name: true } },
    },
  });

  // Turn numbers in one extra query — CraftProject stores turn ids as plain
  // strings (snapshot posture, no relation), the same shape the Depot ledger
  // resolves.
  const turnIds = [
    ...new Set(
      rows.flatMap((r) => [r.startedTurnId, r.lastTurnId]).filter(Boolean),
    ),
  ];
  const turnNumbers = new Map(
    turnIds.length
      ? (
          await prisma.turn.findMany({
            where: { id: { in: turnIds } },
            select: { id: true, number: true },
          })
        ).map((t) => [t.id, t.number])
      : [],
  );

  const projects = rows.map((row) => ({
    id: row.id,
    characterName: row.character?.name ?? "—",
    tagName: row.tag?.name ?? "—",
    quantity: row.quantity,
    status: row.status,
    turnsDone: row.turnsDone,
    turnsNeeded: row.turnsNeeded,
    resourcesCost: row.resourcesCost ?? 0,
    payerName: row.payerName ?? "—",
    // What the start consumed, readable — the snapshot a by-hand reversal
    // hands back (shape: the `replaced` list, CRAFTING.md §3).
    spent: Array.isArray(row.consumed)
      ? row.consumed
          .map((c) => (c?.quantity > 1 ? `${c.quantity}× ${c.tagName}` : c?.tagName))
          .filter(Boolean)
          .join(", ")
      : "",
    // The words a customizable project is carrying to its finishing turn.
    customName:
      row.custom && typeof row.custom === "object" ? (row.custom.name ?? "") : "",
    startedTurn: turnNumbers.get(row.startedTurnId) ?? null,
    lastTurn: turnNumbers.get(row.lastTurnId) ?? null,
    createdAtMs: row.createdAt.getTime(),
  }));

  return (
    <PageShell>
      <PageHeader
        title="Craft projects"
      />
      <CraftsTable projects={projects} />
    </PageShell>
  );
}
