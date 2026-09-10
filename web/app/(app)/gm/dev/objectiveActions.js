"use server";

// Antagonist objectives, behind /gm/dev?s=antagonists (THREATS.md §6a): add
// one, pin its answer, remove it, or drop in a party's standard set.
//
// Every action re-checks what the panel already checked — that the kind
// exists and belongs to the party, that the target is the shape the kind
// asks for, that a Location is one the map lets you blow up — because a
// server action is a public endpoint and a dropdown is a hint, not a lock.
import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { partyByKey } from "@lifeweb/db/lib/threats";
import {
  objectiveKind,
  kindsForParty,
  describeObjective,
  OBJECTIVE_WEIGHTS,
  PARTY_DEFAULTS,
  INQUISITOR_OR_BARON_ROLE_SLUGS,
} from "@lifeweb/db/lib/objectiveKinds";
import { locationEligible } from "@lifeweb/db/lib/objectives";
import { requireDev } from "@/lib/devAccess";


function repaint() {
  revalidatePath("/gm/dev");
}

// Resolves the target the kind asks for into the snapshot columns, or an error.
async function resolveTarget(kind, { targetCharacterId, targetLocationId, value, text }) {
  switch (kind.target) {
    case "character":
    case "leader":
    case "inquisitor-or-baron": {
      if (!targetCharacterId) return { error: "Pick a character." };
      const character = await prisma.character.findUnique({
        where: { id: targetCharacterId },
        select: { id: true, name: true, status: true, role: { select: { slug: true, requiresWhitelist: true } } },
      });
      if (!character) return { error: "That character no longer exists." };
      if (character.status !== "ALIVE") return { error: `${character.name} isn't alive.` };
      if (kind.target === "leader" && !character.role?.requiresWhitelist) {
        return { error: `${character.name} doesn't hold a leader's role.` };
      }
      if (kind.target === "inquisitor-or-baron" && !INQUISITOR_OR_BARON_ROLE_SLUGS.has(character.role?.slug)) {
        return { error: `${character.name} is neither the Inquisitor nor the Baron.` };
      }
      return { data: { targetCharacterId: character.id, targetName: character.name } };
    }
    case "location": {
      if (!targetLocationId) return { error: "Pick a Location." };
      const location = await prisma.location.findUnique({
        where: { id: targetLocationId },
        select: { id: true, name: true, attributes: true, zone: { select: { kind: true } } },
      });
      if (!location) return { error: "That Location no longer exists." };
      if (!locationEligible(location)) return { error: `${location.name} can't be blown up.` };
      return { data: { targetLocationId: location.id, targetLocationName: location.name } };
    }
    case "number": {
      const n = Number.parseInt(value, 10);
      if (!Number.isInteger(n) || n < 1) return { error: "The number has to be one or more." };
      return { data: { value: n } };
    }
    case "text": {
      const t = (text ?? "").toString().trim();
      if (!t) return { error: "Write what the objective is." };
      if (t.length > 200) return { error: "Keep it under two hundred characters." };
      return { data: { text: t } };
    }
    default:
      return { data: {} };
  }
}

// A fresh row's pin: scripted kinds start with the game deciding, manual
// kinds with the answer they start at (only Celebrate starts at Success).
function initialPin(kind) {
  return kind.script ? null : Boolean(kind.startsDone);
}

async function insertObjective(session, { partyKey, kind, targetData, weight }) {
  const row = await prisma.objective.create({
    data: {
      partyKey,
      kind: kind.key,
      weight,
      pinned: initialPin(kind),
      createdBy: session.discordUserId,
      ...targetData,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "objective_added",
      targetCharacterId: row.targetCharacterId ?? undefined,
      details: { party: partyKey, kind: kind.key, objective: describeObjective(row), weight },
    },
  });
  return row;
}

export async function addObjective({ partyKey, kind: kindKey, targetCharacterId, targetLocationId, value, text, weight }) {
  let session;
  try {
    session = await requireDev("gm");
  } catch {
    return { error: "Not authorized." };
  }

  const party = partyByKey(partyKey);
  if (!party) return { error: "That isn't an antagonist party." };
  const kind = objectiveKind(kindKey);
  if (!kind || !kindsForParty(party.key).includes(kind)) {
    return { error: `The ${party.name} can't take that objective.` };
  }

  // Custom rows take the GM's weight, or none; every other kind's is fixed.
  let finalWeight = kind.weight;
  if (kind.key === "custom") {
    if (weight && !OBJECTIVE_WEIGHTS.includes(weight)) return { error: "That isn't a weight." };
    finalWeight = weight || null;
  }

  const target = await resolveTarget(kind, { targetCharacterId, targetLocationId, value, text });
  if (target.error) return { error: target.error };

  const row = await insertObjective(session, { partyKey: party.key, kind, targetData: target.data, weight: finalWeight });
  repaint();
  return { ok: true, id: row.id, description: describeObjective(row) };
}

// The party's standard set, skipping any kind it already holds.
export async function addStandardObjectives({ partyKey }) {
  let session;
  try {
    session = await requireDev("gm");
  } catch {
    return { error: "Not authorized." };
  }
  const party = partyByKey(partyKey);
  if (!party) return { error: "That isn't an antagonist party." };
  const keys = PARTY_DEFAULTS[party.key] ?? [];
  if (keys.length === 0) return { error: `The ${party.name} have no standard set.` };

  const held = new Set(
    (await prisma.objective.findMany({ where: { partyKey: party.key }, select: { kind: true } })).map((o) => o.kind),
  );
  let added = 0;
  for (const key of keys) {
    const kind = objectiveKind(key);
    if (!kind || held.has(key)) continue;
    await insertObjective(session, { partyKey: party.key, kind, targetData: {}, weight: kind.weight });
    added += 1;
  }
  repaint();
  return { ok: true, added };
}

// The GM's answer. `pinned` is true, false, or null for "the game decides" —
// which only a scripted kind may take, since a manual kind has no script to
// fall back on.
export async function pinObjective({ id, pinned }) {
  let session;
  try {
    session = await requireDev("gm");
  } catch {
    return { error: "Not authorized." };
  }
  const row = await prisma.objective.findUnique({ where: { id } });
  if (!row) return { error: "That objective no longer exists." };
  const kind = objectiveKind(row.kind);
  const next = pinned === true ? true : pinned === false ? false : null;
  if (next === null && !kind?.script) return { error: "That one has no script to fall back on." };

  await prisma.objective.update({ where: { id }, data: { pinned: next } });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "objective_pinned",
      targetCharacterId: row.targetCharacterId ?? undefined,
      details: {
        party: row.partyKey,
        objective: describeObjective(row),
        pinned: next === null ? "game decides" : next ? "success" : "failed",
      },
    },
  });
  repaint();
  return { ok: true };
}

export async function removeObjective({ id }) {
  let session;
  try {
    session = await requireDev("gm");
  } catch {
    return { error: "Not authorized." };
  }
  const row = await prisma.objective.findUnique({ where: { id } });
  if (!row) return { error: "That objective no longer exists." };

  await prisma.objective.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "objective_removed",
      targetCharacterId: row.targetCharacterId ?? undefined,
      details: { party: row.partyKey, kind: row.kind, objective: describeObjective(row) },
    },
  });
  repaint();
  return { ok: true };
}
